-- Closed-loop hardening forward migration for existing databases.
-- This migration avoids editing previously applied migrations in-place.

ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_account_code_check;

DELETE FROM ledger_accounts old_account
USING ledger_accounts new_account
WHERE old_account.owner_type = 'platform'
  AND old_account.owner_id = 'platform'
  AND old_account.account_code = 'gold_reserve_grams'
  AND old_account.currency IN ('XAU', 'GBP', 'IZE')
  AND new_account.owner_type = 'platform'
  AND new_account.owner_id = 'platform'
  AND new_account.account_code = 'ize_fiat_received'
  AND new_account.currency = 'GBP';

UPDATE ledger_accounts
SET
  account_code = 'ize_fiat_received',
  currency = 'GBP'
WHERE owner_type = 'platform'
  AND owner_id = 'platform'
  AND account_code = 'gold_reserve_grams';

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_code_check CHECK (
    account_code IN (
      'escrow_liability',
      'platform_revenue',
      'seller_payable',
      'buyer_spend',
      'withdrawable_balance',
      'withdrawal_pending',
      'ize_wallet',
      'ize_pending_redemption',
      'ize_outstanding',
      'ize_fiat_received'
    )
  );

UPDATE jurisdiction_policies
SET
  requires_context = TRUE,
  updated_at = NOW()
WHERE requires_context = FALSE;

DO $$
BEGIN
  IF to_regclass('public.gold_reserve_attestations') IS NOT NULL
    AND to_regclass('public.ize_reconciliation_snapshots') IS NULL THEN
    ALTER TABLE gold_reserve_attestations RENAME TO ize_reconciliation_snapshots;
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.gold_reserve_attestations_created_idx') IS NOT NULL
    AND to_regclass('public.ize_reconciliation_snapshots_created_idx') IS NULL THEN
    ALTER INDEX gold_reserve_attestations_created_idx RENAME TO ize_reconciliation_snapshots_created_idx;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ize_reconciliation_snapshots (
  id TEXT PRIMARY KEY,
  liquidity_buffer_ize NUMERIC(18, 6) NOT NULL CHECK (liquidity_buffer_ize >= 0),
  outstanding_ize NUMERIC(18, 6) NOT NULL CHECK (outstanding_ize >= 0),
  supply_delta_ize NUMERIC(18, 6) NOT NULL,
  within_threshold BOOLEAN NOT NULL,
  attested_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ize_reconciliation_snapshots'
      AND column_name = 'reserve_grams'
  ) THEN
    ALTER TABLE ize_reconciliation_snapshots
      RENAME COLUMN reserve_grams TO liquidity_buffer_ize;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ize_reconciliation_snapshots'
      AND column_name = 'drift_grams'
  ) THEN
    ALTER TABLE ize_reconciliation_snapshots
      RENAME COLUMN drift_grams TO supply_delta_ize;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ize_reconciliation_snapshots_created_idx
  ON ize_reconciliation_snapshots (created_at DESC);
