CREATE TABLE IF NOT EXISTS notification_devices (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('expo')),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  app_version TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS notification_devices_user_idx
  ON notification_devices (user_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS notification_devices_active_idx
  ON notification_devices (user_id, provider, platform)
  WHERE is_active = TRUE;

CREATE TABLE IF NOT EXISTS notification_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('push', 'in_app', 'email', 'system')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL CHECK (status IN ('queued', 'sent', 'failed')),
  provider_message_id TEXT,
  provider_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notification_events_user_created_idx
  ON notification_events (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notification_events_status_created_idx
  ON notification_events (status, created_at DESC);

ALTER TABLE auctions
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS winner_bid_id BIGINT REFERENCES auction_bids(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS winner_bidder_id TEXT REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE listings
SET search_vector =
  setweight(to_tsvector('simple', COALESCE(title, '')), 'A')
  || setweight(to_tsvector('simple', COALESCE(description, '')), 'B')
WHERE search_vector IS NULL;

CREATE INDEX IF NOT EXISTS listings_search_vector_idx
  ON listings USING GIN (search_vector);

CREATE OR REPLACE FUNCTION listings_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', COALESCE(NEW.title, '')), 'A')
    || setweight(to_tsvector('simple', COALESCE(NEW.description, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listings_search_vector_update_trigger ON listings;

CREATE TRIGGER listings_search_vector_update_trigger
BEFORE INSERT OR UPDATE OF title, description ON listings
FOR EACH ROW EXECUTE FUNCTION listings_search_vector_update();
