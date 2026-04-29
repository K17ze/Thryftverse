import assert from 'node:assert/strict';
import test from 'node:test';

import { runDailyReconciliation } from '../lib/reconciliation.js';

type ReconciliationMockTotals = {
  gatewaySucceededGbp: number;
  ledgerEscrowCreditGbp: number;
  ledgerPlatformRevenueGbp?: number;
  payoutRequestedGbp?: number;
  payoutPaidGbp?: number;
};

type QueryResult<T> = { rows: T[] };

function createMockClient(totals: ReconciliationMockTotals) {
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
      if (text.includes("to_regclass('public.daily_reconciliation_runs')")) {
        return { rows: [{ exists: true }] as T[] };
      }

      if (text.includes('FROM payment_intents')) {
        return { rows: [{ total: String(totals.gatewaySucceededGbp) }] as T[] };
      }

      if (text.includes("FROM ledger_entries") && text.includes("line_type = 'buyer_charge'")) {
        return { rows: [{ total: String(totals.ledgerEscrowCreditGbp) }] as T[] };
      }

      if (text.includes("FROM ledger_entries") && text.includes("platform_commission_credit")) {
        return { rows: [{ total: String(totals.ledgerPlatformRevenueGbp ?? 0) }] as T[] };
      }

      if (text.includes('FROM payout_requests') && text.includes("status IN ('requested', 'processing')")) {
        return { rows: [{ total: String(totals.payoutRequestedGbp ?? 0) }] as T[] };
      }

      if (text.includes('FROM payout_requests') && text.includes("status = 'paid'")) {
        return { rows: [{ total: String(totals.payoutPaidGbp ?? 0) }] as T[] };
      }

      if (text.includes('INSERT INTO daily_reconciliation_runs')) {
        const values = params ?? [];
        const metadataRaw = String(values[10] ?? '{}');
        return {
          rows: [{
            id: String(values[0]),
            run_date: String(values[1]),
            gateway_succeeded_gbp: String(values[2]),
            ledger_escrow_credit_gbp: String(values[3]),
            ledger_platform_revenue_gbp: String(values[4]),
            payout_requested_gbp: String(values[5]),
            payout_paid_gbp: String(values[6]),
            mismatch_gbp: String(values[7]),
            status: String(values[8]),
            payouts_auto_paused: Boolean(values[9]),
            metadata: JSON.parse(metadataRaw),
            created_at: '2026-04-27T00:00:00.000Z',
            updated_at: '2026-04-27T00:00:00.000Z',
          }] as T[],
        };
      }

      throw new Error(`Unexpected query in reconciliation test: ${text}`);
    },
  };
}

test('runDailyReconciliation marks mismatch when variance is below critical threshold', async () => {
  const client = createMockClient({
    gatewaySucceededGbp: 1000,
    ledgerEscrowCreditGbp: 996,
  });

  const run = await runDailyReconciliation(client, {
    runDate: '2026-04-27',
    reason: 'manual',
    mismatchThresholdGbp: 1,
    criticalMismatchThresholdGbp: 50,
  });

  assert.equal(run.mismatchGbp, 4);
  assert.equal(run.status, 'mismatch');
  assert.equal(run.payoutsAutoPaused, false);
});

test('runDailyReconciliation marks critical when variance exceeds 0.5 percent', async () => {
  const client = createMockClient({
    gatewaySucceededGbp: 1000,
    ledgerEscrowCreditGbp: 990,
  });

  const run = await runDailyReconciliation(client, {
    runDate: '2026-04-27',
    reason: 'scheduled',
    mismatchThresholdGbp: 25,
    criticalMismatchThresholdGbp: 500,
  });

  assert.equal(run.mismatchGbp, 10);
  assert.equal(run.status, 'critical');
  assert.equal(run.payoutsAutoPaused, true);
});

test('runDailyReconciliation marks critical when absolute mismatch exceeds critical threshold', async () => {
  const client = createMockClient({
    gatewaySucceededGbp: 100000,
    ledgerEscrowCreditGbp: 99990,
  });

  const run = await runDailyReconciliation(client, {
    runDate: '2026-04-27',
    reason: 'manual',
    mismatchThresholdGbp: 5,
    criticalMismatchThresholdGbp: 8,
  });

  assert.equal(run.mismatchGbp, 10);
  assert.equal(run.status, 'critical');
  assert.equal(run.payoutsAutoPaused, true);
});

test('runDailyReconciliation mismatch is not affected by payout paid totals', async () => {
  const client = createMockClient({
    gatewaySucceededGbp: 100,
    ledgerEscrowCreditGbp: 100,
    payoutPaidGbp: 90,
  });

  const run = await runDailyReconciliation(client, {
    runDate: '2026-04-27',
    reason: 'manual',
    mismatchThresholdGbp: 0.1,
    criticalMismatchThresholdGbp: 10,
  });

  assert.equal(run.mismatchGbp, 0);
  assert.equal(run.status, 'ok');
});
