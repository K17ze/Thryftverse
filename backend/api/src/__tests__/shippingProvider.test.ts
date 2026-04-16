import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

type ShippingModule = typeof import('../lib/shippingProvider.js');

let shippingModulePromise: Promise<ShippingModule> | null = null;

async function loadShippingModule(): Promise<ShippingModule> {
  process.env.DATABASE_URL ??= 'postgres://localhost:5432/thryftverse-test';
  process.env.NODE_ENV ??= 'test';

  process.env.SHIPPING_FALLBACK_LABEL_BASE_URL = 'https://shipping-fallback.thryftverse.test';

  process.env.EVRI_API_KEY = '';
  process.env.EVRI_API_BASE_URL = '';
  process.env.DELHIVERY_API_KEY = '';
  process.env.DELHIVERY_API_BASE_URL = '';
  process.env.DHL_API_KEY = '';
  process.env.DHL_API_BASE_URL = '';
  process.env.ARAMEX_API_KEY = '';
  process.env.ARAMEX_API_BASE_URL = '';
  process.env.EASYSHIP_API_KEY = '';
  process.env.EASYSHIP_API_BASE_URL = '';

  process.env.EVRI_WEBHOOK_SECRET = 'test-evri-webhook-secret';
  process.env.EASYSHIP_WEBHOOK_SECRET = 'webh_test_easyship_secret';

  if (!shippingModulePromise) {
    shippingModulePromise = import('../lib/shippingProvider.js');
  }

  return shippingModulePromise;
}

function signEasyshipWebhook(secret: string, payload: Record<string, unknown>): string {
  const encodedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8').toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`, 'utf8')
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

test('getShippingQuotes falls back and sorts by effective price when no live credentials are set', async () => {
  const { getShippingQuotes, isCarrierLiveConfigured } = await loadShippingModule();

  const result = await getShippingQuotes({
    preferredCarriers: [
      {
        id: 'evri_standard',
        label: 'Evri Standard',
        priceFromGbp: 2.1,
        etaMinDays: 2,
        etaMaxDays: 4,
        tracking: true,
      },
      {
        id: 'dhl_express',
        label: 'DHL Express',
        priceFromGbp: 5.2,
        etaMinDays: 1,
        etaMaxDays: 2,
        tracking: true,
      },
    ],
    originPostcode: 'N1 1AA',
    destinationPostcode: 'EC1A 1BB',
    parcelWeightKg: 0.55,
    declaredValueGbp: 125,
  });

  assert.equal(result.source, 'fallback');
  assert.equal(result.quotes.length, 2);
  assert.ok(result.quotes.every((quote) => quote.live === false));
  assert.equal(result.quotes[0]?.carrierId, 'evri_standard');
  assert.equal(result.quotes[0]?.source, 'fallback');
  assert.equal(result.quotes[0]?.metadata.reason, 'missing_or_unavailable_carrier_credentials');

  assert.equal(isCarrierLiveConfigured('evri_standard'), false);
  assert.equal(isCarrierLiveConfigured('dhl_express'), false);
  assert.equal(isCarrierLiveConfigured('unknown_carrier'), false);
});

test('createShipment returns fallback shipment payload when live carrier config is absent', async () => {
  const { createShipment } = await loadShippingModule();

  const shipment = await createShipment({
    orderId: 'ord_test_1',
    carrierId: 'evri_standard',
    originPostcode: 'N1 1AA',
    destinationPostcode: 'EC1A 1BB',
    parcelWeightKg: 0.5,
    declaredValueGbp: 220,
    recipientName: 'Test Buyer',
  });

  assert.equal(shipment.provider, 'fallback');
  assert.equal(shipment.live, false);
  assert.match(shipment.trackingNumber, /^EVR-\d+-[A-Z0-9]{6}$/);
  assert.match(shipment.labelUrl ?? '', /^https:\/\/shipping-fallback\.thryftverse\.test\/labels\/.+\.pdf$/);
  assert.equal(shipment.metadata.reason, 'carrier_api_unavailable');
});

test('normalizeAndVerifyShippingWebhook accepts valid signature and normalizes event fields', async () => {
  const { normalizeAndVerifyShippingWebhook } = await loadShippingModule();

  const payload = {
    eventType: 'complete',
    trackingNumber: 'trk_123',
    metadata: {
      orderId: 'ord_42',
      source: 'test',
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = crypto
    .createHmac('sha256', process.env.EVRI_WEBHOOK_SECRET ?? '')
    .update(rawBody, 'utf8')
    .digest('hex');

  const result = await normalizeAndVerifyShippingWebhook(
    'evri',
    {
      'x-evri-signature': `sha256=${signature}`,
    },
    rawBody,
    payload
  );

  assert.equal(result.verified, true);
  assert.equal(result.event?.provider, 'evri');
  assert.equal(result.event?.eventType, 'delivered');
  assert.equal(result.event?.trackingNumber, 'trk_123');
  assert.equal(result.event?.orderId, 'ord_42');
  assert.equal(result.event?.providerEventId, 'evri:delivered:trk_123');
  assert.equal(result.event?.metadata.source, 'test');
});

test('normalizeAndVerifyShippingWebhook rejects invalid signatures and unknown carriers', async () => {
  const { normalizeAndVerifyShippingWebhook } = await loadShippingModule();

  const payload = {
    eventType: 'delivered',
    trackingNumber: 'trk_invalid',
  };

  const rawBody = JSON.stringify(payload);

  const invalidSignatureResult = await normalizeAndVerifyShippingWebhook(
    'evri',
    {
      'x-evri-signature': 'sha256=deadbeef',
    },
    rawBody,
    payload
  );

  assert.equal(invalidSignatureResult.verified, false);
  assert.match(String(invalidSignatureResult.reason), /Invalid shipping webhook signature/);

  const unknownCarrierResult = await normalizeAndVerifyShippingWebhook(
    'ups',
    {},
    rawBody,
    payload
  );

  assert.equal(unknownCarrierResult.verified, false);
  assert.match(String(unknownCarrierResult.reason), /Unsupported shipping carrier/);
});

test('normalizeAndVerifyShippingWebhook accepts valid Easyship JWT signature', async () => {
  const { normalizeAndVerifyShippingWebhook } = await loadShippingModule();

  const payload = {
    event: 'shipment.tracking.statuschanged',
    tracking_number: 'es_123',
    metadata: {
      orderId: 'ord_easy_1',
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = signEasyshipWebhook(process.env.EASYSHIP_WEBHOOK_SECRET ?? '', {
    event: payload.event,
    tracking_number: payload.tracking_number,
  });

  const result = await normalizeAndVerifyShippingWebhook(
    'easyship',
    {
      'x-easyship-signature': signature,
    },
    rawBody,
    payload
  );

  assert.equal(result.verified, true);
  assert.equal(result.event?.provider, 'easyship');
  assert.equal(result.event?.trackingNumber, 'es_123');
  assert.equal(result.event?.orderId, 'ord_easy_1');
});
