CREATE TABLE IF NOT EXISTS order_parcel_events (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'picked_up',
      'in_transit',
      'out_for_delivery',
      'delivered',
      'collection_confirmed',
      'delivery_failed',
      'returned'
    )
  ),
  provider_event_id TEXT,
  tracking_id TEXT,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS order_parcel_events_provider_event_idx
  ON order_parcel_events (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_parcel_events_order_idx
  ON order_parcel_events (order_id, received_at DESC);

CREATE INDEX IF NOT EXISTS order_parcel_events_tracking_idx
  ON order_parcel_events (tracking_id, received_at DESC);
