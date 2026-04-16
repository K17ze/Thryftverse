ALTER TABLE ledger_accounts
  DROP CONSTRAINT IF EXISTS ledger_accounts_account_code_check;

ALTER TABLE ledger_accounts
  ADD CONSTRAINT ledger_accounts_account_code_check CHECK (
    account_code IN (
      'escrow_liability',
      'platform_revenue',
      'platform_operating',
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

INSERT INTO ledger_accounts (owner_type, owner_id, account_code, currency)
VALUES ('platform', 'platform', 'platform_operating', 'GBP')
ON CONFLICT (owner_type, owner_id, account_code, currency) DO NOTHING;
