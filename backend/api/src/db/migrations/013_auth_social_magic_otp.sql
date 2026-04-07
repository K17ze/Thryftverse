CREATE TABLE IF NOT EXISTS auth_oauth_identities (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'apple')),
  provider_user_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT,
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_oauth_identities_user_provider_unique_idx
  ON auth_oauth_identities (user_id, provider);

CREATE INDEX IF NOT EXISTS auth_oauth_identities_user_idx
  ON auth_oauth_identities (user_id);

CREATE TABLE IF NOT EXISTS auth_magic_links (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT,
  requested_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS auth_magic_links_email_idx
  ON auth_magic_links (LOWER(email), created_at DESC);

CREATE TABLE IF NOT EXISTS auth_otp_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  requested_ip TEXT,
  requested_user_agent TEXT
);

CREATE INDEX IF NOT EXISTS auth_otp_challenges_email_idx
  ON auth_otp_challenges (LOWER(email), created_at DESC);
