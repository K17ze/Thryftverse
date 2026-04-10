import { config } from '../config.js';

type Queryable = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export interface GoldRateSnapshot {
  currency: string;
  ratePerGram: number;
  source: string;
  fetchedAt: string;
  expiresAt: string;
  isFallback: boolean;
  isOverride: boolean;
}

export interface IzeReconciliationAttestation {
  id: string;
  liquidityBufferIze: null;
  outstandingIze: number;
  circulatingIze: number;
  supplyDeltaIze: number;
  driftIze: number;
  withinThreshold: boolean;
  createdAt: string;
  thresholdIze: number;
}

export type GoldReserveAttestation = IzeReconciliationAttestation;

const DEFAULT_FALLBACK_RATES: Record<string, number> = {
  GBP: 75.2,
  USD: 95.4,
  EUR: 88.1,
  NGN: 72500,
  JPY: 14380,
  CAD: 129.6,
  AUD: 145.7,
  AED: 350.4,
  INR: 7940,
};

function runtimeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function parseProviderRate(payload: unknown, currency: string): number | null {
  const root = asRecord(payload);
  const upper = currency.toUpperCase();

  const direct = asNumber(root[upper]);
  if (direct && direct > 0) {
    return direct;
  }

  const rates = asRecord(root.rates);
  const ratesValue = asNumber(rates[upper]);
  if (ratesValue && ratesValue > 0) {
    return ratesValue;
  }

  const data = asRecord(root.data);
  const dataValue = asNumber(data[upper]);
  if (dataValue && dataValue > 0) {
    return dataValue;
  }

  const quotes = asRecord(root.quotes);
  const quoteKey = `XAU${upper}`;
  const quoteValue = asNumber(quotes[quoteKey]);
  if (quoteValue && quoteValue > 0) {
    return quoteValue;
  }

  const xau = asRecord(asRecord(root.metal_prices).XAU);
  const xauValue = asNumber(xau[upper]);
  if (xauValue && xauValue > 0) {
    return xauValue;
  }

  return null;
}

async function fetchProviderRate(currency: string): Promise<{ source: string; ratePerGram: number } | null> {
  const upper = currency.toUpperCase();

  const baseUrl = config.goldOracleApiUrl;
  const hasQuery = baseUrl.includes('?');
  const url = `${baseUrl}${hasQuery ? '&' : '?'}currency=${encodeURIComponent(upper)}&base=XAU`;

  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (config.goldOracleApiKey) {
    headers.authorization = `Bearer ${config.goldOracleApiKey}`;
    headers['x-api-key'] = config.goldOracleApiKey;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const ratePerGram = parseProviderRate(payload, upper);

    if (!ratePerGram || ratePerGram <= 0) {
      return null;
    }

    return {
      source: 'provider',
      ratePerGram,
    };
  } catch {
    return null;
  }
}

async function findActiveOverride(client: Queryable, currency: string): Promise<GoldRateSnapshot | null> {
  const upper = currency.toUpperCase();

  const result = await client.query<{
    rate_per_gram: string;
    created_at: string;
    expires_at: string | null;
  }>(
    `
      SELECT rate_per_gram::text, created_at::text, expires_at::text
      FROM gold_rate_overrides
      WHERE currency = $1
        AND is_active = TRUE
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [upper]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    currency: upper,
    ratePerGram: Number(row.rate_per_gram),
    source: 'operator_override',
    fetchedAt: row.created_at,
    expiresAt: row.expires_at ?? new Date(Date.now() + config.goldOracleTtlSeconds * 1000).toISOString(),
    isFallback: false,
    isOverride: true,
  };
}

async function findLatestFreshQuote(client: Queryable, currency: string): Promise<GoldRateSnapshot | null> {
  const upper = currency.toUpperCase();

  const result = await client.query<{
    source: string;
    rate_per_gram: string;
    fetched_at: string;
    expires_at: string;
    is_fallback: boolean;
  }>(
    `
      SELECT source, rate_per_gram::text, fetched_at::text, expires_at::text, is_fallback
      FROM gold_rate_quotes
      WHERE currency = $1
        AND expires_at > NOW()
      ORDER BY fetched_at DESC
      LIMIT 1
    `,
    [upper]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    currency: upper,
    ratePerGram: Number(row.rate_per_gram),
    source: row.source,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    isFallback: row.is_fallback,
    isOverride: false,
  };
}

async function insertQuote(
  client: Queryable,
  input: {
    currency: string;
    source: string;
    ratePerGram: number;
    fetchedAt: Date;
    expiresAt: Date;
    isFallback: boolean;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO gold_rate_quotes (
        source,
        currency,
        rate_per_gram,
        fetched_at,
        expires_at,
        is_fallback,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
    `,
    [
      input.source,
      input.currency,
      input.ratePerGram,
      input.fetchedAt.toISOString(),
      input.expiresAt.toISOString(),
      input.isFallback,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

export async function resolveGoldRate(
  client: Queryable,
  currency: string,
  options?: { forceRefresh?: boolean }
): Promise<GoldRateSnapshot> {
  const upper = currency.toUpperCase();

  const override = await findActiveOverride(client, upper);
  if (override) {
    return override;
  }

  if (!options?.forceRefresh) {
    const fresh = await findLatestFreshQuote(client, upper);
    if (fresh) {
      return fresh;
    }
  }

  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + Math.max(30, config.goldOracleTtlSeconds) * 1000);

  const providerRate = await fetchProviderRate(upper);
  if (providerRate) {
    await insertQuote(client, {
      currency: upper,
      source: providerRate.source,
      ratePerGram: providerRate.ratePerGram,
      fetchedAt,
      expiresAt,
      isFallback: false,
    });

    return {
      currency: upper,
      ratePerGram: providerRate.ratePerGram,
      source: providerRate.source,
      fetchedAt: fetchedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      isFallback: false,
      isOverride: false,
    };
  }

  const fallback = DEFAULT_FALLBACK_RATES[upper] ?? DEFAULT_FALLBACK_RATES.GBP;
  await insertQuote(client, {
    currency: upper,
    source: 'fallback',
    ratePerGram: fallback,
    fetchedAt,
    expiresAt,
    isFallback: true,
    metadata: {
      reason: 'provider_unavailable',
    },
  });

  return {
    currency: upper,
    ratePerGram: fallback,
    source: 'fallback',
    fetchedAt: fetchedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    isFallback: true,
    isOverride: false,
  };
}

export async function setGoldRateOverride(
  client: Queryable,
  input: {
    currency: string;
    ratePerGram: number;
    reason?: string;
    createdBy?: string;
    expiresAt?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const upper = input.currency.toUpperCase();

  await client.query(
    `
      UPDATE gold_rate_overrides
      SET is_active = FALSE
      WHERE currency = $1
        AND is_active = TRUE
    `,
    [upper]
  );

  await client.query(
    `
      INSERT INTO gold_rate_overrides (
        currency,
        rate_per_gram,
        reason,
        created_by,
        is_active,
        expires_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, TRUE, $5, $6::jsonb)
    `,
    [
      upper,
      input.ratePerGram,
      input.reason ?? null,
      input.createdBy ?? null,
      input.expiresAt ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

async function getPlatformLedgerBalance(
  client: Queryable,
  accountCode: 'ize_outstanding',
  currency: string
): Promise<number> {
  const result = await client.query<{ balance: string }>(
    `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN le.direction = 'credit' THEN le.amount
              ELSE -le.amount
            END
          ),
          0
        )::text AS balance
      FROM ledger_entries le
      INNER JOIN ledger_accounts la ON la.id = le.account_id
      WHERE la.owner_type = 'platform'
        AND la.owner_id = 'platform'
        AND la.account_code = $1
        AND la.currency = $2
    `,
    [accountCode, currency]
  );

  return Number(result.rows[0]?.balance ?? '0');
}

async function getTotalUserIzeWalletBalance(client: Queryable): Promise<number> {
  const result = await client.query<{ balance: string }>(
    `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN le.direction = 'credit' THEN le.amount
              ELSE -le.amount
            END
          ),
          0
        )::text AS balance
      FROM ledger_entries le
      INNER JOIN ledger_accounts la ON la.id = le.account_id
      WHERE la.owner_type = 'user'
        AND la.account_code = 'ize_wallet'
        AND la.currency = 'IZE'
    `
  );

  return Number(result.rows[0]?.balance ?? '0');
}

export async function createIzeReconciliationAttestation(
  client: Queryable,
  options?: {
    attestedBy?: string;
    metadata?: Record<string, unknown>;
    thresholdIze?: number;
  }
): Promise<IzeReconciliationAttestation> {
  const threshold = options?.thresholdIze ?? config.goldReserveDriftThresholdGrams;

  const [outstandingIze, circulatingIze] = await Promise.all([
    getPlatformLedgerBalance(client, 'ize_outstanding', 'IZE'),
    getTotalUserIzeWalletBalance(client),
  ]);

  const supplyDeltaIze = Number((circulatingIze - outstandingIze).toFixed(6));
  const driftIze = supplyDeltaIze;
  const withinThreshold = Math.abs(supplyDeltaIze) <= Math.abs(threshold);
  const liquidityBufferIzeForStorage = 0;
  const attestationId = runtimeId('att');

  const inserted = await client.query<{ created_at: string }>(
    `
      INSERT INTO ize_reconciliation_snapshots (
        id,
        liquidity_buffer_ize,
        outstanding_ize,
        supply_delta_ize,
        within_threshold,
        attested_by,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING created_at::text
    `,
    [
      attestationId,
      liquidityBufferIzeForStorage,
      outstandingIze,
      driftIze,
      withinThreshold,
      options?.attestedBy ?? null,
      JSON.stringify({
        model: 'closed_loop_supply_parity',
        circulatingIze,
        supplyDeltaIze,
        toleranceIze: Math.abs(threshold),
        reserveModel: 'none',
        operationalLiquidityGrams: null,
        ...(options?.metadata ?? {}),
      }),
    ]
  );

  return {
    id: attestationId,
    liquidityBufferIze: null,
    outstandingIze,
    circulatingIze,
    supplyDeltaIze,
    driftIze,
    withinThreshold,
    createdAt: inserted.rows[0]?.created_at ?? new Date().toISOString(),
    thresholdIze: threshold,
  };
}

export const createGoldReserveAttestation = createIzeReconciliationAttestation;

export function assertOperatorToken(token: string | undefined): void {
  const configured = config.goldOperatorToken ?? config.apiSecurityAdminToken;
  if (!configured) {
    return;
  }

  if (!token || token !== configured) {
    throw new Error('Missing or invalid operator token');
  }
}

export const assertGoldOperatorToken = assertOperatorToken;
