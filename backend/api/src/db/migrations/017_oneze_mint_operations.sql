CREATE TABLE IF NOT EXISTS mint_operations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (
    state IN (
      'INITIATED',
      'PAYMENT_PENDING',
      'PAYMENT_CONFIRMED',
      'RESERVE_PURCHASING',
      'RESERVE_ALLOCATED',
      'WALLET_CREDITED',
      'SETTLED',
      'PAYMENT_FAILED',
      'PAYMENT_REFUNDED',
      'RESERVE_FAILED',
      'RECONCILIATION_HOLD',
      'RESERVE_UNKNOWN'
    )
  ),
  fiat_amount_minor BIGINT NOT NULL CHECK (fiat_amount_minor >= 0),
  fiat_currency CHAR(3) NOT NULL,
  net_fiat_amount_minor BIGINT NOT NULL CHECK (net_fiat_amount_minor >= 0),
  platform_fee_minor BIGINT NOT NULL CHECK (platform_fee_minor >= 0),
  ize_amount_mg BIGINT NOT NULL CHECK (ize_amount_mg > 0),
  rate_per_gram NUMERIC(18, 6) NOT NULL CHECK (rate_per_gram > 0),
  rate_source TEXT NOT NULL,
  rate_locked_at TIMESTAMPTZ NOT NULL,
  rate_expires_at TIMESTAMPTZ NOT NULL,
  payment_intent_id TEXT REFERENCES payment_intents(id) ON DELETE SET NULL,
  lot_id TEXT REFERENCES gold_reserve_lots(id) ON DELETE SET NULL,
  custodian_ref TEXT,
  escrow_ledger_tx_id TEXT,
  wallet_credit_tx_id TEXT,
  purchase_attempted_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  last_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_intent_id)
);

CREATE INDEX IF NOT EXISTS mint_operations_user_created_idx
  ON mint_operations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mint_operations_state_idx
  ON mint_operations (state, created_at DESC);

CREATE INDEX IF NOT EXISTS mint_operations_active_state_idx
  ON mint_operations (state, updated_at DESC)
  WHERE state NOT IN (
    'SETTLED',
    'PAYMENT_FAILED',
    'PAYMENT_REFUNDED',
    'RESERVE_FAILED',
    'RESERVE_UNKNOWN'
  );
