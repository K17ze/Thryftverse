# Thryftverse Local Backend (Docker-first)

This backend is designed for local-first development with no cloud dependency.

## Stack

- Node.js API (Fastify + TypeScript)
- Dedicated key service (separate crypto boundary)
- PostgreSQL (real SQL from day one)
- Redis cache
- MinIO (S3-compatible object storage)
- Python ML service (FastAPI)

All services run together via Docker Compose.

## Quick Start

1. From project root:

```bash
docker compose up --build
```

2. Check health:

- API: http://localhost:4000/health
- Key service: http://localhost:4100/health
- ML: http://localhost:8000/health
- MinIO console: http://localhost:9001

3. Default local credentials:

- PostgreSQL: thryftverse / thryftverse / thryftverse
- MinIO: minioadmin / minioadmin

## Frontend API Connection

The Expo app reads API base URL from `EXPO_PUBLIC_API_BASE_URL` when set.

- Android emulator default works without env: `http://10.0.2.2:4000`
- iOS simulator default works without env: `http://localhost:4000`
- Physical device: set host machine LAN IP, for example `http://192.168.1.10:4000`

PowerShell example from project root:

```powershell
$env:EXPO_PUBLIC_API_BASE_URL="http://192.168.1.10:4000"; npx expo start
```

## API Endpoints

- `GET /health`
- `GET /health/deep` (checks Postgres + optional read replica + Redis + key service + ML + S3 bucket connectivity)
- `GET /metrics` (Prometheus metrics export)
- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/refresh`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /listings`
- `GET /search/listings?q=<query>`
- `POST /listings`
- `POST /uploads/presign` (for direct MinIO upload)
- `POST /interactions` (view/wishlist/purchase event)
- `GET /recommendations/:userId` (calls ML service, cached in Redis)
- `POST /secure-profiles` and `GET /secure-profiles/:userId`
- `POST /secure-messages` and `GET /secure-messages/:conversationId`
- `GET /realtime/ws` (WebSocket realtime channel)
- `GET /realtime/stream` (SSE realtime channel)
- `POST /notifications/devices/register`
- `DELETE /notifications/devices/:token`
- `GET /notifications/events`
- `POST /notifications/push/test`
- `POST /wallets/:userId/snapshot` and `GET /wallets/:userId/snapshot`
- `POST /security/keys/:keyName/rotate` (admin-maintenance route, optional bulk rewrap)
- `POST /ops/auctions/sweep` (admin maintenance trigger for auction settlement job)
- `POST /ops/oneze/reconcile` (admin maintenance trigger for 1ze reserve invariant snapshot)
- `POST /ops/oneze/attest` (admin maintenance trigger for signed daily 1ze attestation artifact export)
- `POST /ops/oneze/mint/:operationId/retry` (admin maintenance trigger for mint reserve-worker retry)

Payments and treasury:

- `GET /payments/gateways`
- `GET /payments/platform/summary`
- `POST /payments/intents`
- `GET /payments/intents/:intentId`
- `POST /payments/intents/:intentId/confirm`
- `POST /payments/intents/:intentId/refunds`
- `GET /payments/intents/:intentId/refunds`
- `GET /payments/disputes`
- `POST /webhooks/:provider`
- `POST /payments/webhooks/mock` (admin-maintenance + `API_ENABLE_MOCK_WEBHOOKS`)
- `POST /payouts/webhooks/mock` (admin-maintenance + `API_ENABLE_MOCK_WEBHOOKS`)

Payout operations:

- `GET /users/:userId/payout-accounts`
- `POST /users/:userId/payout-accounts`
- `GET /users/:userId/payout-requests`
- `GET /users/:userId/payout-requests/:requestId`
- `POST /users/:userId/payout-requests`
- `POST /users/:userId/payout-requests/:requestId/status`

1ze money layer:

- `GET /oracle/gold/latest`
- `POST /oracle/gold/override` (gold operator token required)
- `GET /wallet/1ze/quote`
- `GET /wallet/1ze/fx-quote`
- `POST /wallet/1ze/mint/quote`
- `GET /wallet/1ze/mint/:operationId`
- `POST /wallet/1ze/mint`
- `POST /wallet/1ze/burn`
- `POST /wallet/1ze/transfer`
- `POST /wallet/1ze/withdrawals/quote`
- `POST /wallet/1ze/withdrawals/:withdrawalId/accept`
- `POST /wallet/1ze/withdrawals/:withdrawalId/execute` (admin-maintenance route)
- `POST /wallet/1ze/withdrawals/:withdrawalId/fail` (admin-maintenance route)
- `GET /wallet/1ze/:userId/withdrawals`
- `GET /wallet/1ze/:userId/balance`
- `GET /wallet/1ze/:userId/ledger`
- `GET /wallet/1ze/:userId/transfers`
- `GET /wallet/1ze/:userId/position`
- `POST /wallet/1ze/reconcile` (gold operator token required)

Compliance and regulatory:

- `GET /compliance/profile/:userId`
- `PATCH /compliance/profile/:userId`
- `POST /compliance/kyc/sessions`
- `POST /compliance/kyc/webhook` (admin-maintenance route)
- `GET /compliance/kyc/:userId`
- `POST /compliance/aml/evaluate`
- `GET /compliance/aml/alerts`
- `POST /compliance/aml/alerts/:alertId/review` (admin-maintenance route)
- `GET /compliance/jurisdiction/rules`
- `POST /compliance/jurisdiction/rules` (admin-maintenance route)
- `POST /compliance/jurisdiction/eligibility`
- `GET /compliance/consents/documents`
- `POST /compliance/consents/documents` (admin-maintenance route)
- `POST /compliance/consents/accept`
- `GET /compliance/consents/:userId`
- `GET /compliance/audit/logs` (admin-maintenance route)
- `GET /users/me/export` (GDPR data export)
- `DELETE /users/me` (GDPR anonymize/erasure request)

Commerce and checkout:

- `GET /users/:userId/addresses`
- `POST /users/:userId/addresses`
- `DELETE /users/:userId/addresses/:addressId`
- `GET /users/:userId/payment-methods`
- `POST /users/:userId/payment-methods`
- `DELETE /users/:userId/payment-methods/:paymentMethodId`
- `POST /orders`
- `POST /orders/:orderId/pay`
- `GET /orders/:orderId`
- `GET /users/:userId/orders`
- `GET /users/:userId/market-history`

Note: `POST /orders/:orderId/pay` should be sent with `Content-Type: application/json` (an empty `{}` body is valid).

Trade Hub market:

- `GET /auctions`
- `POST /auctions`
- `GET /auctions/:auctionId/bids`
- `POST /auctions/:auctionId/bids`
- `GET /syndicate/assets`
- `POST /syndicate/assets`
- `GET /syndicate/assets/:assetId/orders`
- `POST /syndicate/assets/:assetId/orders`

Market history pagination:

- `GET /users/:userId/market-history?channel=all|auction|syndicate&limit=80`
- Cursor pagination uses `cursorTs` and `cursorId` together:
	- Example next page: `GET /users/:userId/market-history?channel=all&limit=80&cursorTs=2026-04-03T01:11:00.000Z&cursorId=auction_bid_123`
- Response includes `pageInfo.hasMore` and `pageInfo.nextCursor`.

Money-layer request notes:

- `POST /wallet/1ze/mint/quote` creates a stateful mint operation (`INITIATED` -> `PAYMENT_PENDING`) with a locked gold quote (`ONEZE_MINT_QUOTE_TTL_SECONDS`) and a wallet-topup payment intent.
- `POST /webhooks/:provider` now advances mint operations to `PAYMENT_CONFIRMED` on settled wallet-topup payment events and enqueues reserve allocation.
- Mint reserve worker flow is queue-driven and follows `PAYMENT_CONFIRMED` -> `RESERVE_PURCHASING` -> `RESERVE_ALLOCATED` -> `WALLET_CREDITED` -> `SETTLED`.
- `GET /wallet/1ze/mint/:operationId` returns the full mint operation state for frontend polling/progress UX.
- `POST /wallet/1ze/mint` accepts `fiatAmount` + `fiatCurrency` and optional `paymentIntentId`.
- `POST /wallet/1ze/burn` accepts `izeAmount` + `fiatCurrency` and optional `payoutRequestId`.
- `POST /wallet/1ze/transfer` accepts `recipientUserId` + `izeAmount`, with optional `senderUserId` (admin context), `fiatCurrency`, `note`, and metadata.
- `POST /wallet/1ze/withdrawals/quote` accepts exactly one of `amountMg` or `amountOneze`, plus `targetCurrency`; quote validity defaults to `ONEZE_WITHDRAWAL_QUOTE_TTL_SECONDS`.
- `POST /wallet/1ze/withdrawals/:withdrawalId/accept` reserves 1ze balance atomically (wallet debit + `WITHDRAWAL_RESERVED` ledger row). Amounts above `ONEZE_WITHDRAWAL_INSTANT_LIMIT_MG` are queued for async execution.
- `POST /wallet/1ze/withdrawals/:withdrawalId/execute` finalizes payout and reserve consumption (`WITHDRAWAL_SETTLED`) and marks withdrawal `PAID_OUT`.
- `POST /wallet/1ze/withdrawals/:withdrawalId/fail` reverses reserved 1ze (`WITHDRAWAL_REVERSED`) and marks withdrawal `FAILED`.
- `GET /wallet/1ze/:userId/balance` and `GET /wallet/1ze/:userId/ledger` read from the new `wallets` and append-only `wallet_ledger` architecture tables.
- `GET /wallet/1ze/:userId/transfers` supports `direction=all|inbound|outbound` and `limit`.
- `POST /wallet/1ze/mint` and `POST /wallet/1ze/burn` support optional `idempotencyKey` for safe retries.
- Reconciliation safety guard: if reserve invariant fails, mint/burn/withdraw-accept entry points return a halt error until reconciliation is healthy again.
- In production, `paymentIntentId` is required for mint and `payoutRequestId` is required for burn.
- `POST /users/:userId/payout-requests` accepts exactly one of:
	- `amountGbp` (explicit internal settlement amount), or
	- `amount` (in payout account currency; converted to GBP internally via XAU cross rates).

From project root, run full local connectivity check:

```bash
npm run docker:check
```

## ML Endpoints (starter)

- `GET /health`
- `POST /recommendations`
- `POST /classify-image`
- `POST /forecast-price`
- `POST /pricing-action`

`/forecast-price` and `/pricing-action` are baseline placeholders for future LSTM/RL policies.

`/recommendations` now uses a two-stage personalized pipeline with sequence-aware ranking and controlled explore/exploit behavior.

## Crypto Boundary

- Sensitive payloads are encrypted at application layer before database write.
- API never stores encryption keys; it calls the key-service over HTTP.
- Key material is isolated in key-service env/runtime and can be deployed to a separate region/country in production.
- Encrypted domains currently covered: profile PII, direct messages, and wallet snapshots.
- Key lifecycle is supported: rotate key versions and rewrap ciphertext via admin endpoints.

Admin headers:
- API maintenance routes: `x-security-admin-token`
- API -> key-service runtime calls use `x-service-token` with `KEY_SERVICE_CLIENT_TOKEN`.
- API -> key-service admin actions use `KEY_SERVICE_ADMIN_TOKEN` from API env.
- `API_SECURITY_ADMIN_TOKEN` is required in production for API maintenance routes.
- Mock webhook test routes (`/payments/webhooks/mock`, `/payouts/webhooks/mock`) require the same admin header and are controlled by `API_ENABLE_MOCK_WEBHOOKS`.

Regulatory note:
- Compliance tables include immutable hash-chained audit logs, KYC case tracking, AML alerts/SAR records, jurisdiction rules, legal document versioning, consent evidence, and GDPR request records.

## Development Notes

- Migrations auto-run when API container starts (`npm run migrate`).
- Schema and seed data live in `backend/api/src/db/migrations`.
- API uses internal Docker hostname for S3 operations and `S3_PUBLIC_ENDPOINT` for host/browser object URLs.
- No app code changes are needed when moving from laptop to a small Hetzner VPS; copy the same compose file and env vars.

## Data Ops Runbook (Backup, PITR, Replica)

- Logical backups (local/manual):

```bash
cd backend/api
npm run backup:db
```

- Optional backup env vars:
	- `BACKUP_DIR` (default `backend/api/backups`)
	- `BACKUP_RETENTION_DAYS` (default `14`)
- Read replica support:
	- Set `DATABASE_REPLICA_URL` to route selected read-heavy endpoints to replica.
	- `GET /health/deep` reports replica status under `checks.replica` (`ok`, `error`, or `not_configured`).
- PITR recommendation for production:
	- Use managed PostgreSQL with point-in-time recovery enabled (RDS/Azure Database/Flexible Server/Supabase/Neon).
	- Keep WAL retention and backup window aligned with your RPO/RTO targets.

## Minimal .env (optional)

Create `backend/.env` from `backend/.env.example` if you want non-default credentials.
