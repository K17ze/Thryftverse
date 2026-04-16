ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS postage_fee_gbp NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_carrier_id TEXT,
  ADD COLUMN IF NOT EXISTS shipping_provider TEXT,
  ADD COLUMN IF NOT EXISTS tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS shipping_label_url TEXT,
  ADD COLUMN IF NOT EXISTS shipping_quote_gbp NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS shipping_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS shipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_postage_fee_gbp_check;

ALTER TABLE orders
  ADD CONSTRAINT orders_postage_fee_gbp_check CHECK (postage_fee_gbp >= 0);

CREATE INDEX IF NOT EXISTS orders_status_updated_idx
  ON orders (status, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS orders_tracking_number_unique_idx
  ON orders (tracking_number)
  WHERE tracking_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS daily_reconciliation_runs (
  id TEXT PRIMARY KEY,
  run_date DATE NOT NULL UNIQUE,
  gateway_succeeded_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  ledger_escrow_credit_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  ledger_platform_revenue_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  payout_requested_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  payout_paid_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  mismatch_gbp NUMERIC(18, 6) NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('ok', 'mismatch', 'critical')),
  payouts_auto_paused BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS daily_reconciliation_runs_created_idx
  ON daily_reconciliation_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS payout_requests_status_created_idx
  ON payout_requests (status, created_at DESC);

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_type_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_source_type_check CHECK (
    source_type IN (
      'order_payment',
      'order_delivery',
      'payout',
      'refund',
      'adjustment',
      'mint',
      'burn',
      'coOwn_trade',
      'buyout',
      'reserve_reconcile',
      'transfer'
    )
  );
