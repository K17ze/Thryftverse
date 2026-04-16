type DbQueryable = {
  query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
};

export type OpsAlertSeverity = 'warning' | 'critical';

export type OpsAlertCode =
  | 'webhook_failure_spike'
  | 'payment_failure_spike'
  | 'payout_backlog'
  | 'shipment_stall'
  | 'reconciliation_critical';

export interface OpsAlert {
  code: OpsAlertCode;
  severity: OpsAlertSeverity;
  message: string;
  metricValue: number;
  threshold: number;
  metadata: Record<string, unknown>;
}

async function tableExists(client: DbQueryable, tableName: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT to_regclass($1) IS NOT NULL AS exists
    `,
    [tableName]
  );

  return Boolean(result.rows[0]?.exists);
}

export async function collectOperationalAlerts(
  client: DbQueryable,
  nowIso = new Date().toISOString()
): Promise<OpsAlert[]> {
  const alerts: OpsAlert[] = [];

  const now = new Date(nowIso);
  const normalizedNow = Number.isNaN(now.getTime()) ? new Date() : now;

  const [
    webhookFailureResult,
    paymentFailureResult,
    payoutBacklogResult,
    orderParcelTableAvailable,
    reconciliationTableAvailable,
  ] = await Promise.all([
    client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM payment_webhook_events
        WHERE processed_at IS NULL
          AND created_at >= $1::timestamptz - INTERVAL '5 minutes'
      `,
      [normalizedNow.toISOString()]
    ),
    client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM payment_intents
        WHERE status = 'failed'
          AND created_at >= $1::timestamptz - INTERVAL '10 minutes'
      `,
      [normalizedNow.toISOString()]
    ),
    client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM payout_requests
        WHERE status = 'requested'
          AND created_at <= $1::timestamptz - INTERVAL '4 hours'
      `,
      [normalizedNow.toISOString()]
    ),
    tableExists(client, 'public.order_parcel_events'),
    tableExists(client, 'public.daily_reconciliation_runs'),
  ]);

  const webhookFailureCount = Number(webhookFailureResult.rows[0]?.count ?? '0');
  if (webhookFailureCount > 5) {
    alerts.push({
      code: 'webhook_failure_spike',
      severity: 'critical',
      message: `Webhook verification backlog spike detected (${webhookFailureCount} in 5 minutes).`,
      metricValue: webhookFailureCount,
      threshold: 5,
      metadata: {
        windowMinutes: 5,
      },
    });
  }

  const paymentFailureCount = Number(paymentFailureResult.rows[0]?.count ?? '0');
  if (paymentFailureCount > 10) {
    alerts.push({
      code: 'payment_failure_spike',
      severity: 'critical',
      message: `Payment failure spike detected (${paymentFailureCount} failed intents in 10 minutes).`,
      metricValue: paymentFailureCount,
      threshold: 10,
      metadata: {
        windowMinutes: 10,
      },
    });
  }

  const payoutBacklogCount = Number(payoutBacklogResult.rows[0]?.count ?? '0');
  if (payoutBacklogCount > 20) {
    alerts.push({
      code: 'payout_backlog',
      severity: 'warning',
      message: `Payout backlog detected (${payoutBacklogCount} requested payouts older than 4 hours).`,
      metricValue: payoutBacklogCount,
      threshold: 20,
      metadata: {
        windowHours: 4,
      },
    });
  }

  if (orderParcelTableAvailable) {
    const shipmentStallResult = await client.query<{ count: string }>(
      `
        SELECT COUNT(*)::text AS count
        FROM orders o
        WHERE o.status = 'shipped'
          AND COALESCE(o.shipped_at, o.updated_at) <= $1::timestamptz - INTERVAL '7 days'
          AND NOT EXISTS (
            SELECT 1
            FROM order_parcel_events ope
            WHERE ope.order_id = o.id
              AND ope.event_type IN ('delivered', 'collection_confirmed')
          )
      `,
      [normalizedNow.toISOString()]
    );

    const shipmentStallCount = Number(shipmentStallResult.rows[0]?.count ?? '0');
    if (shipmentStallCount > 0) {
      alerts.push({
        code: 'shipment_stall',
        severity: 'warning',
        message: `Shipment stall detected (${shipmentStallCount} shipped orders older than 7 days without delivery event).`,
        metricValue: shipmentStallCount,
        threshold: 1,
        metadata: {
          staleDays: 7,
        },
      });
    }
  }

  if (reconciliationTableAvailable) {
    const criticalReconciliation = await client.query<{
      id: string;
      run_date: string;
      mismatch_gbp: string;
    }>(
      `
        SELECT id, run_date::text, mismatch_gbp::text
        FROM daily_reconciliation_runs
        WHERE status = 'critical'
          AND created_at >= $1::timestamptz - INTERVAL '24 hours'
        ORDER BY run_date DESC
        LIMIT 1
      `,
      [normalizedNow.toISOString()]
    );

    const latestCritical = criticalReconciliation.rows[0];
    if (latestCritical) {
      const mismatch = Number(latestCritical.mismatch_gbp ?? '0');
      alerts.push({
        code: 'reconciliation_critical',
        severity: 'critical',
        message: `Critical reconciliation mismatch detected for ${latestCritical.run_date} (GBP ${mismatch.toFixed(2)}).`,
        metricValue: Math.abs(mismatch),
        threshold: 10,
        metadata: {
          runId: latestCritical.id,
          runDate: latestCritical.run_date,
          mismatchGbp: mismatch,
        },
      });
    }
  }

  return alerts;
}
