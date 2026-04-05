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
