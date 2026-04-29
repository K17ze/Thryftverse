# Thryftverse White Label Payments and Treasury Implementation Report

## 1. Objective

Build a fully native Thryftverse money experience where:
- Thryftverse owns the full user interface and customer journey.
- Stripe and Wise run only as background transaction rails.
- Platform fees, spread, and commissions are correctly separated from user funds via Stripe Connect.
- Company revenue lands in Thryftverse-controlled balances and sweeps to company bank accounts.
- User-to-user money movement and seller payouts are accurate, auditable, and reconciliation-safe.

This report provides a complete coding blueprint to implement and harden the full functionality end to end.

## 2. Product Model

### 2.1 White Label Principle

Users must never need to think about Stripe or Wise. They should only see:
- Thryftverse payment screens.
- Thryftverse transaction statuses.
- Thryftverse wallet and payout history.
- Dual wallet balances: 1ze (platform token) and Fiat (withdrawable).

Provider details are internal only:
- Stored as metadata and provider references in backend data models.
- Used for support, reconciliation, dispute handling, and compliance.

### 2.2 Dual Wallet Architecture

Each user has a wallet with two distinct balances:
- **1ze Balance**: In-game platform token for co-own unit trading only. Not withdrawable directly.
- **Fiat Balance**: Real money (GBP/USD/etc.) held in Stripe Connect accounts. Withdrawable to bank.

### 2.3 Money Separation Principle

All flows must enforce three distinct value buckets:
- User principal: money that belongs to buyer/seller users (held in their Stripe Connect accounts).
- Platform revenue: commissions, fees, and spread belonging to Thryftverse (collected via Stripe Connect application fees).
- Operational movement: bank rail transfers, payout processing, sweeps, and reversals.

## 3. Target Architecture

## 3.1 Layers

1. Experience Layer (Frontend)
- React Native app and backend-for-frontend API contracts.
- Native Thryftverse forms, statuses, timelines, and support actions.
- Wallet displays dual balances: 1ze and Fiat distinctly.

2. Money Orchestration Layer (Backend API)
- Unified payment and payout domain service.
- Provider-agnostic orchestration for intents, settlements, refunds, disputes, and payouts.
- Three distinct payment channels: Commerce (Fiat Escrow), Co-Own (1ze), Wallet (Fiat Top-up/Withdrawal).

3. Rail Adapter Layer
- **Stripe Connect adapter**: User-linked connected accounts for fund segregation.
- **Stripe Platform adapter**: Standard payment intents for co-own 1ze minting.
- **Wise adapter**: External transfer and bank payout rails.

4. Ledger and Treasury Layer
- Double-entry accounting tables.
- Revenue, escrow, payable, pending withdrawal, operating account balances.
- 1ze token ledger (mint/burn/transfer) separate from fiat escrow ledger.
- Daily reconciliation and mismatch controls.

5. Risk, Compliance, and Ops Layer
- AML and policy checks.
- Webhook idempotency and replay safety.
- Alerting, reporting, and operator controls.

## 3.2 System Contracts

- Frontend never calls Stripe or Wise directly for core flow state changes.
- Backend owns all state transitions.
- Webhooks are source of truth for final provider outcome.
- Every state transition must be idempotent.
- Every money transition must produce ledger entries and audit events.
- 1ze is strictly internal platform token - never directly withdrawable.
- Fiat withdrawals only from fiat balance via Stripe Connect payouts.

## 4. Full Functionality Scope to Implement

## 4.1 Payment Intent Lifecycle by Channel

### Commerce Channel (Fiat Escrow)
**Purpose**: Normal marketplace purchases (buyer → seller physical goods)

**Flow**:
1. Buyer creates payment intent linked to order
2. Stripe Connect: Funds go to seller's connected account with application fee to platform
3. **Escrow**: Funds held until delivery confirmation
4. **Release**: On delivery confirmation, seller receives net amount (minus platform fee)
5. **Platform Fee**: Automatically extracted via Stripe Connect application_fee_amount

**Implementation**:
```typescript
stripe.paymentIntents.create({
  amount: orderAmount,
  currency: 'gbp',
  automatic_payment_methods: { enabled: true },
  application_fee_amount: platformFeeAmount,
  on_behalf_of: sellerConnectAccountId,
  transfer_data: { destination: sellerConnectAccountId },
});
```

### Co-Own Channel (1ze Minting)
**Purpose**: Unit trading in co-own assets (platform token only)

**1ze Concept**: 1ze is strictly a **platform currency** - similar to gems in Clash of Clans or UC in PUBG. It exists only for trading within the co-own marketplace and has no external value or direct withdrawal.

**Acquisition Methods**:
1. **Direct Purchase**: User pays fiat via Stripe → 1ze minted to wallet
2. **Wallet Conversion**: User buys 1ze using fiat_balance held in wallet (internal exchange)
3. **Platform Rewards**: 1ze awarded for promotions/achievements

**Usage Flow**:
1. **Mint/Acquire**: User obtains 1ze via purchase or conversion
2. **Trade**: Buyer uses 1ze to buy/sell co-own units (internal transfer only)
3. **Seller receives 1ze** (not fiat) for units sold
4. **Convert**: Seller can convert 1ze back to fiat via burn endpoint (to withdraw)

**1ze Transfer Restrictions**:
- Allowed contexts: `coOwn_trade`, `platform_reward`
- Blocked contexts: `marketplace_sale` (P2P must use fiat escrow)

### Wallet Channel (Fiat Top-up/Withdrawal + 1ze Exchange)
**Purpose**: 
- Fiat deposit and withdrawal
- **1ze purchase using wallet fiat balance**

**Flow**:
- **Deposit**: Stripe payment → fiat_balance credited
- **1ze Purchase**: User buys 1ze using fiat_balance (no Stripe call needed if sufficient balance)
  - Debit fiat_balance → Credit oneze_balance_mg (mint)
  - Rate: 1 GBP = 1000 1ze (or configured rate)
- **Withdrawal**: payout-request → Wise transfer → bank account

### Required states (all channels)
- requires_payment_method
- requires_confirmation
- processing
- succeeded
- failed
- cancelled

### Implementation requirements
- Create payment intent through backend endpoint with strict ownership checks.
- Persist provider intent reference, client action details, and metadata.
- Confirm state only after provider-confirmed outcome.
- Bind settlement logic to successful final state.
- Channel-specific post-payment actions (escrow vs mint vs top-up).

### Coding tasks
- Keep intent creation provider-agnostic.
- Add provider-specific execution in adapter methods.
- For Commerce: Use Stripe Connect with application fees.
- For Co-Own: Use standard Stripe payment + 1ze mint on success.
- Record payment attempts with provider attempt ids for dedupe.

## 4.2 Commerce Settlement (Buyer, Seller, Platform) - Fiat Escrow

### Required accounting events
- Buyer charged via Stripe Connect (held in seller's connected account).
- Escrow liability credited to ledger (buyer_spend → escrow_liability).
- Platform commission extracted via Stripe Connect application_fee_amount.
- Postage/service fee credited (if applicable).
- Seller payable released on delivery confirmation (escrow_liability → seller_payable).

### Stripe Connect Implementation
```typescript
// Payment Intent Creation
const paymentIntent = await stripe.paymentIntents.create({
  amount: Math.round(order.totalGbp * 100),
  currency: 'gbp',
  automatic_payment_methods: { enabled: true },
  application_fee_amount: Math.round(platformFeeGbp * 100),
  on_behalf_of: sellerStripeAccountId,
  transfer_data: {
    destination: sellerStripeAccountId,
  },
}, {
  stripeAccount: sellerStripeAccountId,
});
```

### Delivery Confirmation Flow
1. Buyer confirms receipt / Auto-confirm after tracking delivery
2. System calls `releaseEscrowToSeller(orderId)`
3. Ledger: escrow_liability debited, seller_payable credited
4. Seller can now withdraw to bank via payout request

### Coding tasks
- Maintain ledger posting in transaction blocks.
- Enforce one-time release (idempotent check before seller release).
- Handle refund/dispute reversals via Stripe Connect reverse transfer.
- Link order, parcel events, and payout eligibility.
- Store seller Stripe Connect account ID in `stripe_connect_accounts` table.

## 4.3 Co-Own Trading Money Path (1ze Only)

### Architecture
Co-own trading uses **1ze platform token only** - never fiat directly.

### Required accounting events
- **Mint**: Buyer pays fiat → 1ze minted to wallet (recordIzeMint).
- **Trade**: 1ze transferred from buyer to seller (recordIzeTransfer with contextType: 'coOwn_trade').
- **Platform fee**: 1ze deducted from trade, credited to platform (ledger entry).
- **Holdings update**: Buyer/seller unit holdings updated atomically.
- **Convert**: Seller burns 1ze → fiat credited to wallet (recordIzeBurn + applyWalletLedgerDelta FIAT).

### 1ze Transfer Restrictions
```typescript
const ALLOWED_1ZE_CONTEXTS = ['coOwn_trade', 'platform_reward'] as const;

if (!ALLOWED_1ZE_CONTEXTS.includes(contextType)) {
  throw createApiError('IZE_TRANSFER_INVALID_CONTEXT', 
    '1ze can only be transferred for co-own trading or platform rewards');
}
```

### Coding tasks
- Enforce 1ze transfer context restrictions (block marketplace_sale context).
- Ensure co-own trade fee is reflected in platform revenue ledger.
- Ensure trade matching and settlement are atomic.
- Prevent partial writes across holdings, trade rows, and ledger entries.
- Implement 1ze → Fiat conversion endpoint (`POST /wallet/convert-1ze-to-fiat`).

### New Endpoint: Convert 1ze to Fiat
```typescript
app.post('/wallet/convert-1ze-to-fiat', async (request, reply) => {
  // 1. Validate 1ze balance
  // 2. Burn 1ze via recordIzeBurn()
  // 3. Credit fiat via applyWalletLedgerDelta(asset: 'FIAT')
  // 4. Return updated wallet with both balances
});
```

### New Endpoint: Buy 1ze with Wallet Fiat
```typescript
app.post('/wallet/buy-1ze', async (request, reply) => {
  // 1. Validate fiat_balance sufficiency
  // 2. Debit fiat_balance via applyWalletLedgerDelta(asset: 'FIAT', amount: -fiatAmount)
  // 3. Mint 1ze via recordIzeMint() or applyWalletLedgerDelta(asset: '1ZE')
  // 4. Return updated wallet with both balances
  // Rate: 1 GBP = 1000 1ze (configurable)
});
```

## 4.4 Wallet Dual Balance Display

### Required API Response Structure
```json
{
  "ok": true,
  "userId": "user_123",
  "wallet": {
    "id": "wal_xxx",
    "onezeBalanceMg": 100000,
    "onezeBalance": 100.00,
    "fiatBalanceMinor": 5000,
    "fiatBalance": 50.00,
    "fiatCurrency": "GBP"
  }
}
```

### Frontend Display Requirements
- **1ze Balance Card**: Show 1ze amount with "For Co-Own Trading" label.
- **Fiat Balance Card**: Show fiat amount with "Withdrawable to Bank" label.
- **Convert Button**: 1ze ↔ Fiat conversion (if supported).
- Separate transaction histories for each balance type.

## 4.5 Payout Accounts and Payout Requests (Fiat Only)

### Required controls
- Strong user ownership validation.
- Active account validation.
- Currency and corridor policy validation.
- Velocity limits and risk/manual-review thresholds.
- **Fiat balance validation** (cannot request payout exceeding fiat_balance).

### Required statuses
- requested
- processing
- paid
- failed
- cancelled

### Payout Sources
- **Commerce sales**: Released from escrow → seller_payable → fiat_balance
- **Co-own trading**: Convert 1ze → fiat_balance → withdrawal
- **Direct fiat**: Top-up → fiat_balance → withdrawal

### Coding tasks
- User endpoint can request payout only from fiat_balance.
- 1ze withdrawals disabled in closed-loop mode (directOnezeWithdrawalRoutesDisabled = true).
- Only provider webhooks and admin-review paths can move to paid/failed/cancelled.
- Prevent direct user-triggered status transitions.
- Persist provider payout references only from trusted processing paths.

## 4.6 Platform Revenue Collection (Stripe Connect)

### Required behavior
- Platform fees collected via Stripe Connect `application_fee_amount` at payment time.
- Fees accumulate in Thryftverse Stripe Connect account automatically.
- No need for sweep from escrow - fees never touch seller accounts.
- Wise transfer for platform revenue sweep to corporate bank.

### Stripe Connect Fee Flow
```
Buyer Payment ($100)
  ├──→ Seller Connect Account ($95)
  └──→ Platform Fee ($5) → Thryftverse Connect Account
```

### Coding tasks
- Configure application_fee_amount on all commerce payment intents.
- Store platform fee rate in config (COMMERCE_PLATFORM_CHARGE_RATE = 0.05).
- Maintain ledger for platform revenue tracking (parallel to Stripe).
- Wise sweep from Thryftverse Connect balance to corporate bank.
- Add strict alerting on repeated sweep failures.

## 4.7 Platform Revenue Sweep and Company Bank Settlement

### Required behavior
- Revenue accumulates in Thryftverse Stripe Connect account.
- Sweep job transfers to corporate bank via Wise with explicit source ids.
- Optional external transfer required flag must block internal sweep when external transfer fails.
- Wise transfer references saved in metadata for traceability.

### Coding tasks
- Keep scheduler + manual trigger.
- Add strict alerting on repeated sweep failures.
- Add daily report of unswept platform revenue age and amount.

## 4.8 Withdrawal Spread and Network Fee Handling

### Required behavior
- Spread and network fee computed at quote (applies to fiat withdrawals only).
- On execution, recognized as explicit platform revenue entries.
- Net amount flows to user payout destination through rail.

### Coding tasks
- Post separate ledger lines for spread revenue and network fee components.
- Ensure withdrawal execution writes complete treasury entries, not only wallet state updates.
- Reversal path must reverse spread and fee entries when payout fails before final settlement.
- 1ze to fiat conversion has no spread (1:1 based on internal rate).

## 4.9 Refunds, Disputes, and Chargeback Safety

### Required behavior
- Manual refund and webhook refund should converge to same final accounting state.
- Lost disputes must trigger risk flags and liability reversal.
- Notification and support workflow must be queue-driven and idempotent.

### Stripe Connect Refunds
- Refunds reverse the transfer from seller account back to buyer.
- Platform fee is automatically refunded by Stripe.
- Ledger entries must reflect the full reversal.

### Coding tasks
- Execute reversal immediately on synchronous successful refund response.
- Keep webhook as reconciliation and idempotency fallback.
- Track dispute lifecycle in dedicated table and expose admin review endpoint.
- Handle Stripe Connect reverse transfers for refunds.

## 5. Provider Integration Strategy

## 5.1 Stripe Connect as Primary Payment Rail

Use Stripe Connect as backend rail for:
- **Commerce payments**: Funds held in seller connected accounts with automatic fee extraction.
- **Platform fee collection**: application_fee_amount collected at payment time.
- **Refund and dispute handling**: Reverse transfers and chargeback protection.
- **User-linked account management**: Onboarding sellers to Connect.

### Stripe Connect Implementation Requirements
- **Required**: Create `stripe_connect_accounts` table to store seller Connect IDs.
- **Onboarding**: Sellers must complete Stripe Connect onboarding before listing items.
- **Fee Structure**: application_fee_amount set to 5% (COMMERCE_PLATFORM_CHARGE_RATE) + £0.70 fixed.
- **Escrow**: Funds held in Connect account until delivery confirmation.

### Standard Stripe Platform for Co-Own
- Use standard Stripe payment intents (not Connect) for co-own 1ze minting.
- Funds go to platform account, then 1ze minted to user wallet.
- No fee extraction at payment time (fees handled in 1ze trades).

## 5.2 Wise as Payout and Sweep Rail

Use Wise as backend rail for:
- **User fiat withdrawals**: From fiat_balance to user bank accounts.
- **Platform revenue sweep**: From Thryftverse Stripe Connect to corporate bank.
- **Corporate recipient routing**: For platform treasury settlement.

### Implementation requirements
- Strict credential checks and recipient/profile validation.
- Idempotent transfer creation with source ids.
- Persist provider transfer/quote references for reconciliation.
- Validate fiat_balance sufficiency before initiating user payout.
- Block payouts when reconciliation is in critical state.

## 6. Security and Control Hardening

## 6.1 Endpoint access rules

1. Public-safe operations
- Non-sensitive reads and webhooks only.

2. Authenticated user operations
- Create payment intent for owned order/context.
- Request payout.
- Read own transaction history.

3. Admin-only operations
- Force status transitions.
- Review and approve/reject payout requests.
- Trigger ops sweeps/reconciliation overrides.

## 6.2 Mandatory guardrails

- Disallow user-simulated payment success in production.
- Disallow user-driven payout paid/processing transitions.
- Enforce actor-user context match in every user-scoped route.
- Verify webhook signatures for all providers.
- Deduplicate by provider event id and provider attempt/ref ids.

## 6.3 Data integrity rules

- All money state changes must run in transactions.
- No ledger mutation without source_type and source_id.
- No payout completion when pending balance is insufficient.
- No seller release if escrow balance is insufficient.

## 7. Data Model and Ledger Blueprint

## 7.1 Core tables (already aligned to keep)

- payment_intents
- payment_attempts
- payment_webhook_events
- payment_refunds
- payment_disputes
- payout_accounts
- payout_requests
- ledger_accounts
- ledger_entries
- daily_reconciliation_runs

## 7.2 New/Updated Tables

### stripe_connect_accounts
```sql
CREATE TABLE stripe_connect_accounts (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  stripe_account_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, rejected
  onboarding_url TEXT,
  charges_enabled BOOLEAN DEFAULT FALSE,
  payouts_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### wallets (dual balance)
```sql
-- Already exists: oneze_balance_mg + fiat_balance_minor
-- Ensure both balances are maintained distinctly
```

### wallet_ize_transfers (context restricted)
```sql
-- Add context_type validation
-- Allowed: 'coOwn_trade', 'platform_reward'
-- Blocked: 'marketplace_sale' (must use fiat escrow)
```

## 7.3 Account codes to keep explicit

- escrow_liability (commerce orders)
- platform_revenue (fees from both fiat and 1ze)
- platform_operating
- seller_payable (after delivery confirmation)
- buyer_spend
- withdrawal_pending
- withdrawable_balance
- ize_wallet (user 1ze holdings)
- ize_outstanding (platform 1ze liability)

## 7.4 Line type conventions

Define and enforce a controlled line_type taxonomy:

### Commerce (Fiat Escrow)
- buyer_charge
- platform_commission_credit
- postage_fee_credit
- seller_payable_release
- escrow_liability_credit
- escrow_liability_debit

### Co-Own (1ze)
- mint_user_credit
- mint_outstanding_credit
- burn_user_debit
- burn_outstanding_debit
- coown_trade_fee_credit
- p2p_sender_debit
- p2p_recipient_credit

### Payouts/Withdrawals
- payout_requested
- payout_paid
- payout_reversed
- refund_reversal
- dispute_reversal
- platform_revenue_sweep_out
- platform_revenue_sweep_in
- spread_revenue_credit
- network_fee_credit

## 8. Reconciliation and Ops Reliability

## 8.1 Daily reconciliation job

Compare at least:
- Provider succeeded volumes.
- Escrow credits from internal ledger.
- Platform revenue credits.
- Payout requested versus paid amounts.

Status outcomes:
- ok
- mismatch
- critical

Critical must auto-pause payout progression until reviewed.

## 8.2 Operational alerting

Alert conditions:
- Webhook backlog spikes.
- Payment failure spikes.
- Payout requested backlog older than threshold.
- Sweep failures and recurring external transfer failures.

## 8.3 Operator runbooks

Create explicit procedures for:
- Paid but order not settled.
- Payout missing or stuck in requested.
- Refund/dispute mismatch.
- Reconciliation critical pause.

## 9. Frontend Contract for Native UX

## 9.1 UX principle

All UI labels remain Thryftverse-native.
No provider names in user copy except optional support disclosures.

## 9.2 Wallet Display

### Dual Balance Cards
```
┌─────────────────────────────┐
│ 1ze Balance                 │
│ 100.00 1ze                  │
│ For Co-Own Trading          │
│ [Convert to Fiat]           │
└─────────────────────────────┘

┌─────────────────────────────┐
│ Fiat Balance                │
│ £50.00 GBP                  │
│ Withdrawable to Bank        │
│ [Withdraw] [Top Up]         │
└─────────────────────────────┘
```

### Transaction History Tabs
- **All Activity**: Combined view
- **1ze Transactions**: Mint, burn, co-own trades
- **Fiat Transactions**: Commerce sales, top-ups, withdrawals

## 9.3 Contextual Help
- 1ze explained as "platform tokens for co-own trading"
- Fiat explained as "real money you can withdraw"
- Conversion flow clearly labeled "Convert 1ze to Fiat"

## 9.4 API response shaping

Always return:
- Unified status enums.
- Human-readable timeline entries.
- Support-safe references (internal ids).
- Optional provider references only for admin/support interfaces.
- Dual wallet balances with clear labeling.

## 9.5 Suggested app screens

- Checkout payment progress (commerce vs co-own channel)
- Order settlement timeline (delivery tracking)
- Seller payout dashboard (fiat withdrawals)
- **Wallet dashboard (dual balances with convert button)**
- Co-own trading interface (1ze balance display)
- Refund/dispute status view
- Support escalation view
- **Stripe Connect onboarding flow for sellers**

## 10. Testing Strategy to Prove Robustness

## 10.1 Unit tests

- Fee/spread calculations (commerce vs co-own).
- 1ze context restriction enforcement.
- Transition validators.
- Ledger balance helpers.
- Webhook normalizers.

## 10.2 Integration tests

### Commerce (Fiat Escrow)
- Commerce payment success to delivery to payout.
- Stripe Connect application fee extraction.
- Refund and dispute reversals with reverse transfers.

### Co-Own (1ze)
- 1ze mint on payment success.
- Co-own trade with 1ze transfer.
- 1ze to fiat conversion flow.
- Context restriction (block marketplace_sale context).

### Wallet
- Dual balance display accuracy.
- Payout review and approval flow.
- Sweep success and failure behavior.

## 10.3 Abuse tests

- User attempts to mark payment succeeded.
- User attempts to mark payout paid.
- User attempts to transfer 1ze for marketplace_sale (should fail).
- User attempts to withdraw 1ze directly (should fail in closed-loop).
- Replayed webhook events.
- Double-settlement and duplicate payout attempts.
- Invalid 1ze → fiat conversion (insufficient balance).

## 10.4 Invariant tests

- Sum of debits and credits per source id remains balanced.
- No negative protected balances.
- No payout completion above fiat_balance.
- 1ze circulating supply = sum of all user 1ze balances.
- Platform revenue in ledger matches Stripe Connect balance.

## 11. Phased Build Plan

## Phase 0: Immediate production safety
- Remove or lock payment simulation status transitions for non-admin/non-test.
- Remove user access to payout status transition endpoint.
- Enforce provider-only payout settlement transitions.
- **Implement 1ze transfer context restrictions**.

## Phase 1: Stripe Connect Implementation
- Create `stripe_connect_accounts` table.
- Build seller onboarding flow for Stripe Connect.
- Update commerce payment intent creation to use Connect with application fees.
- **Migrate existing sellers to Connect model**.
- Test escrow release on delivery confirmation.

## Phase 2: 1ze Architecture Hardening
- Implement `POST /wallet/convert-1ze-to-fiat` endpoint.
- Enforce 1ze transfer context restrictions (coOwn_trade only).
- Update co-own trading to use 1ze exclusively.
- **Block P2P marketplace sales from using 1ze** (must use fiat escrow).
- Add 1ze supply reconciliation checks.

## Phase 3: Provider truth hardening
- Ensure Stripe Connect webhook coverage for refunds/disputes.
- Ensure Wise webhook/transfer idempotency for fiat withdrawals.
- Ensure platform revenue sweep from Connect to corporate bank.

## Phase 4: Revenue and spread accounting completion
- Add explicit ledger postings for spread and network fee realization.
- Add co-own fee to platform revenue ledger.
- Add consistent reversal entries for failed downstream settlement.

## Phase 5: Reconciliation and operational excellence
- Expand mismatch checks (fiat escrow vs Connect balances, 1ze supply vs wallet balances).
- Add admin report endpoints for unresolved money events.
- Add nightly drift and stale-state detectors.
- Add operational runbooks for dual-wallet support.

## Phase 6: Scalability and governance
- Introduce stricter idempotency keys for all write operations.
- Add schema-level constraints for immutable terminal transitions where possible.
- Add complete audit event coverage for money state mutations.
- Add automated testing for 1ze context restrictions.

## 12. Definition of Done

Functionality is complete when all are true:

### Security & Control
- User cannot fake success or payout completion through API misuse.
- User cannot withdraw 1ze directly (only via conversion to fiat).
- User cannot use 1ze for marketplace sales (commerce must use fiat escrow).
- Every provider event can be replayed safely without duplicate settlement.

### Stripe Connect
- All commerce payments use Stripe Connect with seller-linked accounts.
- Platform fees are automatically extracted via application_fee_amount.
- Escrow funds are held in seller Connect accounts until delivery confirmation.
- Refunds properly reverse transfers from seller accounts.

### 1ze Token System
- 1ze is strictly for co-own trading and platform rewards.
- 1ze transfers are blocked for marketplace_sale context.
- 1ze to fiat conversion endpoint is functional and secure.
- 1ze circulating supply matches sum of all user balances (reconciliation).

### Wallet & Payouts
- Wallet displays both 1ze and fiat balances distinctly.
- Fiat withdrawals only from fiat_balance via Wise.
- Payout validation ensures sufficient fiat_balance before processing.
- Daily reconciliation can halt risky payout progression automatically.

### General
- Platform fee/spread/commission are explicitly separated in ledger and reports.
- Company revenue sweep path is traceable from source transaction to bank rail reference.
- Frontend experience remains fully Thryftverse-native while rails remain transparent to users.
- Dual-wallet UI clearly distinguishes 1ze (co-own trading) from fiat (withdrawable).

## 13. Implementation Ownership Matrix

- Backend Money Core Team
  - Intent orchestration, settlement engine, ledger posting, payout transitions.
  - **1ze token lifecycle (mint/burn/transfer with context restrictions).**
  - **Dual-wallet balance management.**

- Integrations Team
  - **Stripe Connect implementation (seller onboarding, Connect accounts).**
  - Stripe Platform adapter for co-own 1ze minting.
  - Wise adapters for fiat withdrawals and platform sweep.
  - Webhook verification, provider idempotency.

- Risk and Compliance Team
  - AML policies, manual review thresholds, audit records.
  - **1ze transfer context validation rules.**
  - Seller Connect account verification.

- Ops and SRE Team
  - Reconciliation jobs (dual: fiat escrow + 1ze supply).
  - Alerting, incident runbooks, monitoring dashboards.
  - **Dual-wallet reconciliation and mismatch detection.**

- Mobile and Frontend Team
  - Native UX and timeline views driven only by Thryftverse APIs.
  - **Dual-wallet dashboard with convert button.**
  - Co-own trading interface (1ze balance display).
  - Seller Stripe Connect onboarding flow.

## 14. Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DEPOSIT FLOW                                 │
│     User Card → Stripe → Fiat Balance (wallets.fiat_balance)     │
└─────────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
┌─────────────────────────┐  ┌──────────────────────────────┐
│  COMMERCE (Fiat)        │  │  CO-OWN (1ze Platform Token) │
│  • Stripe Connect       │  │                              │
│  • Funds in seller      │  │  BUY 1ze OPTIONS:            │
│    Connect account      │  │  1. Stripe Payment → Mint    │
│  • Escrow until         │  │  2. Fiat Balance → Buy 1ze   │
│    delivery             │  │     (Internal exchange)      │
│  • Auto fees to platform│  │                              │
│                         │  │  USAGE:                      │
│  Release → Seller fiat  │  │  • Trade co-own units        │
│  balance → Withdrawal   │  │  • Transfer: coOwn_trade     │
└─────────────────────────┘  │  • Convert → Fiat → Withdraw │
                             │                              │
                             │  1ze = Platform currency     │
                             │  (like COC gems, PUBG UC)    │
                             └──────────────────────────────┘
```

## 15. Final Recommendation

Proceed with **Stripe Connect for commerce** and **1ze platform token for co-own** as the dual-track architecture.

**Critical path items:**
1. **Stripe Connect seller onboarding** (Phase 1)
2. **1ze context restrictions** (Phase 2)  
3. **1ze→Fiat conversion endpoint** (Phase 2)
4. **Buy 1ze with wallet fiat endpoint** (Phase 2)
5. **Dual-wallet UI update** (Frontend)

The architecture now provides:
- **Regulatory compliance**: Seller funds held in their Connect accounts (not platform).
- **Clear separation**: Commerce = Fiat, Co-Own = 1ze.
- **User clarity**: Dual balances with distinct purposes and conversion flow.

Complete all hardening items before production launch.
