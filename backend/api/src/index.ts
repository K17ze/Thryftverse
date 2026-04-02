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
