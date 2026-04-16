-- 1ze controlled monetary system foundation.
-- This migration introduces an internal anchor + country pricing model that removes
-- runtime dependency on commodity pegs for user-facing pricing.

CREATE TABLE IF NOT EXISTS oneze_anchor_config (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  anchor_currency CHAR(3) NOT NULL,
  anchor_value NUMERIC(18, 6) NOT NULL CHECK (anchor_value > 0),
  notes TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO oneze_anchor_config (id, anchor_currency, anchor_value, notes)
VALUES (1, 'INR', 1000, 'Internal reference anchor for controlled pricing')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS oneze_country_pricing_profiles (
  country_code TEXT PRIMARY KEY,
  currency CHAR(3) NOT NULL,
  markup_bps INT NOT NULL CHECK (markup_bps BETWEEN 1500 AND 2500),
  markdown_bps INT NOT NULL CHECK (markdown_bps BETWEEN 1000 AND 2000),
  cross_border_fee_bps INT NOT NULL CHECK (cross_border_fee_bps BETWEEN 500 AND 1500),
  ppp_factor NUMERIC(8, 6) NOT NULL CHECK (ppp_factor >= 0.7 AND ppp_factor <= 1.0),
  withdrawal_lock_hours INT NOT NULL DEFAULT 168 CHECK (withdrawal_lock_hours BETWEEN 0 AND 336),
  daily_redeem_limit_ize NUMERIC(18, 6) NOT NULL DEFAULT 500 CHECK (daily_redeem_limit_ize >= 0),
  weekly_redeem_limit_ize NUMERIC(18, 6) NOT NULL DEFAULT 2000 CHECK (weekly_redeem_limit_ize >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO oneze_country_pricing_profiles (
  country_code,
  currency,
  markup_bps,
  markdown_bps,
  cross_border_fee_bps,
  ppp_factor,
  withdrawal_lock_hours,
  daily_redeem_limit_ize,
  weekly_redeem_limit_ize,
  is_active,
  metadata
)
VALUES
  (
    'IN',
    'INR',
    1500,
    2000,
    1000,
    0.900000,
    168,
    500,
    2000,
    TRUE,
    '{"seed":true,"label":"India baseline"}'::jsonb
  ),
  (
    'GB',
    'GBP',
    1500,
    1800,
    1000,
    0.900000,
    168,
    500,
    2000,
    TRUE,
    '{"seed":true,"label":"United Kingdom baseline"}'::jsonb
  )
ON CONFLICT (country_code)
DO UPDATE
  SET
    currency = EXCLUDED.currency,
    markup_bps = EXCLUDED.markup_bps,
    markdown_bps = EXCLUDED.markdown_bps,
    cross_border_fee_bps = EXCLUDED.cross_border_fee_bps,
    ppp_factor = EXCLUDED.ppp_factor,
    withdrawal_lock_hours = EXCLUDED.withdrawal_lock_hours,
    daily_redeem_limit_ize = EXCLUDED.daily_redeem_limit_ize,
    weekly_redeem_limit_ize = EXCLUDED.weekly_redeem_limit_ize,
    is_active = EXCLUDED.is_active,
    metadata = oneze_country_pricing_profiles.metadata || EXCLUDED.metadata,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS oneze_internal_fx_rates (
  base_currency CHAR(3) NOT NULL,
  quote_currency CHAR(3) NOT NULL,
  rate NUMERIC(18, 8) NOT NULL CHECK (rate > 0),
  source TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (base_currency, quote_currency),
  CHECK (base_currency <> quote_currency)
);

INSERT INTO oneze_internal_fx_rates (base_currency, quote_currency, rate, source, metadata)
VALUES
  ('INR', 'GBP', 0.01100000, 'seed', '{"seed":true}'::jsonb),
  ('GBP', 'INR', 90.90909091, 'seed', '{"seed":true}'::jsonb),
  ('INR', 'USD', 0.01200000, 'seed', '{"seed":true}'::jsonb),
  ('USD', 'INR', 83.33333333, 'seed', '{"seed":true}'::jsonb),
  ('INR', 'EUR', 0.01100000, 'seed', '{"seed":true}'::jsonb),
  ('EUR', 'INR', 90.90909091, 'seed', '{"seed":true}'::jsonb)
ON CONFLICT (base_currency, quote_currency)
DO UPDATE
  SET
    rate = EXCLUDED.rate,
    source = EXCLUDED.source,
    metadata = oneze_internal_fx_rates.metadata || EXCLUDED.metadata,
    updated_at = NOW();

CREATE TABLE IF NOT EXISTS oneze_wallet_segments (
  wallet_id TEXT PRIMARY KEY REFERENCES wallets(id) ON DELETE CASCADE,
  purchased_balance_mg BIGINT NOT NULL DEFAULT 0 CHECK (purchased_balance_mg >= 0),
  earned_balance_mg BIGINT NOT NULL DEFAULT 0 CHECK (earned_balance_mg >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO oneze_wallet_segments (wallet_id, purchased_balance_mg, earned_balance_mg, metadata)
SELECT w.id, w.oneze_balance_mg, 0, '{"bootstrap":true}'::jsonb
FROM wallets w
ON CONFLICT (wallet_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS oneze_balance_origin_events (
  id BIGSERIAL PRIMARY KEY,
  wallet_id TEXT NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  tx_id TEXT NOT NULL,
  amount_mg BIGINT NOT NULL,
  origin_country TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('purchased', 'earned')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oneze_balance_origin_wallet_created_idx
  ON oneze_balance_origin_events (wallet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS oneze_balance_origin_tx_idx
  ON oneze_balance_origin_events (tx_id);

CREATE TABLE IF NOT EXISTS oneze_conversion_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  conversion_ratio NUMERIC(18, 8) NOT NULL CHECK (conversion_ratio > 0),
  executed_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO oneze_conversion_events (
  id,
  event_type,
  conversion_ratio,
  executed_by,
  metadata
)
SELECT
  'conv_controlled_bootstrap',
  'GOLD_TO_CONTROLLED_CONVERSION',
  1.00000000,
  'migration_022',
  '{"note":"One-time bootstrap conversion event for controlled model"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1
  FROM oneze_conversion_events
);
