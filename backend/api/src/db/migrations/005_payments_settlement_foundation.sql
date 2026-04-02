CREATE TABLE IF NOT EXISTS payment_gateways (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  gateway_type TEXT NOT NULL CHECK (gateway_type IN ('fiat', 'stablecoin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO payment_gateways (id, display_name, gateway_type, is_active)
VALUES
  ('mock_fiat_gbp', 'Mock Fiat Gateway', 'fiat', TRUE),
  ('mock_tvusd', 'Mock TVUSD Gateway', 'stablecoin', TRUE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS payment_customers (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  provider_customer_ref TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_customer_ref),
  UNIQUE (user_id, gateway_id)
);

CREATE INDEX IF NOT EXISTS payment_customers_user_idx
  ON payment_customers (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_instruments (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  customer_id BIGINT REFERENCES payment_customers(id) ON DELETE SET NULL,
  method_type TEXT NOT NULL CHECK (method_type IN ('card', 'bank_account', 'wallet')),
  provider_payment_method_ref TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending_verification', 'disabled')),
  brand TEXT,
  last4 TEXT,
  expiry_month SMALLINT CHECK (expiry_month BETWEEN 1 AND 12),
  expiry_year SMALLINT CHECK (expiry_year BETWEEN 2000 AND 2200),
  country_code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_payment_method_ref)
);

CREATE INDEX IF NOT EXISTS payment_instruments_user_idx
  ON payment_instruments (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_intents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('commerce', 'syndicate', 'wallet_topup', 'wallet_withdrawal')),
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  syndicate_order_id BIGINT REFERENCES syndicate_orders(id) ON DELETE SET NULL,
  instrument_id BIGINT REFERENCES payment_instruments(id) ON DELETE SET NULL,
  amount_gbp NUMERIC(12, 2) NOT NULL CHECK (amount_gbp >= 0),
  amount_currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(amount_currency) = 3),
  status TEXT NOT NULL CHECK (
    status IN (
      'requires_payment_method',
      'requires_confirmation',
      'processing',
      'succeeded',
      'failed',
      'cancelled'
    )
  ),
  provider_intent_ref TEXT,
  client_secret TEXT,
  idempotency_key TEXT,
  failure_code TEXT,
  failure_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_intent_ref),
  UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS payment_intents_user_idx
  ON payment_intents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_intents_order_idx
  ON payment_intents (order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_attempts (
  id BIGSERIAL PRIMARY KEY,
  intent_id TEXT NOT NULL REFERENCES payment_intents(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled')),
  amount_gbp NUMERIC(12, 2) NOT NULL CHECK (amount_gbp >= 0),
  provider_fee_gbp NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (provider_fee_gbp >= 0),
  provider_attempt_ref TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_attempt_ref)
);

CREATE INDEX IF NOT EXISTS payment_attempts_intent_idx
  ON payment_attempts (intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id BIGSERIAL PRIMARY KEY,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_event_id)
);

CREATE INDEX IF NOT EXISTS payment_webhook_events_intent_idx
  ON payment_webhook_events (intent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payout_accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gateway_id TEXT NOT NULL REFERENCES payment_gateways(id) ON DELETE RESTRICT,
  provider_account_ref TEXT NOT NULL,
  country_code TEXT,
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(currency) = 3),
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (gateway_id, provider_account_ref)
);

CREATE INDEX IF NOT EXISTS payout_accounts_user_idx
  ON payout_accounts (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS payout_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payout_account_id BIGINT NOT NULL REFERENCES payout_accounts(id) ON DELETE RESTRICT,
  amount_gbp NUMERIC(12, 2) NOT NULL CHECK (amount_gbp > 0),
  amount_currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(amount_currency) = 3),
  status TEXT NOT NULL CHECK (status IN ('requested', 'processing', 'paid', 'failed', 'cancelled')),
  provider_payout_ref TEXT,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_payout_ref)
);

CREATE INDEX IF NOT EXISTS payout_requests_user_idx
  ON payout_requests (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id BIGSERIAL PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('platform', 'user')),
  owner_id TEXT NOT NULL,
  account_code TEXT NOT NULL CHECK (
    account_code IN (
      'escrow_liability',
      'platform_revenue',
      'seller_payable',
      'buyer_spend',
      'withdrawable_balance',
      'withdrawal_pending'
    )
  ),
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(currency) = 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_type, owner_id, account_code, currency)
);

INSERT INTO ledger_accounts (owner_type, owner_id, account_code, currency)
VALUES
  ('platform', 'platform', 'escrow_liability', 'GBP'),
  ('platform', 'platform', 'platform_revenue', 'GBP')
ON CONFLICT (owner_type, owner_id, account_code, currency) DO NOTHING;

CREATE TABLE IF NOT EXISTS ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  account_id BIGINT NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  counterparty_account_id BIGINT NOT NULL REFERENCES ledger_accounts(id) ON DELETE RESTRICT,
  direction TEXT NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_gbp NUMERIC(12, 2) NOT NULL CHECK (amount_gbp >= 0),
  currency TEXT NOT NULL DEFAULT 'GBP' CHECK (char_length(currency) = 3),
  source_type TEXT NOT NULL CHECK (source_type IN ('order_payment', 'payout', 'refund', 'adjustment')),
  source_id TEXT NOT NULL,
  line_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ledger_entries_source_idx
  ON ledger_entries (source_type, source_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ledger_entries_account_idx
  ON ledger_entries (account_id, created_at DESC);
