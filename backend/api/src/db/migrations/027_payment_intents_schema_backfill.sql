-- Backfill payment_intents schema for environments carrying legacy syndicate-era columns
-- and constraints from earlier migration branches.

ALTER TABLE payment_intents
  ADD COLUMN IF NOT EXISTS coOwn_order_id BIGINT REFERENCES coOwn_orders(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payment_intents'
      AND column_name = 'syndicate_order_id'
  ) THEN
    UPDATE payment_intents
    SET coOwn_order_id = syndicate_order_id
    WHERE coOwn_order_id IS NULL
      AND syndicate_order_id IS NOT NULL;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS payment_intents_coOwn_order_idx
  ON payment_intents (coOwn_order_id, created_at DESC);

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_channel_check;

ALTER TABLE payment_intents
  ADD CONSTRAINT payment_intents_channel_check
  CHECK (
    channel IN ('commerce', 'co-own', 'syndicate', 'wallet_topup', 'wallet_withdrawal')
  );