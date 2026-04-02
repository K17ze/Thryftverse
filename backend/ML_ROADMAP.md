# ML/RL/LSTM Build Roadmap (Local-first)

This roadmap keeps model development local and containerized, while preserving a straight path to a small self-hosted server later.

## Phase A: Foundation (now)

Goal: working API contract and simple baseline models.

Implemented in this repo:
- `/recommendations` (baseline content recommender)
- `/classify-image` (heuristic placeholder)
- `/forecast-price` (baseline trend forecaster)
- `/pricing-action` (rule policy baseline)

Why this matters:
- Your frontend and Node API can integrate against stable ML endpoints immediately.
- You can replace internals model-by-model without breaking contracts.

## Phase B: Recommendation Engine (first real model)

Use case: marketplace listing ranking and personalized feed.

Recommended sequence:
1. Build offline dataset from Postgres interactions (`view`, `wishlist`, `purchase`) and listing metadata.
2. Start with two-tower retrieval model (user tower + listing tower).
3. Export top-K candidates into a feature store table or Redis cache.
4. Serve online ranking in `ml-service` via FastAPI endpoint.

Current implementation status:
- `ml-service /recommendations` now runs a two-stage online pipeline with retrieval + ranking.
- Ranking is sequence-aware (LSTM-inspired gated state) and includes controlled explore/exploit (contextual bandit style).
- API now forwards recent interactions and candidate metadata for personalization.

Minimal stack:
- PyTorch or TensorFlow
- pandas/polars for ETL
- scikit-learn for early baselines and diagnostics

## Phase C: Image Classifier (authenticity/category assist)

Use case: listing enrichment and moderation support.

Recommended sequence:
1. Curate labeled image dataset from listing photos.
2. Transfer-learn from EfficientNet/ConvNeXt.
3. Export model (TorchScript/ONNX) for inference.
4. Replace `/classify-image` heuristic with model inference.

## Phase D: Syndicate LSTM Price Predictor

Use case: assistive analytics for asset price trends (not financial advice).

Recommended sequence:
1. Build time-series table from syndicate trades and order-book snapshots.
2. Train baseline models first (ARIMA/XGBoost) as sanity checks.
3. Train LSTM/Temporal Fusion model for multi-horizon forecasting.
4. Serve confidence intervals, not point forecasts only.

Endpoint fit:
- Replace internals of `/forecast-price`

## Phase E: RL Pricing Agent (Syndicate)

Use case: pricing strategy suggestions under inventory + demand dynamics.

Recommended sequence:
1. Create simulator from historical events.
2. Start with contextual bandits before full RL.
3. Upgrade to PPO/SAC policy once simulator quality is proven.
4. Keep a strict safety layer: bounded price delta and human approval gate.

Endpoint fit:
- Replace internals of `/pricing-action`

## Local 3090 Training Setup (24GB VRAM)

Recommended options:
- Native CUDA on host for training jobs.
- Use Docker for serving/inference and orchestration.
- If using Docker for GPU training, use `nvidia-container-toolkit` and pass through GPUs.

Practical split:
- `ml-service` container: inference API and lightweight preprocessing.
- Separate training scripts/jobs on host (or dedicated train container) writing model artifacts to mounted volume or MinIO bucket.

## Promotion Path (Hetzner)

No architecture change required:
- Keep same `docker-compose.yml` and envs.
- Move from local volume-backed services to server volumes.
- Keep API contracts unchanged.

## Immediate Next Tasks

1. Add `backend/ml-service/app/train/` package with dataset loaders and first recommender baseline.
2. Add `backend/api/src/jobs/` to export interaction snapshots for training.
3. Add model registry convention (artifact path + version metadata table in Postgres).
4. Add simple offline eval report (Recall@K, NDCG) to make improvements measurable.
