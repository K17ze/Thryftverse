-- Real payment gateways
INSERT INTO payment_gateways (id, display_name, gateway_type, is_active)
VALUES
  ('razorpay_in', 'Razorpay India', 'fiat', TRUE),
  ('mollie_eu', 'Mollie Europe', 'fiat', TRUE),
  ('flutterwave_africa', 'Flutterwave Africa', 'fiat', TRUE),
  ('tap_gulf', 'Tap Payments Gulf', 'fiat', TRUE),
  ('stripe_americas', 'Stripe Americas', 'fiat', TRUE)
ON CONFLICT (id) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  gateway_type = EXCLUDED.gateway_type,
  is_active = EXCLUDED.is_active;

ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS next_action_url TEXT,
  ADD COLUMN IF NOT EXISTS sca_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_status TEXT,
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payment_refunds (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  amount NUMERIC(18, 6) NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(currency) = 3),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  provider_refund_ref TEXT,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_refund_ref)
);

CREATE INDEX IF NOT EXISTS payment_refunds_intent_idx
  ON payment_refunds (intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_disputes (
  id TEXT PRIMARY KEY,
  intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  provider_dispute_ref TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'warning', 'needs_response', 'won', 'lost', 'closed')),
  amount NUMERIC(18, 6) NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(currency) = 3),
  reason TEXT,
  evidence_due_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_dispute_ref)
);

CREATE INDEX IF NOT EXISTS payment_disputes_intent_idx
  ON payment_disputes (intent_id, created_at DESC);

-- Ledger hardening for multi-currency and 1ze
ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_account_code_check;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_code_check CHECK (
    account_code IN (
      'escrow_liability',
      'platform_revenue',
      'seller_payable',
      'buyer_spend',
      'withdrawable_balance',
      'withdrawal_pending',
      'ize_wallet',
      'ize_pending_redemption',
      'ize_outstanding',
      'ize_fiat_received'
    )
  );

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_type_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_source_type_check CHECK (
    source_type IN (
      'order_payment',
      'payout',
      'refund',
      'adjustment',
      'mint',
      'burn',
      'coOwn_trade',
      'buyout',
      'reserve_reconcile'
    )
  );

ALTER TABLE ledger_entries
  ALTER COLUMN amount_gbp DROP NOT NULL;

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_amount_gbp_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_gbp_check CHECK (amount_gbp IS NULL OR amount_gbp >= 0);

ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS amount NUMERIC(18, 6);

UPDATE ledger_entries
SET amount = amount_gbp
WHERE amount IS NULL;

ALTER TABLE ledger_entries
  ALTER COLUMN amount SET NOT NULL;

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_amount_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_amount_check CHECK (amount >= 0);

INSERT INTO ledger_accounts (owner_type, owner_id, account_code, currency)
VALUES
  ('platform', 'platform', 'ize_outstanding', 'IZE'),
  ('platform', 'platform', 'ize_fiat_received', 'GBP')
ON CONFLICT (owner_type, owner_id, account_code, currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS wallet_ize_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('mint', 'burn')),
  fiat_amount NUMERIC(18, 6) NOT NULL CHECK (fiat_amount >= 0),
  fiat_currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(fiat_currency) = 3),
  ize_amount NUMERIC(18, 6) NOT NULL CHECK (ize_amount > 0),
  rate_per_gram NUMERIC(18, 6) NOT NULL CHECK (rate_per_gram > 0),
  status TEXT NOT NULL CHECK (status IN ('committed', 'failed', 'reversed')),
  payment_intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  payout_request_id TEXT REFERENCES payout_requests(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS wallet_ize_operations_user_idx
  ON wallet_ize_operations (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gold_rate_quotes (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  rate_per_gram NUMERIC(18, 6) NOT NULL CHECK (rate_per_gram > 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS gold_rate_quotes_currency_idx
  ON gold_rate_quotes (currency, fetched_at DESC);

CREATE TABLE IF NOT EXISTS gold_rate_overrides (
  id BIGSERIAL PRIMARY KEY,
  currency TEXT NOT NULL CHECK (char_length(currency) = 3),
  rate_per_gram NUMERIC(18, 6) NOT NULL CHECK (rate_per_gram > 0),
  reason TEXT,
  created_by TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS gold_rate_overrides_active_idx
  ON gold_rate_overrides (currency, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS ize_reconciliation_snapshots (
  id TEXT PRIMARY KEY,
  liquidity_buffer_ize NUMERIC(18, 6) NOT NULL CHECK (liquidity_buffer_ize >= 0),
  outstanding_ize NUMERIC(18, 6) NOT NULL CHECK (outstanding_ize >= 0),
  supply_delta_ize NUMERIC(18, 6) NOT NULL,
  within_threshold BOOLEAN NOT NULL,
  attested_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ize_reconciliation_snapshots_created_idx
  ON ize_reconciliation_snapshots (created_at DESC);

-- Co-Own matching and holdings
ALTER TABLE coOwn_orders
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'market',
  ADD COLUMN IF NOT EXISTS limit_price_gbp NUMERIC(12, 4),
  ADD COLUMN IF NOT EXISTS remaining_units INTEGER,
  ADD COLUMN IF NOT EXISTS filled_units INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE coOwn_orders
SET remaining_units = CASE WHEN status = 'filled' THEN 0 ELSE units END
WHERE remaining_units IS NULL;

UPDATE coOwn_orders
SET filled_units = GREATEST(0, units - remaining_units)
WHERE filled_units = 0;

ALTER TABLE coOwn_orders
  DROP CONSTRAINT IF EXISTS coOwn_orders_status_check;

ALTER TABLE coOwn_orders
  ADD CONSTRAINT coOwn_orders_status_check CHECK (
    status IN ('open', 'partially_filled', 'filled', 'cancelled', 'rejected')
  );

ALTER TABLE coOwn_orders
  DROP CONSTRAINT IF EXISTS coOwn_orders_order_type_check;

ALTER TABLE coOwn_orders
  ADD CONSTRAINT coOwn_orders_order_type_check CHECK (
    order_type IN ('market', 'limit')
  );

ALTER TABLE coOwn_orders
  DROP CONSTRAINT IF EXISTS coOwn_orders_limit_price_required_check;

ALTER TABLE coOwn_orders
  ADD CONSTRAINT coOwn_orders_limit_price_required_check CHECK (
    (order_type = 'market' AND limit_price_gbp IS NULL)
    OR (order_type = 'limit' AND limit_price_gbp IS NOT NULL AND limit_price_gbp > 0)
  );

CREATE INDEX IF NOT EXISTS coOwn_orders_match_idx
  ON coOwn_orders (asset_id, side, status, unit_price_gbp, created_at);

CREATE TABLE IF NOT EXISTS coOwn_trades (
  id BIGSERIAL PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES coOwn_assets(id) ON DELETE CASCADE,
  buy_order_id BIGINT REFERENCES coOwn_orders(id) ON DELETE SET NULL,
  sell_order_id BIGINT REFERENCES coOwn_orders(id) ON DELETE SET NULL,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  units INTEGER NOT NULL CHECK (units > 0),
  unit_price_gbp NUMERIC(12, 4) NOT NULL CHECK (unit_price_gbp > 0),
  notional_gbp NUMERIC(12, 4) NOT NULL CHECK (notional_gbp >= 0),
  fee_gbp NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (fee_gbp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coOwn_trades_asset_idx
  ON coOwn_trades (asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coOwn_holdings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES coOwn_assets(id) ON DELETE CASCADE,
  units_owned INTEGER NOT NULL DEFAULT 0 CHECK (units_owned >= 0),
  avg_entry_price_gbp NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (avg_entry_price_gbp >= 0),
  realized_pnl_gbp NUMERIC(12, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, asset_id)
);

CREATE INDEX IF NOT EXISTS coOwn_holdings_asset_idx
  ON coOwn_holdings (asset_id, units_owned DESC);

INSERT INTO coOwn_holdings (user_id, asset_id, units_owned, avg_entry_price_gbp, realized_pnl_gbp, updated_at)
SELECT
  so.user_id,
  so.asset_id,
  GREATEST(0, SUM(CASE WHEN so.side = 'buy' THEN so.units ELSE -so.units END)) AS units_owned,
  CASE
    WHEN SUM(CASE WHEN so.side = 'buy' THEN so.units ELSE 0 END) > 0
      THEN SUM(CASE WHEN so.side = 'buy' THEN so.units * so.unit_price_gbp ELSE 0 END)
           / SUM(CASE WHEN so.side = 'buy' THEN so.units ELSE 0 END)
    ELSE 0
  END AS avg_entry_price_gbp,
  0,
  NOW()
FROM coOwn_orders so
WHERE so.status IN ('filled', 'partially_filled')
GROUP BY so.user_id, so.asset_id
ON CONFLICT (user_id, asset_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS coOwn_buyout_offers (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES coOwn_assets(id) ON DELETE CASCADE,
  bidder_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_price_gbp NUMERIC(12, 4) NOT NULL CHECK (offer_price_gbp > 0),
  target_units INTEGER NOT NULL CHECK (target_units > 0),
  accepted_units INTEGER NOT NULL DEFAULT 0 CHECK (accepted_units >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'accepted', 'expired', 'cancelled', 'rejected', 'settled')),
  expires_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coOwn_buyout_offers_asset_idx
  ON coOwn_buyout_offers (asset_id, created_at DESC);

CREATE TABLE IF NOT EXISTS coOwn_buyout_acceptances (
  id BIGSERIAL PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES coOwn_buyout_offers(id) ON DELETE CASCADE,
  holder_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  units INTEGER NOT NULL CHECK (units > 0),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected', 'cancelled')),
  responded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (offer_id, holder_user_id)
);

CREATE INDEX IF NOT EXISTS coOwn_buyout_acceptances_offer_idx
  ON coOwn_buyout_acceptances (offer_id, responded_at DESC);
