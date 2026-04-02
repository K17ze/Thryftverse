# Thryftverse Key Service

This service isolates key custody and cryptographic operations from the API service.

## Purpose

- Keep encryption keys out of the API and database layers.
- Provide encrypt/decrypt as a separate boundary that can run in a different region/country.
- Support key versioning and rotation without rewriting API crypto code.

## Endpoints

- `GET /health`
- `POST /encrypt`
- `POST /decrypt`
- `POST /rewrap` (admin token)
- `POST /keys/:keyName/rotate` (optional admin token)

## Environment

- `PORT` (default: `4100`)
- `KEY_SERVICE_MASTER_KEY_B64` (32-byte key in base64)
- `KEY_SERVICE_ALLOWED_KEYS` (default: `profile,message,wallet`)
- `KEY_SERVICE_DEFAULT_KEY_VERSION` (default: `1`)
- `KEY_SERVICE_ADMIN_TOKEN` (optional)
- `KEY_SERVICE_REGION`, `KEY_SERVICE_COUNTRY` (metadata for deployment and observability)

## Security notes

- In production, `KEY_SERVICE_MASTER_KEY_B64` must be explicitly set.
- `POST /rewrap` and rotation should be restricted via `KEY_SERVICE_ADMIN_TOKEN`.
