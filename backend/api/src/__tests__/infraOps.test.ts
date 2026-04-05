import assert from 'node:assert/strict';
import test from 'node:test';
import {
  metricsContentType,
  observeHttpRequest,
  recordPaymentTransition,
  recordPushDelivery,
  renderMetrics,
} from '../lib/metrics.js';
import { parseRealtimeTopics, publishRealtimeEvent } from '../lib/realtime.js';

test('parseRealtimeTopics normalizes both string and array payloads', () => {
  const fromString = parseRealtimeTopics(' Auctions.Market , syndicate.asset:ABC ,,  ');
  assert.deepEqual(fromString, ['auctions.market', 'syndicate.asset:abc']);

  const fromArray = parseRealtimeTopics([' notifications.user:U1 ', 'SYSTEM', 123, null]);
  assert.deepEqual(fromArray, ['notifications.user:u1', 'system']);
});

test('publishRealtimeEvent returns zero when no clients are connected', () => {
  const delivered = publishRealtimeEvent({
    topic: 'auctions.market',
    type: 'auction.bid.created',
    payload: { auctionId: 'a_1' },
  });

  assert.equal(delivered, 0);
});

test('metrics renderer exposes infra counters and content type', async () => {
  observeHttpRequest({
    method: 'GET',
    route: '/search/listings',
    statusCode: 200,
    durationSeconds: 0.032,
  });

  recordPushDelivery({ provider: 'expo', status: 'queued' });
  recordPaymentTransition({
    channel: 'commerce',
    from: 'processing',
    to: 'succeeded',
    gateway: 'stripe_americas',
  });

  const payload = await renderMetrics();
  const contentType = metricsContentType();

  assert.match(payload, /thryftverse_http_requests_total/);
  assert.match(payload, /thryftverse_push_deliveries_total/);
  assert.match(payload, /thryftverse_payment_transitions_total/);
  assert.match(contentType, /text\/plain/);
});
