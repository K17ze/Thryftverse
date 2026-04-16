-- Decommission legacy gold-backed schema artifacts after controlled 1ze rollout.
-- This migration is intentionally idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'wallet_ledger'
      AND column_name = 'gold_rate_inr_per_g'
  ) THEN
    ALTER TABLE wallet_ledger
      RENAME COLUMN gold_rate_inr_per_g TO anchor_value_in_inr;
  END IF;
END $$;

-- Runtime no longer depends on these tables.
DROP TABLE IF EXISTS gold_rate_overrides CASCADE;
DROP TABLE IF EXISTS gold_rate_quotes CASCADE;
DROP TABLE IF EXISTS reserve_movements CASCADE;
DROP TABLE IF EXISTS gold_reserve_lots CASCADE;
DROP TABLE IF EXISTS gold_price_ticks CASCADE;
