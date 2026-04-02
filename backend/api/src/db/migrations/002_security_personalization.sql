CREATE TABLE IF NOT EXISTS user_secure_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS secure_messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS secure_messages_conversation_idx
  ON secure_messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS wallet_secure_snapshots (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wallet_secure_snapshots_user_created_idx
  ON wallet_secure_snapshots (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS recommendation_feedback (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('view', 'wishlist', 'purchase')),
  served_score NUMERIC(10, 6),
  served_policy TEXT CHECK (served_policy IN ('exploit', 'explore')),
  surface TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recommendation_feedback_user_idx ON recommendation_feedback (user_id);
CREATE INDEX IF NOT EXISTS recommendation_feedback_listing_idx ON recommendation_feedback (listing_id);
CREATE INDEX IF NOT EXISTS recommendation_feedback_created_idx ON recommendation_feedback (created_at DESC);
