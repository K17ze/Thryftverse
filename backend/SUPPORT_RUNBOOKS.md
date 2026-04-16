# Support Runbooks

Use these runbooks during launch and post-launch operations for commerce, payouts, and reconciliation incidents.

## 1) Customer Paid But Order Stuck

Symptoms:
- Customer was charged but order status is still `created`.

Checks:
1. Verify payment intent status for the order:
   - `GET /payments/intents/:intentId`
2. Verify provider webhook ingestion:
   - `payment_webhook_events` has event row for the provider event id
   - `processed_at` is not null
3. Verify order settlement state:
   - `orders.status` is `paid`

Recovery:
1. If webhook was not received, replay the provider webhook from the gateway dashboard.
2. If webhook was received but order not settled, inspect API logs around `settlePaymentIntent`.
3. Admin-only emergency path:
   - `POST /admin/orders/:orderId/force-status` with a review note.

## 2) Seller Missing Payout

Symptoms:
- Seller requested payout but has no transfer confirmation.

Checks:
1. `GET /admin/payouts/pending-review` for queued review cases.
2. Inspect `payout_requests` row:
   - `status`, `failure_reason`, `metadata.review`
3. Check reconciliation pause state:
   - `GET /ops/payouts/pause`

Recovery:
1. If manual review required, approve/reject explicitly:
   - `POST /admin/payouts/:requestId/approve`
   - `POST /admin/payouts/:requestId/reject`
2. If payouts are paused, resolve reconciliation mismatch first.
3. If provider rejected payout, retry after correcting beneficiary/bank data.

## 3) Order Stuck In Shipped

Symptoms:
- Order remains `shipped` for extended duration and seller cannot cash out completion confidently.

Checks:
1. `GET /admin/orders/stuck` to identify delayed orders.
2. Confirm shipping webhook ingestion:
   - `POST /shipping/webhooks/:carrier` event history mapped to order.
3. Confirm parcel events table has terminal event:
   - `delivered` or `collection_confirmed`.

Recovery:
1. Replay shipping webhook from carrier portal.
2. If carrier webhook unavailable, admin can push parcel event:
   - `POST /orders/:orderId/parcel/events`
3. If exceptional case requires manual closure, use:
   - `POST /admin/orders/:orderId/force-status` with audit note.

## 4) Dispute Received / Refund Liability

Symptoms:
- Gateway dispute marked lost or refund succeeded after settlement.

Checks:
1. Verify `payment_disputes`/`payment_refunds` row for intent.
2. Confirm ledger reversal posted:
   - `ledger_entries` with refund source for order
3. Verify order metadata includes dispute flags when applicable.

Recovery:
1. Gather evidence and respond in provider dashboard immediately.
2. Ensure refund/dispute webhook replay succeeds if events were missed.
3. Keep payout processing paused for affected seller if liability uncertainty exists.

## 5) Reconciliation Mismatch (Critical)

Symptoms:
- Latest reconciliation status is `critical` and payouts are auto-paused.

Checks:
1. Trigger and inspect reconciliation:
   - `POST /ops/reconciliation/run`
   - `GET /ops/reconciliation/latest`
2. Compare:
   - gateway settled totals
   - ledger escrow credits
   - payout requested/paid totals
3. Inspect recent webhook processing errors and dead letters.

Recovery:
1. Backfill/replay missing payment or payout webhooks.
2. Correct operational ledger anomalies with explicit audit notes.
3. Re-run reconciliation until status is `ok` or acceptable `mismatch`.
4. Resume payout operations only after mismatch is understood and documented.

## Escalation

Escalate immediately to on-call engineering + finance ops when:
- reconciliation remains `critical` for more than one run
- payment failure spike alert is sustained
- webhook verification failures exceed threshold and replay does not clear backlog
