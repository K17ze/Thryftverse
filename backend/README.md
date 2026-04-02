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
- `GET /health/deep` (checks Postgres + Redis + key service + ML + S3 bucket connectivity)
- `GET /listings`
- `POST /listings`
- `POST /uploads/presign` (for direct MinIO upload)
- `POST /interactions` (view/wishlist/purchase event)
- `GET /recommendations/:userId` (calls ML service, cached in Redis)
- `POST /secure-profiles` and `GET /secure-profiles/:userId`
- `POST /secure-messages` and `GET /secure-messages/:conversationId`
- `POST /wallets/:userId/snapshot` and `GET /wallets/:userId/snapshot`
- `POST /security/keys/:keyName/rotate` (admin-maintenance route, optional bulk rewrap)

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
- API -> key-service admin actions use `KEY_SERVICE_ADMIN_TOKEN` from API env.

## Development Notes

- Migrations auto-run when API container starts (`npm run migrate`).
- Schema and seed data live in `backend/api/src/db/migrations`.
- API uses internal Docker hostname for S3 operations and `S3_PUBLIC_ENDPOINT` for host/browser object URLs.
- No app code changes are needed when moving from laptop to a small Hetzner VPS; copy the same compose file and env vars.

## Minimal .env (optional)

Create `backend/.env` from `backend/.env.example` if you want non-default credentials.
