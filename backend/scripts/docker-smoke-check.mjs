import process from 'node:process';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const ML_BASE = process.env.ML_BASE_URL ?? 'http://localhost:8000';
const KEY_BASE = process.env.KEY_BASE_URL ?? 'http://localhost:4100';
const API_SECURITY_ADMIN_TOKEN = process.env.API_SECURITY_ADMIN_TOKEN ?? 'local-security-admin-token';

function createSmokeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

async function requestJson(url, init) {
  const maxAttempts = 12;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { raw: text };
      }

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} at ${url}: ${JSON.stringify(payload)}`);
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log('[check] API health');
  const health = await requestJson(`${API_BASE}/health`);
  assert(health.ok === true, 'API health check did not return ok=true');

  console.log('[check] API deep health (db/redis/ml/s3)');
  const deep = await requestJson(`${API_BASE}/health/deep`);
  assert(deep.ok === true, 'Deep health failed');

  console.log('[check] ML health');
  const mlHealth = await requestJson(`${ML_BASE}/health`);
  assert(mlHealth.ok === 'true', 'ML health payload mismatch');

  console.log('[check] Key service health');
  const keyHealth = await requestJson(`${KEY_BASE}/health`);
  assert(keyHealth.ok === true, 'Key service health payload mismatch');

  console.log('[check] Seed listings query');
  const listings = await requestJson(`${API_BASE}/listings`);
  assert(Array.isArray(listings.items), 'Listings endpoint did not return items array');
  assert(listings.items.length >= 1, 'Expected seeded listings');

  const listingSeed1 = listings.items.find((item) => item.id === 'l_seed_1') ?? listings.items[0];
  const listingSeed2 =
    listings.items.find((item) => item.id === 'l_seed_2') ??
    listings.items.find((item) => item.id !== listingSeed1.id) ??
    listingSeed1;

  assert(Boolean(listingSeed1?.id), 'Missing listing to run smoke checks');
  assert(Boolean(listingSeed2?.id), 'Missing second listing to run smoke checks');

  console.log('[check] Commerce lifecycle (address/payment/order/pay)');
  const address = await requestJson(`${API_BASE}/users/u1/addresses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Buyer',
      street: '1 Smoke Test Street',
      city: 'London',
      postcode: 'N1 1AA',
      isDefault: true,
    }),
  });
  assert(address.ok === true, 'Address creation failed');
  assert(address.item?.id !== undefined && address.item?.id !== null, 'Address response missing id');

  const paymentMethod = await requestJson(`${API_BASE}/users/u1/payment-methods`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      type: 'card',
      label: 'Smoke Visa',
      details: '**** 4242',
      isDefault: true,
    }),
  });
  assert(paymentMethod.ok === true, 'Payment method creation failed');
  assert(
    paymentMethod.item?.id !== undefined && paymentMethod.item?.id !== null,
    'Payment method response missing id'
  );

  const smokeOrderId = createSmokeId('ord_smoke');
  const orderCreate = await requestJson(`${API_BASE}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      orderId: smokeOrderId,
      buyerId: 'u1',
      listingId: listingSeed1.id,
      addressId: address.item.id,
      paymentMethodId: paymentMethod.item.id,
    }),
  });
  assert(orderCreate.ok === true, 'Order creation failed');
  assert(orderCreate.order?.id === smokeOrderId, 'Order id mismatch');
  assert(orderCreate.order?.status === 'created', 'Expected new order status to be created');

  const orderPay = await requestJson(`${API_BASE}/orders/${smokeOrderId}/pay`, {
    method: 'POST',
  });
  assert(orderPay.ok === true, 'Order payment failed');
  assert(orderPay.status === 'paid', 'Expected order status to be paid after payment');

  const orderRead = await requestJson(`${API_BASE}/orders/${smokeOrderId}`);
  assert(orderRead.ok === true, 'Order read failed');
  assert(orderRead.order?.status === 'paid', 'Paid order readback mismatch');

  const buyerOrders = await requestJson(`${API_BASE}/users/u1/orders?role=buyer&limit=20`);
  assert(Array.isArray(buyerOrders.items), 'Buyer orders endpoint did not return items array');
  assert(
    buyerOrders.items.some((item) => item.id === smokeOrderId),
    'Created order was not returned in buyer orders list'
  );

  console.log('[check] Market actions + unified market-history pagination');
  const now = Date.now();
  const smokeAuctionId = createSmokeId('a_smoke');
  const smokeAssetId = createSmokeId('s_smoke');

  const auctionCreate = await requestJson(`${API_BASE}/auctions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: smokeAuctionId,
      listingId: listingSeed1.id,
      sellerId: 'u2',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 6 * 60 * 60 * 1000).toISOString(),
      startingBidGbp: 95,
      buyNowPriceGbp: 160,
    }),
  });
  assert(auctionCreate.ok === true, 'Auction creation failed');

  const bidOne = await requestJson(`${API_BASE}/auctions/${smokeAuctionId}/bids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bidderId: 'u1',
      amountGbp: 100,
    }),
  });
  assert(bidOne.ok === true, 'First auction bid failed');

  const bidTwo = await requestJson(`${API_BASE}/auctions/${smokeAuctionId}/bids`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      bidderId: 'u1',
      amountGbp: 110,
    }),
  });
  assert(bidTwo.ok === true, 'Second auction bid failed');

  const auctionBids = await requestJson(`${API_BASE}/auctions/${smokeAuctionId}/bids?limit=10`);
  assert(Array.isArray(auctionBids.items), 'Auction bids endpoint did not return items array');
  assert(
    auctionBids.items.filter((item) => item.bidderId === 'u1').length >= 2,
    'Expected at least two smoke bids for bidder u1'
  );

  const assetCreate = await requestJson(`${API_BASE}/syndicate/assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: smokeAssetId,
      listingId: listingSeed2.id,
      issuerId: 'u2',
      totalUnits: 250,
      unitPriceGbp: 1.5,
      unitPriceStable: 1.9,
      settlementMode: 'HYBRID',
      issuerJurisdiction: 'GB',
    }),
  });
  assert(assetCreate.ok === true, 'Syndicate asset creation failed');

  const syndicateOrderOne = await requestJson(`${API_BASE}/syndicate/assets/${smokeAssetId}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'u1',
      side: 'buy',
      units: 8,
    }),
  });
  assert(syndicateOrderOne.ok === true, 'First syndicate order failed');

  const syndicateOrderTwo = await requestJson(`${API_BASE}/syndicate/assets/${smokeAssetId}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'u1',
      side: 'buy',
      units: 5,
    }),
  });
  assert(syndicateOrderTwo.ok === true, 'Second syndicate order failed');

  const assetOrders = await requestJson(`${API_BASE}/syndicate/assets/${smokeAssetId}/orders?limit=10`);
  assert(Array.isArray(assetOrders.items), 'Syndicate orders endpoint did not return items array');
  assert(
    assetOrders.items.filter((item) => item.userId === 'u1').length >= 2,
    'Expected at least two smoke syndicate orders for user u1'
  );

  const marketHistoryPageOne = await requestJson(`${API_BASE}/users/u1/market-history?channel=all&limit=2`);
  assert(Array.isArray(marketHistoryPageOne.items), 'Market-history page one missing items array');
  assert(marketHistoryPageOne.items.length === 2, 'Market-history page one limit was not respected');
  assert(marketHistoryPageOne.pageInfo?.hasMore === true, 'Expected market-history page one to indicate hasMore=true');
  assert(
    typeof marketHistoryPageOne.pageInfo?.nextCursor?.cursorTs === 'string' &&
      typeof marketHistoryPageOne.pageInfo?.nextCursor?.cursorId === 'string',
    'Market-history page one missing next cursor'
  );

  const pageOneCursor = marketHistoryPageOne.pageInfo.nextCursor;
  const marketHistoryPageTwo = await requestJson(
    `${API_BASE}/users/u1/market-history?channel=all&limit=2&cursorTs=${encodeURIComponent(pageOneCursor.cursorTs)}&cursorId=${encodeURIComponent(pageOneCursor.cursorId)}`
  );
  assert(Array.isArray(marketHistoryPageTwo.items), 'Market-history page two missing items array');
  assert(marketHistoryPageTwo.items.length >= 1, 'Expected market-history page two to include at least one item');

  const pageOneIds = new Set(marketHistoryPageOne.items.map((item) => item.id));
  assert(
    marketHistoryPageTwo.items.every((item) => !pageOneIds.has(item.id)),
    'Market-history cursor pagination returned overlapping item ids'
  );

  const marketHistoryCombined = [...marketHistoryPageOne.items, ...marketHistoryPageTwo.items];
  assert(
    marketHistoryCombined.some((item) => item.referenceId === smokeAuctionId),
    'Market-history did not include smoke auction entries'
  );
  assert(
    marketHistoryCombined.some((item) => item.referenceId === smokeAssetId),
    'Market-history did not include smoke syndicate entries'
  );

  const auctionHistory = await requestJson(`${API_BASE}/users/u1/market-history?channel=auction&limit=10`);
  assert(Array.isArray(auctionHistory.items), 'Auction-only market-history missing items array');
  assert(
    auctionHistory.items.every((item) => item.channel === 'auction'),
    'Auction-only market-history contained non-auction entries'
  );

  const syndicateHistory = await requestJson(`${API_BASE}/users/u1/market-history?channel=syndicate&limit=10`);
  assert(Array.isArray(syndicateHistory.items), 'Syndicate-only market-history missing items array');
  assert(
    syndicateHistory.items.every((item) => item.channel === 'syndicate'),
    'Syndicate-only market-history contained non-syndicate entries'
  );

  console.log('[check] Secure profile encrypt/decrypt roundtrip');
  const profileUpsert = await requestJson(`${API_BASE}/secure-profiles`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'u1',
      fullName: 'Encrypted User',
      email: 'encrypted.user@example.com',
      phone: '+44000000001',
      countryCode: 'GB',
      preferences: ['streetwear', 'auctions'],
    }),
  });
  assert(profileUpsert.ok === true, 'Secure profile upsert failed');

  const profileRead = await requestJson(`${API_BASE}/secure-profiles/u1`);
  assert(profileRead.ok === true, 'Secure profile read failed');
  assert(profileRead.profile.email === 'encrypted.user@example.com', 'Secure profile decrypt mismatch');

  console.log('[check] Secure message encrypt/decrypt roundtrip');
  const msgCreate = await requestJson(`${API_BASE}/secure-messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: 'conv_smoke_u1_u2',
      senderId: 'u1',
      recipientId: 'u2',
      message: 'hello from encrypted smoke check',
    }),
  });
  assert(msgCreate.ok === true, 'Secure message creation failed');

  const msgRead = await requestJson(`${API_BASE}/secure-messages/conv_smoke_u1_u2?limit=5`);
  assert(msgRead.ok === true, 'Secure message read failed');
  assert(
    msgRead.items.some((item) => item.message === 'hello from encrypted smoke check'),
    'Secure message decrypt mismatch'
  );

  console.log('[check] Wallet snapshot encrypt/decrypt roundtrip');
  const walletUpsert = await requestJson(`${API_BASE}/wallets/u1/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      balanceGbp: 2450.5,
      availableGbp: 2200.0,
      pendingGbp: 250.5,
      currency: 'GBP',
    }),
  });
  assert(walletUpsert.ok === true, 'Wallet snapshot upsert failed');

  const walletRead = await requestJson(`${API_BASE}/wallets/u1/snapshot`);
  assert(walletRead.ok === true, 'Wallet snapshot read failed');
  assert(walletRead.snapshot.balanceGbp === 2450.5, 'Wallet snapshot decrypt mismatch');

  console.log('[check] Security key rotation maintenance route');
  const rotate = await requestJson(`${API_BASE}/security/keys/profile/rotate`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-security-admin-token': API_SECURITY_ADMIN_TOKEN,
    },
    body: JSON.stringify({
      rewrapExisting: false,
    }),
  });
  assert(rotate.ok === true, 'Security key rotation route failed');
  assert(rotate.keyName === 'profile', 'Unexpected rotated key name');
  assert(Number.isInteger(rotate.keyVersion) && rotate.keyVersion > 0, 'Invalid rotated key version');

  console.log('[check] Recommendations roundtrip + Redis cache');
  const rec1 = await requestJson(`${API_BASE}/recommendations/u1`);
  const rec2 = await requestJson(`${API_BASE}/recommendations/u1`);
  assert(Array.isArray(rec1.items), 'Recommendations response missing items array');
  assert(Array.isArray(rec2.items), 'Recommendations cache response missing items array');
  assert(rec2.source === 'cache' || rec1.source === 'cache', 'Expected at least one cached recommendation response');

  console.log('[check] MinIO presign + upload + public fetch');
  const presign = await requestJson(`${API_BASE}/uploads/presign`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName: 'smoke.txt',
      contentType: 'text/plain',
      folder: 'smoke',
    }),
  });

  const uploadResponse = await fetch(presign.url, {
    method: 'PUT',
    headers: { 'content-type': 'text/plain' },
    body: 'thryftverse smoke check',
  });

  if (!uploadResponse.ok) {
    throw new Error(`S3 upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  const publicFetch = await fetch(presign.publicUrl);
  assert(publicFetch.ok, `Uploaded object not publicly reachable: ${presign.publicUrl}`);
  const uploadedText = await publicFetch.text();
  assert(uploadedText.includes('thryftverse smoke check'), 'Uploaded object content mismatch');

  console.log('\n[ok] Local Docker stack is fully connected.');
}

main().catch((error) => {
  console.error(`\n[failed] ${error.message}`);
  process.exit(1);
});
