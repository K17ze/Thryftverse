# Thryftverse Key Service

This service isolates key custody and cryptographic operations from the API service.

## Purpose

- Keep encryption keys out of the API and database layers.
- Provide encrypt/decrypt as a separate boundary that can run in a different region/country.
- Support key versioning and rotation without rewriting API crypto code.

## Endpoints

- `GET /health`
- `POST /encrypt` (service token)
- `POST /decrypt` (service token)
- `POST /rewrap` (service token + admin token)
- `POST /keys/:keyName/rotate` (service token + admin token)

## Environment

- `PORT` (default: `4100`)
- `KEY_SERVICE_MASTER_KEY_B64` (32-byte key in base64)
- `KEY_SERVICE_ALLOWED_KEYS` (default: `profile,message,wallet`)
- `KEY_SERVICE_DEFAULT_KEY_VERSION` (default: `1`)
- `KEY_SERVICE_CLIENT_TOKEN` (required in production)
- `KEY_SERVICE_ADMIN_TOKEN` (required in production)
- `KEY_SERVICE_REGION`, `KEY_SERVICE_COUNTRY` (metadata for deployment and observability)

## Security notes

- In production, `KEY_SERVICE_MASTER_KEY_B64` must be explicitly set.
- Runtime crypto endpoints are restricted by `x-service-token` (`KEY_SERVICE_CLIENT_TOKEN`).
- `POST /rewrap` and rotation should be restricted via `KEY_SERVICE_ADMIN_TOKEN`.
