CREATE TABLE IF NOT EXISTS user_addresses (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  street TEXT NOT NULL,
  city TEXT NOT NULL,
  postcode TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON user_addresses (user_id);

CREATE TABLE IF NOT EXISTS user_payment_methods (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method_type TEXT NOT NULL CHECK (method_type IN ('card', 'bank_account')),
  label TEXT NOT NULL,
  details TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_payment_methods_user_idx ON user_payment_methods (user_id);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  subtotal_gbp NUMERIC(12, 2) NOT NULL CHECK (subtotal_gbp >= 0),
  buyer_protection_fee_gbp NUMERIC(12, 2) NOT NULL CHECK (buyer_protection_fee_gbp >= 0),
  total_gbp NUMERIC(12, 2) NOT NULL CHECK (total_gbp >= 0),
  status TEXT NOT NULL CHECK (status IN ('created', 'paid', 'shipped', 'delivered', 'cancelled')),
  address_id BIGINT REFERENCES user_addresses(id) ON DELETE SET NULL,
  payment_method_id BIGINT REFERENCES user_payment_methods(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orders_buyer_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_idx ON orders (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS auctions (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  starting_bid_gbp NUMERIC(12, 2) NOT NULL CHECK (starting_bid_gbp >= 0),
  current_bid_gbp NUMERIC(12, 2) NOT NULL CHECK (current_bid_gbp >= 0),
  buy_now_price_gbp NUMERIC(12, 2),
  bid_count INTEGER NOT NULL DEFAULT 0 CHECK (bid_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('upcoming', 'live', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auctions_status_idx ON auctions (status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS auction_bids (
  id BIGSERIAL PRIMARY KEY,
  auction_id TEXT NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  bidder_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_gbp NUMERIC(12, 2) NOT NULL CHECK (amount_gbp >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS auction_bids_auction_idx ON auction_bids (auction_id, created_at DESC);

CREATE TABLE IF NOT EXISTS syndicate_assets (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  issuer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  image_url TEXT,
  total_units INTEGER NOT NULL CHECK (total_units > 0),
  available_units INTEGER NOT NULL CHECK (available_units >= 0),
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

CREATE INDEX IF NOT EXISTS syndicate_assets_open_idx ON syndicate_assets (is_open, created_at DESC);

CREATE TABLE IF NOT EXISTS syndicate_orders (
  id BIGSERIAL PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES syndicate_assets(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  units INTEGER NOT NULL CHECK (units > 0),
  unit_price_gbp NUMERIC(12, 4) NOT NULL CHECK (unit_price_gbp > 0),
  fee_gbp NUMERIC(12, 4) NOT NULL DEFAULT 0 CHECK (fee_gbp >= 0),
  total_gbp NUMERIC(12, 4) NOT NULL CHECK (total_gbp >= 0),
  status TEXT NOT NULL CHECK (status IN ('filled', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS syndicate_orders_asset_idx ON syndicate_orders (asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS syndicate_orders_user_idx ON syndicate_orders (user_id, created_at DESC);

INSERT INTO auctions (
  id,
  listing_id,
  seller_id,
  starts_at,
  ends_at,
  starting_bid_gbp,
  current_bid_gbp,
  buy_now_price_gbp,
  bid_count,
  status
)
VALUES (
  'a_seed_1',
  'l_seed_1',
  'u2',
  NOW() - INTERVAL '1 hour',
  NOW() + INTERVAL '5 hours',
  95.00,
  95.00,
  160.00,
  0,
  'live'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO syndicate_assets (
  id,
  listing_id,
  issuer_id,
  title,
  image_url,
  total_units,
  available_units,
  unit_price_gbp,
  unit_price_stable,
  settlement_mode,
  issuer_jurisdiction,
  market_move_pct_24h,
  holders,
  volume_24h_gbp,
  is_open
)
VALUES (
  's_seed_1',
  'l_seed_2',
  'u2',
  'Y2K Utility Bag Fraction Pool',
  'https://picsum.photos/seed/s_seed_1/800/800',
  1000,
  1000,
  1.25,
  1.60,
  'HYBRID',
  'GB',
  0,
  0,
  0,
  TRUE
)
ON CONFLICT (id) DO NOTHING;
