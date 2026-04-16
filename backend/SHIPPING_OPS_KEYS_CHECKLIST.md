# Shipping and Ops Key Checklist

Use this checklist to switch shipping and launch-ops flows from fallback mode to live integrations.

## 1) Shipping Provider Credentials

Set these for each carrier you want live quotes and shipment labels from.

- EVRI_API_KEY
- EVRI_API_BASE_URL
- EVRI_WEBHOOK_SECRET
- DELHIVERY_API_KEY
- DELHIVERY_API_BASE_URL
- DELHIVERY_WEBHOOK_SECRET
- DHL_API_KEY
- DHL_API_BASE_URL
- DHL_WEBHOOK_SECRET
- ARAMEX_API_KEY
- ARAMEX_API_BASE_URL
- ARAMEX_WEBHOOK_SECRET
- EASYSHIP_API_KEY
- EASYSHIP_API_BASE_URL
- EASYSHIP_WEBHOOK_SECRET

Notes:
- If a provider is missing API key or base URL, the backend automatically uses fallback quote and label behavior.
- In production, webhook signatures are enforced. Set each provider webhook secret before enabling live callbacks.
- Easyship can act as a single aggregator rail while retaining multi-carrier routing and fallback behavior.

## 2) Shipping Fallback Label Base URL

- SHIPPING_FALLBACK_LABEL_BASE_URL

Use a stable HTTPS URL for fallback label links in non-live carrier scenarios.

## 3) Reconciliation and Payout Safeguards

- DAILY_PAYOUT_VELOCITY_LIMIT_GBP
- PAYOUT_MANUAL_REVIEW_THRESHOLD_GBP
- RECONCILIATION_SCHEDULE_UTC_HOUR
- RECONCILIATION_MISMATCH_THRESHOLD_GBP
- RECONCILIATION_CRITICAL_MISMATCH_THRESHOLD_GBP

## 4) Ops Alerting Destinations

- OPS_ALERT_INTERVAL_MS
- ALERTING_WEBHOOK_URLS
- ALERTING_ADMIN_USER_IDS

## 5) Rehearsal Script Inputs

For the staging rehearsal script at backend/scripts/staging-shipping-ops-rehearsal.mjs:

- API_BASE_URL (default http://localhost:4000)
- API_SECURITY_ADMIN_TOKEN (required for ops and admin endpoints)
- API_ADMIN_BEARER_TOKEN (preferred) or API_ADMIN_EMAIL + API_ADMIN_PASSWORD
- Optional strict mode: STRICT_ADMIN_CHECKS=true

## 6) Runbook Command

From project root:

npm run staging:shipping-ops

The script validates:

- shipping serviceability and quote endpoints
- paid order shipment provisioning
- shipping webhook ingestion and parcel delivery settlement
- payout review queue and admin review flow
- reconciliation and ops-alert endpoints