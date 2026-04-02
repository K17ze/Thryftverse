import process from 'node:process';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';
const ML_BASE = process.env.ML_BASE_URL ?? 'http://localhost:8000';
const KEY_BASE = process.env.KEY_BASE_URL ?? 'http://localhost:4100';
const API_SECURITY_ADMIN_TOKEN = process.env.API_SECURITY_ADMIN_TOKEN ?? 'local-security-admin-token';

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
