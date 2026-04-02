from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import math
import re
from typing import Literal

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel, Field

app = FastAPI(title="thryftverse-ml-service", version="0.1.0")


TOKEN_PATTERN = re.compile(r"[a-z0-9]+")
ACTION_WEIGHTS = {
    "view": 1.0,
    "wishlist": 2.6,
    "purchase": 4.2,
}


def stable_rand(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    as_int = int.from_bytes(digest[:8], byteorder="big", signed=False)
    return as_int / float(2**64)


def tokenize(*parts: str) -> set[str]:
    values = " ".join(part for part in parts if part)
    return set(TOKEN_PATTERN.findall(values.lower()))


def to_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def jaccard_distance(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    union = len(a | b)
    if union == 0:
        return 0.0
    intersection = len(a & b)
    return 1.0 - (intersection / union)


class CandidateItem(BaseModel):
    listing_id: str
    title: str = ""
    description: str = ""
    price_gbp: float = Field(default=0, ge=0)
    created_at: datetime | None = None


class InteractionEvent(BaseModel):
    listing_id: str
    action: Literal["view", "wishlist", "purchase"]
    strength: float = Field(default=1.0, ge=0.05, le=20)
    created_at: datetime | None = None


class RecommendationRequest(BaseModel):
    user_id: str = Field(min_length=2)
    candidate_listing_ids: list[str] = Field(default_factory=lambda: ["l_seed_1", "l_seed_2", "l_seed_3"])
    candidates: list[CandidateItem] = Field(default_factory=list)
    recent_interactions: list[InteractionEvent] = Field(default_factory=list)
    result_limit: int = Field(default=20, ge=1, le=100)
    exploration_rate: float = Field(default=0.2, ge=0.0, le=0.45)


class RecommendationItem(BaseModel):
    listing_id: str
    score: float
    model: Literal["two_stage_ranker", "contextual_bandit_explore"]
    policy: Literal["exploit", "explore"]
    reason: str


class ClassificationRequest(BaseModel):
    image_url: str


class PriceForecastRequest(BaseModel):
    series: list[float] = Field(min_length=10)
    horizon_steps: int = Field(default=5, ge=1, le=90)


class PricingActionRequest(BaseModel):
    inventory: int = Field(ge=0)
    demand_index: float = Field(ge=0)
    current_price: float = Field(gt=0)


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "ok": "true",
        "service": "thryftverse-ml-service",
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/recommendations")
def recommendations(payload: RecommendationRequest) -> dict[str, list[RecommendationItem]]:
    candidates = payload.candidates or [CandidateItem(listing_id=item_id) for item_id in payload.candidate_listing_ids]
    if not candidates:
        return {"recommendations": []}

    now = datetime.now(timezone.utc)
    interactions = sorted(
        payload.recent_interactions,
        key=lambda event: to_utc(event.created_at) or now,
    )

    candidate_tokens: dict[str, set[str]] = {}
    for candidate in candidates:
        tokens = tokenize(candidate.title, candidate.description)
        if candidate.price_gbp > 0:
            tokens.add(f"price_bucket_{int(candidate.price_gbp // 25)}")
        if not tokens:
            tokens = {candidate.listing_id.lower()}
        candidate_tokens[candidate.listing_id] = tokens

    user_token_weights: dict[str, float] = {}
    sequence_state: dict[str, float] = {}
    interacted_prices: list[float] = []

    for idx, event in enumerate(interactions):
        recency_multiplier = 0.9 ** max(0, len(interactions) - idx - 1)
        action_weight = ACTION_WEIGHTS.get(event.action, 1.0)
        event_weight = action_weight * event.strength * recency_multiplier
        tokens = candidate_tokens.get(event.listing_id, {event.listing_id.lower()})

        for token in list(sequence_state.keys()):
            sequence_state[token] *= 0.82

        gate_input = max(0.05, min(2.5, event_weight / 2.0))
        gate_value = 1.0 / (1.0 + math.exp(-(gate_input - 0.8)))
        for token in tokens:
            user_token_weights[token] = user_token_weights.get(token, 0.0) + event_weight
            sequence_state[token] = sequence_state.get(token, 0.0) + gate_value

        for candidate in candidates:
            if candidate.listing_id == event.listing_id and candidate.price_gbp > 0:
                interacted_prices.append(candidate.price_gbp)
                break

    median_price = float(np.median(interacted_prices)) if interacted_prices else None

    retrieval_scores: list[tuple[CandidateItem, float, float, float, float]] = []
    for candidate in candidates:
        tokens = candidate_tokens[candidate.listing_id]

        affinity_raw = sum(user_token_weights.get(token, 0.0) for token in tokens)
        affinity_score = affinity_raw / (1.0 + len(tokens) * 1.75)

        sequence_raw = sum(sequence_state.get(token, 0.0) for token in tokens)
        sequence_score = sequence_raw / (1.0 + len(tokens))

        created_at = to_utc(candidate.created_at)
        if created_at is None:
            recency_score = 0.52
        else:
            age_seconds = max(0.0, (now - created_at).total_seconds())
            recency_score = float(math.exp(-age_seconds / (60.0 * 60.0 * 24.0 * 21.0)))

        if median_price is not None and candidate.price_gbp > 0:
            rel_delta = abs(candidate.price_gbp - median_price) / max(1.0, median_price)
            price_alignment = float(math.exp(-rel_delta * 1.35))
        else:
            price_alignment = 0.55

        retrieval_signal = 0.58 * affinity_score + 0.42 * sequence_score
        retrieval_signal += stable_rand(f"retrieval:{payload.user_id}:{candidate.listing_id}") * 0.01

        retrieval_scores.append((candidate, retrieval_signal, affinity_score, sequence_score, recency_score * price_alignment))

    retrieval_scores.sort(key=lambda item: item[1], reverse=True)
    pool_size = min(max(payload.result_limit * 3, 18), len(retrieval_scores))
    retrieval_pool = retrieval_scores[:pool_size]

    ranked_pool: list[tuple[CandidateItem, float, float, float, float]] = []
    for candidate, _, affinity_score, sequence_score, freshness_alignment in retrieval_pool:
        prior = 0.4 + stable_rand(f"prior:{payload.user_id}:{candidate.listing_id}") * 0.25
        exploit_score = (
            0.44 * affinity_score
            + 0.24 * sequence_score
            + 0.22 * freshness_alignment
            + 0.10 * prior
        )
        ranked_pool.append((candidate, exploit_score, affinity_score, sequence_score, freshness_alignment))

    ranked_pool.sort(key=lambda item: item[1], reverse=True)

    cold_start = len(interactions) < 4
    effective_explore_rate = payload.exploration_rate if not cold_start else max(payload.exploration_rate, 0.28)
    explore_count = min(max(int(round(payload.result_limit * effective_explore_rate)), 1), max(payload.result_limit // 2, 1))
    exploit_count = max(payload.result_limit - explore_count, 1)

    exploit_entries = ranked_pool[:exploit_count]
    selected_ids = {item[0].listing_id for item in exploit_entries}

    explore_candidates = [item for item in ranked_pool[exploit_count:] if item[0].listing_id not in selected_ids]
    selected_explore: list[tuple[CandidateItem, float, float, float, float]] = []
    selected_token_sets = [candidate_tokens[item[0].listing_id] for item in exploit_entries]

    while len(selected_explore) < explore_count and explore_candidates:
        best_idx = 0
        best_score = -1.0

        for idx, candidate_tuple in enumerate(explore_candidates):
            candidate, exploit_score, *_ = candidate_tuple
            token_set = candidate_tokens[candidate.listing_id]

            if not selected_token_sets:
                novelty = 1.0
            else:
                novelty = min(jaccard_distance(token_set, existing) for existing in selected_token_sets)

            uncertainty = max(0.05, 1.0 - min(1.0, exploit_score))
            blended_score = 0.65 * novelty + 0.35 * uncertainty

            if blended_score > best_score:
                best_idx = idx
                best_score = blended_score

        chosen = explore_candidates.pop(best_idx)
        selected_explore.append(chosen)
        selected_token_sets.append(candidate_tokens[chosen[0].listing_id])

    results: list[RecommendationItem] = []
    for candidate, exploit_score, affinity_score, sequence_score, freshness_alignment in exploit_entries:
        normalized = 1.0 / (1.0 + math.exp(-4.0 * (exploit_score - 0.5)))
        reason = (
            f"affinity={affinity_score:.3f}, sequence={sequence_score:.3f}, "
            f"freshness={freshness_alignment:.3f}"
        )
        results.append(
            RecommendationItem(
                listing_id=candidate.listing_id,
                score=float(round(min(max(normalized, 0.01), 0.99), 6)),
                model="two_stage_ranker",
                policy="exploit",
                reason=reason,
            )
        )

    for candidate, exploit_score, affinity_score, sequence_score, freshness_alignment in selected_explore:
        explore_score = max(0.12, min(0.92, exploit_score * 0.86 + 0.04))
        reason = (
            f"explore_bandit novelty with affinity={affinity_score:.3f}, sequence={sequence_score:.3f}, "
            f"freshness={freshness_alignment:.3f}"
        )
        results.append(
            RecommendationItem(
                listing_id=candidate.listing_id,
                score=float(round(explore_score, 6)),
                model="contextual_bandit_explore",
                policy="explore",
                reason=reason,
            )
        )

    deduped: list[RecommendationItem] = []
    seen_listing_ids: set[str] = set()
    for item in sorted(results, key=lambda rec: rec.score, reverse=True):
        if item.listing_id in seen_listing_ids:
            continue
        deduped.append(item)
        seen_listing_ids.add(item.listing_id)
        if len(deduped) >= payload.result_limit:
            break

    return {"recommendations": deduped}


@app.post("/classify-image")
def classify_image(payload: ClassificationRequest) -> dict[str, object]:
    # Heuristic placeholder for local development until vision model is connected.
    tags = ["streetwear", "outerwear"] if "jacket" in payload.image_url.lower() else ["fashion", "marketplace"]
    confidence = 0.78 if "jacket" in payload.image_url.lower() else 0.65
    return {
        "label": tags[0],
        "tags": tags,
        "confidence": confidence,
    }


@app.post("/forecast-price")
def forecast_price(payload: PriceForecastRequest) -> dict[str, object]:
    # Lightweight moving-trend forecast baseline. Replace with LSTM trainer output later.
    series = np.array(payload.series, dtype=np.float64)
    recent = series[-5:]
    trend = float(np.mean(np.diff(recent))) if recent.size >= 2 else 0.0

    last = float(series[-1])
    forecast = []
    for step in range(payload.horizon_steps):
        last = max(0.0, last + trend)
        forecast.append(round(last, 6))

    return {
        "model": "baseline_trend",
        "horizon_steps": payload.horizon_steps,
        "forecast": forecast,
    }


@app.post("/pricing-action")
def pricing_action(payload: PricingActionRequest) -> dict[str, object]:
    # Simple rule-policy baseline. Replace with RL policy endpoint when ready.
    if payload.inventory > 20 and payload.demand_index < 0.6:
        action = "decrease_price"
        next_price = payload.current_price * 0.97
    elif payload.demand_index > 1.2:
        action = "increase_price"
        next_price = payload.current_price * 1.03
    else:
        action = "hold"
        next_price = payload.current_price

    return {
        "policy": "baseline_rule_policy",
        "action": action,
        "suggested_price": round(next_price, 4),
    }
