CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('dm', 'group')),
  title TEXT,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES listings(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_members (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_members_user_joined_idx
  ON chat_members (user_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS chat_members_conversation_joined_idx
  ON chat_members (conversation_id, joined_at ASC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('user', 'bot', 'system')),
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_bot_id TEXT,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON chat_messages (conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_bots (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  command_hint TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('moderation', 'commerce', 'automation')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_bot_installs (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES chat_bots(id) ON DELETE CASCADE,
  installed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, bot_id)
);

CREATE INDEX IF NOT EXISTS chat_bot_installs_bot_idx
  ON chat_bot_installs (bot_id, installed_at DESC);

INSERT INTO chat_bots (id, slug, name, description, command_hint, category, metadata)
VALUES
  (
    'bot_guard',
    'guard',
    'Guard Bot',
    'Moderation helper for rules, join messages, and spam guardrails.',
    '/guard status',
    'moderation',
    '{}'::jsonb
  ),
  (
    'bot_trade',
    'tradeops',
    'TradeOps Bot',
    'Posts auction and co-own market alerts into your group.',
    '/tradeops alerts on',
    'commerce',
    '{}'::jsonb
  ),
  (
    'bot_brief',
    'brief',
    'Daily Brief Bot',
    'Sends timed digest updates and pinned reminders.',
    '/brief now',
    'automation',
    '{}'::jsonb
  )
ON CONFLICT (id) DO UPDATE
SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  command_hint = EXCLUDED.command_hint,
  category = EXCLUDED.category,
  is_active = TRUE,
  updated_at = NOW();
