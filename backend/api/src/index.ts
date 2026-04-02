import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { db, closeDb } from './db/pool.js';
import { redis, closeRedis } from './lib/redis.js';
import {
  assertKeyServiceConnectivity,
  decryptJsonPayload,
  encryptJsonPayload,
  rewrapCiphertext,
  rotateKeyVersion,
} from './lib/keyService.js';
import { assertS3BucketConnectivity, createUploadUrl } from './lib/s3.js';

const app = Fastify({ logger: true });

function toJsonString(value: unknown): string {
  return JSON.stringify(value);
}

async function ensureUserExists(userId: string) {
  await db.query(
    `
      INSERT INTO users (id, username)
      VALUES ($1, $2)
      ON CONFLICT (id) DO NOTHING
    `,
    [userId, `user_${userId.slice(0, 40)}`]
  );
}

function ensureSecurityAdmin(headerToken: string | undefined) {
  if (!config.apiSecurityAdminToken) {
    return;
  }

  if (!headerToken || headerToken !== config.apiSecurityAdminToken) {
    throw new Error('Missing or invalid security admin token');
  }
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function resolveAuctionStatus(startsAt: Date, endsAt: Date): 'upcoming' | 'live' | 'ended' {
  const now = Date.now();
  const start = startsAt.getTime();
  const end = endsAt.getTime();

  if (end <= now) {
    return 'ended';
  }

  if (start <= now && end > now) {
    return 'live';
  }

  return 'upcoming';
}

function parseQueryBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
      return true;
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no') {
      return false;
    }
  }

  return fallback;
}

async function rewrapDomainRows(
  keyName: 'profile' | 'message' | 'wallet',
  targetKeyVersion: number,
  maxRows: number
): Promise<{ rowsScanned: number; rowsRewrapped: number }> {
  let rowsScanned = 0;
  let rowsRewrapped = 0;

  if (keyName === 'profile') {
    const rows = await db.query<{
      user_id: string;
      ciphertext: string;
      key_version: number;
    }>(
      `
        SELECT user_id, ciphertext, key_version
        FROM user_secure_profiles
        WHERE key_version < $1
        ORDER BY updated_at DESC
        LIMIT $2
      `,
      [targetKeyVersion, maxRows]
    );

    rowsScanned = rows.rows.length;
    for (const row of rows.rows) {
      const rewrapped = await rewrapCiphertext(
        row.ciphertext,
        `secure-profile:${row.user_id}`,
        targetKeyVersion
      );

      await db.query(
        `
          UPDATE user_secure_profiles
          SET ciphertext = $1,
              key_version = $2,
              updated_at = NOW()
          WHERE user_id = $3
        `,
        [rewrapped.ciphertext, rewrapped.toVersion, row.user_id]
      );

      rowsRewrapped += 1;
    }

    return { rowsScanned, rowsRewrapped };
  }

  if (keyName === 'message') {
    const rows = await db.query<{
      id: number;
      conversation_id: string;
      sender_id: string;
      recipient_id: string;
      ciphertext: string;
      key_version: number;
    }>(
      `
        SELECT id, conversation_id, sender_id, recipient_id, ciphertext, key_version
        FROM secure_messages
        WHERE key_version < $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [targetKeyVersion, maxRows]
    );

    rowsScanned = rows.rows.length;
    for (const row of rows.rows) {
      const rewrapped = await rewrapCiphertext(
        row.ciphertext,
        `secure-message:${row.conversation_id}:${row.sender_id}:${row.recipient_id}`,
        targetKeyVersion
      );

      await db.query(
        `
          UPDATE secure_messages
          SET ciphertext = $1,
              key_version = $2
          WHERE id = $3
        `,
        [rewrapped.ciphertext, rewrapped.toVersion, row.id]
      );

      rowsRewrapped += 1;
    }

    return { rowsScanned, rowsRewrapped };
  }

  const rows = await db.query<{
    id: number;
    user_id: string;
    ciphertext: string;
    key_version: number;
  }>(
    `
      SELECT id, user_id, ciphertext, key_version
      FROM wallet_secure_snapshots
      WHERE key_version < $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [targetKeyVersion, maxRows]
  );

  rowsScanned = rows.rows.length;
  for (const row of rows.rows) {
    const rewrapped = await rewrapCiphertext(
      row.ciphertext,
      `wallet-snapshot:${row.user_id}`,
      targetKeyVersion
    );

    await db.query(
      `
        UPDATE wallet_secure_snapshots
        SET ciphertext = $1,
            key_version = $2
        WHERE id = $3
      `,
      [rewrapped.ciphertext, rewrapped.toVersion, row.id]
    );

    rowsRewrapped += 1;
  }

  return { rowsScanned, rowsRewrapped };
}

const recommendationPayloadSchema = z.object({
  recommendations: z.array(
    z.object({
      listing_id: z.string(),
      score: z.number(),
      model: z.string(),
      reason: z.string().optional(),
      policy: z.enum(['exploit', 'explore']).optional(),
    })
  ),
});

app.get('/health', async () => {
  const [{ now }] = (await db.query<{ now: string }>('SELECT NOW() AS now')).rows;
  const redisPing = await redis.ping();

  return {
    ok: true,
    service: 'thryftverse-api',
    now,
    redis: redisPing,
  };
});

app.get('/health/deep', async (_request, reply) => {
  const status = {
    api: 'ok',
    postgres: 'unknown',
    redis: 'unknown',
    keyService: 'unknown',
    ml: 'unknown',
    s3: 'unknown',
  } as const;

  const result: {
    ok: boolean;
    checks: {
      api: string;
      postgres: string;
      redis: string;
      keyService: string;
      ml: string;
      s3: string;
    };
    details?: Record<string, string>;
  } = {
    ok: true,
    checks: {
      ...status,
    },
    details: {},
  };

  try {
    await db.query('SELECT 1');
    result.checks.postgres = 'ok';
  } catch (error) {
    result.ok = false;
    result.checks.postgres = 'error';
    result.details!.postgres = (error as Error).message;
  }

  try {
    const redisPing = await redis.ping();
    result.checks.redis = redisPing === 'PONG' ? 'ok' : 'error';
    if (redisPing !== 'PONG') {
      result.ok = false;
      result.details!.redis = `Unexpected ping result: ${redisPing}`;
    }
  } catch (error) {
    result.ok = false;
    result.checks.redis = 'error';
    result.details!.redis = (error as Error).message;
  }

  try {
    await assertKeyServiceConnectivity();
    result.checks.keyService = 'ok';
  } catch (error) {
    result.ok = false;
    result.checks.keyService = 'error';
    result.details!.keyService = (error as Error).message;
  }

  try {
    const mlResponse = await fetch(`${config.mlServiceUrl}/health`);
    if (!mlResponse.ok) {
      throw new Error(`ML service responded ${mlResponse.status}`);
    }
    result.checks.ml = 'ok';
  } catch (error) {
    result.ok = false;
    result.checks.ml = 'error';
    result.details!.ml = (error as Error).message;
  }

  try {
    await assertS3BucketConnectivity();
    result.checks.s3 = 'ok';
  } catch (error) {
    result.ok = false;
    result.checks.s3 = 'error';
    result.details!.s3 = (error as Error).message;
  }

  if (result.ok) {
    delete result.details;
    return result;
  }

  reply.code(503);
  return result;
});

app.post('/security/keys/:keyName/rotate', async (request, reply) => {
  const paramsSchema = z.object({
    keyName: z.enum(['profile', 'message', 'wallet']),
  });
  const bodySchema = z.object({
    rewrapExisting: z.boolean().default(true),
    maxRows: z.number().int().min(1).max(5000).default(1000),
  });

  const { keyName } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  try {
    ensureSecurityAdmin(request.headers['x-security-admin-token'] as string | undefined);
  } catch (error) {
    reply.code(401);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  try {
    const rotated = await rotateKeyVersion(keyName);
    let rewrap = { rowsScanned: 0, rowsRewrapped: 0 };

    if (payload.rewrapExisting) {
      rewrap = await rewrapDomainRows(keyName, rotated.keyVersion, payload.maxRows);
    }

    return {
      ok: true,
      keyName,
      keyVersion: rotated.keyVersion,
      rewrap,
    };
  } catch (error) {
    reply.code(502);
    return {
      ok: false,
      error: `Key rotation failed: ${(error as Error).message}`,
    };
  }
});

app.get('/listings', async () => {
  const result = await db.query(
    'SELECT id, seller_id, title, description, price_gbp, image_url, created_at FROM listings ORDER BY created_at DESC'
  );
  return { items: result.rows };
});

app.post('/listings', async (request, reply) => {
  const bodySchema = z.object({
    id: z.string().min(2),
    sellerId: z.string().min(2),
    title: z.string().min(3),
    description: z.string().min(10),
    priceGbp: z.number().nonnegative(),
    imageUrl: z.string().url().optional(),
  });

  const payload = bodySchema.parse(request.body);

  await db.query(
    `
      INSERT INTO listings (id, seller_id, title, description, price_gbp, image_url)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE
      SET seller_id = EXCLUDED.seller_id,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          price_gbp = EXCLUDED.price_gbp,
          image_url = EXCLUDED.image_url
    `,
    [
      payload.id,
      payload.sellerId,
      payload.title,
      payload.description,
      payload.priceGbp,
      payload.imageUrl ?? null,
    ]
  );

  reply.code(201);
  return { ok: true };
});

app.post('/secure-profiles', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    fullName: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(6).max(40).optional(),
    address: z.string().min(5).max(220).optional(),
    countryCode: z.string().length(2).optional(),
    preferences: z.array(z.string().min(2).max(60)).max(20).optional(),
  });

  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.userId);

  const aad = `secure-profile:${payload.userId}`;
  const encrypted = await encryptJsonPayload(
    'profile',
    {
      fullName: payload.fullName,
      email: payload.email,
      phone: payload.phone,
      address: payload.address,
      countryCode: payload.countryCode,
      preferences: payload.preferences ?? [],
      updatedAt: new Date().toISOString(),
    },
    aad
  );

  await db.query(
    `
      INSERT INTO user_secure_profiles (user_id, ciphertext, key_version)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE
      SET ciphertext = EXCLUDED.ciphertext,
          key_version = EXCLUDED.key_version,
          updated_at = NOW()
    `,
    [payload.userId, encrypted.ciphertext, encrypted.keyVersion]
  );

  reply.code(201);
  return {
    ok: true,
    userId: payload.userId,
    keyVersion: encrypted.keyVersion,
  };
});

app.get('/secure-profiles/:userId', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const result = await db.query<{
    user_id: string;
    ciphertext: string;
    key_version: number;
    updated_at: string;
  }>(
    `
      SELECT user_id, ciphertext, key_version, updated_at
      FROM user_secure_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    reply.code(404);
    return { ok: false, error: 'Secure profile not found' };
  }

  const profile = await decryptJsonPayload<{
    fullName: string;
    email: string;
    phone?: string;
    address?: string;
    countryCode?: string;
    preferences?: string[];
    updatedAt?: string;
  }>(row.ciphertext, `secure-profile:${userId}`);

  return {
    ok: true,
    userId,
    keyVersion: row.key_version,
    storedAt: row.updated_at,
    profile,
  };
});

app.post('/secure-messages', async (request, reply) => {
  const bodySchema = z.object({
    conversationId: z.string().min(2).max(80),
    senderId: z.string().min(2),
    recipientId: z.string().min(2),
    message: z.string().min(1).max(4000),
  });

  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.senderId);
  await ensureUserExists(payload.recipientId);

  const aad = `secure-message:${payload.conversationId}:${payload.senderId}:${payload.recipientId}`;
  const encrypted = await encryptJsonPayload(
    'message',
    {
      message: payload.message,
      sentAt: new Date().toISOString(),
    },
    aad
  );

  const result = await db.query<{ id: number; created_at: string }>(
    `
      INSERT INTO secure_messages (
        conversation_id,
        sender_id,
        recipient_id,
        ciphertext,
        key_version
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at
    `,
    [
      payload.conversationId,
      payload.senderId,
      payload.recipientId,
      encrypted.ciphertext,
      encrypted.keyVersion,
    ]
  );

  reply.code(201);
  return {
    ok: true,
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at,
  };
});

app.get('/secure-messages/:conversationId', async (request) => {
  const paramsSchema = z.object({ conversationId: z.string().min(2).max(80) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  const { conversationId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: number;
    conversation_id: string;
    sender_id: string;
    recipient_id: string;
    ciphertext: string;
    key_version: number;
    created_at: string;
  }>(
    `
      SELECT id, conversation_id, sender_id, recipient_id, ciphertext, key_version, created_at
      FROM secure_messages
      WHERE conversation_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [conversationId, limit]
  );

  const messages = [] as Array<{
    id: number;
    senderId: string;
    recipientId: string;
    message: string;
    sentAt: string;
    keyVersion: number;
  }>;

  for (const row of result.rows) {
    const aad = `secure-message:${row.conversation_id}:${row.sender_id}:${row.recipient_id}`;
    const decrypted = await decryptJsonPayload<{
      message: string;
      sentAt?: string;
    }>(row.ciphertext, aad);

    messages.push({
      id: row.id,
      senderId: row.sender_id,
      recipientId: row.recipient_id,
      message: decrypted.message,
      sentAt: decrypted.sentAt ?? row.created_at,
      keyVersion: row.key_version,
    });
  }

  return {
    ok: true,
    conversationId,
    items: messages,
  };
});

app.post('/wallets/:userId/snapshot', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    balanceGbp: z.number().nonnegative(),
    availableGbp: z.number().nonnegative(),
    pendingGbp: z.number().nonnegative().default(0),
    currency: z.string().length(3).default('GBP'),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);
  await ensureUserExists(userId);

  const aad = `wallet-snapshot:${userId}`;
  const encrypted = await encryptJsonPayload(
    'wallet',
    {
      userId,
      balanceGbp: payload.balanceGbp,
      availableGbp: payload.availableGbp,
      pendingGbp: payload.pendingGbp,
      currency: payload.currency,
      updatedAt: new Date().toISOString(),
    },
    aad
  );

  const result = await db.query<{ id: number; created_at: string }>(
    `
      INSERT INTO wallet_secure_snapshots (user_id, ciphertext, key_version)
      VALUES ($1, $2, $3)
      RETURNING id, created_at
    `,
    [userId, encrypted.ciphertext, encrypted.keyVersion]
  );

  reply.code(201);
  return {
    ok: true,
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at,
  };
});

app.get('/wallets/:userId/snapshot', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const result = await db.query<{
    id: number;
    ciphertext: string;
    key_version: number;
    created_at: string;
  }>(
    `
      SELECT id, ciphertext, key_version, created_at
      FROM wallet_secure_snapshots
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    reply.code(404);
    return {
      ok: false,
      error: 'Wallet snapshot not found',
    };
  }

  const snapshot = await decryptJsonPayload<{
    userId: string;
    balanceGbp: number;
    availableGbp: number;
    pendingGbp: number;
    currency: string;
    updatedAt?: string;
  }>(row.ciphertext, `wallet-snapshot:${userId}`);

  return {
    ok: true,
    keyVersion: row.key_version,
    createdAt: row.created_at,
    snapshot,
  };
});

app.post('/uploads/presign', async (request) => {
  const bodySchema = z.object({
    fileName: z.string().min(1),
    contentType: z.string().min(3),
    folder: z.string().optional(),
  });

  const payload = bodySchema.parse(request.body);
  const safeName = payload.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const folder = payload.folder?.replace(/[^a-zA-Z0-9/_-]/g, '') ?? 'listings';
  const key = `${folder}/${Date.now()}_${safeName}`;

  return createUploadUrl(key, payload.contentType);
});

app.post('/interactions', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    listingId: z.string().min(2),
    action: z.enum(['view', 'wishlist', 'purchase']),
    strength: z.number().positive().default(1),
    servedScore: z.number().min(0).max(1).optional(),
    servedPolicy: z.enum(['exploit', 'explore']).optional(),
    surface: z.string().min(2).max(60).optional(),
  });

  const payload = bodySchema.parse(request.body);

  await db.query(
    'INSERT INTO interactions (user_id, listing_id, action, strength) VALUES ($1, $2, $3, $4)',
    [payload.userId, payload.listingId, payload.action, payload.strength]
  );

  await redis.lpush(
    `events:user:${payload.userId}`,
    JSON.stringify({
      listingId: payload.listingId,
      action: payload.action,
      strength: payload.strength,
      servedScore: payload.servedScore,
      servedPolicy: payload.servedPolicy,
      surface: payload.surface,
      ts: new Date().toISOString(),
    })
  );

  await redis.ltrim(`events:user:${payload.userId}`, 0, 199);

  if (payload.servedScore !== undefined || payload.servedPolicy || payload.surface) {
    await db.query(
      `
        INSERT INTO recommendation_feedback (
          user_id,
          listing_id,
          action,
          served_score,
          served_policy,
          surface
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        payload.userId,
        payload.listingId,
        payload.action,
        payload.servedScore ?? null,
        payload.servedPolicy ?? null,
        payload.surface ?? null,
      ]
    );
  }

  reply.code(201);
  return { ok: true };
});

app.get('/recommendations/:userId', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const cacheKey = `recommendations:${userId}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    return { source: 'cache', items: JSON.parse(cached) };
  }

  const listingsResult = await db.query<{
    id: string;
    seller_id: string;
    title: string;
    description: string;
    price_gbp: number | string;
    image_url: string | null;
    created_at: string;
  }>(
    `
      SELECT id, seller_id, title, description, price_gbp, image_url, created_at
      FROM listings
      ORDER BY created_at DESC
      LIMIT 500
    `
  );

  const interactionsResult = await db.query<{
    listing_id: string;
    action: 'view' | 'wishlist' | 'purchase';
    strength: number | string;
    created_at: string;
  }>(
    `
      SELECT listing_id, action, strength, created_at
      FROM interactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 200
    `,
    [userId]
  );

  const mlResponse = await fetch(`${config.mlServiceUrl}/recommendations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: toJsonString({
      user_id: userId,
      result_limit: 24,
      candidates: listingsResult.rows.map((row) => ({
        listing_id: row.id,
        title: row.title,
        description: row.description,
        price_gbp: Number(row.price_gbp),
        created_at: row.created_at,
      })),
      recent_interactions: interactionsResult.rows.map((row) => ({
        listing_id: row.listing_id,
        action: row.action,
        strength: Number(row.strength),
        created_at: row.created_at,
      })),
    }),
  });

  if (!mlResponse.ok) {
    const fallback = listingsResult.rows.slice(0, 24).map((row, index) => ({
      score: Number((1 - index * 0.02).toFixed(6)),
      model: 'fallback_recent',
      policy: 'exploit',
      reason: 'ml_unavailable',
      listing: row,
    }));

    await redis.set(cacheKey, toJsonString(fallback), 'EX', 30);
    return {
      source: 'fallback',
      items: fallback,
    };
  }

  const mlPayload = recommendationPayloadSchema.parse(await mlResponse.json());

  const listingIds = mlPayload.recommendations.map((item) => item.listing_id);
  if (listingIds.length === 0) {
    return { source: 'ml', items: [] };
  }

  const listingById = new Map(listingsResult.rows.map((row) => [row.id, row]));
  const merged = mlPayload.recommendations
    .map((item) => ({
      score: item.score,
      model: item.model,
      reason: item.reason,
      policy: item.policy,
      listing: listingById.get(item.listing_id),
    }))
    .filter((item) => Boolean(item.listing));

  await redis.set(cacheKey, toJsonString(merged), 'EX', 60);

  return { source: 'ml', items: merged };
});

app.get('/users/:userId/addresses', async (request) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const result = await db.query<{
    id: number;
    user_id: string;
    name: string;
    street: string;
    city: string;
    postcode: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, user_id, name, street, city, postcode, is_default, created_at, updated_at
      FROM user_addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC
    `,
    [userId]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      name: row.name,
      street: row.street,
      city: row.city,
      postcode: row.postcode,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/users/:userId/addresses', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    name: z.string().min(2).max(120),
    street: z.string().min(3).max(220),
    city: z.string().min(2).max(120),
    postcode: z.string().min(2).max(24),
    isDefault: z.boolean().default(false),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  await ensureUserExists(userId);

  const existingCountResult = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM user_addresses WHERE user_id = $1',
    [userId]
  );

  const shouldDefault = payload.isDefault || Number(existingCountResult.rows[0]?.count ?? '0') === 0;
  if (shouldDefault) {
    await db.query('UPDATE user_addresses SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1', [userId]);
  }

  const result = await db.query<{
    id: number;
    user_id: string;
    name: string;
    street: string;
    city: string;
    postcode: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO user_addresses (user_id, name, street, city, postcode, is_default)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, name, street, city, postcode, is_default, created_at, updated_at
    `,
    [userId, payload.name, payload.street, payload.city, payload.postcode, shouldDefault]
  );

  reply.code(201);
  return {
    ok: true,
    item: {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      name: result.rows[0].name,
      street: result.rows[0].street,
      city: result.rows[0].city,
      postcode: result.rows[0].postcode,
      isDefault: result.rows[0].is_default,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    },
  };
});

app.delete('/users/:userId/addresses/:addressId', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
    addressId: z.coerce.number().int().positive(),
  });

  const { userId, addressId } = paramsSchema.parse(request.params);

  const deleted = await db.query(
    `
      DELETE FROM user_addresses
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [addressId, userId]
  );

  if (!deleted.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Address not found' };
  }

  const defaultExists = await db.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM user_addresses
        WHERE user_id = $1 AND is_default = TRUE
      ) AS exists
    `,
    [userId]
  );

  if (!defaultExists.rows[0]?.exists) {
    await db.query(
      `
        UPDATE user_addresses
        SET is_default = TRUE, updated_at = NOW()
        WHERE id = (
          SELECT id FROM user_addresses
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 1
        )
      `,
      [userId]
    );
  }

  return { ok: true };
});

app.get('/users/:userId/payment-methods', async (request) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const result = await db.query<{
    id: number;
    user_id: string;
    method_type: 'card' | 'bank_account';
    label: string;
    details: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT id, user_id, method_type, label, details, is_default, created_at, updated_at
      FROM user_payment_methods
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC
    `,
    [userId]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      type: row.method_type,
      label: row.label,
      details: row.details,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/users/:userId/payment-methods', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    type: z.enum(['card', 'bank_account']),
    label: z.string().min(3).max(120),
    details: z.string().max(220).optional(),
    isDefault: z.boolean().default(false),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  await ensureUserExists(userId);

  const existingCountResult = await db.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM user_payment_methods WHERE user_id = $1',
    [userId]
  );

  const shouldDefault = payload.isDefault || Number(existingCountResult.rows[0]?.count ?? '0') === 0;
  if (shouldDefault) {
    await db.query('UPDATE user_payment_methods SET is_default = FALSE, updated_at = NOW() WHERE user_id = $1', [
      userId,
    ]);
  }

  const result = await db.query<{
    id: number;
    user_id: string;
    method_type: 'card' | 'bank_account';
    label: string;
    details: string | null;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO user_payment_methods (user_id, method_type, label, details, is_default)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, method_type, label, details, is_default, created_at, updated_at
    `,
    [userId, payload.type, payload.label, payload.details ?? null, shouldDefault]
  );

  reply.code(201);
  return {
    ok: true,
    item: {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      type: result.rows[0].method_type,
      label: result.rows[0].label,
      details: result.rows[0].details,
      isDefault: result.rows[0].is_default,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    },
  };
});

app.delete('/users/:userId/payment-methods/:paymentMethodId', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
    paymentMethodId: z.coerce.number().int().positive(),
  });

  const { userId, paymentMethodId } = paramsSchema.parse(request.params);

  const deleted = await db.query(
    `
      DELETE FROM user_payment_methods
      WHERE id = $1 AND user_id = $2
      RETURNING id
    `,
    [paymentMethodId, userId]
  );

  if (!deleted.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Payment method not found' };
  }

  const defaultExists = await db.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1 FROM user_payment_methods
        WHERE user_id = $1 AND is_default = TRUE
      ) AS exists
    `,
    [userId]
  );

  if (!defaultExists.rows[0]?.exists) {
    await db.query(
      `
        UPDATE user_payment_methods
        SET is_default = TRUE, updated_at = NOW()
        WHERE id = (
          SELECT id FROM user_payment_methods
          WHERE user_id = $1
          ORDER BY updated_at DESC
          LIMIT 1
        )
      `,
      [userId]
    );
  }

  return { ok: true };
});

app.post('/orders', async (request, reply) => {
  const bodySchema = z.object({
    orderId: z.string().min(4).max(64).optional(),
    buyerId: z.string().min(2),
    listingId: z.string().min(2),
    addressId: z.coerce.number().int().positive().optional(),
    paymentMethodId: z.coerce.number().int().positive().optional(),
    buyerProtectionFeeGbp: z.number().min(0).optional(),
  });

  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.buyerId);

  const listingResult = await db.query<{
    id: string;
    seller_id: string;
    price_gbp: number | string;
  }>(
    'SELECT id, seller_id, price_gbp FROM listings WHERE id = $1 LIMIT 1',
    [payload.listingId]
  );

  const listing = listingResult.rows[0];
  if (!listing) {
    reply.code(404);
    return { ok: false, error: 'Listing not found' };
  }

  if (listing.seller_id === payload.buyerId) {
    reply.code(400);
    return { ok: false, error: 'Buyer cannot purchase their own listing' };
  }

  if (payload.addressId) {
    const addressOwner = await db.query(
      'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2 LIMIT 1',
      [payload.addressId, payload.buyerId]
    );
    if (!addressOwner.rowCount) {
      reply.code(400);
      return { ok: false, error: 'Address does not belong to buyer' };
    }
  }

  if (payload.paymentMethodId) {
    const methodOwner = await db.query(
      'SELECT id FROM user_payment_methods WHERE id = $1 AND user_id = $2 LIMIT 1',
      [payload.paymentMethodId, payload.buyerId]
    );
    if (!methodOwner.rowCount) {
      reply.code(400);
      return { ok: false, error: 'Payment method does not belong to buyer' };
    }
  }

  const subtotalGbp = roundTo(Number(listing.price_gbp), 2);
  const buyerProtectionFeeGbp =
    payload.buyerProtectionFeeGbp !== undefined
      ? roundTo(payload.buyerProtectionFeeGbp, 2)
      : roundTo(subtotalGbp * 0.05 + 0.7, 2);
  const totalGbp = roundTo(subtotalGbp + buyerProtectionFeeGbp, 2);

  const orderId = payload.orderId ?? `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const insertResult = await db.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    subtotal_gbp: number | string;
    buyer_protection_fee_gbp: number | string;
    total_gbp: number | string;
    status: string;
    address_id: number | null;
    payment_method_id: number | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO orders (
        id,
        buyer_id,
        seller_id,
        listing_id,
        subtotal_gbp,
        buyer_protection_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'created', $8, $9)
      RETURNING
        id,
        buyer_id,
        seller_id,
        listing_id,
        subtotal_gbp,
        buyer_protection_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        created_at,
        updated_at
    `,
    [
      orderId,
      payload.buyerId,
      listing.seller_id,
      payload.listingId,
      subtotalGbp,
      buyerProtectionFeeGbp,
      totalGbp,
      payload.addressId ?? null,
      payload.paymentMethodId ?? null,
    ]
  );

  reply.code(201);
  return {
    ok: true,
    order: {
      id: insertResult.rows[0].id,
      buyerId: insertResult.rows[0].buyer_id,
      sellerId: insertResult.rows[0].seller_id,
      listingId: insertResult.rows[0].listing_id,
      subtotalGbp: Number(insertResult.rows[0].subtotal_gbp),
      buyerProtectionFeeGbp: Number(insertResult.rows[0].buyer_protection_fee_gbp),
      totalGbp: Number(insertResult.rows[0].total_gbp),
      status: insertResult.rows[0].status,
      addressId: insertResult.rows[0].address_id,
      paymentMethodId: insertResult.rows[0].payment_method_id,
      createdAt: insertResult.rows[0].created_at,
      updatedAt: insertResult.rows[0].updated_at,
    },
  };
});

app.post('/orders/:orderId/pay', async (request, reply) => {
  const paramsSchema = z.object({ orderId: z.string().min(4).max(64) });
  const { orderId } = paramsSchema.parse(request.params);

  const paid = await db.query<{
    id: string;
    status: string;
    updated_at: string;
  }>(
    `
      UPDATE orders
      SET status = 'paid', updated_at = NOW()
      WHERE id = $1 AND status = 'created'
      RETURNING id, status, updated_at
    `,
    [orderId]
  );

  if (!paid.rowCount) {
    const existing = await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM orders WHERE id = $1 LIMIT 1',
      [orderId]
    );

    if (!existing.rowCount) {
      reply.code(404);
      return { ok: false, error: 'Order not found' };
    }

    reply.code(409);
    return { ok: false, error: `Order cannot be paid from status '${existing.rows[0].status}'` };
  }

  return {
    ok: true,
    id: paid.rows[0].id,
    status: paid.rows[0].status,
    updatedAt: paid.rows[0].updated_at,
  };
});

app.get('/orders/:orderId', async (request, reply) => {
  const paramsSchema = z.object({ orderId: z.string().min(4).max(64) });
  const { orderId } = paramsSchema.parse(request.params);

  const result = await db.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    subtotal_gbp: number | string;
    buyer_protection_fee_gbp: number | string;
    total_gbp: number | string;
    status: string;
    address_id: number | null;
    payment_method_id: number | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        buyer_id,
        seller_id,
        listing_id,
        subtotal_gbp,
        buyer_protection_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        created_at,
        updated_at
      FROM orders
      WHERE id = $1
      LIMIT 1
    `,
    [orderId]
  );

  if (!result.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Order not found' };
  }

  const row = result.rows[0];
  return {
    ok: true,
    order: {
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      listingId: row.listing_id,
      subtotalGbp: Number(row.subtotal_gbp),
      buyerProtectionFeeGbp: Number(row.buyer_protection_fee_gbp),
      totalGbp: Number(row.total_gbp),
      status: row.status,
      addressId: row.address_id,
      paymentMethodId: row.payment_method_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
});

app.get('/users/:userId/orders', async (request) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    role: z.enum(['buyer', 'seller', 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { role, limit } = querySchema.parse(request.query);

  const whereClause =
    role === 'buyer'
      ? 'o.buyer_id = $1'
      : role === 'seller'
        ? 'o.seller_id = $1'
        : '(o.buyer_id = $1 OR o.seller_id = $1)';

  const result = await db.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    status: string;
    total_gbp: number | string;
    created_at: string;
    listing_title: string;
    listing_image_url: string | null;
  }>(
    `
      SELECT
        o.id,
        o.buyer_id,
        o.seller_id,
        o.listing_id,
        o.status,
        o.total_gbp,
        o.created_at,
        l.title AS listing_title,
        l.image_url AS listing_image_url
      FROM orders o
      INNER JOIN listings l ON l.id = o.listing_id
      WHERE ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      listingId: row.listing_id,
      listingTitle: row.listing_title,
      listingImageUrl: row.listing_image_url,
      status: row.status,
      totalGbp: Number(row.total_gbp),
      createdAt: row.created_at,
    })),
  };
});

app.get('/users/:userId/market-history', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    channel: z.enum(['all', 'auction', 'syndicate']).default('all'),
    limit: z.coerce.number().int().min(1).max(500).default(200),
    cursorTs: z.string().datetime().optional(),
    cursorId: z.string().min(1).optional(),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { channel, limit, cursorTs, cursorId } = querySchema.parse(request.query);

  if ((cursorTs && !cursorId) || (!cursorTs && cursorId)) {
    reply.code(400);
    return {
      ok: false,
      error: 'cursorTs and cursorId must be provided together',
    };
  }

  const fetchLimit = limit + 1;

  const result = await db.query<{
    entry_id: string;
    channel: 'auction' | 'syndicate';
    action: 'bid' | 'buy-units' | 'sell-units';
    reference_id: string;
    amount_gbp: number | string;
    units: number | null;
    unit_price_gbp: number | string | null;
    fee_gbp: number | string | null;
    status: 'filled' | 'rejected' | null;
    note: string | null;
    timestamp: string;
  }>(
    `
      SELECT
        history.entry_id,
        history.channel,
        history.action,
        history.reference_id,
        history.amount_gbp,
        history.units,
        history.unit_price_gbp,
        history.fee_gbp,
        history.status,
        history.note,
        history.timestamp
      FROM (
        SELECT
          ('auction_bid_' || ab.id::text) AS entry_id,
          'auction'::text AS channel,
          'bid'::text AS action,
          ab.auction_id AS reference_id,
          ab.amount_gbp AS amount_gbp,
          NULL::INTEGER AS units,
          NULL::NUMERIC AS unit_price_gbp,
          NULL::NUMERIC AS fee_gbp,
          NULL::TEXT AS status,
          l.title AS note,
          ab.created_at AS timestamp
        FROM auction_bids ab
        INNER JOIN auctions a ON a.id = ab.auction_id
        INNER JOIN listings l ON l.id = a.listing_id
        WHERE ab.bidder_id = $1

        UNION ALL

        SELECT
          ('syndicate_order_' || so.id::text) AS entry_id,
          'syndicate'::text AS channel,
          CASE WHEN so.side = 'buy' THEN 'buy-units' ELSE 'sell-units' END AS action,
          so.asset_id AS reference_id,
          so.total_gbp AS amount_gbp,
          so.units AS units,
          so.unit_price_gbp AS unit_price_gbp,
          so.fee_gbp AS fee_gbp,
          so.status::text AS status,
          sa.title AS note,
          so.created_at AS timestamp
        FROM syndicate_orders so
        INNER JOIN syndicate_assets sa ON sa.id = so.asset_id
        WHERE so.user_id = $1
      ) history
      WHERE ($2 = 'all' OR history.channel = $2)
        AND ($3::timestamptz IS NULL OR (history.timestamp, history.entry_id) < ($3::timestamptz, $4::text))
      ORDER BY history.timestamp DESC, history.entry_id DESC
      LIMIT $5
    `,
    [userId, channel, cursorTs ?? null, cursorId ?? null, fetchLimit]
  );

  const hasMore = result.rows.length > limit;
  const pageRows = hasMore ? result.rows.slice(0, limit) : result.rows;

  const lastRow = pageRows[pageRows.length - 1];
  const nextCursor = hasMore && lastRow
    ? {
        cursorTs: lastRow.timestamp,
        cursorId: lastRow.entry_id,
      }
    : undefined;

  return {
    ok: true,
    items: pageRows.map((row) => ({
      id: row.entry_id,
      channel: row.channel,
      action: row.action,
      referenceId: row.reference_id,
      amountGbp: Number(row.amount_gbp),
      units: row.units,
      unitPriceGbp: row.unit_price_gbp === null ? null : Number(row.unit_price_gbp),
      feeGbp: row.fee_gbp === null ? null : Number(row.fee_gbp),
      status: row.status,
      note: row.note,
      timestamp: row.timestamp,
    })),
    pageInfo: {
      hasMore,
      nextCursor,
    },
  };
});

app.get('/auctions', async (request) => {
  const querySchema = z.object({
    status: z.enum(['upcoming', 'live', 'ended']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });
  const { status, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: string;
    listing_id: string;
    seller_id: string;
    starts_at: string;
    ends_at: string;
    starting_bid_gbp: number | string;
    current_bid_gbp: number | string;
    buy_now_price_gbp: number | string | null;
    bid_count: number;
    status: 'upcoming' | 'live' | 'ended';
    title: string;
    image_url: string | null;
  }>(
    `
      SELECT
        a.id,
        a.listing_id,
        a.seller_id,
        a.starts_at,
        a.ends_at,
        a.starting_bid_gbp,
        a.current_bid_gbp,
        a.buy_now_price_gbp,
        a.bid_count,
        a.status,
        l.title,
        l.image_url
      FROM auctions a
      INNER JOIN listings l ON l.id = a.listing_id
      ORDER BY a.starts_at DESC
      LIMIT $1
    `,
    [limit]
  );

  const now = Date.now();
  const items = result.rows
    .map((row) => {
      const startsAt = new Date(row.starts_at);
      const endsAt = new Date(row.ends_at);
      const computedStatus = resolveAuctionStatus(startsAt, endsAt);

      return {
        id: row.id,
        listingId: row.listing_id,
        sellerId: row.seller_id,
        title: row.title,
        imageUrl: row.image_url,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        msToStart: startsAt.getTime() - now,
        msToEnd: endsAt.getTime() - now,
        startingBidGbp: Number(row.starting_bid_gbp),
        currentBidGbp: Number(row.current_bid_gbp),
        buyNowPriceGbp: row.buy_now_price_gbp === null ? null : Number(row.buy_now_price_gbp),
        bidCount: row.bid_count,
        status: computedStatus,
      };
    })
    .filter((item) => (status ? item.status === status : true));

  return { ok: true, items };
});

app.post('/auctions', async (request, reply) => {
  const bodySchema = z.object({
    id: z.string().min(4).max(64).optional(),
    listingId: z.string().min(2),
    sellerId: z.string().min(2).optional(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    startingBidGbp: z.number().min(0),
    buyNowPriceGbp: z.number().min(0).optional(),
  });

  const payload = bodySchema.parse(request.body);

  const listingResult = await db.query<{
    id: string;
    seller_id: string;
    title: string;
  }>('SELECT id, seller_id, title FROM listings WHERE id = $1 LIMIT 1', [payload.listingId]);

  const listing = listingResult.rows[0];
  if (!listing) {
    reply.code(404);
    return { ok: false, error: 'Listing not found' };
  }

  const sellerId = payload.sellerId ?? listing.seller_id;
  await ensureUserExists(sellerId);

  const startsAt = new Date(payload.startsAt);
  const endsAt = new Date(payload.endsAt);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    reply.code(400);
    return { ok: false, error: 'Auction timing is invalid' };
  }

  const status = resolveAuctionStatus(startsAt, endsAt);
  const auctionId = payload.id ?? `a_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const startingBidGbp = roundTo(payload.startingBidGbp, 2);
  const buyNowPriceGbp =
    payload.buyNowPriceGbp === undefined ? null : roundTo(payload.buyNowPriceGbp, 2);

  const result = await db.query<{
    id: string;
    listing_id: string;
    seller_id: string;
    starts_at: string;
    ends_at: string;
    starting_bid_gbp: number | string;
    current_bid_gbp: number | string;
    buy_now_price_gbp: number | string | null;
    bid_count: number;
    status: 'upcoming' | 'live' | 'ended';
  }>(
    `
      INSERT INTO auctions (
        id,
        listing_id,
        seller_id,
        starts_at,
        ends_at,
        starting_bid_gbp,
        current_bid_gbp,
        buy_now_price_gbp,
        bid_count,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6, $7, 0, $8)
      RETURNING
        id,
        listing_id,
        seller_id,
        starts_at,
        ends_at,
        starting_bid_gbp,
        current_bid_gbp,
        buy_now_price_gbp,
        bid_count,
        status
    `,
    [
      auctionId,
      payload.listingId,
      sellerId,
      startsAt.toISOString(),
      endsAt.toISOString(),
      startingBidGbp,
      buyNowPriceGbp,
      status,
    ]
  );

  reply.code(201);
  return {
    ok: true,
    auction: {
      id: result.rows[0].id,
      listingId: result.rows[0].listing_id,
      sellerId: result.rows[0].seller_id,
      startsAt: result.rows[0].starts_at,
      endsAt: result.rows[0].ends_at,
      startingBidGbp: Number(result.rows[0].starting_bid_gbp),
      currentBidGbp: Number(result.rows[0].current_bid_gbp),
      buyNowPriceGbp: result.rows[0].buy_now_price_gbp === null ? null : Number(result.rows[0].buy_now_price_gbp),
      bidCount: result.rows[0].bid_count,
      status: result.rows[0].status,
    },
  };
});

app.get('/auctions/:auctionId/bids', async (request, reply) => {
  const paramsSchema = z.object({ auctionId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
  });

  const { auctionId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const auctionExists = await db.query('SELECT id FROM auctions WHERE id = $1 LIMIT 1', [auctionId]);
  if (!auctionExists.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Auction not found' };
  }

  const result = await db.query<{
    id: number;
    auction_id: string;
    bidder_id: string;
    amount_gbp: number | string;
    created_at: string;
  }>(
    `
      SELECT id, auction_id, bidder_id, amount_gbp, created_at
      FROM auction_bids
      WHERE auction_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [auctionId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      auctionId: row.auction_id,
      bidderId: row.bidder_id,
      amountGbp: Number(row.amount_gbp),
      createdAt: row.created_at,
    })),
  };
});

app.post('/auctions/:auctionId/bids', async (request, reply) => {
  const paramsSchema = z.object({ auctionId: z.string().min(2) });
  const bodySchema = z.object({
    bidderId: z.string().min(2),
    amountGbp: z.number().positive(),
  });

  const { auctionId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.bidderId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const auctionResult = await client.query<{
      id: string;
      seller_id: string;
      starts_at: string;
      ends_at: string;
      current_bid_gbp: number | string;
      bid_count: number;
    }>(
      `
        SELECT id, seller_id, starts_at, ends_at, current_bid_gbp, bid_count
        FROM auctions
        WHERE id = $1
        FOR UPDATE
      `,
      [auctionId]
    );

    const auction = auctionResult.rows[0];
    if (!auction) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { ok: false, error: 'Auction not found' };
    }

    if (auction.seller_id === payload.bidderId) {
      await client.query('ROLLBACK');
      reply.code(400);
      return { ok: false, error: 'Seller cannot bid on their own auction' };
    }

    const status = resolveAuctionStatus(new Date(auction.starts_at), new Date(auction.ends_at));
    await client.query('UPDATE auctions SET status = $2, updated_at = NOW() WHERE id = $1', [auctionId, status]);

    if (status !== 'live') {
      await client.query('ROLLBACK');
      reply.code(409);
      return { ok: false, error: `Auction is ${status}; bidding is closed` };
    }

    const currentBid = Number(auction.current_bid_gbp);
    const amountGbp = roundTo(payload.amountGbp, 2);
    if (amountGbp <= currentBid) {
      await client.query('ROLLBACK');
      reply.code(400);
      return { ok: false, error: `Bid must be greater than current bid (${currentBid.toFixed(2)} GBP)` };
    }

    const bidResult = await client.query<{
      id: number;
      created_at: string;
    }>(
      `
        INSERT INTO auction_bids (auction_id, bidder_id, amount_gbp)
        VALUES ($1, $2, $3)
        RETURNING id, created_at
      `,
      [auctionId, payload.bidderId, amountGbp]
    );

    const nextBidCount = auction.bid_count + 1;
    await client.query(
      `
        UPDATE auctions
        SET current_bid_gbp = $2,
            bid_count = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [auctionId, amountGbp, nextBidCount]
    );

    await client.query('COMMIT');

    reply.code(201);
    return {
      ok: true,
      bid: {
        id: bidResult.rows[0].id,
        auctionId,
        bidderId: payload.bidderId,
        amountGbp,
        createdAt: bidResult.rows[0].created_at,
      },
      auction: {
        id: auctionId,
        currentBidGbp: amountGbp,
        bidCount: nextBidCount,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    reply.code(500);
    return {
      ok: false,
      error: `Unable to place bid: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

app.get('/syndicate/assets', async (request) => {
  const querySchema = z.object({
    openOnly: z.union([z.string(), z.boolean()]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80),
  });
  const parsedQuery = querySchema.parse(request.query);
  const openOnly = parseQueryBoolean(parsedQuery.openOnly, false);
  const { limit } = parsedQuery;

  const whereClause = openOnly ? 'WHERE sa.is_open = TRUE' : '';
  const result = await db.query<{
    id: string;
    listing_id: string;
    issuer_id: string;
    title: string;
    image_url: string | null;
    total_units: number;
    available_units: number;
    unit_price_gbp: number | string;
    unit_price_stable: number | string;
    settlement_mode: 'GBP' | 'TVUSD' | 'HYBRID';
    issuer_jurisdiction: string | null;
    market_move_pct_24h: number | string;
    holders: number;
    volume_24h_gbp: number | string;
    is_open: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        sa.id,
        sa.listing_id,
        sa.issuer_id,
        sa.title,
        sa.image_url,
        sa.total_units,
        sa.available_units,
        sa.unit_price_gbp,
        sa.unit_price_stable,
        sa.settlement_mode,
        sa.issuer_jurisdiction,
        sa.market_move_pct_24h,
        sa.holders,
        sa.volume_24h_gbp,
        sa.is_open,
        sa.created_at,
        sa.updated_at
      FROM syndicate_assets sa
      ${whereClause}
      ORDER BY sa.volume_24h_gbp DESC, sa.created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      listingId: row.listing_id,
      issuerId: row.issuer_id,
      title: row.title,
      imageUrl: row.image_url,
      totalUnits: row.total_units,
      availableUnits: row.available_units,
      unitPriceGbp: Number(row.unit_price_gbp),
      unitPriceStable: Number(row.unit_price_stable),
      settlementMode: row.settlement_mode,
      issuerJurisdiction: row.issuer_jurisdiction,
      marketMovePct24h: Number(row.market_move_pct_24h),
      holders: row.holders,
      volume24hGbp: Number(row.volume_24h_gbp),
      isOpen: row.is_open,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/syndicate/assets', async (request, reply) => {
  const bodySchema = z.object({
    id: z.string().min(4).max(64).optional(),
    listingId: z.string().min(2),
    issuerId: z.string().min(2),
    title: z.string().min(3).max(180).optional(),
    imageUrl: z.string().url().optional(),
    totalUnits: z.number().int().min(1),
    unitPriceGbp: z.number().positive(),
    unitPriceStable: z.number().positive(),
    settlementMode: z.enum(['GBP', 'TVUSD', 'HYBRID']),
    issuerJurisdiction: z.string().min(2).max(10).optional(),
  });

  const payload = bodySchema.parse(request.body);

  await ensureUserExists(payload.issuerId);

  const listingResult = await db.query<{
    id: string;
    title: string;
    image_url: string | null;
  }>('SELECT id, title, image_url FROM listings WHERE id = $1 LIMIT 1', [payload.listingId]);

  const listing = listingResult.rows[0];
  if (!listing) {
    reply.code(404);
    return { ok: false, error: 'Listing not found' };
  }

  const assetId = payload.id ?? `s_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const resolvedTitle = payload.title ?? `${listing.title} Fraction Pool`;
  const resolvedImage = payload.imageUrl ?? listing.image_url;

  const result = await db.query<{
    id: string;
    listing_id: string;
    issuer_id: string;
    title: string;
    image_url: string | null;
    total_units: number;
    available_units: number;
    unit_price_gbp: number | string;
    unit_price_stable: number | string;
    settlement_mode: 'GBP' | 'TVUSD' | 'HYBRID';
    issuer_jurisdiction: string | null;
    market_move_pct_24h: number | string;
    holders: number;
    volume_24h_gbp: number | string;
    is_open: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO syndicate_assets (
        id,
        listing_id,
        issuer_id,
        title,
        image_url,
        total_units,
        available_units,
        unit_price_gbp,
        unit_price_stable,
        settlement_mode,
        issuer_jurisdiction,
        market_move_pct_24h,
        holders,
        volume_24h_gbp,
        is_open
      )
      VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, 0, 0, 0, TRUE)
      RETURNING
        id,
        listing_id,
        issuer_id,
        title,
        image_url,
        total_units,
        available_units,
        unit_price_gbp,
        unit_price_stable,
        settlement_mode,
        issuer_jurisdiction,
        market_move_pct_24h,
        holders,
        volume_24h_gbp,
        is_open,
        created_at,
        updated_at
    `,
    [
      assetId,
      payload.listingId,
      payload.issuerId,
      resolvedTitle,
      resolvedImage,
      payload.totalUnits,
      roundTo(payload.unitPriceGbp, 4),
      roundTo(payload.unitPriceStable, 4),
      payload.settlementMode,
      payload.issuerJurisdiction ?? null,
    ]
  );

  reply.code(201);
  return {
    ok: true,
    asset: {
      id: result.rows[0].id,
      listingId: result.rows[0].listing_id,
      issuerId: result.rows[0].issuer_id,
      title: result.rows[0].title,
      imageUrl: result.rows[0].image_url,
      totalUnits: result.rows[0].total_units,
      availableUnits: result.rows[0].available_units,
      unitPriceGbp: Number(result.rows[0].unit_price_gbp),
      unitPriceStable: Number(result.rows[0].unit_price_stable),
      settlementMode: result.rows[0].settlement_mode,
      issuerJurisdiction: result.rows[0].issuer_jurisdiction,
      marketMovePct24h: Number(result.rows[0].market_move_pct_24h),
      holders: result.rows[0].holders,
      volume24hGbp: Number(result.rows[0].volume_24h_gbp),
      isOpen: result.rows[0].is_open,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    },
  };
});

app.get('/syndicate/assets/:assetId/orders', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const assetExists = await db.query('SELECT id FROM syndicate_assets WHERE id = $1 LIMIT 1', [assetId]);
  if (!assetExists.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Syndicate asset not found' };
  }

  const result = await db.query<{
    id: number;
    asset_id: string;
    user_id: string;
    side: 'buy' | 'sell';
    units: number;
    unit_price_gbp: number | string;
    fee_gbp: number | string;
    total_gbp: number | string;
    status: 'filled' | 'rejected';
    created_at: string;
  }>(
    `
      SELECT
        id,
        asset_id,
        user_id,
        side,
        units,
        unit_price_gbp,
        fee_gbp,
        total_gbp,
        status,
        created_at
      FROM syndicate_orders
      WHERE asset_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [assetId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      userId: row.user_id,
      side: row.side,
      units: row.units,
      unitPriceGbp: Number(row.unit_price_gbp),
      feeGbp: Number(row.fee_gbp),
      totalGbp: Number(row.total_gbp),
      status: row.status,
      createdAt: row.created_at,
    })),
  };
});

app.post('/syndicate/assets/:assetId/orders', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const bodySchema = z.object({
    userId: z.string().min(2),
    side: z.enum(['buy', 'sell']),
    units: z.number().int().positive(),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.userId);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const assetResult = await client.query<{
      id: string;
      issuer_id: string;
      total_units: number;
      available_units: number;
      unit_price_gbp: number | string;
      holders: number;
      volume_24h_gbp: number | string;
      is_open: boolean;
    }>(
      `
        SELECT
          id,
          issuer_id,
          total_units,
          available_units,
          unit_price_gbp,
          holders,
          volume_24h_gbp,
          is_open
        FROM syndicate_assets
        WHERE id = $1
        FOR UPDATE
      `,
      [assetId]
    );

    const asset = assetResult.rows[0];
    if (!asset) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { ok: false, error: 'Syndicate asset not found' };
    }

    if (!asset.is_open) {
      await client.query('ROLLBACK');
      reply.code(409);
      return { ok: false, error: 'Syndicate asset is closed for trading' };
    }

    const unitPriceGbp = Number(asset.unit_price_gbp);
    const grossGbp = roundTo(unitPriceGbp * payload.units, 4);
    const feeGbp = roundTo(grossGbp * 0.005, 4);
    const totalGbp = payload.side === 'buy' ? roundTo(grossGbp + feeGbp, 4) : roundTo(Math.max(0, grossGbp - feeGbp), 4);

    let nextAvailableUnits = asset.available_units;
    let nextHolders = asset.holders;

    if (payload.side === 'buy') {
      if (asset.available_units < payload.units) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: `Only ${asset.available_units} units available`,
        };
      }

      nextAvailableUnits = asset.available_units - payload.units;
      nextHolders = asset.holders + 1;
    } else {
      nextAvailableUnits = Math.min(asset.total_units, asset.available_units + payload.units);
      nextHolders = Math.max(0, asset.holders - 1);
    }

    const volume24hGbp = roundTo(Number(asset.volume_24h_gbp) + grossGbp, 2);

    const orderResult = await client.query<{
      id: number;
      created_at: string;
    }>(
      `
        INSERT INTO syndicate_orders (
          asset_id,
          user_id,
          side,
          units,
          unit_price_gbp,
          fee_gbp,
          total_gbp,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'filled')
        RETURNING id, created_at
      `,
      [assetId, payload.userId, payload.side, payload.units, unitPriceGbp, feeGbp, totalGbp]
    );

    const updatedAssetResult = await client.query<{
      id: string;
      available_units: number;
      holders: number;
      volume_24h_gbp: number | string;
      updated_at: string;
    }>(
      `
        UPDATE syndicate_assets
        SET
          available_units = $2,
          holders = $3,
          volume_24h_gbp = $4,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, available_units, holders, volume_24h_gbp, updated_at
      `,
      [assetId, nextAvailableUnits, nextHolders, volume24hGbp]
    );

    await client.query('COMMIT');

    reply.code(201);
    return {
      ok: true,
      order: {
        id: orderResult.rows[0].id,
        assetId,
        userId: payload.userId,
        side: payload.side,
        units: payload.units,
        unitPriceGbp,
        feeGbp,
        totalGbp,
        status: 'filled',
        createdAt: orderResult.rows[0].created_at,
      },
      asset: {
        id: updatedAssetResult.rows[0].id,
        availableUnits: updatedAssetResult.rows[0].available_units,
        holders: updatedAssetResult.rows[0].holders,
        volume24hGbp: Number(updatedAssetResult.rows[0].volume_24h_gbp),
        updatedAt: updatedAssetResult.rows[0].updated_at,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    reply.code(500);
    return {
      ok: false,
      error: `Unable to place syndicate order: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`API running on :${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

const shutdown = async () => {
  await app.close();
  await closeRedis();
  await closeDb();
};

process.on('SIGINT', async () => {
  await shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdown();
  process.exit(0);
});

void start();
