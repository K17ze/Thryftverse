import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

export type ComplianceMarket = 'syndicate' | 'auctions' | 'wallet';
export type JurisdictionScope = 'country' | 'region' | 'global';
export type KycLevel = 'none' | 'basic' | 'enhanced';
export type KycStatus = 'not_started' | 'pending' | 'verified' | 'rejected' | 'expired';
export type SanctionsStatus = 'unknown' | 'clear' | 'watchlist' | 'blocked';
export type PepStatus = 'unknown' | 'clear' | 'flagged';
export type AmlRiskTier = 'low' | 'medium' | 'high' | 'critical';
export type AmlRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type AmlAlertStatus = 'open' | 'under_review' | 'sar_required' | 'dismissed';

export interface ComplianceProfile {
  userId: string;
  legalName: string | null;
  dateOfBirth: string | null;
  countryCode: string;
  residencyCountryCode: string | null;
  kycStatus: KycStatus;
  kycLevel: KycLevel;
  kycVendor: string | null;
  kycVendorRef: string | null;
  documentStatus: 'unsubmitted' | 'submitted' | 'approved' | 'rejected';
  livenessStatus: 'unsubmitted' | 'pending' | 'passed' | 'failed';
  sanctionsStatus: SanctionsStatus;
  pepStatus: PepStatus;
  amlRiskTier: AmlRiskTier;
  tradingEnabled: boolean;
  maxSingleTradeGbp: number | null;
  maxDailyVolumeGbp: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface JurisdictionRule {
  id: string;
  market: ComplianceMarket;
  scope: JurisdictionScope;
  scopeCode: string;
  isEnabled: boolean;
  minKycLevel: KycLevel;
  requireSanctionsClear: boolean;
  maxOrderNotionalGbp: number | null;
  maxDailyNotionalGbp: number | null;
  maxOpenOrders: number | null;
  blockedReason: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MarketEligibilityDecision {
  allowed: boolean;
  code: string;
  message: string;
  userId: string;
  market: ComplianceMarket;
  countryCode: string;
  jurisdictionGroups: string[];
  orderNotionalGbp: number;
  dailyNotionalGbp: number;
  openOrderCount: number;
  rule: JurisdictionRule | null;
  profile: Pick<
    ComplianceProfile,
    | 'kycStatus'
    | 'kycLevel'
    | 'sanctionsStatus'
    | 'pepStatus'
    | 'amlRiskTier'
    | 'tradingEnabled'
    | 'maxSingleTradeGbp'
    | 'maxDailyVolumeGbp'
  >;
}

export interface AmlRiskAssessment {
  userId: string;
  market: ComplianceMarket;
  riskScore: number;
  riskLevel: AmlRiskLevel;
  recommendedAlertStatus: AmlAlertStatus;
  shouldCreateAlert: boolean;
  shouldBlock: boolean;
  reasons: string[];
  profile: Pick<
    ComplianceProfile,
    'countryCode' | 'kycStatus' | 'kycLevel' | 'sanctionsStatus' | 'pepStatus' | 'amlRiskTier'
  >;
  exposure: {
    dailyNotionalGbp: number;
    openOrderCount: number;
  };
}

interface MarketEligibilityInput {
  userId: string;
  market: ComplianceMarket;
  orderNotionalGbp: number;
}

interface AmlRiskInput {
  userId: string;
  market: ComplianceMarket;
  amountGbp: number;
  counterpartyUserId?: string | null;
}

interface CreateAmlAlertInput {
  userId: string;
  relatedUserId?: string | null;
  market: ComplianceMarket;
  eventType: 'trade' | 'bid' | 'deposit' | 'withdrawal' | 'manual';
  amountGbp: number;
  referenceId?: string | null;
  ruleCode?: string | null;
  notes?: string | null;
  context?: Record<string, unknown>;
  assessment: AmlRiskAssessment;
}

interface ComplianceProfileRow {
  user_id: string;
  legal_name: string | null;
  date_of_birth: string | null;
  country_code: string;
  residency_country_code: string | null;
  kyc_status: KycStatus;
  kyc_level: KycLevel;
  kyc_vendor: string | null;
  kyc_vendor_ref: string | null;
  document_status: 'unsubmitted' | 'submitted' | 'approved' | 'rejected';
  liveness_status: 'unsubmitted' | 'pending' | 'passed' | 'failed';
  sanctions_status: SanctionsStatus;
  pep_status: PepStatus;
  aml_risk_tier: AmlRiskTier;
  trading_enabled: boolean;
  max_single_trade_gbp: string | null;
  max_daily_volume_gbp: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface JurisdictionRuleRow {
  id: string;
  market: ComplianceMarket;
  scope: JurisdictionScope;
  scope_code: string;
  is_enabled: boolean;
  min_kyc_level: KycLevel;
  require_sanctions_clear: boolean;
  max_order_notional_gbp: string | null;
  max_daily_notional_gbp: string | null;
  max_open_orders: number | null;
  blocked_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

type DbQueryable = Pick<PoolClient, 'query'>;
type DbConnectable = Pick<Pool, 'connect'>;

const COMPLIANCE_AUDIT_LOCK_ID = 904_220_131;

const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

const GULF_COUNTRIES = new Set(['AE', 'SA', 'QA', 'KW', 'BH', 'OM']);

const AFRICA_COUNTRIES = new Set([
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ',
  'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG',
  'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'SN', 'SC', 'SL', 'SO', 'ZA',
  'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
]);

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toOptionalNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = toNumber(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function riskLevelFromScore(score: number): AmlRiskLevel {
  if (score >= 85) {
    return 'critical';
  }

  if (score >= 65) {
    return 'high';
  }

  if (score >= 40) {
    return 'medium';
  }

  return 'low';
}

function minDefined(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) {
    return null;
  }

  return Math.min(...present);
}

function kycLevelRank(level: KycLevel): number {
  if (level === 'none') {
    return 0;
  }

  if (level === 'basic') {
    return 1;
  }

  return 2;
}

function hasRequiredKycLevel(actual: KycLevel, minimum: KycLevel): boolean {
  return kycLevelRank(actual) >= kycLevelRank(minimum);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key) => {
      const entryValue = record[key];
      if (entryValue === undefined) {
        return [];
      }

      return [`${JSON.stringify(key)}:${stableStringify(entryValue)}`];
    });

  return `{${entries.join(',')}}`;
}

export function normalizeCountryCode(countryCode: string | null | undefined, fallback = 'GB'): string {
  const raw = countryCode?.trim().toUpperCase();
  if (raw && raw.length >= 2 && raw.length <= 3) {
    return raw;
  }

  return fallback.toUpperCase();
}

export function countryToJurisdictionGroups(countryCode: string): string[] {
  const normalized = normalizeCountryCode(countryCode);
  const groups = new Set<string>();

  if (normalized === 'IN') {
    groups.add('IN');
  }

  if (EU_COUNTRIES.has(normalized)) {
    groups.add('EU');
  }

  if (GULF_COUNTRIES.has(normalized)) {
    groups.add('GULF');
  }

  if (AFRICA_COUNTRIES.has(normalized)) {
    groups.add('AFRICA');
  }

  groups.add('GLOBAL');
  return [...groups];
}

export function resolveClientIp(
  requestIp: string,
  forwardedFor: string | string[] | undefined
): string {
  const fallback = requestIp.trim();

  if (Array.isArray(forwardedFor)) {
    for (const value of forwardedFor) {
      const first = value.split(',')[0]?.trim();
      if (first) {
        return first;
      }
    }

    return fallback;
  }

  if (typeof forwardedFor === 'string') {
    const first = forwardedFor.split(',')[0]?.trim();
    return first || fallback;
  }

  return fallback;
}

export function createComplianceId(prefix: string): string {
  const ts = Date.now();
  const nonce = Math.floor(Math.random() * 1_000_000).toString().padStart(6, '0');
  return `${prefix}_${ts}_${nonce}`;
}

function mapProfileRow(row: ComplianceProfileRow): ComplianceProfile {
  return {
    userId: row.user_id,
    legalName: row.legal_name,
    dateOfBirth: row.date_of_birth,
    countryCode: normalizeCountryCode(row.country_code),
    residencyCountryCode: row.residency_country_code,
    kycStatus: row.kyc_status,
    kycLevel: row.kyc_level,
    kycVendor: row.kyc_vendor,
    kycVendorRef: row.kyc_vendor_ref,
    documentStatus: row.document_status,
    livenessStatus: row.liveness_status,
    sanctionsStatus: row.sanctions_status,
    pepStatus: row.pep_status,
    amlRiskTier: row.aml_risk_tier,
    tradingEnabled: row.trading_enabled,
    maxSingleTradeGbp: toOptionalNumber(row.max_single_trade_gbp),
    maxDailyVolumeGbp: toOptionalNumber(row.max_daily_volume_gbp),
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRuleRow(row: JurisdictionRuleRow): JurisdictionRule {
  return {
    id: row.id,
    market: row.market,
    scope: row.scope,
    scopeCode: row.scope_code,
    isEnabled: row.is_enabled,
    minKycLevel: row.min_kyc_level,
    requireSanctionsClear: row.require_sanctions_clear,
    maxOrderNotionalGbp: toOptionalNumber(row.max_order_notional_gbp),
    maxDailyNotionalGbp: toOptionalNumber(row.max_daily_notional_gbp),
    maxOpenOrders: row.max_open_orders,
    blockedReason: row.blocked_reason,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getOrCreateComplianceProfile(
  client: DbQueryable,
  userId: string
): Promise<ComplianceProfile> {
  await client.query(
    `
      INSERT INTO user_compliance_profiles (
        user_id,
        country_code,
        kyc_status,
        kyc_level,
        document_status,
        liveness_status,
        sanctions_status,
        pep_status,
        aml_risk_tier,
        trading_enabled
      )
      VALUES ($1, 'GB', 'not_started', 'basic', 'unsubmitted', 'unsubmitted', 'unknown', 'unknown', 'medium', FALSE)
      ON CONFLICT (user_id) DO NOTHING
    `,
    [userId]
  );

  const result = await client.query<ComplianceProfileRow>(
    `
      SELECT
        user_id,
        legal_name,
        date_of_birth::text,
        country_code,
        residency_country_code,
        kyc_status,
        kyc_level,
        kyc_vendor,
        kyc_vendor_ref,
        document_status,
        liveness_status,
        sanctions_status,
        pep_status,
        aml_risk_tier,
        trading_enabled,
        max_single_trade_gbp::text,
        max_daily_volume_gbp::text,
        metadata,
        created_at::text,
        updated_at::text
      FROM user_compliance_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Compliance profile missing for user ${userId}`);
  }

  return mapProfileRow(row);
}

export async function resolveJurisdictionRule(
  client: DbQueryable,
  market: ComplianceMarket,
  countryCode: string
): Promise<JurisdictionRule | null> {
  const normalizedCountry = normalizeCountryCode(countryCode);
  const groups = countryToJurisdictionGroups(normalizedCountry).filter((group) => group !== 'GLOBAL');

  const result = await client.query<JurisdictionRuleRow>(
    `
      SELECT
        id,
        market,
        scope,
        scope_code,
        is_enabled,
        min_kyc_level,
        require_sanctions_clear,
        max_order_notional_gbp::text,
        max_daily_notional_gbp::text,
        max_open_orders,
        blocked_reason,
        metadata,
        created_at::text,
        updated_at::text
      FROM jurisdiction_rules
      WHERE market = $1
        AND (
          (scope = 'country' AND scope_code = $2)
          OR (scope = 'region' AND scope_code = ANY($3::text[]))
          OR (scope = 'global' AND scope_code = 'GLOBAL')
        )
    `,
    [market, normalizedCountry, groups.length ? groups : ['__none__']]
  );

  if (!result.rowCount) {
    return null;
  }

  const groupPriority = new Map(countryToJurisdictionGroups(normalizedCountry).map((group, index) => [group, index]));
  const ranked = result.rows
    .slice()
    .sort((a, b) => {
      const rank = (row: JurisdictionRuleRow): number => {
        if (row.scope === 'country' && row.scope_code === normalizedCountry) {
          return 0;
        }

        if (row.scope === 'region') {
          return 10 + (groupPriority.get(row.scope_code) ?? 90);
        }

        return 100;
      };

      return rank(a) - rank(b);
    });

  return mapRuleRow(ranked[0]);
}

async function readMarketExposure(
  client: DbQueryable,
  userId: string,
  market: ComplianceMarket
): Promise<{ dailyNotionalGbp: number; openOrderCount: number }> {
  if (market === 'syndicate') {
    const dailyNotional = await client.query<{ notional: string }>(
      `
        SELECT COALESCE(
          SUM(
            CASE
              WHEN status IN ('open', 'partially_filled')
                THEN remaining_units * unit_price_gbp
              ELSE total_gbp
            END
          ),
          0
        )::text AS notional
        FROM syndicate_orders
        WHERE user_id = $1
          AND created_at >= date_trunc('day', NOW())
      `,
      [userId]
    );

    const openOrders = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM syndicate_orders
        WHERE user_id = $1
          AND status IN ('open', 'partially_filled')
      `,
      [userId]
    );

    return {
      dailyNotionalGbp: roundTo(toNumber(dailyNotional.rows[0]?.notional), 2),
      openOrderCount: Math.max(0, Math.floor(toNumber(openOrders.rows[0]?.count))),
    };
  }

  if (market === 'auctions') {
    const dailyNotional = await client.query<{ notional: string }>(
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS notional
        FROM auction_bids
        WHERE bidder_id = $1
          AND created_at >= date_trunc('day', NOW())
      `,
      [userId]
    );

    const openOrders = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM auction_bids ab
        INNER JOIN auctions a ON a.id = ab.auction_id
        WHERE ab.bidder_id = $1
          AND a.ends_at > NOW()
          AND a.status IN ('upcoming', 'live')
      `,
      [userId]
    );

    return {
      dailyNotionalGbp: roundTo(toNumber(dailyNotional.rows[0]?.notional), 2),
      openOrderCount: Math.max(0, Math.floor(toNumber(openOrders.rows[0]?.count))),
    };
  }

  return {
    dailyNotionalGbp: 0,
    openOrderCount: 0,
  };
}

async function hasAcceptedActiveRiskDisclosure(
  client: DbQueryable,
  userId: string
): Promise<boolean> {
  const result = await client.query<{ accepted: boolean }>(
    `
      SELECT EXISTS(
        SELECT 1
        FROM legal_documents ld
        INNER JOIN user_consents uc ON uc.document_id = ld.id
        WHERE uc.user_id = $1
          AND uc.accepted = TRUE
          AND ld.doc_type = 'risk_disclosure'
          AND ld.is_active = TRUE
          AND ld.effective_at <= NOW()
          AND (ld.retired_at IS NULL OR ld.retired_at > NOW())
      ) AS accepted
    `,
    [userId]
  );

  return result.rows[0]?.accepted === true;
}

export async function evaluateMarketEligibility(
  client: DbQueryable,
  input: MarketEligibilityInput
): Promise<MarketEligibilityDecision> {
  const profile = await getOrCreateComplianceProfile(client, input.userId);
  const countryCode = normalizeCountryCode(profile.countryCode);
  const groups = countryToJurisdictionGroups(countryCode);
  const rule = await resolveJurisdictionRule(client, input.market, countryCode);
  const exposure = await readMarketExposure(client, input.userId, input.market);
  const orderNotional = roundTo(Math.max(0, input.orderNotionalGbp), 2);

  const base = {
    userId: input.userId,
    market: input.market,
    countryCode,
    jurisdictionGroups: groups,
    orderNotionalGbp: orderNotional,
    dailyNotionalGbp: exposure.dailyNotionalGbp,
    openOrderCount: exposure.openOrderCount,
    rule,
    profile: {
      kycStatus: profile.kycStatus,
      kycLevel: profile.kycLevel,
      sanctionsStatus: profile.sanctionsStatus,
      pepStatus: profile.pepStatus,
      amlRiskTier: profile.amlRiskTier,
      tradingEnabled: profile.tradingEnabled,
      maxSingleTradeGbp: profile.maxSingleTradeGbp,
      maxDailyVolumeGbp: profile.maxDailyVolumeGbp,
    },
  };

  const deny = (code: string, message: string): MarketEligibilityDecision => ({
    allowed: false,
    code,
    message,
    ...base,
  });

  if (!rule) {
    return deny('JURISDICTION_RULE_MISSING', 'No jurisdiction rule configured for this market.');
  }

  if (!rule.isEnabled) {
    return deny(
      'JURISDICTION_BLOCKED',
      rule.blockedReason ?? 'Trading is currently unavailable in your jurisdiction.'
    );
  }

  if (profile.sanctionsStatus === 'blocked') {
    return deny('SANCTIONS_BLOCKED', 'Account is blocked after sanctions screening.');
  }

  if (!profile.tradingEnabled) {
    return deny('TRADING_DISABLED', 'Trading is disabled pending compliance review.');
  }

  if (profile.kycStatus !== 'verified') {
    return deny('KYC_REQUIRED', 'Complete identity verification before trading.');
  }

  if (!hasRequiredKycLevel(profile.kycLevel, rule.minKycLevel)) {
    return deny(
      'KYC_LEVEL_INSUFFICIENT',
      `Your KYC level is insufficient for ${input.market}. Required: ${rule.minKycLevel}.`
    );
  }

  if (input.market === 'syndicate') {
    const acceptedRiskDisclosure = await hasAcceptedActiveRiskDisclosure(client, input.userId);
    if (!acceptedRiskDisclosure) {
      return deny(
        'RISK_DISCLOSURE_REQUIRED',
        'Accept the active syndicate risk disclosure before trading.'
      );
    }
  }

  if (rule.requireSanctionsClear && profile.sanctionsStatus !== 'clear') {
    return deny(
      'SANCTIONS_REVIEW_REQUIRED',
      'Trading is paused until sanctions screening is cleared.'
    );
  }

  const maxSingleLimit = minDefined([rule.maxOrderNotionalGbp, profile.maxSingleTradeGbp]);
  if (maxSingleLimit !== null && orderNotional > maxSingleLimit) {
    return deny(
      'MAX_ORDER_NOTIONAL_EXCEEDED',
      `Order notional exceeds your permitted limit of ${maxSingleLimit.toFixed(2)} GBP.`
    );
  }

  const maxDailyLimit = minDefined([rule.maxDailyNotionalGbp, profile.maxDailyVolumeGbp]);
  if (maxDailyLimit !== null && exposure.dailyNotionalGbp + orderNotional > maxDailyLimit) {
    return deny(
      'MAX_DAILY_NOTIONAL_EXCEEDED',
      `Daily trading limit exceeded. Remaining allowance is ${Math.max(
        0,
        roundTo(maxDailyLimit - exposure.dailyNotionalGbp, 2)
      ).toFixed(2)} GBP.`
    );
  }

  if (rule.maxOpenOrders !== null && exposure.openOrderCount >= rule.maxOpenOrders) {
    return deny(
      'MAX_OPEN_ORDERS_EXCEEDED',
      `Open order limit reached (${rule.maxOpenOrders}).`
    );
  }

  return {
    allowed: true,
    code: 'ALLOWED',
    message: 'Trading eligibility checks passed.',
    ...base,
  };
}

export async function evaluateAmlRisk(
  client: DbQueryable,
  input: AmlRiskInput
): Promise<AmlRiskAssessment> {
  const profile = await getOrCreateComplianceProfile(client, input.userId);
  const exposure = await readMarketExposure(client, input.userId, input.market);

  const amount = roundTo(Math.max(0, input.amountGbp), 2);
  const reasons: string[] = [];
  let score = 0;

  if (amount >= 20_000) {
    score += 48;
    reasons.push('amount_over_20000');
  } else if (amount >= 10_000) {
    score += 36;
    reasons.push('amount_over_10000');
  } else if (amount >= 5_000) {
    score += 24;
    reasons.push('amount_over_5000');
  } else if (amount >= 2_000) {
    score += 16;
    reasons.push('amount_over_2000');
  } else {
    score += 8;
  }

  if (profile.kycStatus !== 'verified') {
    score += 28;
    reasons.push('kyc_not_verified');
  }

  if (profile.kycLevel === 'none') {
    score += 12;
    reasons.push('kyc_level_none');
  }

  if (profile.sanctionsStatus === 'watchlist') {
    score += 45;
    reasons.push('sanctions_watchlist');
  } else if (profile.sanctionsStatus === 'blocked') {
    score += 70;
    reasons.push('sanctions_blocked');
  } else if (profile.sanctionsStatus === 'unknown') {
    score += 18;
    reasons.push('sanctions_unknown');
  }

  if (profile.pepStatus === 'flagged') {
    score += 22;
    reasons.push('pep_flagged');
  }

  if (profile.amlRiskTier === 'medium') {
    score += 6;
  } else if (profile.amlRiskTier === 'high') {
    score += 14;
    reasons.push('risk_tier_high');
  } else if (profile.amlRiskTier === 'critical') {
    score += 24;
    reasons.push('risk_tier_critical');
  }

  const projectedDailyNotional = roundTo(exposure.dailyNotionalGbp + amount, 2);
  if (projectedDailyNotional >= 50_000) {
    score += 22;
    reasons.push('projected_daily_over_50000');
  } else if (projectedDailyNotional >= 20_000) {
    score += 12;
    reasons.push('projected_daily_over_20000');
  }

  if (input.counterpartyUserId && input.counterpartyUserId === input.userId) {
    score += 20;
    reasons.push('self_counterparty_detected');
  }

  score = Math.max(0, Math.min(100, roundTo(score, 2)));

  const riskLevel = riskLevelFromScore(score);
  const recommendedAlertStatus: AmlAlertStatus =
    riskLevel === 'critical'
      ? 'sar_required'
      : riskLevel === 'high'
        ? 'open'
        : riskLevel === 'medium'
          ? 'under_review'
          : 'dismissed';

  const shouldCreateAlert = score >= 40;
  const shouldBlock = riskLevel === 'critical' || profile.sanctionsStatus === 'blocked';

  return {
    userId: input.userId,
    market: input.market,
    riskScore: score,
    riskLevel,
    recommendedAlertStatus,
    shouldCreateAlert,
    shouldBlock,
    reasons,
    profile: {
      countryCode: normalizeCountryCode(profile.countryCode),
      kycStatus: profile.kycStatus,
      kycLevel: profile.kycLevel,
      sanctionsStatus: profile.sanctionsStatus,
      pepStatus: profile.pepStatus,
      amlRiskTier: profile.amlRiskTier,
    },
    exposure,
  };
}

export async function createAmlAlert(
  client: DbQueryable,
  input: CreateAmlAlertInput
): Promise<{ alertId: string; status: AmlAlertStatus }> {
  const alertId = createComplianceId('aml');

  await client.query(
    `
      INSERT INTO aml_alerts (
        id,
        user_id,
        related_user_id,
        market,
        event_type,
        risk_score,
        risk_level,
        status,
        amount_gbp,
        reference_id,
        rule_code,
        notes,
        context
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
    `,
    [
      alertId,
      input.userId,
      input.relatedUserId ?? null,
      input.market,
      input.eventType,
      input.assessment.riskScore,
      input.assessment.riskLevel,
      input.assessment.recommendedAlertStatus,
      roundTo(Math.max(0, input.amountGbp), 2),
      input.referenceId ?? null,
      input.ruleCode ?? null,
      input.notes ?? null,
      JSON.stringify({
        ...input.context,
        reasons: input.assessment.reasons,
        profile: input.assessment.profile,
        exposure: input.assessment.exposure,
      }),
    ]
  );

  return {
    alertId,
    status: input.assessment.recommendedAlertStatus,
  };
}

export interface ComplianceAuditEventInput {
  eventType: string;
  actorUserId?: string | null;
  subjectUserId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown>;
  createdAt?: string;
}

interface AuditHashMaterial {
  previousHash: string;
  eventType: string;
  actorUserId: string;
  subjectUserId: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function buildAuditEntryHash(material: AuditHashMaterial): string {
  const payload = stableStringify(material.payload);
  const serialized = [
    material.previousHash,
    material.eventType,
    material.actorUserId,
    material.subjectUserId,
    material.requestId,
    material.ipAddress,
    material.userAgent,
    material.createdAt,
    payload,
  ].join('|');

  return createHash('sha256').update(serialized).digest('hex');
}

export async function appendComplianceAuditEvent(
  db: DbConnectable,
  input: ComplianceAuditEventInput
): Promise<{ id: number; previousHash: string; entryHash: string; createdAt: string }> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [COMPLIANCE_AUDIT_LOCK_ID]);

    const previousResult = await client.query<{ entry_hash: string }>(
      `
        SELECT entry_hash
        FROM compliance_audit_log
        ORDER BY id DESC
        LIMIT 1
      `
    );

    const previousHash = previousResult.rows[0]?.entry_hash ?? '0'.repeat(64);
    const createdAt = input.createdAt ?? new Date().toISOString();
    const payload = input.payload ?? {};

    const entryHash = buildAuditEntryHash({
      previousHash,
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? '',
      subjectUserId: input.subjectUserId ?? '',
      requestId: input.requestId ?? '',
      ipAddress: input.ipAddress ?? '',
      userAgent: input.userAgent ?? '',
      createdAt,
      payload,
    });

    const insertResult = await client.query<{ id: number }>(
      `
        INSERT INTO compliance_audit_log (
          event_type,
          actor_user_id,
          subject_user_id,
          request_id,
          ip_address,
          user_agent,
          payload,
          previous_hash,
          entry_hash,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
        RETURNING id
      `,
      [
        input.eventType,
        input.actorUserId ?? null,
        input.subjectUserId ?? null,
        input.requestId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        JSON.stringify(payload),
        previousHash,
        entryHash,
        createdAt,
      ]
    );

    await client.query('COMMIT');

    return {
      id: insertResult.rows[0].id,
      previousHash,
      entryHash,
      createdAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
