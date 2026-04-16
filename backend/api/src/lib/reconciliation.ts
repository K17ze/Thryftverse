import crypto from 'node:crypto';

type DbQueryable = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type ReconciliationStatus = 'ok' | 'mismatch' | 'critical';

export interface DailyReconciliationRun {
  id: string;
  runDate: string;
  gatewaySucceededGbp: number;
  ledgerEscrowCreditGbp: number;
  ledgerPlatformRevenueGbp: number;
  payoutRequestedGbp: number;
  payoutPaidGbp: number;
  mismatchGbp: number;
  status: ReconciliationStatus;
  payoutsAutoPaused: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DailyReconciliationRunRow {
  id: string;
  run_date: string;
  gateway_succeeded_gbp: string | number;
  ledger_escrow_credit_gbp: string | number;
  ledger_platform_revenue_gbp: string | number;
  payout_requested_gbp: string | number;
  payout_paid_gbp: string | number;
  mismatch_gbp: string | number;
  status: ReconciliationStatus;
  payouts_auto_paused: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toRunPayload(row: DailyReconciliationRunRow): DailyReconciliationRun {
  return {
    id: row.id,
    runDate: row.run_date,
    gatewaySucceededGbp: toNumber(row.gateway_succeeded_gbp),
    ledgerEscrowCreditGbp: toNumber(row.ledger_escrow_credit_gbp),
    ledgerPlatformRevenueGbp: toNumber(row.ledger_platform_revenue_gbp),
    payoutRequestedGbp: toNumber(row.payout_requested_gbp),
    payoutPaidGbp: toNumber(row.payout_paid_gbp),
    mismatchGbp: toNumber(row.mismatch_gbp),
    status: row.status,
    payoutsAutoPaused: row.payouts_auto_paused,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function reconciliationTableAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT to_regclass('public.daily_reconciliation_runs') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function sumQueryByDate(
  client: DbQueryable,
  text: string,
  runDate: string
): Promise<number> {
  const result = await client.query<{ total: string | number }>(text, [runDate]);
  return roundTo(toNumber(result.rows[0]?.total), 6);
}

export async function runDailyReconciliation(
  client: DbQueryable,
  input: {
    runDate: string;
    reason: 'scheduled' | 'manual';
    mismatchThresholdGbp: number;
    criticalMismatchThresholdGbp: number;
  }
): Promise<DailyReconciliationRun> {
  if (!(await reconciliationTableAvailable(client))) {
    throw new Error('daily_reconciliation_runs table unavailable');
  }

  const runDate = input.runDate;

  const [
    gatewaySucceededGbp,
    ledgerEscrowCreditGbp,
    ledgerPlatformRevenueGbp,
    payoutRequestedGbp,
    payoutPaidGbp,
  ] = await Promise.all([
    sumQueryByDate(
      client,
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM payment_intents
        WHERE status = 'succeeded'
          AND COALESCE(settled_at, updated_at)::date = $1::date
      `,
      runDate
    ),
    sumQueryByDate(
      client,
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM ledger_entries
        WHERE source_type = 'order_payment'
          AND line_type = 'buyer_charge'
          AND direction = 'credit'
          AND created_at::date = $1::date
      `,
      runDate
    ),
    sumQueryByDate(
      client,
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM ledger_entries
        WHERE source_type = 'order_payment'
          AND direction = 'credit'
          AND line_type IN ('platform_commission_credit', 'postage_fee_credit', 'shipping_fee_credit')
          AND created_at::date = $1::date
      `,
      runDate
    ),
    sumQueryByDate(
      client,
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM payout_requests
        WHERE status IN ('requested', 'processing')
          AND created_at::date = $1::date
      `,
      runDate
    ),
    sumQueryByDate(
      client,
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM payout_requests
        WHERE status = 'paid'
          AND updated_at::date = $1::date
      `,
      runDate
    ),
  ]);

  const mismatchGbp = roundTo(gatewaySucceededGbp - ledgerEscrowCreditGbp, 6);
  const absMismatch = Math.abs(mismatchGbp);

  let status: ReconciliationStatus = 'ok';
  if (absMismatch > Math.max(0, input.criticalMismatchThresholdGbp)) {
    status = 'critical';
  } else if (absMismatch > Math.max(0, input.mismatchThresholdGbp)) {
    status = 'mismatch';
  }

  const payoutsAutoPaused = status === 'critical';

  const inserted = await client.query<DailyReconciliationRunRow>(
    `
      INSERT INTO daily_reconciliation_runs (
        id,
        run_date,
        gateway_succeeded_gbp,
        ledger_escrow_credit_gbp,
        ledger_platform_revenue_gbp,
        payout_requested_gbp,
        payout_paid_gbp,
        mismatch_gbp,
        status,
        payouts_auto_paused,
        metadata
      )
      VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (run_date)
      DO UPDATE
        SET
          gateway_succeeded_gbp = EXCLUDED.gateway_succeeded_gbp,
          ledger_escrow_credit_gbp = EXCLUDED.ledger_escrow_credit_gbp,
          ledger_platform_revenue_gbp = EXCLUDED.ledger_platform_revenue_gbp,
          payout_requested_gbp = EXCLUDED.payout_requested_gbp,
          payout_paid_gbp = EXCLUDED.payout_paid_gbp,
          mismatch_gbp = EXCLUDED.mismatch_gbp,
          status = EXCLUDED.status,
          payouts_auto_paused = EXCLUDED.payouts_auto_paused,
          metadata = COALESCE(daily_reconciliation_runs.metadata, '{}'::jsonb) || EXCLUDED.metadata,
          updated_at = NOW()
      RETURNING
        id,
        run_date::text,
        gateway_succeeded_gbp::text,
        ledger_escrow_credit_gbp::text,
        ledger_platform_revenue_gbp::text,
        payout_requested_gbp::text,
        payout_paid_gbp::text,
        mismatch_gbp::text,
        status,
        payouts_auto_paused,
        metadata,
        created_at::text,
        updated_at::text
    `,
    [
      `rec_${runDate.replace(/-/g, '')}_${crypto.randomUUID().slice(0, 8)}`,
      runDate,
      gatewaySucceededGbp,
      ledgerEscrowCreditGbp,
      ledgerPlatformRevenueGbp,
      payoutRequestedGbp,
      payoutPaidGbp,
      mismatchGbp,
      status,
      payoutsAutoPaused,
      JSON.stringify({
        reason: input.reason,
        mismatchThresholdGbp: input.mismatchThresholdGbp,
        criticalMismatchThresholdGbp: input.criticalMismatchThresholdGbp,
        computedAt: new Date().toISOString(),
      }),
    ]
  );

  return toRunPayload(inserted.rows[0]);
}

export async function getLatestReconciliationRun(
  client: DbQueryable
): Promise<DailyReconciliationRun | null> {
  if (!(await reconciliationTableAvailable(client))) {
    return null;
  }

  const result = await client.query<DailyReconciliationRunRow>(
    `
      SELECT
        id,
        run_date::text,
        gateway_succeeded_gbp::text,
        ledger_escrow_credit_gbp::text,
        ledger_platform_revenue_gbp::text,
        payout_requested_gbp::text,
        payout_paid_gbp::text,
        mismatch_gbp::text,
        status,
        payouts_auto_paused,
        metadata,
        created_at::text,
        updated_at::text
      FROM daily_reconciliation_runs
      ORDER BY run_date DESC
      LIMIT 1
    `
  );

  return result.rows[0] ? toRunPayload(result.rows[0]) : null;
}
