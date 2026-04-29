-- Migration: Stripe Connect Accounts for Seller Fund Segregation
-- Purpose: Store seller Stripe Connect account IDs for commerce escrow

CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    stripe_account_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    -- status values: pending, active, rejected, requirements_due
    onboarding_url TEXT,
    charges_enabled BOOLEAN DEFAULT FALSE,
    payouts_enabled BOOLEAN DEFAULT FALSE,
    requirements_disabled_reason TEXT,
    -- Metadata for tracking
    country TEXT DEFAULT 'GB',
    default_currency TEXT DEFAULT 'gbp',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_user_id ON stripe_connect_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_stripe_account_id ON stripe_connect_accounts(stripe_account_id);
CREATE INDEX IF NOT EXISTS idx_stripe_connect_accounts_status ON stripe_connect_accounts(status);

-- Comment explaining table purpose
COMMENT ON TABLE stripe_connect_accounts IS 'Stores Stripe Connect account IDs for sellers. Used for commerce escrow - funds held in seller Connect accounts until delivery confirmation.';
COMMENT ON COLUMN stripe_connect_accounts.status IS 'pending: onboarding started, active: fully onboarded and charges enabled, rejected: account rejected, requirements_due: additional info needed';
