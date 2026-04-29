# Thryftverse

Last updated: 2026-04-25

Thryftverse is a mobile-first marketplace and social commerce platform built with React Native (Expo) plus a Docker-first backend stack. It combines:
- Core second-hand marketplace flows (listing, browsing, checkout, orders)
- Real-time and bot-enabled messaging
- Trade Hub modules (auctions and co-own assets)
- 1ze wallet and controlled monetary-layer foundations
- Compliance, payouts, reconciliation, and launch-ops tooling

## What Is In This Repository

This repository contains two primary layers in one workspace:

1. Mobile application (Expo + TypeScript)
2. Backend platform services (API, key service, ML service, data dependencies)

The project is set up so you can:
- Run the app only for UI/product work
- Run the full stack locally with Docker for end-to-end behavior
- Validate production configuration and launch readiness before shipping

## High-Level Architecture

- Mobile app: React Native + Expo + React Navigation + Zustand
- API service: Fastify + TypeScript
- Data stores: PostgreSQL + Redis + MinIO
- Crypto boundary: dedicated key-service for app-layer encryption operations
- Intelligence layer: Python FastAPI ML microservice

Runtime service graph (local Docker):
- app -> api
- api -> postgres
- api -> redis
- api -> minio
- api -> key-service
- api -> ml-service

## Repository Structure

```text
thryftverse/
  src/                    # mobile app source
    screens/              # app screens and journeys
    components/           # reusable UI + interaction components
    navigation/           # stack/tab routing + route contracts
    store/                # Zustand state slices
    services/             # frontend service clients
    __tests__/            # Vitest suites
  backend/
    api/                  # Fastify API + SQL migrations + ops scripts
    key-service/          # encryption/decryption + key rotation boundary
    ml-service/           # ML endpoints for recommendations/pricing
    scripts/              # smoke checks and launch rehearsal scripts
  scripts/                # root validation and tooling scripts
  docker-compose.yml      # local stack definition
  docker-compose.prod.yml # production-safe overrides
```

## Product Surface Snapshot

Major app surfaces currently included:
- Marketplace: home feed, search, category browse, item detail, make offer, checkout
- Seller workflows: sell/upload, postage, listing success, manage listing
- Messaging: inbox, chat, group chat, bot directory, support entry points
- Profiles and preferences: account settings, edit profile, notifications, personalization
- Trade Hub: auctions, co-own hub, portfolio, asset detail, trade, buyout, syndicate history
- Wallet and money flows: balance, payments, withdraw, payout-linked journeys
- Compliance and support oriented screens integrated into key financial paths

## Tech Stack

### Mobile
- Expo SDK 54
- React 19 + React Native 0.81
- TypeScript 5.9
- React Navigation 7
- FlashList
- Reanimated + Gesture Handler
- Zustand
- Vitest for tests

### Backend
- Node.js TypeScript API (Fastify)
- PostgreSQL (primary relational store)
- Redis (cache/queue support)
- MinIO (S3-compatible object storage)
- Python FastAPI ML service
- OpenTelemetry + Sentry hooks

## Local Development

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (for full-stack mode)
- Expo Go app (for physical device testing)

## Option A: App-Only (Frontend Focus)

```bash
npm ci
npm run start
```

Also available:

```bash
npm run android
npm run ios
npm run web
```

## Option B: Full Stack (Frontend + Backend Dependencies)

1. Install frontend dependencies:

```bash
npm ci
```

2. Start platform dependencies and backend services:

```bash
npm run docker:up
```

3. Check service logs:

```bash
npm run docker:logs
```

4. Run dependency smoke check:

```bash
npm run docker:check
```

5. Start Expo app:

```bash
npm run start
```

## Environment Configuration

Use provided examples:
- .env.example for local development
- .env.production.example for production deployment

Useful notes:
- Frontend API endpoint is controlled via EXPO_PUBLIC_API_BASE_URL
- Production preflight checks are enforced via scripts/validate-production-env.mjs
- Runtime mocks must be disabled for production

Production env validation:

```bash
npm run deploy:prod:validate
```

## Core Scripts

| Category | Script | Purpose |
|---|---|---|
| App runtime | npm run start | Start Expo dev server |
| Type safety | npm run typecheck | Run TypeScript noEmit checks |
| Tests | npm run test | Run Vitest suites in src |
| Token governance | npm run lint:design-tokens | Validate design token usage policy |
| Docker local | npm run docker:up | Build and run backend stack |
| Docker health | npm run docker:check | Validate API/dependency health |
| Production preflight | npm run deploy:prod:validate | Validate .env.production requirements |
| Production stack | npm run docker:up:prod | Start production compose profile |
| Launch rehearsal | npm run launch:phase8 | Run strict launch checks |

## Quality and Release Workflow

Recommended baseline before merge/release:

```bash
npm run typecheck
npm run test
npm run lint:design-tokens
npm run deploy:prod:validate
```

Additional runbooks/checklists:
- RELEASE_PRECHECK.md
- PRODUCTION_DEPLOYMENT.md
- backend/SHIPPING_OPS_KEYS_CHECKLIST.md
- backend/SUPPORT_RUNBOOKS.md

## Data and Database Documentation

A separate detailed report is available:
- DATABASE_AND_DATA_LAYER_REPORT.md

That report covers:
- Full PostgreSQL schema domains from migrations 001 through 025
- Relationships, constraints, index strategy, and operational tables
- Redis/MinIO/key-service roles in the broader data layer
- Backup, reconciliation, and production hardening guidance

## Security and Compliance Notes

- Key management and crypto operations are isolated in backend/key-service
- API and key-service use token-guarded service/admin boundaries
- Compliance domain includes KYC, AML alerts, SAR records, consent evidence, and immutable audit log design
- Production secrets are mandatory for auth, security admin controls, compliance, and attestation flows

## Deployment Summary

Primary deployment path is Docker Compose with production override:

```bash
npm run docker:up:prod
```

See PRODUCTION_DEPLOYMENT.md for the exact runbook, validation, health checks, and rollback flow.

## Troubleshooting

- Expo package compatibility warnings: align package versions to Expo SDK expectations
- API not reachable from device: set EXPO_PUBLIC_API_BASE_URL to host LAN IP
- Docker dependency issues: use npm run docker:check and inspect npm run docker:logs
- Production env failures: run npm run deploy:prod:validate and fill missing required keys

## Documentation Index

- APP_STORE_METADATA.md
- UI_UX_UPGRADATION_REPORT.md
- PREDICTIVE_BACK_TEST_PLAN.md
- RELEASE_PRECHECK.md
- PRODUCTION_DEPLOYMENT.md
- backend/README.md
- backend/SHIPPING_OPS_KEYS_CHECKLIST.md
- backend/SUPPORT_RUNBOOKS.md
- DATABASE_AND_DATA_LAYER_REPORT.md

## Ownership

Thryftverse
- Repository owner: K17ze
- Default branch: main

If you are onboarding a new engineer, start with this file, then backend/README.md, then DATABASE_AND_DATA_LAYER_REPORT.md.
