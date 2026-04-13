# Production Deployment Runbook (Docker)

This runbook defines the production-grade Docker deployment path for Thryftverse.

## 1) Prepare Environment

1. Copy [.env.production.example](.env.production.example) to `.env.production`.
2. Fill all required values with production secrets.
3. Ensure `EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS=false` and `API_ENABLE_MOCK_WEBHOOKS=false`.

## 2) Validate Configuration

Run strict preflight validation before deployment:

```bash
node scripts/validate-production-env.mjs .env.production
```

The command must pass with zero errors.

## 3) Build and Start Production Stack

Use Compose base plus production override:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

This enables production-safe overrides including:
- `NODE_ENV=production` for API/key-service
- Disabled mock webhooks
- Required secret/env expansion
- No host port exposure for postgres/redis/minio/key-service/ml-service

## 4) Verify Health

1. API health:

```bash
curl http://localhost:${API_PORT:-4000}/health
```

2. Optional local dependency smoke:

```bash
API_BASE_URL=http://localhost:${API_PORT:-4000} node backend/scripts/docker-smoke-check.mjs
```

3. Container logs:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml logs -f api key-service ml-service
```

## 5) Rollback

If health checks fail after deployment:

```bash
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.prod.yml down
```

Then restore previous known-good image tags and redeploy.

## 6) Release Gates

Before public traffic, confirm:
- Typecheck and test gates are green.
- Payment provider keys are live and webhook secrets match deployed endpoints.
- Sentry DSN points to self-hosted production project.
- KYC vendor is production (non-sandbox).
- Runtime mock flags are disabled.
