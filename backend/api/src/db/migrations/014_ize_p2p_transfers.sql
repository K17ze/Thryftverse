ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_source_type_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_source_type_check CHECK (
    source_type IN (
      'order_payment',
      'payout',
      'refund',
      'adjustment',
      'mint',
      'burn',
      'coOwn_trade',
      'buyout',
      'reserve_reconcile',
      'transfer'
    )
  );

ALTER TABLE jurisdiction_rules
  DROP CONSTRAINT IF EXISTS jurisdiction_rules_market_check;

ALTER TABLE jurisdiction_rules
  ADD CONSTRAINT jurisdiction_rules_market_check CHECK (
    market IN ('co-own', 'auctions', 'wallet', 'p2p')
  );

ALTER TABLE aml_alerts
  DROP CONSTRAINT IF EXISTS aml_alerts_market_check;

ALTER TABLE aml_alerts
  ADD CONSTRAINT aml_alerts_market_check CHECK (
    market IN ('co-own', 'auctions', 'wallet', 'p2p')
  );

ALTER TABLE aml_alerts
  DROP CONSTRAINT IF EXISTS aml_alerts_event_type_check;

ALTER TABLE aml_alerts
  ADD CONSTRAINT aml_alerts_event_type_check CHECK (
    event_type IN ('trade', 'bid', 'deposit', 'withdrawal', 'transfer', 'manual')
  );

CREATE TABLE IF NOT EXISTS wallet_ize_transfers (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  ize_amount NUMERIC(18, 6) NOT NULL CHECK (ize_amount > 0),
  fiat_amount NUMERIC(18, 6) NOT NULL CHECK (fiat_amount >= 0),
  fiat_currency TEXT NOT NULL CHECK (char_length(fiat_currency) = 3),
  rate_per_gram NUMERIC(18, 6) NOT NULL CHECK (rate_per_gram > 0),
  status TEXT NOT NULL CHECK (status IN ('committed', 'blocked', 'reversed')),
  eligibility_code TEXT,
  aml_risk_score NUMERIC(5, 2),
  aml_risk_level TEXT,
  aml_alert_id TEXT REFERENCES aml_alerts(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ,
  CHECK (sender_user_id <> recipient_user_id)
);

CREATE INDEX IF NOT EXISTS wallet_ize_transfers_sender_idx
  ON wallet_ize_transfers (sender_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_ize_transfers_recipient_idx
  ON wallet_ize_transfers (recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS wallet_ize_transfers_status_idx
  ON wallet_ize_transfers (status, created_at DESC);

INSERT INTO jurisdiction_rules (
  id,
  market,
  scope,
  scope_code,
  is_enabled,
  min_kyc_level,
  require_sanctions_clear,
  max_order_notional_gbp,
  max_daily_notional_gbp,
  max_open_orders,
  blocked_reason,
  metadata
)
VALUES
  (
    'jr_p2p_global',
    'p2p',
    'global',
    'GLOBAL',
    TRUE,
    'basic',
    TRUE,
    2500,
    7500,
    NULL,
    NULL,
    '{"note": "Default P2P 1ze transfer controls"}'::jsonb
  ),
  (
    'jr_p2p_us',
    'p2p',
    'country',
    'US',
    TRUE,
    'enhanced',
    TRUE,
    1500,
    4000,
    NULL,
    NULL,
    '{"jurisdiction": "US", "comment": "Enhanced KYC for P2P transfer corridor"}'::jsonb
  )
ON CONFLICT (market, scope, scope_code)
DO UPDATE
  SET
    is_enabled = EXCLUDED.is_enabled,
    min_kyc_level = EXCLUDED.min_kyc_level,
    require_sanctions_clear = EXCLUDED.require_sanctions_clear,
    max_order_notional_gbp = EXCLUDED.max_order_notional_gbp,
    max_daily_notional_gbp = EXCLUDED.max_daily_notional_gbp,
    max_open_orders = EXCLUDED.max_open_orders,
    blocked_reason = EXCLUDED.blocked_reason,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
