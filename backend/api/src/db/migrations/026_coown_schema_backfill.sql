-- Backfill Co-Own schema for environments where earlier migration revisions were applied
-- before Co-Own tables existed in their current form.

CREATE TABLE IF NOT EXISTS coOwn_assets (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  issuer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  image_url TEXT,
  total_units INTEGER NOT NULL CHECK (total_units > 0 AND total_units <= 20),
  available_units INTEGER NOT NULL CHECK (available_units >= 0 AND available_units <= total_units),
  unit_price_gbp NUMERIC(12, 4) NOT NULL CHECK (unit_price_gbp > 0),
  unit_price_stable NUMERIC(12, 4) NOT NULL CHECK (unit_price_stable > 0),
  settlement_mode TEXT NOT NULL CHECK (settlement_mode IN ('GBP', 'TVUSD', 'HYBRID')),
  issuer_jurisdiction TEXT,
  market_move_pct_24h NUMERIC(8, 3) NOT NULL DEFAULT 0,
  holders INTEGER NOT NULL DEFAULT 0 CHECK (holders >= 0),
  volume_24h_gbp NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (volume_24h_gbp >= 0),
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS coOwn_assets_open_idx
  ON coOwn_assets (is_open, created_at DESC);

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_total_units_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_units_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_total_units_cap_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_units_cap_check;

ALTER TABLE coOwn_assets
  DROP CONSTRAINT IF EXISTS coOwn_assets_available_le_total_units_check;

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_total_units_cap_check CHECK (total_units > 0 AND total_units <= 20);

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_available_units_cap_check CHECK (available_units >= 0 AND available_units <= 20);

ALTER TABLE coOwn_assets
  ADD CONSTRAINT coOwn_assets_available_le_total_units_check CHECK (available_units <= total_units);

CREATE TABLE IF NOT EXISTS coOwn_orders (
  id BIGSERIAL PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES coOwn_assets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  units INTEGER NOT NULL CHECK (units > 0),
  unit_price_gbp NUMERIC(12, 4) NOT NULL CHECK (unit_price_gbp > 0),
  fee_gbp NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (fee_gbp >= 0),
  total_gbp NUMERIC(12, 4) NOT NULL CHECK (total_gbp >= 0),
  status TEXT NOT NULL CHECK (status IN ('open', 'partially_filled', 'filled', 'cancelled', 'rejected')),
  order_type TEXT NOT NULL DEFAULT 'market' CHECK (order_type IN ('market', 'limit')),
  limit_price_gbp NUMERIC(12, 4),
  remaining_units INTEGER,
  filled_units INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (order_type = 'market' AND limit_price_gbp IS NULL)
    OR (order_type = 'limit' AND limit_price_gbp IS NOT NULL AND limit_price_gbp > 0)
  )
);

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

CREATE INDEX IF NOT EXISTS coOwn_orders_asset_idx
  ON coOwn_orders (asset_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coOwn_orders_user_idx
  ON coOwn_orders (user_id, created_at DESC);

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

ALTER TABLE coOwn_holdings
  DROP CONSTRAINT IF EXISTS coOwn_holdings_units_owned_check;

ALTER TABLE coOwn_holdings
  DROP CONSTRAINT IF EXISTS coOwn_holdings_units_owned_cap_check;

ALTER TABLE coOwn_holdings
  ADD CONSTRAINT coOwn_holdings_units_owned_cap_check CHECK (units_owned >= 0 AND units_owned <= 20);

CREATE INDEX IF NOT EXISTS coOwn_holdings_asset_idx
  ON coOwn_holdings (asset_id, units_owned DESC);

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

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_target_units_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_units_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_target_units_cap_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_units_cap_check;

ALTER TABLE coOwn_buyout_offers
  DROP CONSTRAINT IF EXISTS coOwn_buyout_offers_accepted_le_target_check;

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_target_units_cap_check CHECK (target_units > 0 AND target_units <= 20);

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_accepted_units_cap_check CHECK (accepted_units >= 0 AND accepted_units <= 20);

ALTER TABLE coOwn_buyout_offers
  ADD CONSTRAINT coOwn_buyout_offers_accepted_le_target_check CHECK (accepted_units <= target_units);

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
