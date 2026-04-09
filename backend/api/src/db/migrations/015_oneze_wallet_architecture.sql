CREATE TABLE IF NOT EXISTS wallets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  oneze_balance_mg BIGINT NOT NULL DEFAULT 0 CHECK (oneze_balance_mg >= 0),
  fiat_balance_minor BIGINT NOT NULL DEFAULT 0 CHECK (fiat_balance_minor >= 0),
  fiat_currency CHAR(3) NOT NULL,
  version BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id BIGSERIAL PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  tx_id TEXT NOT NULL,
  asset TEXT NOT NULL CHECK (asset IN ('1ZE', 'FIAT')),
  amount BIGINT NOT NULL,
  balance_after BIGINT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN (
      'CREDIT',
      'DEBIT',
      'TRANSFER_SEND',
      'TRANSFER_RECEIVE',
      'MINT',
      'BURN',
      'WITHDRAWAL_RESERVED',
      'WITHDRAWAL_SETTLED',
      'WITHDRAWAL_REVERSED',
      'WITHDRAWAL_FEE',
      'SALE',
      'PURCHASE',
      'CO_OWN_TRADE',
      'FEE',
      'REDEMPTION'
    )
  ),
  ref_type TEXT,
  ref_id TEXT,
  gold_rate_inr_per_g NUMERIC(18, 6),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallet_ledger_wallet_created_idx
  ON wallet_ledger (wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_ledger_tx_idx
  ON wallet_ledger (tx_id);

CREATE TABLE IF NOT EXISTS gold_reserve_lots (
  id TEXT PRIMARY KEY,
  custodian TEXT NOT NULL,
  custodian_ref TEXT NOT NULL,
  weight_mg BIGINT NOT NULL CHECK (weight_mg >= 0),
  purity NUMERIC(5, 4) NOT NULL CHECK (purity > 0 AND purity <= 1),
  acquired_at TIMESTAMPTZ NOT NULL,
  acquisition_cost_inr BIGINT NOT NULL CHECK (acquisition_cost_inr >= 0),
  attestation_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'depleted', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (custodian, custodian_ref)
);

CREATE INDEX IF NOT EXISTS gold_reserve_lots_status_idx
  ON gold_reserve_lots (status, acquired_at ASC);

CREATE TABLE IF NOT EXISTS reserve_movements (
  id TEXT PRIMARY KEY,
  lot_id TEXT REFERENCES gold_reserve_lots(id) ON DELETE SET NULL,
  delta_mg BIGINT NOT NULL,
  reason TEXT NOT NULL,
  linked_tx_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reserve_movements_lot_idx
  ON reserve_movements (lot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS reserve_movements_tx_idx
  ON reserve_movements (linked_tx_id);

CREATE TABLE IF NOT EXISTS gold_price_ticks (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  inr_per_gram NUMERIC(18, 6) NOT NULL CHECK (inr_per_gram > 0),
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS gold_price_ticks_observed_idx
  ON gold_price_ticks (observed_at DESC);

CREATE TABLE IF NOT EXISTS payout_corridors (
  currency CHAR(3) PRIMARY KEY,
  rail TEXT NOT NULL,
  min_amount_minor BIGINT NOT NULL CHECK (min_amount_minor >= 0),
  max_amount_minor BIGINT NOT NULL CHECK (max_amount_minor > 0),
  spread_bps INT NOT NULL CHECK (spread_bps >= 0),
  network_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (network_fee_minor >= 0),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  settlement_sla_hours INT NOT NULL CHECK (settlement_sla_hours > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payout_corridors (
  currency,
  rail,
  min_amount_minor,
  max_amount_minor,
  spread_bps,
  network_fee_minor,
  enabled,
  settlement_sla_hours
)
VALUES
  ('INR', 'razorpay', 1000, 500000000, 75, 500, TRUE, 12),
  ('EUR', 'mollie', 100, 50000000, 85, 50, TRUE, 24),
  ('GBP', 'mollie', 100, 50000000, 85, 50, TRUE, 24),
  ('AED', 'tap', 100, 50000000, 95, 75, TRUE, 24),
  ('NGN', 'flutterwave', 1000, 250000000, 120, 500, TRUE, 24),
  ('USD', 'wise', 100, 50000000, 90, 50, TRUE, 24)
ON CONFLICT (currency)
DO UPDATE
  SET
    rail = EXCLUDED.rail,
    min_amount_minor = EXCLUDED.min_amount_minor,
    max_amount_minor = EXCLUDED.max_amount_minor,
    spread_bps = EXCLUDED.spread_bps,
    network_fee_minor = EXCLUDED.network_fee_minor,
    enabled = EXCLUDED.enabled,
    settlement_sla_hours = EXCLUDED.settlement_sla_hours,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS fx_rates (
  id BIGSERIAL PRIMARY KEY,
  base CHAR(3) NOT NULL,
  quote CHAR(3) NOT NULL,
  rate NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS fx_rates_lookup_idx
  ON fx_rates (base, quote, observed_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  burn_tx_id TEXT,
  amount_mg BIGINT NOT NULL CHECK (amount_mg > 0),
  target_currency CHAR(3) NOT NULL,
  gross_minor BIGINT NOT NULL CHECK (gross_minor >= 0),
  spread_minor BIGINT NOT NULL CHECK (spread_minor >= 0),
  network_fee_minor BIGINT NOT NULL CHECK (network_fee_minor >= 0),
  net_minor BIGINT NOT NULL CHECK (net_minor >= 0),
  rate_locked NUMERIC(18, 8) NOT NULL CHECK (rate_locked > 0),
  rate_expires_at TIMESTAMPTZ NOT NULL,
  rail TEXT NOT NULL,
  rail_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('QUOTED', 'ACCEPTED', 'RESERVED', 'PAID_OUT', 'FAILED', 'REVERSED')),
  payout_destination JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS withdrawals_user_created_idx
  ON withdrawals (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawals_status_created_idx
  ON withdrawals (status, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_idempotency_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS wallet_idempotency_created_idx
  ON wallet_idempotency_keys (created_at DESC);

CREATE TABLE IF NOT EXISTS oneze_reconciliation_snapshots (
  id TEXT PRIMARY KEY,
  circulating_mg BIGINT NOT NULL CHECK (circulating_mg >= 0),
  reserve_active_mg BIGINT NOT NULL CHECK (reserve_active_mg >= 0),
  within_invariant BOOLEAN NOT NULL,
  invariant_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oneze_reconciliation_created_idx
  ON oneze_reconciliation_snapshots (created_at DESC);

CREATE TABLE IF NOT EXISTS jurisdiction_policies (
  country_code TEXT PRIMARY KEY,
  p2p_send_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  p2p_receive_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  p2p_daily_limit_mg BIGINT CHECK (p2p_daily_limit_mg IS NULL OR p2p_daily_limit_mg > 0),
  p2p_monthly_limit_mg BIGINT CHECK (p2p_monthly_limit_mg IS NULL OR p2p_monthly_limit_mg > 0),
  p2p_per_tx_limit_mg BIGINT CHECK (p2p_per_tx_limit_mg IS NULL OR p2p_per_tx_limit_mg > 0),
  requires_context BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO jurisdiction_policies (
  country_code,
  p2p_send_allowed,
  p2p_receive_allowed,
  p2p_daily_limit_mg,
  p2p_monthly_limit_mg,
  p2p_per_tx_limit_mg,
  requires_context,
  notes
)
VALUES
  ('GLOBAL', FALSE, FALSE, NULL, NULL, NULL, TRUE, 'Default deny policy'),
  ('IN', FALSE, TRUE, NULL, NULL, NULL, TRUE, 'India stays closed-loop for sending'),
  ('DE', TRUE, TRUE, 50000, 500000, 10000, FALSE, 'Open P2P market'),
  ('FR', TRUE, TRUE, 50000, 500000, 10000, FALSE, 'Open P2P market'),
  ('GB', TRUE, TRUE, 50000, 500000, 10000, FALSE, 'Open P2P market'),
  ('AE', TRUE, TRUE, 100000, 1000000, 20000, FALSE, 'Open P2P market'),
  ('NG', TRUE, TRUE, 30000, 300000, 5000, FALSE, 'Open P2P market'),
  ('KE', TRUE, TRUE, 30000, 300000, 5000, FALSE, 'Open P2P market')
ON CONFLICT (country_code)
DO UPDATE
  SET
    p2p_send_allowed = EXCLUDED.p2p_send_allowed,
    p2p_receive_allowed = EXCLUDED.p2p_receive_allowed,
    p2p_daily_limit_mg = EXCLUDED.p2p_daily_limit_mg,
    p2p_monthly_limit_mg = EXCLUDED.p2p_monthly_limit_mg,
    p2p_per_tx_limit_mg = EXCLUDED.p2p_per_tx_limit_mg,
    requires_context = EXCLUDED.requires_context,
    notes = EXCLUDED.notes,
    updated_at = NOW();

ALTER TABLE wallet_ize_transfers
  ADD COLUMN IF NOT EXISTS sender_country TEXT;

ALTER TABLE wallet_ize_transfers
  ADD COLUMN IF NOT EXISTS recipient_country TEXT;

ALTER TABLE wallet_ize_transfers
  ADD COLUMN IF NOT EXISTS travel_rule_payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE wallet_ize_transfers
  ADD COLUMN IF NOT EXISTS is_cross_border BOOLEAN GENERATED ALWAYS AS (
    COALESCE(sender_country, '') <> COALESCE(recipient_country, '')
  ) STORED;
