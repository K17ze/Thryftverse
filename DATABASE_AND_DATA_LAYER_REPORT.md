# Thryftverse Database and Data Layer Report

Last updated: 2026-04-25
Scope: current state inferred from backend/api/src/db/migrations/001_init.sql through 025_platform_revenue_sweep_operating_account.sql, plus compose/runtime configuration.

## 1) Executive Summary

Thryftverse uses a relational-first data architecture with PostgreSQL as system-of-record, supported by Redis (cache/queue patterns), MinIO (object storage), and a dedicated key service for encryption operations.

Key characteristics:
- Migration-driven schema evolution with ordered SQL files and schema_migrations tracking
- Broad domain coverage: marketplace, orders, trade hub, payouts, 1ze monetary layer, messaging, and compliance
- Strong integrity posture using extensive CHECK constraints, foreign keys, and status-controlled state models
- Ops-ready additions for reconciliation, shipping events, and platform revenue sweep controls

## 2) Data Platform Topology

Primary data components:

1. PostgreSQL
- Main transactional and analytical-operational store
- Tables span user identity, commerce, trades, ledger, wallet, compliance, chat, and ops controls

2. Redis
- Used by API runtime as low-latency cache and queue support layer (via ioredis/bullmq)
- Not the source of truth for financial/compliance records

3. MinIO
- S3-compatible object store for media/upload flows
- Bucket bootstrapped by compose init container

4. Key Service
- Isolates key custody and cryptographic operations from API and database
- Enables encrypt/decrypt/rewrap/rotate workflows with service and admin token boundaries

5. ML Service
- Supports recommendation/pricing endpoints
- Model output consumed by API; canonical commerce and financial states remain in PostgreSQL

## 3) Migration and Schema Governance

Migration runner behavior:
- backend/api/src/db/migrate.ts creates schema_migrations if missing
- Applies SQL files in lexical order
- Executes each migration in transaction (BEGIN/COMMIT)
- Records applied file name in schema_migrations

Current migration set:
- 001 through 025 applied in-order

Strengths:
- Deterministic ordering
- Idempotent patterns (IF NOT EXISTS / conflict handling) in many migrations
- Forward-only strategy for hardening and decommissioning

## 4) PostgreSQL Schema Inventory by Domain

## 4.1 Foundation and Marketplace Core

- users
- listings
- interactions
- recommendations
- recommendation_feedback

Purpose:
- User identity anchor
- Listings catalog and engagement events
- Recommendation serving and feedback loop capture

Notable details:
- listings.search_vector (GIN index + trigger) for full-text search
- interactions/recommendation feedback indexed by user/listing/action/time patterns

## 4.2 Commerce and Checkout

- user_addresses
- user_payment_methods
- orders
- order_parcel_events

Purpose:
- Buyer checkout profile data
- Order lifecycle and shipping state evidence

Notable details:
- orders has strict status checks and shipping metadata extensions
- Unique tracking number index for shipment identity
- order_parcel_events records provider-side event trail (dedupe by provider_event_id)

## 4.3 Auctions and Co-Own Market

- auctions
- auction_bids
- coOwn_assets
- coOwn_orders
- coOwn_trades
- coOwn_holdings
- coOwn_buyout_offers
- coOwn_buyout_acceptances

Purpose:
- Trade Hub market infrastructure for auctions and fractionalized assets

Notable details:
- coOwn global unit caps hardened to <= 20 by migration 011
- coOwn order model supports market/limit order semantics and partial fill states
- buyout domain includes offer/acceptance lifecycle with strict target/accepted unit constraints

## 4.4 Identity and Authentication

- user_sessions
- refresh_tokens
- password_reset_tokens
- user_totp_factors
- user_recovery_codes
- auth_oauth_identities
- auth_magic_links
- auth_otp_challenges

Purpose:
- Session management, token lifecycle, password recovery, MFA, OAuth, magic-link, OTP

Notable details:
- users table extended with role and verification-related columns
- Strong uniqueness constraints for token hashes and provider identities

## 4.5 Messaging and Collaboration

- chat_conversations
- chat_members
- chat_messages
- chat_bots
- chat_bot_installs
- chat_group_invites
- secure_messages

Purpose:
- Group and direct messaging with bot-install model and invite control surface

Notable details:
- Rich role model in chat_members (owner/admin/member)
- Invite model tracks token usage, expiry, revocation, and usage caps
- secure_messages stores ciphertext payload model for encrypted channels

## 4.6 Security and Encrypted Domain Storage

- user_secure_profiles
- wallet_secure_snapshots

Purpose:
- App-layer encrypted payload persistence for profile and wallet-sensitive data

Notable details:
- key_version columns support key rotation and ciphertext rewrap paths

## 4.7 Payments, Payouts, and Settlement Ledger

- payment_gateways
- payment_customers
- payment_instruments
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

Purpose:
- Payment orchestration, webhook traceability, dispute/refund handling, payout execution, and double-entry style ledger foundations

Notable details:
- Multi-provider gateway strategy (Stripe/Wise/Razorpay/Mollie/etc. seeds)
- Idempotency key support in payment_intents
- Ledger account_code/source_type constraints hardened over multiple migrations
- Reconciliation run table captures mismatch and payout pause signals
- platform_operating ledger account introduced by migration 025 for revenue sweep flow

## 4.8 1ze Wallet and Controlled Monetary Layer

- wallets
- wallet_ledger
- wallet_idempotency_keys
- wallet_ize_operations
- wallet_ize_transfers
- withdrawals
- mint_operations
- payout_corridors
- fx_rates
- oneze_reconciliation_snapshots
- ize_reconciliation_snapshots
- oneze_anchor_config
- oneze_country_pricing_profiles
- oneze_internal_fx_rates
- oneze_wallet_segments
- oneze_balance_origin_events
- oneze_conversion_events
- jurisdiction_policies

Purpose:
- Wallet accounting, mint lifecycle, transfer governance, corridor limits, conversion controls, and closed-loop monetary hardening

Notable details:
- Mint state machine persisted in mint_operations
- wallet_ledger tracks event kind and balance_after per tx lineage
- Controlled model migrations shift from commodity-dependent artifacts to internal anchor + country pricing profiles
- Legacy gold_* tables decommissioned in migration 023

## 4.9 Compliance and Regulatory Controls

- user_compliance_profiles
- kyc_cases
- kyc_verification_events
- sanctions_screenings
- aml_alerts
- compliance_sar_reports
- jurisdiction_rules
- legal_documents
- user_consents
- gdpr_requests
- compliance_audit_log

Purpose:
- KYC lifecycle, AML risk triage, SAR records, jurisdiction policy enforcement, legal consent evidence, GDPR requests, and immutable audit trails

Notable details:
- compliance_audit_log uses hash-chain fields and mutation-blocking trigger pattern
- Rich status/check constraints across KYC/AML/SAR entities
- jurisdiction rules seeded for co-own, auctions, and p2p contexts

## 4.10 Notifications and Infra-Ops Support

- notification_devices
- notification_events

Purpose:
- Device registration and delivery event tracking for push/in-app/email/system channels

Notable details:
- Active device indexes per user/provider/platform
- Notification status tracking with sent/failure metadata

## 4.11 Migration Metadata

- schema_migrations

Purpose:
- Records applied migration file names and applied_at timestamps

## 5) Core Relationship Model (Selected)

Primary relationship anchors:
- users -> listings, sessions, tokens, addresses, payment methods, chats, wallets, compliance entities
- listings -> orders, auctions, coOwn_assets, interaction/recommendation artifacts
- coOwn_assets -> coOwn_orders/coOwn_trades/coOwn_holdings/buyout tables
- orders -> payment_intents and parcel events
- payment_intents -> attempts/refunds/disputes/webhook events
- ledger_accounts -> ledger_entries (account/counterparty pairing)
- wallets -> wallet_ledger + oneze wallet segment/origin tables

Design observation:
- Most critical domains enforce referential integrity with explicit FKs and ON DELETE behavior, favoring cascade in user-owned artifacts and restrict/set-null in financial traces.

## 6) Constraint and Integrity Posture

The schema applies broad constraint coverage:

1. Enumerated status via CHECK
- Seen in payment, order, auction, co-own, mint, compliance, messaging, and notification entities

2. Financial and quantity safety checks
- Non-negative and positive numeric checks on amounts, fees, balances, and units
- Co-own cap policy encoded directly in DB constraints (<=20)

3. Cross-field validity checks
- Example: coOwn order_type + limit_price requirements
- Example: invite max_uses/use_count consistency
- Example: sender_user_id <> recipient_user_id for transfers

4. Uniqueness controls
- Provider-level unique references for webhooks/intents/disputes/refunds
- Token hash uniqueness for auth flows
- Unique tracking number and consent uniqueness patterns

## 7) Indexing and Query Performance Strategy

Observed index patterns:
- Descending created_at/updated_at indexes for feed/history style retrieval
- Composite indexes matching common filter/sort access paths
- Partial indexes for active-state records (sessions, devices, etc.)
- Full-text GIN index on listings.search_vector
- Dedupe-oriented unique indexes on provider event references

Market history support:
- Additional user + created + id-style indexes for cursor pagination friendliness

Observation:
- Current indexing strategy is pragmatic and workload-aware for operational APIs.

## 8) Data Layer Beyond PostgreSQL

## Redis
- Used for runtime acceleration and queue mechanisms
- Safe because durable records remain in PostgreSQL

## MinIO (S3-compatible)
- Stores listing/media objects
- Bucket initialized at stack start
- API builds object URLs via internal endpoint + public endpoint settings

## Key Service
- Separates encryption key handling from API and DB
- Supports key rotation and ciphertext rewrap workflows

## 9) Operational Hardening and Reliability

Already in place:
- Deep health endpoint checks for DB/replica/Redis/key-service/ML/S3 connectivity
- Database backup script hook in backend API package (backup:db)
- Optional read replica support (DATABASE_REPLICA_URL)
- Reconciliation tables and payout pause semantics for operational safety
- Production environment validator script for required secrets and runtime flags

Runbook-linked ops docs:
- PRODUCTION_DEPLOYMENT.md
- backend/SHIPPING_OPS_KEYS_CHECKLIST.md
- backend/SUPPORT_RUNBOOKS.md

## 10) Security and Compliance Posture

Strengths visible at schema level:
- Rich compliance model with auditable entities
- Immutable-style compliance audit log trigger enforcement
- Tokenized auth/session artifacts with hashed token storage patterns
- Separate encrypted storage domains with key-version tracking

Observations:
- No row-level security policy statements are present in migrations (application-layer authorization is assumed)
- Multiple JSONB metadata fields provide flexibility but should be monitored for schema drift and query bloat

## 11) Recovery, Backup, and Continuity

Current support:
- Logical backup workflow via backend/api script
- Replica-aware read model in API pool configuration
- PITR guidance documented for managed Postgres in backend documentation

Recommended production baseline:
- Scheduled backups + retention verification
- Regular restore drills (staging restore from production snapshots)
- Explicit RPO/RTO targets aligned with reconciliation and payout windows

## 12) Gaps and Recommendations

1. Table partitioning strategy
- No partitioning detected for high-growth event tables (ledger, notifications, compliance events, chat messages)
- Recommendation: evaluate time-based partitioning once row volumes justify it

2. Data retention policy codification
- Retention/deletion windows are not encoded in schema for event-heavy tables
- Recommendation: add retention jobs and legal hold controls per domain

3. Materialized reporting layer
- Financial/compliance reporting appears transaction-table based
- Recommendation: introduce curated reporting marts or materialized views for heavy analytics

4. Schema naming consistency
- Mixed naming style around coOwn_* entities is stable but non-uniform
- Recommendation: standardize conventions in future migrations only (avoid disruptive renames)

5. Role-level database controls
- Recommend introducing least-privilege DB roles for read-only analytics, migration, and runtime writes

## 13) Decommission and Evolution Notes

Notable evolution milestone:
- Migration 023 decommissioned legacy gold-dependent tables and shifted runtime model toward controlled oneze monetary configuration.

Result:
- Historical artifacts removed from active runtime path
- Controlled anchor/country-pricing model becomes canonical structure

## 14) Appendix A - Table Count Snapshot

Approximate active table count (excluding dropped artifacts):
- Core/messaging/commerce/trade/auth/compliance/ops/1ze combined: 60+ tables
- Migration metadata: schema_migrations

Dropped legacy tables by migration 023:
- gold_rate_overrides
- gold_rate_quotes
- reserve_movements
- gold_reserve_lots
- gold_price_ticks

## 15) Source Files Used For This Report

Primary inputs:
- backend/api/src/db/migrations/001_init.sql through 025_platform_revenue_sweep_operating_account.sql
- backend/api/src/db/migrate.ts
- backend/api/src/db/pool.ts
- backend/api/src/config.ts
- docker-compose.yml
- docker-compose.prod.yml
- backend/README.md
- PRODUCTION_DEPLOYMENT.md
