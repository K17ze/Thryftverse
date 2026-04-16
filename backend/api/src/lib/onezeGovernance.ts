import { config } from '../config.js';

type Queryable = {
  query: <T = Record<string, unknown>>(
    text: string,
    values?: unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
};

export interface OnezeReconciliationAttestation {
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

function runtimeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
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

export async function createOnezeReconciliationAttestation(
  client: Queryable,
  options?: {
    attestedBy?: string;
    metadata?: Record<string, unknown>;
    thresholdIze?: number;
  }
): Promise<OnezeReconciliationAttestation> {
  const threshold = options?.thresholdIze ?? config.onezeSupplyDriftThresholdIze;

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
        model: 'controlled_liquidity_supply_parity',
        circulatingIze,
        supplyDeltaIze,
        toleranceIze: Math.abs(threshold),
        reserveModel: 'platform_controlled',
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

export function assertOnezeOperatorToken(token: string | undefined): void {
  const configured = config.onezeOperatorToken ?? config.apiSecurityAdminToken;
  if (!configured) {
    return;
  }

  if (!token || token !== configured) {
    throw new Error('Missing or invalid operator token');
  }
}
