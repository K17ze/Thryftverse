CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price_gbp NUMERIC(12, 2) NOT NULL CHECK (price_gbp >= 0),
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS interactions (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('view', 'wishlist', 'purchase')),
  strength NUMERIC(8, 4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS interactions_user_idx ON interactions (user_id);
CREATE INDEX IF NOT EXISTS interactions_listing_idx ON interactions (listing_id);
CREATE INDEX IF NOT EXISTS interactions_action_idx ON interactions (action);

CREATE TABLE IF NOT EXISTS recommendations (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  score NUMERIC(10, 6) NOT NULL,
  source TEXT NOT NULL DEFAULT 'ml',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, listing_id)
);

INSERT INTO users (id, username)
VALUES ('u1', 'thryftverse_user')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, username)
VALUES ('u2', 'stylist_trader')
ON CONFLICT (id) DO NOTHING;

INSERT INTO listings (id, seller_id, title, description, price_gbp, image_url)
VALUES
  ('l_seed_1', 'u2', 'Vintage Racing Jacket', 'Archive race-inspired jacket in very good condition', 145.00, 'https://picsum.photos/seed/l_seed_1/800/800'),
  ('l_seed_2', 'u2', 'Y2K Utility Bag', 'Structured utility bag with detachable strap', 89.00, 'https://picsum.photos/seed/l_seed_2/800/800'),
  ('l_seed_3', 'u1', 'Selvedge Denim', 'Raw selvedge denim with minimal wear', 120.00, 'https://picsum.photos/seed/l_seed_3/800/800')
ON CONFLICT (id) DO NOTHING;
