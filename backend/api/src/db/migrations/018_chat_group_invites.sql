CREATE TABLE IF NOT EXISTS chat_group_invites (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  max_uses INTEGER NOT NULL DEFAULT 0 CHECK (max_uses >= 0),
  use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_used_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_uses = 0 OR use_count <= max_uses)
);

CREATE INDEX IF NOT EXISTS chat_group_invites_conversation_created_idx
  ON chat_group_invites (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS chat_group_invites_validity_idx
  ON chat_group_invites (expires_at, revoked_at);
