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
VALUES (
  'jr_syndicate_us',
  'syndicate',
  'country',
  'US',
  TRUE,
  'enhanced',
  TRUE,
  NULL,
  NULL,
  NULL,
  NULL,
  '{"jurisdiction": "US", "comment": "Country rule enabled by migration 012"}'::jsonb
)
ON CONFLICT (market, scope, scope_code)
DO UPDATE
SET
  is_enabled = EXCLUDED.is_enabled,
  min_kyc_level = EXCLUDED.min_kyc_level,
  require_sanctions_clear = EXCLUDED.require_sanctions_clear,
  blocked_reason = EXCLUDED.blocked_reason,
  metadata = EXCLUDED.metadata,
  updated_at = NOW();
