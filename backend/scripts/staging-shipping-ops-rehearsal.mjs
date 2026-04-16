import crypto from 'node:crypto';
import process from 'node:process';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:4000';
const API_SECURITY_ADMIN_TOKEN = process.env.API_SECURITY_ADMIN_TOKEN ?? '';
const API_ADMIN_BEARER_TOKEN = process.env.API_ADMIN_BEARER_TOKEN ?? '';
const API_ADMIN_EMAIL = process.env.API_ADMIN_EMAIL ?? '';
const API_ADMIN_PASSWORD = process.env.API_ADMIN_PASSWORD ?? '';
const STRICT_ADMIN_CHECKS = String(process.env.STRICT_ADMIN_CHECKS ?? 'false').toLowerCase() === 'true';
const EASYSHIP_API_KEY = process.env.EASYSHIP_API_KEY ?? process.env.SHIPPING_EASYSHIP_API_KEY ?? '';

const SHIPPING_WEBHOOK_SECRETS = {
  evri: process.env.EVRI_WEBHOOK_SECRET ?? '',
  delhivery: process.env.DELHIVERY_WEBHOOK_SECRET ?? '',
  dhl: process.env.DHL_WEBHOOK_SECRET ?? '',
  aramex: process.env.ARAMEX_WEBHOOK_SECRET ?? '',
  easyship: process.env.EASYSHIP_WEBHOOK_SECRET ?? process.env.SHIPPING_EASYSHIP_WEBHOOK_SECRET ?? '',
};

const SHIPPING_PROVIDER_KEYS = {
  evri: process.env.EVRI_API_KEY ?? process.env.SHIPPING_EVRI_API_KEY ?? '',
  delhivery: process.env.DELHIVERY_API_KEY ?? process.env.SHIPPING_DELHIVERY_API_KEY ?? '',
  dhl: process.env.DHL_API_KEY ?? process.env.SHIPPING_DHL_API_KEY ?? '',
  aramex: process.env.ARAMEX_API_KEY ?? process.env.SHIPPING_ARAMEX_API_KEY ?? '',
};

function createRuntimeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function base64UrlEncode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function signEasyshipWebhook(secret, payload) {
  const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`, 'utf8')
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function carrierIdToProvider(carrierId) {
  const normalized = String(carrierId ?? '').trim().toLowerCase();

  if (!normalized) {
    if (EASYSHIP_API_KEY) {
      return 'easyship';
    }

    return 'evri';
  }

  let directProvider = 'evri';

  if (normalized.includes('delhivery') || normalized.includes('bluedart') || normalized.includes('india_post')) {
    directProvider = 'delhivery';
  } else if (normalized.includes('aramex') || normalized.includes('fetchr')) {
    directProvider = 'aramex';
  } else if (normalized.includes('dhl') || normalized.includes('sf_express') || normalized.includes('cainiao')) {
    directProvider = 'dhl';
  }

  if (SHIPPING_PROVIDER_KEYS[directProvider]) {
    return directProvider;
  }

  if (EASYSHIP_API_KEY) {
    return 'easyship';
  }

  return directProvider;
}

async function requestJson(path, options = {}) {
  const {
    method = 'GET',
    token,
    headers = {},
    body,
    rawBody,
    expectedStatuses = [200],
  } = options;

  const resolvedHeaders = {
    accept: 'application/json',
    ...headers,
  };

  if (token) {
    resolvedHeaders.authorization = `Bearer ${token}`;
  }

  let requestBody;
  if (rawBody !== undefined) {
    requestBody = rawBody;
    resolvedHeaders['content-type'] = resolvedHeaders['content-type'] ?? 'application/json';
  } else if (body !== undefined) {
    requestBody = JSON.stringify(body);
    resolvedHeaders['content-type'] = resolvedHeaders['content-type'] ?? 'application/json';
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: resolvedHeaders,
    body: requestBody,
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!expectedStatuses.includes(response.status)) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`
    );
  }

  return {
    status: response.status,
    payload,
  };
}

async function waitForApiHealth() {
  const maxAttempts = 20;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const health = await requestJson('/health', {
        expectedStatuses: [200],
      });

      if (health.payload?.ok === true) {
        return;
      }
    } catch {
      // Retry until attempts are exhausted.
    }

    if (attempt < maxAttempts) {
      await sleep(1000);
      continue;
    }
  }

  throw new Error(`API health did not become ready at ${API_BASE_URL}`);
}

async function createActor(prefix) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const username = `${prefix}_${suffix}`.slice(0, 32);
  const email = `${prefix}_${suffix}@thryftverse.local`;

  const signup = await requestJson('/auth/signup', {
    method: 'POST',
    expectedStatuses: [201],
    body: {
      email,
      username,
      password: 'SmokePass123!',
    },
  });

  assert(signup.payload?.ok === true, `Signup failed for ${prefix}`);
  assert(typeof signup.payload?.accessToken === 'string', `Signup token missing for ${prefix}`);
  assert(typeof signup.payload?.user?.id === 'string', `Signup user id missing for ${prefix}`);

  return {
    userId: signup.payload.user.id,
    token: signup.payload.accessToken,
  };
}

async function createAddress(actor, input) {
  const response = await requestJson(`/users/${encodeURIComponent(actor.userId)}/addresses`, {
    method: 'POST',
    token: actor.token,
    expectedStatuses: [201],
    body: {
      name: input.name,
      street: input.street,
      city: input.city,
      postcode: input.postcode,
      isDefault: true,
    },
  });

  assert(response.payload?.ok === true, 'Address creation failed');
  assert(response.payload?.item?.id !== undefined, 'Address id missing');
  return response.payload.item;
}

async function createListing(actor, listingId, priceGbp) {
  const response = await requestJson('/listings', {
    method: 'POST',
    token: actor.token,
    expectedStatuses: [201],
    body: {
      id: listingId,
      sellerId: actor.userId,
      title: 'Staging Shipping Rehearsal Listing',
      description: 'Staging listing used to validate shipping quote, webhook, and payout operations.',
      priceGbp,
      imageUrl: `https://picsum.photos/seed/${encodeURIComponent(listingId)}/800/800`,
    },
  });

  assert(response.payload?.ok === true, 'Listing creation failed');
}

async function resolveAdminBearerToken() {
  if (API_ADMIN_BEARER_TOKEN) {
    return API_ADMIN_BEARER_TOKEN;
  }

  if (!API_ADMIN_EMAIL || !API_ADMIN_PASSWORD) {
    return null;
  }

  const login = await requestJson('/auth/login', {
    method: 'POST',
    expectedStatuses: [200],
    body: {
      email: API_ADMIN_EMAIL,
      password: API_ADMIN_PASSWORD,
    },
  });

  if (login.payload?.ok === true && typeof login.payload?.accessToken === 'string') {
    return login.payload.accessToken;
  }

  return null;
}

async function runAdminChecks(input) {
  const adminBearerToken = await resolveAdminBearerToken();
  const hasAdminContext = Boolean(adminBearerToken && API_SECURITY_ADMIN_TOKEN);

  if (!hasAdminContext) {
    const reason = 'Skipping admin and ops checks because API_ADMIN_BEARER_TOKEN (or admin login) and API_SECURITY_ADMIN_TOKEN were not both provided.';
    if (STRICT_ADMIN_CHECKS) {
      throw new Error(reason);
    }

    return {
      skipped: true,
      reason,
    };
  }

  const adminHeaders = {
    'x-security-admin-token': API_SECURITY_ADMIN_TOKEN,
  };

  const pendingReview = await requestJson('/admin/payouts/pending-review?limit=40', {
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
  });

  const pendingItems = Array.isArray(pendingReview.payload?.items) ? pendingReview.payload.items : [];
  const payoutInQueue = pendingItems.some((item) => item.id === input.payoutRequestId);

  const payoutReview = await requestJson(`/admin/payouts/${encodeURIComponent(input.payoutRequestId)}/review`, {
    method: 'POST',
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200, 409],
    body: {
      status: 'failed',
      note: 'Staging rehearsal close-out',
      metadata: {
        rehearsal: true,
      },
    },
  });

  const stuckOrders = await requestJson('/admin/orders/stuck?paidOlderHours=1&limit=20', {
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
  });

  const reconciliationRun = await requestJson('/ops/reconciliation/run', {
    method: 'POST',
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
    body: {},
  });

  const reconciliationLatest = await requestJson('/ops/reconciliation/latest', {
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
  });

  const alertsRun = await requestJson('/ops/alerts/run', {
    method: 'POST',
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
    body: {},
  });

  const payoutPause = await requestJson('/ops/payouts/pause', {
    token: adminBearerToken,
    headers: adminHeaders,
    expectedStatuses: [200],
  });

  return {
    skipped: false,
    pendingReviewCount: pendingItems.length,
    payoutInQueue,
    payoutReviewStatusCode: payoutReview.status,
    payoutReviewOk: Boolean(payoutReview.payload?.ok),
    stuckOrderCount: Array.isArray(stuckOrders.payload?.items) ? stuckOrders.payload.items.length : 0,
    reconciliationStatus: reconciliationRun.payload?.run?.status ?? null,
    reconciliationRunDate: reconciliationRun.payload?.run?.runDate ?? null,
    latestReconciliationStatus: reconciliationLatest.payload?.latest?.status ?? null,
    alertsSent: alertsRun.payload?.result?.alertsSent ?? null,
    payoutsPaused: Boolean(payoutPause.payload?.payouts?.paused),
    payoutsPauseReason: payoutPause.payload?.payouts?.reason ?? null,
  };
}

async function main() {
  console.log('[rehearsal] waiting for API health');
  await waitForApiHealth();

  console.log('[rehearsal] creating buyer and seller users');
  const buyer = await createActor('shipops_buyer');
  const seller = await createActor('shipops_seller');

  console.log('[rehearsal] creating default addresses for buyer and seller');
  const buyerAddress = await createAddress(buyer, {
    name: 'Shipping Rehearsal Buyer',
    street: '21 Rehearsal Lane',
    city: 'London',
    postcode: 'N1 1AA',
  });

  await createAddress(seller, {
    name: 'Shipping Rehearsal Seller',
    street: '55 Fulfilment Road',
    city: 'London',
    postcode: 'EC1A 1BB',
  });

  console.log('[rehearsal] validating shipping serviceability');
  const serviceability = await requestJson('/shipping/serviceability', {
    method: 'POST',
    token: buyer.token,
    expectedStatuses: [200],
    body: {
      buyerId: buyer.userId,
    },
  });

  const carriers = Array.isArray(serviceability.payload?.carriers) ? serviceability.payload.carriers : [];
  assert(carriers.length > 0, 'No shipping carriers returned from serviceability endpoint');

  const preferredCarrierId = String(carriers[0]?.id ?? 'evri');
  const listingId = createRuntimeId('lst_shipops');
  const listingPriceGbp = 720;

  console.log('[rehearsal] creating listing for checkout and shipping quote flow');
  await createListing(seller, listingId, listingPriceGbp);

  console.log('[rehearsal] requesting shipping quote');
  const quote = await requestJson('/shipping/quote', {
    method: 'POST',
    token: buyer.token,
    expectedStatuses: [200],
    body: {
      buyerId: buyer.userId,
      listingId,
      addressId: buyerAddress.id,
      preferredCarrierId,
      declaredValueGbp: listingPriceGbp,
    },
  });

  const recommendedQuote = quote.payload?.recommendedQuote ?? (Array.isArray(quote.payload?.quotes) ? quote.payload.quotes[0] : null);
  assert(recommendedQuote, 'Shipping quote response did not include a recommended quote');

  console.log('[rehearsal] creating and paying order with postage fields');
  const orderId = createRuntimeId('ord_shipops');
  const orderCreate = await requestJson('/orders', {
    method: 'POST',
    token: buyer.token,
    expectedStatuses: [201],
    body: {
      orderId,
      buyerId: buyer.userId,
      listingId,
      addressId: buyerAddress.id,
      postageFeeGbp: Number(recommendedQuote.priceFromGbp),
      shippingCarrierId: String(recommendedQuote.carrierId),
    },
  });

  assert(orderCreate.payload?.order?.status === 'created', 'Order did not start in created status');

  const orderPay = await requestJson(`/orders/${encodeURIComponent(orderId)}/pay`, {
    method: 'POST',
    token: buyer.token,
    expectedStatuses: [200],
  });

  assert(orderPay.payload?.status === 'paid', 'Order payment did not result in paid status');

  const shipment = orderPay.payload?.settlement?.shipment ?? {};
  const trackingNumber = shipment.trackingNumber ?? null;
  const webhookProvider = carrierIdToProvider(recommendedQuote.carrierId);

  console.log('[rehearsal] posting shipping delivery webhook');
  const providerEventId = createRuntimeId('ship_evt');
  const shippingWebhookPayload = {
    eventType: 'delivered',
    providerEventId,
    orderId,
    trackingNumber,
    occurredAt: new Date().toISOString(),
    metadata: {
      rehearsal: true,
    },
  };

  const webhookRawBody = JSON.stringify(shippingWebhookPayload);
  const webhookHeaders = {
    'content-type': 'application/json',
  };

  const webhookSecret = SHIPPING_WEBHOOK_SECRETS[webhookProvider];
  if (webhookSecret) {
    if (webhookProvider === 'easyship') {
      webhookHeaders['x-easyship-signature'] = signEasyshipWebhook(webhookSecret, {
        provider: 'easyship',
        orderId,
        trackingNumber,
        issuedAt: new Date().toISOString(),
      });
    } else {
      webhookHeaders[`x-${webhookProvider}-signature`] = `sha256=${hmacSha256(webhookSecret, webhookRawBody)}`;
    }
  }

  const shippingWebhook = await requestJson(`/shipping/webhooks/${webhookProvider}`, {
    method: 'POST',
    expectedStatuses: [200, 202],
    headers: webhookHeaders,
    rawBody: webhookRawBody,
  });

  assert(shippingWebhook.payload?.ok === true, 'Shipping webhook did not return ok=true');

  console.log('[rehearsal] creating seller payout account and manual-review payout request');
  const payoutAccount = await requestJson(`/users/${encodeURIComponent(seller.userId)}/payout-accounts`, {
    method: 'POST',
    token: seller.token,
    expectedStatuses: [201],
    body: {
      metadata: {
        accountHolderName: 'Staging Seller',
        rehearsal: true,
      },
    },
  });

  assert(payoutAccount.payload?.ok === true, 'Payout account creation failed');
  const payoutAccountId = payoutAccount.payload?.item?.id;
  assert(Number.isInteger(payoutAccountId), 'Payout account id missing');

  const payoutRequest = await requestJson(`/users/${encodeURIComponent(seller.userId)}/payout-requests`, {
    method: 'POST',
    token: seller.token,
    expectedStatuses: [201],
    body: {
      payoutAccountId,
      amountGbp: 600,
      metadata: {
        rehearsal: true,
      },
    },
  });

  assert(payoutRequest.payload?.ok === true, 'Payout request creation failed');
  const payoutRequestId = payoutRequest.payload?.payoutRequest?.id;
  assert(typeof payoutRequestId === 'string' && payoutRequestId.length > 3, 'Payout request id missing');

  console.log('[rehearsal] running admin and ops checks when admin context is available');
  const adminChecks = await runAdminChecks({ payoutRequestId });

  const summary = {
    apiBaseUrl: API_BASE_URL,
    shipping: {
      serviceabilityCarrierCount: carriers.length,
      recommendedCarrierId: recommendedQuote.carrierId,
      quoteSource: quote.payload?.source ?? null,
      orderId,
      shipmentProvisioned: Boolean(shipment.provisioned),
      trackingNumber: trackingNumber,
      webhookProvider,
      webhookStatusCode: shippingWebhook.status,
      webhookUnresolved: Boolean(shippingWebhook.payload?.unresolved),
      finalOrderStatus: shippingWebhook.payload?.order?.status ?? null,
    },
    payout: {
      payoutAccountId,
      payoutRequestId,
      payoutRequestStatus: payoutRequest.payload?.payoutRequest?.status ?? null,
      manualReviewRequired: Boolean(payoutRequest.payload?.payoutRequest?.metadata?.manualReviewRequired),
    },
    admin: adminChecks,
  };

  console.log('[rehearsal] completed successfully');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error('[rehearsal] failed');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});