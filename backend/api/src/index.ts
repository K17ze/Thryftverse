import crypto from 'node:crypto';
import { shutdownTelemetry } from './telemetry.js';
import Fastify from 'fastify';
import * as Sentry from '@sentry/node';
import type { Pool, PoolClient } from 'pg';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyRawBody from 'fastify-raw-body';
import Razorpay from 'razorpay';
import Stripe from 'stripe';
import { z } from 'zod';
import { config } from './config.js';
import { db, closeDb, readDb, replicaConfigured } from './db/pool.js';
import { redis, closeRedis } from './lib/redis.js';
import type { AuthRole, AuthenticatedUser } from './lib/auth.js';
import {
  createPublicToken,
  hashOpaqueValue,
  hashPassword,
  issueAuthSession,
  revokeAllUserSessions,
  revokeSessionByRefreshToken,
  rotateRefreshSession,
  verifyAccessToken,
  verifyPassword,
} from './lib/auth.js';
import { sendAuthEmail } from './lib/authEmail.js';
import {
  assertGoldOperatorToken,
  createGoldReserveAttestation,
  resolveGoldRate,
  setGoldRateOverride,
} from './lib/goldOracle.js';
import {
  expectedGatewayIdForProvider,
  resolveProviderFromPathSegment,
  type ProviderPaymentStatus,
  verifyAndNormalizeWebhook,
} from './lib/paymentProviders.js';
import {
  assertKeyServiceConnectivity,
  decryptJsonPayload,
  encryptJsonPayload,
  rewrapCiphertext,
  rotateKeyVersion,
} from './lib/keyService.js';
import {
  closeBackgroundQueues,
  enqueueAuctionSweepJob,
  enqueuePushNotificationJob,
  startBackgroundWorkers,
} from './lib/queues.js';
import {
  closeRealtimeConnections,
  parseRealtimeTopics,
  publishRealtimeEvent,
  registerSseClient,
  registerWsClient,
} from './lib/realtime.js';
import { assertS3BucketConnectivity, createUploadUrl } from './lib/s3.js';
import {
  metricsContentType,
  observeHttpRequest,
  recordAuctionSettlement,
  recordPaymentTransition,
  recordPushDelivery,
  renderMetrics,
} from './lib/metrics.js';
import {
  appendComplianceAuditEvent,
  createAmlAlert,
  createComplianceId,
  evaluateAmlRisk,
  evaluateMarketEligibility,
  getOrCreateComplianceProfile,
  normalizeCountryCode,
  resolveClientIp,
  resolveJurisdictionRule,
} from './lib/compliance.js';
import {
  verifyAppleIdentityToken,
  verifyGoogleIdentityToken,
  type VerifiedSocialIdentity,
} from './lib/identityProviders.js';
import {
  createOtpauthUrl,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotp,
} from './lib/totp.js';

const app = Fastify({ logger: true });

if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
    tracesSampleRate: config.sentryTracesSampleRate,
  });
}

void app.register(websocket);

void app.register(fastifyRawBody, {
  field: 'rawBody',
  global: false,
  routes: ['/webhooks/*'],
  encoding: 'utf8',
  runFirst: true,
});

void app.register(rateLimit, {
  global: true,
  max: config.apiRateLimitMax,
  timeWindow: config.apiRateLimitWindow,
  redis,
  nameSpace: 'thryftverse:rate-limit',
});

function toJsonString(value: unknown): string {
  return JSON.stringify(value);
}

async function ensureUserExists(userId: string) {
  const result = await db.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  if (!result.rowCount) {
    throw createApiError('USER_NOT_FOUND', 'User account does not exist', {
      userId,
    });
  }
}

function ensureSecurityAdmin(headerToken: string | undefined) {
  if (!headerToken || headerToken !== config.apiSecurityAdminToken) {
    throw new Error('Missing or invalid security admin token');
  }
}

function ensureSecurityAdminAccess(
  request: {
    headers: Record<string, string | string[] | undefined>;
    authUser?: AuthenticatedUser;
  },
  reply: {
    code: (statusCode: number) => unknown;
  }
): { ok: false; error: string } | null {
  try {
    ensureSecurityAdmin(request.headers['x-security-admin-token'] as string | undefined);
  } catch (error) {
    reply.code(401);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  if (request.authUser && request.authUser.role !== 'admin') {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: admin role required',
    };
  }

  return null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const COMMERCE_PLATFORM_CHARGE_RATE = 0.05;
const COMMERCE_PLATFORM_CHARGE_FIXED_GBP = 0.7;
const COMMERCE_PLATFORM_CHARGE_MIN_RATE = 0.02;
const SYNDICATE_TRADE_FEE_RATE = 0.01;
const AUCTION_PLATFORM_FEE_RATE = 0.03;
const WALLET_TOPUP_PLATFORM_FEE_RATE = 0.01;

function calculateCommercePlatformChargeGbp(subtotalGbp: number): number {
  const normalizedSubtotal = roundTo(Math.max(0, subtotalGbp), 2);
  if (normalizedSubtotal <= 0) {
    return 0;
  }

  const formulaCharge =
    normalizedSubtotal * COMMERCE_PLATFORM_CHARGE_RATE + COMMERCE_PLATFORM_CHARGE_FIXED_GBP;
  const minimumCharge = normalizedSubtotal * COMMERCE_PLATFORM_CHARGE_MIN_RATE;
  return roundTo(Math.max(formulaCharge, minimumCharge), 2);
}

function calculateAuctionPlatformFeeGbp(winningBidGbp: number): number {
  return roundTo(Math.max(0, winningBidGbp) * AUCTION_PLATFORM_FEE_RATE, 2);
}

function calculateWalletTopupFeeBreakdown(grossFiatAmount: number): {
  grossFiatAmount: number;
  platformFeeRate: number;
  platformFeeAmount: number;
  netFiatAmount: number;
} {
  const gross = roundTo(Math.max(0, grossFiatAmount), 6);
  const platformFeeAmount = roundTo(gross * WALLET_TOPUP_PLATFORM_FEE_RATE, 6);
  const netFiatAmount = roundTo(Math.max(0, gross - platformFeeAmount), 6);

  return {
    grossFiatAmount: gross,
    platformFeeRate: WALLET_TOPUP_PLATFORM_FEE_RATE,
    platformFeeAmount,
    netFiatAmount,
  };
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

function resolveHeaderString(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === 'string' && entry.trim().length > 0);
    return first?.trim() ?? null;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}

function resolveRequestIpAddress(request: { ip: string; headers: Record<string, string | string[] | undefined> }): string {
  return resolveClientIp(request.ip, request.headers['x-forwarded-for']);
}

function resolveRequestUserAgent(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  return resolveHeaderString(request.headers['user-agent']);
}

async function appendComplianceAuditSafe(
  request: {
    id: string;
    ip: string;
    headers: Record<string, string | string[] | undefined>;
    authUser?: AuthenticatedUser;
    log: { error: (payload: unknown, message: string) => void };
  },
  input: {
    eventType: string;
    actorUserId?: string | null;
    subjectUserId?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  try {
    await appendComplianceAuditEvent(db, {
      eventType: input.eventType,
      actorUserId: input.actorUserId ?? request.authUser?.userId ?? null,
      subjectUserId: input.subjectUserId ?? request.authUser?.userId ?? null,
      requestId: request.id,
      ipAddress: resolveRequestIpAddress(request),
      userAgent: resolveRequestUserAgent(request),
      payload: input.payload ?? {},
    });
  } catch (error) {
    request.log.error(
      {
        err: error,
        eventType: input.eventType,
        requestId: request.id,
      },
      'Failed to append compliance audit event'
    );
  }
}

interface ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
}

function createApiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function getApiError(error: unknown): ApiError | null {
  if (!error || typeof error !== 'object') {
    return null;
  }

  if ('code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return error as ApiError;
  }

  return null;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthenticatedUser;
    rawBody?: string | Buffer;
    apiVersion?: 'legacy' | 'v1';
    metricsStartNs?: bigint;
  }
}

const BODY_ACTOR_KEYS = [
  'userId',
  'buyerId',
  'sellerId',
  'bidderId',
  'bidderUserId',
  'holderUserId',
  'issuerId',
  'senderId',
] as const;

function getRoutePath(url: string) {
  return url.split('?')[0] || '/';
}

function isSecurityMaintenanceRoute(method: string, path: string) {
  return method === 'POST' && /^\/security\/keys\/[^/]+\/rotate$/.test(path);
}

function stripV1Prefix(url: string): { url: string; apiVersion: 'legacy' | 'v1' } {
  const path = getRoutePath(url);
  if (path === '/v1' || path.startsWith('/v1/')) {
    const suffix = url.slice(path.length);
    const normalizedPath = path === '/v1' ? '/' : path.slice(3);
    return {
      url: `${normalizedPath}${suffix}`,
      apiVersion: 'v1',
    };
  }

  return {
    url,
    apiVersion: 'legacy',
  };
}

function isPublicRoute(method: string, path: string) {
  if (method === 'OPTIONS') {
    return true;
  }

  if (method === 'POST' && path.startsWith('/webhooks/')) {
    return true;
  }

  const signature = `${method} ${path}`;
  const fixedPublicRoutes = new Set<string>([
    'GET /health',
    'GET /health/deep',
    'GET /metrics',
    'GET /listings',
    'GET /search/listings',
    'GET /feed/looks',
    'GET /oracle/gold/latest',
    'POST /auth/signup',
    'POST /auth/login',
    'POST /auth/refresh',
    'POST /auth/oauth/google',
    'POST /auth/oauth/apple',
    'POST /auth/magic-link/request',
    'POST /auth/magic-link/consume',
    'POST /auth/otp/request',
    'POST /auth/otp/verify',
    'POST /auth/password-reset/request',
    'POST /auth/password-reset/confirm',
    'POST /compliance/kyc/webhook',
  ]);

  if (fixedPublicRoutes.has(signature)) {
    return true;
  }

  if (isSecurityMaintenanceRoute(method, path)) {
    return true;
  }

  if (method === 'GET' && (path === '/auctions' || path.startsWith('/auctions/'))) {
    return true;
  }

  if (method === 'GET' && (path === '/syndicate/assets' || path.startsWith('/syndicate/assets/'))) {
    return true;
  }

  return false;
}

function getBearerToken(authHeader: string | undefined) {
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }

  return token.trim();
}

async function authenticateRequest(requestPath: string, authHeader: string | undefined) {
  const token = getBearerToken(authHeader);
  if (!token) {
    return null;
  }

  const authUser = await verifyAccessToken(token);
  if (!authUser) {
    app.log.warn({ requestPath }, 'Rejected request with invalid access token');
  }

  return authUser;
}

function resolveActorUserId(requestPath: string, request: { params?: unknown; body?: unknown }) {
  const params = request.params as Record<string, unknown> | undefined;
  if (params && typeof params.userId === 'string') {
    return params.userId;
  }

  const userPathMatch = requestPath.match(/^\/users\/([^/]+)/);
  if (userPathMatch?.[1]) {
    return decodeURIComponent(userPathMatch[1]);
  }

  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const bodyRecord = body as Record<string, unknown>;
  for (const key of BODY_ACTOR_KEYS) {
    const value = bodyRecord[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function resolveAuthenticatedUserId(
  request: { authUser?: AuthenticatedUser },
  requestedUserId?: string
): string {
  const authUser = request.authUser;
  if (!authUser) {
    throw createApiError('UNAUTHORIZED', 'Unauthorized');
  }

  if (requestedUserId && authUser.role !== 'admin' && requestedUserId !== authUser.userId) {
    throw createApiError('FORBIDDEN_USER_CONTEXT', 'Forbidden: user context mismatch', {
      authUserId: authUser.userId,
      requestedUserId,
    });
  }

  return requestedUserId ?? authUser.userId;
}

function statusCodeForApiError(code: string): number {
  if (code === 'UNAUTHORIZED') {
    return 401;
  }

  if (code === 'FORBIDDEN_USER_CONTEXT') {
    return 403;
  }

  if (code.endsWith('_NOT_FOUND') || code === 'USER_NOT_FOUND') {
    return 404;
  }

  if (code.endsWith('_INVALID') || code.endsWith('_MISMATCH') || code.endsWith('_REQUIRED')) {
    return 400;
  }

  return 409;
}

app.addHook('onRequest', async (request) => {
  request.metricsStartNs = process.hrtime.bigint();

  const rawUrl = request.raw.url ?? request.url;
  const normalized = stripV1Prefix(rawUrl);
  request.apiVersion = normalized.apiVersion;

  if (normalized.url !== rawUrl) {
    request.raw.url = normalized.url;
  }
});

app.addHook('onSend', async (request, reply, payload) => {
  reply.header('x-api-version', 'v1');
  reply.header('x-request-id', request.id);

  if (request.apiVersion === 'legacy') {
    reply.header('x-api-deprecation', 'Legacy unversioned endpoint; prefer /v1/*');
  }

  return payload;
});

app.addHook('onResponse', async (request, reply) => {
  if (!request.metricsStartNs) {
    return;
  }

  const elapsedNs = process.hrtime.bigint() - request.metricsStartNs;
  const routeTemplate =
    request.routeOptions.url
    ?? getRoutePath(request.raw.url ?? request.url);

  observeHttpRequest({
    method: request.method,
    route: routeTemplate,
    statusCode: reply.statusCode,
    durationSeconds: Number(elapsedNs) / 1_000_000_000,
  });
});

app.addHook('preHandler', async (request, reply) => {
  const requestPath = getRoutePath(request.raw.url ?? request.url);

  if (isPublicRoute(request.method, requestPath)) {
    return;
  }

  const authUser = await authenticateRequest(requestPath, request.headers.authorization);
  if (!authUser) {
    reply.code(401).send({
      ok: false,
      error: 'Unauthorized',
    });
    return reply;
  }

  request.authUser = authUser;

  const actorUserId = resolveActorUserId(requestPath, request);
  if (actorUserId && authUser.role !== 'admin' && actorUserId !== authUser.userId) {
    reply.code(403).send({
      ok: false,
      error: 'Forbidden: user context mismatch',
    });
    return reply;
  }
});

app.setErrorHandler((error, request, reply) => {
  if (config.sentryDsn) {
    Sentry.captureException(error, {
      tags: {
        method: request.method,
        route: request.routeOptions.url,
      },
      extra: {
        requestId: request.id,
      },
    });
  }

  request.log.error(
    {
      err: error,
      method: request.method,
      path: request.raw.url,
      requestId: request.id,
    },
    'Unhandled request failure'
  );

  if (reply.sent) {
    return;
  }

  if (error instanceof z.ZodError) {
    reply.code(400);
    reply.send({
      ok: false,
      error: 'Invalid request payload',
      details: error.issues,
    });
    return;
  }

  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
      ? (error as { statusCode: number }).statusCode
      : 500;

  reply.code(statusCode >= 400 ? statusCode : 500);
  const errorMessage = error instanceof Error ? error.message : 'Request failed';
  reply.send({
    ok: false,
    error: statusCode >= 500 ? 'Internal server error' : errorMessage,
  });
});

type DbQueryable = Pick<PoolClient, 'query'>;
type LedgerOwnerType = 'platform' | 'user';
type LedgerAccountCode =
  | 'escrow_liability'
  | 'platform_revenue'
  | 'seller_payable'
  | 'buyer_spend'
  | 'withdrawal_pending'
  | 'withdrawable_balance'
  | 'ize_wallet'
  | 'ize_pending_redemption'
  | 'ize_outstanding'
  | 'gold_reserve_grams';
type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
type PaymentIntentTerminalStatus = 'succeeded' | 'failed' | 'cancelled';
type PaymentIntentChannel = 'commerce' | 'syndicate' | 'wallet_topup' | 'wallet_withdrawal';

interface PaymentIntentRow {
  id: string;
  user_id: string;
  gateway_id: string;
  channel: PaymentIntentChannel;
  order_id: string | null;
  syndicate_order_id: number | null;
  instrument_id: number | null;
  amount_gbp: number | string;
  amount_currency: string;
  status: PaymentIntentStatus;
  provider_intent_ref: string | null;
  client_secret: string | null;
  provider_status: string | null;
  next_action_url: string | null;
  sca_expires_at: string | null;
  settled_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  created_at: string;
  updated_at: string;
}

type PayoutRequestStatus = 'requested' | 'processing' | 'paid' | 'failed' | 'cancelled';

interface PayoutRequestRow {
  id: string;
  user_id: string;
  payout_account_id: number;
  amount_gbp: number | string;
  amount_currency: string;
  status: PayoutRequestStatus;
  provider_payout_ref: string | null;
  failure_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function createRuntimeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

type ChatConversationType = 'dm' | 'group';
type ChatSenderType = 'user' | 'bot' | 'system';

interface ChatConversationAccessRow {
  id: string;
  type: ChatConversationType;
  title: string | null;
  owner_id: string;
  item_id: string | null;
}

async function ensureChatConversationAccess(
  client: DbQueryable,
  conversationId: string,
  userId: string
): Promise<ChatConversationAccessRow> {
  const result = await client.query<ChatConversationAccessRow>(
    `
      SELECT c.id, c.type, c.title, c.owner_id, c.item_id
      FROM chat_conversations c
      INNER JOIN chat_members cm
        ON cm.conversation_id = c.id
      WHERE c.id = $1
        AND cm.user_id = $2
      LIMIT 1
    `,
    [conversationId, userId]
  );

  if (!result.rowCount) {
    throw createApiError('CHAT_CONVERSATION_NOT_FOUND', 'Conversation not found', {
      conversationId,
      userId,
    });
  }

  return result.rows[0];
}

async function ensureGroupConversationAccess(
  client: DbQueryable,
  conversationId: string,
  userId: string
): Promise<ChatConversationAccessRow> {
  const conversation = await ensureChatConversationAccess(client, conversationId, userId);

  if (conversation.type !== 'group') {
    throw createApiError('CHAT_CONVERSATION_INVALID', 'This action is available only for group conversations', {
      conversationId,
      conversationType: conversation.type,
    });
  }

  return conversation;
}

async function listChatParticipantIds(client: DbQueryable, conversationId: string): Promise<string[]> {
  const result = await client.query<{ user_id: string }>(
    `
      SELECT user_id
      FROM chat_members
      WHERE conversation_id = $1
      ORDER BY joined_at ASC
    `,
    [conversationId]
  );

  return result.rows.map((row) => row.user_id);
}

async function listChatBotIds(client: DbQueryable, conversationId: string): Promise<string[]> {
  const result = await client.query<{ bot_id: string }>(
    `
      SELECT bot_id
      FROM chat_bot_installs
      WHERE conversation_id = $1
      ORDER BY installed_at ASC
    `,
    [conversationId]
  );

  return result.rows.map((row) => row.bot_id);
}

async function appendSystemChatMessage(
  client: DbQueryable,
  input: {
    conversationId: string;
    text: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ id: string; createdAt: string }> {
  const messageId = createRuntimeId('chatmsg');
  const result = await client.query<{ id: string; created_at: string }>(
    `
      INSERT INTO chat_messages (
        id,
        conversation_id,
        sender_type,
        sender_user_id,
        sender_bot_id,
        body,
        metadata
      )
      VALUES ($1, $2, 'system', NULL, NULL, $3, $4::jsonb)
      RETURNING id, created_at::text
    `,
    [
      messageId,
      input.conversationId,
      input.text,
      toJsonString(input.metadata ?? {}),
    ]
  );

  return {
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at,
  };
}

function toPaymentIntentPayload(row: PaymentIntentRow) {
  return {
    id: row.id,
    userId: row.user_id,
    gatewayId: row.gateway_id,
    channel: row.channel,
    orderId: row.order_id,
    syndicateOrderId: row.syndicate_order_id,
    instrumentId: row.instrument_id,
    amountGbp: Number(row.amount_gbp),
    amountCurrency: row.amount_currency,
    status: row.status,
    providerIntentRef: row.provider_intent_ref,
    clientSecret: row.client_secret,
    providerStatus: row.provider_status,
    nextActionUrl: row.next_action_url,
    scaExpiresAt: row.sca_expires_at,
    settledAt: row.settled_at,
    failureCode: row.failure_code,
    failureMessage: row.failure_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toPayoutRequestPayload(row: PayoutRequestRow) {
  return {
    id: row.id,
    userId: row.user_id,
    payoutAccountId: row.payout_account_id,
    amountGbp: Number(row.amount_gbp),
    amountCurrency: row.amount_currency,
    status: row.status,
    providerPayoutRef: row.provider_payout_ref,
    failureReason: row.failure_reason,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function assertSettledWalletTopupIntent(
  client: DbQueryable,
  input: {
    paymentIntentId: string;
    userId: string;
    fiatAmount: number;
    fiatCurrency: string;
  }
): Promise<{ gatewayId: string }> {
  const result = await client.query<{
    id: string;
    user_id: string;
    gateway_id: string;
    channel: PaymentIntentChannel;
    status: PaymentIntentStatus;
    amount_gbp: number | string;
    amount_currency: string;
  }>(
    `
      SELECT id, user_id, gateway_id, channel, status, amount_gbp, amount_currency
      FROM payment_intents
      WHERE id = $1
      LIMIT 1
    `,
    [input.paymentIntentId]
  );

  const intent = result.rows[0];
  if (!intent) {
    throw createApiError('PAYMENT_INTENT_NOT_FOUND', 'Payment intent not found for 1ze mint');
  }

  if (intent.user_id !== input.userId) {
    throw createApiError('PAYMENT_INTENT_USER_MISMATCH', 'Payment intent does not belong to this user', {
      paymentIntentId: input.paymentIntentId,
      expectedUserId: input.userId,
      actualUserId: intent.user_id,
    });
  }

  if (intent.channel !== 'wallet_topup') {
    throw createApiError('PAYMENT_INTENT_CHANNEL_INVALID', 'Payment intent channel must be wallet_topup', {
      paymentIntentId: input.paymentIntentId,
      channel: intent.channel,
    });
  }

  if (intent.status !== 'succeeded') {
    throw createApiError('PAYMENT_INTENT_NOT_SETTLED', 'Payment intent must be succeeded before minting 1ze', {
      paymentIntentId: input.paymentIntentId,
      status: intent.status,
    });
  }

  if (intent.amount_currency.toUpperCase() !== input.fiatCurrency.toUpperCase()) {
    throw createApiError('PAYMENT_INTENT_CURRENCY_MISMATCH', 'Payment intent currency does not match mint currency', {
      paymentIntentId: input.paymentIntentId,
      intentCurrency: intent.amount_currency,
      mintCurrency: input.fiatCurrency,
    });
  }

  const intentAmount = Number(intent.amount_gbp);
  const expectedAmount = roundTo(input.fiatAmount, 2);
  const tolerance = Math.max(0.5, expectedAmount * 0.02);
  if (Math.abs(intentAmount - expectedAmount) > tolerance) {
    throw createApiError('PAYMENT_INTENT_AMOUNT_MISMATCH', 'Payment intent amount does not match mint request', {
      paymentIntentId: input.paymentIntentId,
      intentAmount,
      expectedAmount,
      tolerance,
    });
  }

  return {
    gatewayId: intent.gateway_id,
  };
}

async function assertRedeemablePayoutRequest(
  client: DbQueryable,
  input: {
    payoutRequestId: string;
    userId: string;
  }
): Promise<{ gatewayId: string; status: PayoutRequestStatus; amountCurrency: string; amountGbp: number }> {
  const result = await client.query<{
    id: string;
    user_id: string;
    status: PayoutRequestStatus;
    gateway_id: string;
    amount_currency: string;
    amount_gbp: number | string;
  }>(
    `
      SELECT pr.id, pr.user_id, pr.status, pa.gateway_id, pr.amount_currency, pr.amount_gbp
      FROM payout_requests pr
      INNER JOIN payout_accounts pa ON pa.id = pr.payout_account_id
      WHERE pr.id = $1
      LIMIT 1
    `,
    [input.payoutRequestId]
  );

  const payoutRequest = result.rows[0];
  if (!payoutRequest) {
    throw createApiError('PAYOUT_REQUEST_NOT_FOUND', 'Payout request not found for 1ze redemption');
  }

  if (payoutRequest.user_id !== input.userId) {
    throw createApiError('PAYOUT_REQUEST_USER_MISMATCH', 'Payout request does not belong to this user', {
      payoutRequestId: input.payoutRequestId,
      expectedUserId: input.userId,
      actualUserId: payoutRequest.user_id,
    });
  }

  if (payoutRequest.status === 'failed' || payoutRequest.status === 'cancelled') {
    throw createApiError('PAYOUT_REQUEST_INVALID', 'Payout request is not redeemable in its current status', {
      payoutRequestId: input.payoutRequestId,
      status: payoutRequest.status,
    });
  }

  return {
    gatewayId: payoutRequest.gateway_id,
    status: payoutRequest.status,
    amountCurrency: payoutRequest.amount_currency,
    amountGbp: Number(payoutRequest.amount_gbp),
  };
}

function canTransitionPayoutRequestStatus(
  currentStatus: PayoutRequestStatus,
  nextStatus: PayoutRequestStatus
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  if (currentStatus === 'requested') {
    return ['processing', 'paid', 'failed', 'cancelled'].includes(nextStatus);
  }

  if (currentStatus === 'processing') {
    return ['paid', 'failed', 'cancelled'].includes(nextStatus);
  }

  return false;
}

async function paymentTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.payment_gateways') IS NOT NULL
        AND to_regclass('public.payment_intents') IS NOT NULL
        AND to_regclass('public.payment_attempts') IS NOT NULL
        AND to_regclass('public.payment_webhook_events') IS NOT NULL
        AND to_regclass('public.payment_refunds') IS NOT NULL
        AND to_regclass('public.payment_disputes') IS NOT NULL
        AND to_regclass('public.payout_accounts') IS NOT NULL
        AND to_regclass('public.payout_requests') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function ledgerTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.ledger_accounts') IS NOT NULL
        AND to_regclass('public.ledger_entries') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function onezeTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.ledger_accounts') IS NOT NULL
        AND to_regclass('public.ledger_entries') IS NOT NULL
        AND to_regclass('public.payment_intents') IS NOT NULL
        AND to_regclass('public.wallet_ize_operations') IS NOT NULL
        AND to_regclass('public.gold_rate_quotes') IS NOT NULL
        AND to_regclass('public.gold_rate_overrides') IS NOT NULL
        AND to_regclass('public.gold_reserve_attestations') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function ensureLedgerAccount(
  client: DbQueryable,
  ownerType: LedgerOwnerType,
  ownerId: string,
  accountCode: LedgerAccountCode,
  currency = 'GBP'
): Promise<number> {
  const result = await client.query<{ id: number }>(
    `
      INSERT INTO ledger_accounts (owner_type, owner_id, account_code, currency)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (owner_type, owner_id, account_code, currency)
      DO UPDATE SET owner_id = EXCLUDED.owner_id
      RETURNING id
    `,
    [ownerType, ownerId, accountCode, currency]
  );

  return result.rows[0].id;
}

async function appendLedgerEntry(
  client: DbQueryable,
  input: {
    accountId: number;
    counterpartyAccountId: number;
    direction: 'debit' | 'credit';
    amountGbp?: number;
    amount?: number;
    currency?: string;
    sourceType:
      | 'order_payment'
      | 'payout'
      | 'refund'
      | 'adjustment'
      | 'mint'
      | 'burn'
      | 'syndicate_trade'
      | 'buyout'
      | 'reserve_reconcile';
    sourceId: string;
    lineType: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const normalizedCurrency = (input.currency ?? 'GBP').toUpperCase();
  const normalizedAmount =
    input.amount !== undefined
      ? input.amount
      : input.amountGbp !== undefined
        ? input.amountGbp
        : 0;
  const normalizedAmountGbp =
    input.amountGbp !== undefined
      ? input.amountGbp
      : normalizedCurrency === 'GBP'
        ? normalizedAmount
        : null;

  await client.query(
    `
      INSERT INTO ledger_entries (
        account_id,
        counterparty_account_id,
        direction,
        amount_gbp,
        amount,
        currency,
        source_type,
        source_id,
        line_type,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      input.accountId,
      input.counterpartyAccountId,
      input.direction,
      normalizedAmountGbp,
      normalizedAmount,
      normalizedCurrency,
      input.sourceType,
      input.sourceId,
      input.lineType,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function getLedgerAccountBalance(
  client: DbQueryable,
  ownerType: LedgerOwnerType,
  ownerId: string,
  accountCode: LedgerAccountCode,
  currency = 'GBP'
): Promise<number> {
  const result = await client.query<{ balance: string }>(
    `
      SELECT
        COALESCE(
          SUM(
            CASE
              WHEN le.direction = 'credit' THEN le.amount
              ELSE -le.amount
            END
          ),
          0
        )::text AS balance
      FROM ledger_entries le
      INNER JOIN ledger_accounts la
        ON la.id = le.account_id
      WHERE la.owner_type = $1
        AND la.owner_id = $2
        AND la.account_code = $3
        AND la.currency = $4
    `,
    [ownerType, ownerId, accountCode, currency.toUpperCase()]
  );

  return Number(result.rows[0]?.balance ?? '0');
}

async function getUserCumulativeWithdrawnGbp(client: DbQueryable, userId: string): Promise<number> {
  const result = await client.query<{ total: string }>(
    `
      SELECT
        COALESCE(SUM(le.amount_gbp), 0)::text AS total
      FROM ledger_entries le
      INNER JOIN ledger_accounts la
        ON la.id = le.account_id
      WHERE la.owner_type = 'user'
        AND la.owner_id = $1
        AND la.account_code = 'withdrawal_pending'
        AND le.source_type = 'payout'
        AND le.line_type = 'payout_paid'
        AND le.direction = 'debit'
    `,
    [userId]
  );

  return Number(result.rows[0]?.total ?? '0');
}

async function getPlatformIzeReserveSnapshot(client: DbQueryable): Promise<{
  outstandingIze: number;
  reserveGrams: number;
}> {
  const [outstandingIze, reserveGrams] = await Promise.all([
    getLedgerAccountBalance(client, 'platform', 'platform', 'ize_outstanding', 'IZE'),
    getLedgerAccountBalance(client, 'platform', 'platform', 'gold_reserve_grams', 'XAU'),
  ]);

  return {
    outstandingIze,
    reserveGrams,
  };
}

async function recordIzeMint(
  client: PoolClient,
  input: {
    operationId: string;
    userId: string;
    fiatAmount: number;
    fiatCurrency: string;
    izeAmount: number;
    ratePerGram: number;
    paymentIntentId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const userWalletAccountId = await ensureLedgerAccount(client, 'user', input.userId, 'ize_wallet', 'IZE');
  const platformOutstandingAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'ize_outstanding',
    'IZE'
  );
  const reserveAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'gold_reserve_grams',
    'XAU'
  );

  await appendLedgerEntry(client, {
    accountId: userWalletAccountId,
    counterpartyAccountId: platformOutstandingAccountId,
    direction: 'credit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'mint',
    sourceId: input.operationId,
    lineType: 'mint_user_credit',
    metadata: {
      userId: input.userId,
      ratePerGram: input.ratePerGram,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      ...(input.metadata ?? {}),
    },
  });

  await appendLedgerEntry(client, {
    accountId: platformOutstandingAccountId,
    counterpartyAccountId: userWalletAccountId,
    direction: 'credit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'mint',
    sourceId: input.operationId,
    lineType: 'mint_outstanding_credit',
    metadata: {
      userId: input.userId,
      ...(input.metadata ?? {}),
    },
  });

  await appendLedgerEntry(client, {
    accountId: reserveAccountId,
    counterpartyAccountId: reserveAccountId,
    direction: 'credit',
    amount: input.izeAmount,
    currency: 'XAU',
    sourceType: 'mint',
    sourceId: input.operationId,
    lineType: 'mint_reserve_credit',
    metadata: {
      userId: input.userId,
      ...(input.metadata ?? {}),
    },
  });

  await client.query(
    `
      INSERT INTO wallet_ize_operations (
        id,
        user_id,
        operation_type,
        fiat_amount,
        fiat_currency,
        ize_amount,
        rate_per_gram,
        status,
        payment_intent_id,
        metadata,
        committed_at
      )
      VALUES ($1, $2, 'mint', $3, $4, $5, $6, 'committed', $7, $8::jsonb, NOW())
    `,
    [
      input.operationId,
      input.userId,
      input.fiatAmount,
      input.fiatCurrency,
      input.izeAmount,
      input.ratePerGram,
      input.paymentIntentId ?? null,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function recordIzeBurn(
  client: PoolClient,
  input: {
    operationId: string;
    userId: string;
    fiatAmount: number;
    fiatCurrency: string;
    izeAmount: number;
    ratePerGram: number;
    payoutRequestId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const availableIze = await getLedgerAccountBalance(client, 'user', input.userId, 'ize_wallet', 'IZE');
  if (input.izeAmount > availableIze + 1e-8) {
    throw createApiError('IZE_INSUFFICIENT_BALANCE', 'Insufficient 1ze balance for burn', {
      availableIze,
      requestedIze: input.izeAmount,
    });
  }

  const userWalletAccountId = await ensureLedgerAccount(client, 'user', input.userId, 'ize_wallet', 'IZE');
  const platformOutstandingAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'ize_outstanding',
    'IZE'
  );
  const reserveAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'gold_reserve_grams',
    'XAU'
  );

  await appendLedgerEntry(client, {
    accountId: userWalletAccountId,
    counterpartyAccountId: platformOutstandingAccountId,
    direction: 'debit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'burn',
    sourceId: input.operationId,
    lineType: 'burn_user_debit',
    metadata: {
      userId: input.userId,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      ...(input.metadata ?? {}),
    },
  });

  await appendLedgerEntry(client, {
    accountId: platformOutstandingAccountId,
    counterpartyAccountId: userWalletAccountId,
    direction: 'debit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'burn',
    sourceId: input.operationId,
    lineType: 'burn_outstanding_debit',
    metadata: {
      userId: input.userId,
      ...(input.metadata ?? {}),
    },
  });

  await appendLedgerEntry(client, {
    accountId: reserveAccountId,
    counterpartyAccountId: reserveAccountId,
    direction: 'debit',
    amount: input.izeAmount,
    currency: 'XAU',
    sourceType: 'burn',
    sourceId: input.operationId,
    lineType: 'burn_reserve_debit',
    metadata: {
      userId: input.userId,
      ...(input.metadata ?? {}),
    },
  });

  await client.query(
    `
      INSERT INTO wallet_ize_operations (
        id,
        user_id,
        operation_type,
        fiat_amount,
        fiat_currency,
        ize_amount,
        rate_per_gram,
        status,
        payout_request_id,
        metadata,
        committed_at
      )
      VALUES ($1, $2, 'burn', $3, $4, $5, $6, 'committed', $7, $8::jsonb, NOW())
    `,
    [
      input.operationId,
      input.userId,
      input.fiatAmount,
      input.fiatCurrency,
      input.izeAmount,
      input.ratePerGram,
      input.payoutRequestId ?? null,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function postCommerceOrderLedgerEntries(
  client: DbQueryable,
  input: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    subtotalGbp: number;
    platformChargeGbp: number;
    totalGbp: number;
  }
): Promise<void> {
  const totalGbp = roundTo(input.totalGbp, 2);
  const subtotalGbp = roundTo(input.subtotalGbp, 2);
  const platformChargeGbp = roundTo(input.platformChargeGbp, 2);

  if (totalGbp <= 0) {
    return;
  }

  const buyerSpendAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.buyerId,
    'buyer_spend'
  );
  const sellerPayableAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.sellerId,
    'ize_wallet',
    'IZE'
  );
  const escrowAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'escrow_liability'
  );
  const platformRevenueAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'platform_revenue'
  );

  await appendLedgerEntry(client, {
    accountId: buyerSpendAccountId,
    counterpartyAccountId: escrowAccountId,
    direction: 'debit',
    amountGbp: totalGbp,
    sourceType: 'order_payment',
    sourceId: input.orderId,
    lineType: 'buyer_charge',
    metadata: {
      buyerId: input.buyerId,
      sellerId: input.sellerId,
    },
  });

  await appendLedgerEntry(client, {
    accountId: escrowAccountId,
    counterpartyAccountId: buyerSpendAccountId,
    direction: 'credit',
    amountGbp: totalGbp,
    sourceType: 'order_payment',
    sourceId: input.orderId,
    lineType: 'buyer_charge',
    metadata: {
      buyerId: input.buyerId,
      sellerId: input.sellerId,
    },
  });

  if (subtotalGbp > 0) {
    await appendLedgerEntry(client, {
      accountId: escrowAccountId,
      counterpartyAccountId: sellerPayableAccountId,
      direction: 'debit',
      amountGbp: subtotalGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'seller_payable_credit',
      metadata: {
        sellerId: input.sellerId,
      },
    });

    await appendLedgerEntry(client, {
      accountId: sellerPayableAccountId,
      counterpartyAccountId: escrowAccountId,
      direction: 'credit',
      amountGbp: subtotalGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'seller_payable_credit',
      metadata: {
        sellerId: input.sellerId,
      },
    });
  }

  if (platformChargeGbp > 0) {
    await appendLedgerEntry(client, {
      accountId: escrowAccountId,
      counterpartyAccountId: platformRevenueAccountId,
      direction: 'debit',
      amountGbp: platformChargeGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'platform_commission_credit',
      metadata: {
        component: 'platform_charge',
      },
    });

    await appendLedgerEntry(client, {
      accountId: platformRevenueAccountId,
      counterpartyAccountId: escrowAccountId,
      direction: 'credit',
      amountGbp: platformChargeGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'platform_commission_credit',
      metadata: {
        component: 'platform_charge',
      },
    });
  }
}

async function postAuctionSettlementLedgerEntries(
  client: DbQueryable,
  input: {
    auctionId: string;
    buyerId: string;
    sellerId: string;
    winningBidGbp: number;
    platformFeeGbp: number;
  }
): Promise<void> {
  const winningBidGbp = roundTo(Math.max(0, input.winningBidGbp), 2);
  const platformFeeGbp = roundTo(Math.max(0, input.platformFeeGbp), 2);
  if (winningBidGbp <= 0) {
    return;
  }

  const sellerNetGbp = roundTo(Math.max(0, winningBidGbp - platformFeeGbp), 2);
  const sourceId = `auction:${input.auctionId}`;

  const buyerSpendAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.buyerId,
    'buyer_spend'
  );
  const sellerPayableAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.sellerId,
    'ize_wallet',
    'IZE'
  );
  const escrowAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'escrow_liability'
  );
  const platformRevenueAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'platform_revenue'
  );

  await appendLedgerEntry(client, {
    accountId: buyerSpendAccountId,
    counterpartyAccountId: escrowAccountId,
    direction: 'debit',
    amountGbp: winningBidGbp,
    sourceType: 'order_payment',
    sourceId,
    lineType: 'auction_buyer_charge',
    metadata: {
      auctionId: input.auctionId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
    },
  });

  await appendLedgerEntry(client, {
    accountId: escrowAccountId,
    counterpartyAccountId: buyerSpendAccountId,
    direction: 'credit',
    amountGbp: winningBidGbp,
    sourceType: 'order_payment',
    sourceId,
    lineType: 'auction_buyer_charge',
    metadata: {
      auctionId: input.auctionId,
      buyerId: input.buyerId,
      sellerId: input.sellerId,
    },
  });

  if (sellerNetGbp > 0) {
    await appendLedgerEntry(client, {
      accountId: escrowAccountId,
      counterpartyAccountId: sellerPayableAccountId,
      direction: 'debit',
      amountGbp: sellerNetGbp,
      sourceType: 'order_payment',
      sourceId,
      lineType: 'auction_seller_payable_credit',
      metadata: {
        auctionId: input.auctionId,
        sellerId: input.sellerId,
      },
    });

    await appendLedgerEntry(client, {
      accountId: sellerPayableAccountId,
      counterpartyAccountId: escrowAccountId,
      direction: 'credit',
      amountGbp: sellerNetGbp,
      sourceType: 'order_payment',
      sourceId,
      lineType: 'auction_seller_payable_credit',
      metadata: {
        auctionId: input.auctionId,
        sellerId: input.sellerId,
      },
    });
  }

  if (platformFeeGbp > 0) {
    await appendLedgerEntry(client, {
      accountId: escrowAccountId,
      counterpartyAccountId: platformRevenueAccountId,
      direction: 'debit',
      amountGbp: platformFeeGbp,
      sourceType: 'order_payment',
      sourceId,
      lineType: 'auction_platform_fee_credit',
      metadata: {
        component: 'auction_platform_charge',
      },
    });

    await appendLedgerEntry(client, {
      accountId: platformRevenueAccountId,
      counterpartyAccountId: escrowAccountId,
      direction: 'credit',
      amountGbp: platformFeeGbp,
      sourceType: 'order_payment',
      sourceId,
      lineType: 'auction_platform_fee_credit',
      metadata: {
        component: 'auction_platform_charge',
      },
    });
  }
}

function toStripeMetadata(metadata: Record<string, unknown>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
      continue;
    }

    next[key] = toJsonString(value);
  }

  return next;
}

function mapStripePaymentIntentStatus(status: Stripe.PaymentIntent.Status): PaymentIntentStatus {
  switch (status) {
    case 'requires_payment_method':
      return 'requires_payment_method';
    case 'requires_confirmation':
      return 'requires_confirmation';
    case 'requires_action':
      return 'requires_confirmation';
    case 'processing':
      return 'processing';
    case 'succeeded':
      return 'succeeded';
    case 'canceled':
      return 'cancelled';
    default:
      return 'processing';
  }
}

function mapMolliePaymentStatus(status?: string): PaymentIntentStatus {
  if (!status) {
    return 'requires_confirmation';
  }

  if (status === 'paid') {
    return 'succeeded';
  }

  if (status === 'failed' || status === 'expired') {
    return 'failed';
  }

  if (status === 'canceled') {
    return 'cancelled';
  }

  if (status === 'open' || status === 'pending') {
    return 'processing';
  }

  return 'requires_confirmation';
}

function resolveDefaultGatewayForChannel(channel: PaymentIntentChannel): string {
  if (channel === 'syndicate') {
    return 'stripe_americas';
  }

  if (channel === 'wallet_topup' || channel === 'wallet_withdrawal') {
    return 'stripe_americas';
  }

  return 'stripe_americas';
}

async function createGatewayPaymentIntent(input: {
  gatewayId: string;
  intentId: string;
  channel: PaymentIntentChannel;
  amountGbp: number;
  amountCurrency: string;
  metadata: Record<string, unknown>;
  returnUrl?: string;
  webhookUrl?: string;
}): Promise<{
  providerIntentRef: string;
  clientSecret: string | null;
  initialStatus: PaymentIntentStatus;
  providerStatus?: string | null;
  nextActionUrl?: string | null;
  scaExpiresAt?: string | null;
}> {
  const normalizedCurrency = input.amountCurrency.toUpperCase();
  const baseMetadata = {
    ...input.metadata,
    intentId: input.intentId,
    channel: input.channel,
  };

  if (input.gatewayId === 'stripe_americas' && config.stripeSecretKey) {
    const stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: '2024-06-20',
    });

    const created = await stripe.paymentIntents.create({
      amount: Math.max(1, Math.round(input.amountGbp * 100)),
      currency: normalizedCurrency.toLowerCase(),
      automatic_payment_methods: { enabled: true },
      confirmation_method: 'manual',
      metadata: toStripeMetadata(baseMetadata),
    });

    return {
      providerIntentRef: created.id,
      clientSecret: created.client_secret,
      initialStatus: mapStripePaymentIntentStatus(created.status),
      providerStatus: created.status,
      nextActionUrl:
        created.next_action && created.next_action.type === 'redirect_to_url'
          ? created.next_action.redirect_to_url?.url ?? null
          : null,
      scaExpiresAt:
        created.next_action && created.next_action.type === 'redirect_to_url'
          ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
          : null,
    };
  }

  if (input.gatewayId === 'razorpay_in' && config.razorpayKeyId && config.razorpayKeySecret) {
    const razorpay = new Razorpay({
      key_id: config.razorpayKeyId,
      key_secret: config.razorpayKeySecret,
    });

    const order = await razorpay.orders.create({
      amount: Math.max(1, Math.round(input.amountGbp * 100)),
      currency: normalizedCurrency,
      receipt: input.intentId.slice(0, 40),
      notes: toStripeMetadata(baseMetadata),
    });

    return {
      providerIntentRef: String((order as { id?: unknown }).id ?? createRuntimeId('rzp')),
      clientSecret: null,
      initialStatus: 'requires_confirmation',
      providerStatus: String((order as { status?: unknown }).status ?? 'created'),
      nextActionUrl: null,
      scaExpiresAt: null,
    };
  }

  if (input.gatewayId === 'mollie_eu' && config.mollieApiKey) {
    const { createMollieClient } = await import('@mollie/api-client');
    const mollie = createMollieClient({ apiKey: config.mollieApiKey });
    const created = await mollie.payments.create({
      amount: {
        currency: normalizedCurrency,
        value: input.amountGbp.toFixed(2),
      },
      description: `Thryftverse ${input.channel} ${input.intentId}`,
      redirectUrl: input.returnUrl ?? 'https://thryftverse.app/payments/return',
      webhookUrl: input.webhookUrl ?? 'https://thryftverse.app/webhooks/mollie',
      metadata: toStripeMetadata(baseMetadata),
    });

    const checkoutUrl =
      typeof (created as unknown as { getCheckoutUrl?: unknown }).getCheckoutUrl === 'function'
        ? (created as unknown as { getCheckoutUrl: () => string }).getCheckoutUrl()
        : null;

    return {
      providerIntentRef: created.id,
      clientSecret: null,
      initialStatus: mapMolliePaymentStatus(created.status),
      providerStatus: created.status,
      nextActionUrl: checkoutUrl,
      scaExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  if (input.gatewayId === 'flutterwave_africa' && config.flutterwaveSecretKey) {
    const txRef = `${input.intentId}`;
    const response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.flutterwaveSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: toJsonString({
        tx_ref: txRef,
        amount: Number(input.amountGbp.toFixed(2)),
        currency: normalizedCurrency,
        redirect_url: input.returnUrl ?? 'https://thryftverse.app/payments/return',
        customer: {
          email: 'payments@thryftverse.app',
        },
        customizations: {
          title: 'Thryftverse Payment',
        },
        meta: toStripeMetadata(baseMetadata),
      }),
    });

    const payload = response.ok ? ((await response.json()) as Record<string, unknown>) : {};
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const checkoutUrl = typeof data.link === 'string' ? data.link : null;

    return {
      providerIntentRef: txRef,
      clientSecret: null,
      initialStatus: 'requires_confirmation',
      providerStatus: response.ok ? 'created' : 'fallback_created',
      nextActionUrl: checkoutUrl,
      scaExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  if (input.gatewayId === 'tap_gulf' && config.tapSecretKey) {
    const response = await fetch('https://api.tap.company/v2/charges', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.tapSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: toJsonString({
        amount: Number(input.amountGbp.toFixed(2)),
        currency: normalizedCurrency,
        source: {
          id: 'src_all',
        },
        redirect: {
          url: input.returnUrl ?? 'https://thryftverse.app/payments/return',
        },
        metadata: toStripeMetadata(baseMetadata),
      }),
    });

    const payload = response.ok ? ((await response.json()) as Record<string, unknown>) : {};
    const chargeId = typeof payload.id === 'string' ? payload.id : createRuntimeId('tap_charge');
    const transaction = (payload.transaction ?? {}) as Record<string, unknown>;
    const checkoutUrl = typeof transaction.url === 'string' ? transaction.url : null;

    return {
      providerIntentRef: chargeId,
      clientSecret: null,
      initialStatus: 'requires_confirmation',
      providerStatus: response.ok ? String(payload.status ?? 'initiated') : 'fallback_created',
      nextActionUrl: checkoutUrl,
      scaExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  const fallbackRef = createRuntimeId(`intent_${input.gatewayId}`);
  return {
    providerIntentRef: fallbackRef,
    clientSecret: createRuntimeId('secret'),
    initialStatus: 'requires_confirmation',
    providerStatus: 'mock_created',
    nextActionUrl: null,
    scaExpiresAt: null,
  };
}

async function settlePaymentIntent(
  client: PoolClient,
  input: {
    intentId: string;
    finalStatus: PaymentIntentTerminalStatus;
    providerAttemptRef?: string;
    providerFeeGbp?: number;
    failureCode?: string;
    failureMessage?: string;
    rawPayload?: unknown;
  }
): Promise<{
  intent: ReturnType<typeof toPaymentIntentPayload>;
  alreadyFinal: boolean;
  orderSettlement?: {
    orderId: string;
    buyerChargedGbp: number;
    sellerPayableCreditedGbp: number;
    platformCommissionCreditedGbp: number;
    platformChargeCreditedGbp: number;
  };
}> {
  const intentResult = await client.query<PaymentIntentRow>(
    `
      SELECT
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      FROM payment_intents
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [input.intentId]
  );

  const currentIntent = intentResult.rows[0];
  if (!currentIntent) {
    throw new Error('PAYMENT_INTENT_NOT_FOUND');
  }

  const isTerminal = ['succeeded', 'failed', 'cancelled'].includes(currentIntent.status);
  if (isTerminal) {
    return {
      intent: toPaymentIntentPayload(currentIntent),
      alreadyFinal: true,
    };
  }

  const nextStatus: PaymentIntentStatus = input.finalStatus;
  const providerFeeGbp = roundTo(Math.max(0, input.providerFeeGbp ?? 0), 2);
  const attemptRef = input.providerAttemptRef ?? createRuntimeId('attempt');
  const attemptStatus =
    nextStatus === 'succeeded' ? 'succeeded' : nextStatus === 'cancelled' ? 'cancelled' : 'failed';

  await client.query(
    `
      INSERT INTO payment_attempts (
        intent_id,
        gateway_id,
        status,
        amount_gbp,
        provider_fee_gbp,
        provider_attempt_ref,
        raw_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      ON CONFLICT (gateway_id, provider_attempt_ref)
      DO NOTHING
    `,
    [
      currentIntent.id,
      currentIntent.gateway_id,
      attemptStatus,
      Number(currentIntent.amount_gbp),
      providerFeeGbp,
      attemptRef,
      toJsonString(input.rawPayload ?? {}),
    ]
  );

  const updatedIntentResult = await client.query<PaymentIntentRow>(
    `
      UPDATE payment_intents
      SET
        status = $2,
        failure_code = $3,
        failure_message = $4,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
    `,
    [
      currentIntent.id,
      nextStatus,
      nextStatus === 'failed' ? input.failureCode ?? 'payment_failed' : null,
      nextStatus === 'failed' ? input.failureMessage ?? 'Payment failed' : null,
    ]
  );

  const updatedIntent = updatedIntentResult.rows[0];
  if (!updatedIntent) {
    throw new Error('PAYMENT_INTENT_UPDATE_FAILED');
  }

  recordPaymentTransition({
    from: currentIntent.status,
    to: nextStatus,
    gateway: currentIntent.gateway_id,
    channel: currentIntent.channel,
  });

  let orderSettlement:
    | {
        orderId: string;
        buyerChargedGbp: number;
        sellerPayableCreditedGbp: number;
        platformCommissionCreditedGbp: number;
        platformChargeCreditedGbp: number;
      }
    | undefined;

  if (nextStatus === 'succeeded' && updatedIntent.channel === 'commerce' && updatedIntent.order_id) {
    const paidOrderResult = await client.query<{
      id: string;
      buyer_id: string;
      seller_id: string;
      subtotal_gbp: number | string;
      buyer_protection_fee_gbp: number | string;
      total_gbp: number | string;
    }>(
      `
        UPDATE orders
        SET status = 'paid', updated_at = NOW()
        WHERE id = $1 AND status = 'created'
        RETURNING
          id,
          buyer_id,
          seller_id,
          subtotal_gbp,
          buyer_protection_fee_gbp,
          total_gbp
      `,
      [updatedIntent.order_id]
    );

    const paidOrder = paidOrderResult.rows[0];
    if (paidOrder) {
      if (await ledgerTablesAvailable(client)) {
        await postCommerceOrderLedgerEntries(client, {
          orderId: paidOrder.id,
          buyerId: paidOrder.buyer_id,
          sellerId: paidOrder.seller_id,
          subtotalGbp: Number(paidOrder.subtotal_gbp),
          platformChargeGbp: Number(paidOrder.buyer_protection_fee_gbp),
          totalGbp: Number(paidOrder.total_gbp),
        });
      }

      const platformChargeCreditedGbp = Number(paidOrder.buyer_protection_fee_gbp);
      orderSettlement = {
        orderId: paidOrder.id,
        buyerChargedGbp: Number(paidOrder.total_gbp),
        sellerPayableCreditedGbp: Number(paidOrder.subtotal_gbp),
        platformCommissionCreditedGbp: platformChargeCreditedGbp,
        platformChargeCreditedGbp,
      };
    }
  }

  return {
    intent: toPaymentIntentPayload(updatedIntent),
    alreadyFinal: false,
    orderSettlement,
  };
}

async function transitionPaymentIntentStatus(
  client: PoolClient,
  input: {
    intentId: string;
    nextStatus: PaymentIntentStatus;
    providerStatus?: string | null;
    nextActionUrl?: string | null;
    scaExpiresAt?: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    metadataPatch?: Record<string, unknown>;
  }
): Promise<{
  intent: ReturnType<typeof toPaymentIntentPayload>;
  fromStatus: PaymentIntentStatus;
  idempotent: boolean;
}> {
  const result = await client.query<PaymentIntentRow>(
    `
      SELECT
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      FROM payment_intents
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [input.intentId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('PAYMENT_INTENT_NOT_FOUND');
  }

  const fromStatus = row.status;
  if (fromStatus === input.nextStatus) {
    return {
      intent: toPaymentIntentPayload(row),
      fromStatus,
      idempotent: true,
    };
  }

  const terminalStates: PaymentIntentStatus[] = ['succeeded', 'failed', 'cancelled'];
  if (terminalStates.includes(fromStatus)) {
    return {
      intent: toPaymentIntentPayload(row),
      fromStatus,
      idempotent: true,
    };
  }

  const allowedTransitions: Record<PaymentIntentStatus, PaymentIntentStatus[]> = {
    requires_payment_method: ['requires_confirmation', 'cancelled'],
    requires_confirmation: ['processing', 'succeeded', 'failed', 'cancelled'],
    processing: ['succeeded', 'failed', 'cancelled'],
    succeeded: [],
    failed: [],
    cancelled: [],
  };

  if (!allowedTransitions[fromStatus].includes(input.nextStatus)) {
    throw createApiError(
      'PAYMENT_INTENT_INVALID_TRANSITION',
      `Payment intent cannot transition from '${fromStatus}' to '${input.nextStatus}'`
    );
  }

  const updated = await client.query<PaymentIntentRow>(
    `
      UPDATE payment_intents
      SET
        status = $2,
        provider_status = COALESCE($3, provider_status),
        next_action_url = $4,
        sca_expires_at = $5,
        failure_code = $6,
        failure_message = $7,
        settled_at = CASE
          WHEN $2 IN ('succeeded', 'failed', 'cancelled') THEN NOW()
          ELSE settled_at
        END,
        metadata = COALESCE(metadata, '{}'::jsonb) || $8::jsonb,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
    `,
    [
      input.intentId,
      input.nextStatus,
      input.providerStatus ?? null,
      input.nextActionUrl ?? null,
      input.scaExpiresAt ?? null,
      input.failureCode ?? null,
      input.failureMessage ?? null,
      toJsonString(input.metadataPatch ?? {}),
    ]
  );

  recordPaymentTransition({
    from: fromStatus,
    to: input.nextStatus,
    gateway: row.gateway_id,
    channel: row.channel,
  });

  return {
    intent: toPaymentIntentPayload(updated.rows[0]),
    fromStatus,
    idempotent: false,
  };
}

async function findPaymentIntentByProviderRef(
  client: PoolClient,
  gatewayId: string,
  providerIntentRef: string
): Promise<PaymentIntentRow | null> {
  const result = await client.query<PaymentIntentRow>(
    `
      SELECT
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      FROM payment_intents
      WHERE gateway_id = $1
        AND provider_intent_ref = $2
      LIMIT 1
    `,
    [gatewayId, providerIntentRef]
  );

  return result.rows[0] ?? null;
}

async function upsertPaymentRefund(
  client: PoolClient,
  input: {
    intentId: string;
    gatewayId: string;
    providerRefundRef: string;
    status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
    amount?: number;
    currency?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const id = `rf_${input.gatewayId}_${input.providerRefundRef}`;
  await client.query(
    `
      INSERT INTO payment_refunds (
        id,
        intent_id,
        gateway_id,
        amount,
        currency,
        status,
        provider_refund_ref,
        reason,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (gateway_id, provider_refund_ref)
      DO UPDATE
        SET
          status = EXCLUDED.status,
          reason = EXCLUDED.reason,
          metadata = payment_refunds.metadata || EXCLUDED.metadata,
          updated_at = NOW()
    `,
    [
      id,
      input.intentId,
      input.gatewayId,
      input.amount ?? 0,
      (input.currency ?? 'GBP').toUpperCase(),
      input.status,
      input.providerRefundRef,
      input.reason ?? null,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function upsertPaymentDispute(
  client: PoolClient,
  input: {
    intentId?: string;
    gatewayId: string;
    providerDisputeRef: string;
    status: 'open' | 'warning' | 'needs_response' | 'won' | 'lost' | 'closed';
    amount?: number;
    currency?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  const id = `dp_${input.gatewayId}_${input.providerDisputeRef}`;
  await client.query(
    `
      INSERT INTO payment_disputes (
        id,
        intent_id,
        gateway_id,
        provider_dispute_ref,
        status,
        amount,
        currency,
        reason,
        metadata,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (gateway_id, provider_dispute_ref)
      DO UPDATE
        SET
          status = EXCLUDED.status,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          reason = EXCLUDED.reason,
          metadata = payment_disputes.metadata || EXCLUDED.metadata,
          updated_at = NOW()
    `,
    [
      id,
      input.intentId ?? null,
      input.gatewayId,
      input.providerDisputeRef,
      input.status,
      input.amount ?? 0,
      (input.currency ?? 'GBP').toUpperCase(),
      input.reason ?? null,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function settlePayoutRequest(
  client: PoolClient,
  input: {
    userId: string;
    requestId: string;
    targetStatus: Exclude<PayoutRequestStatus, 'requested'>;
    providerPayoutRef?: string;
    failureReason?: string;
    metadata?: Record<string, unknown>;
    source?: string;
  }
): Promise<{
  payoutRequest: ReturnType<typeof toPayoutRequestPayload>;
  idempotent: boolean;
  fromStatus: PayoutRequestStatus;
}> {
  const payoutRequestResult = await client.query<PayoutRequestRow>(
    `
      SELECT
        id,
        user_id,
        payout_account_id,
        amount_gbp,
        amount_currency,
        status,
        provider_payout_ref,
        failure_reason,
        metadata,
        created_at,
        updated_at
      FROM payout_requests
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [input.requestId, input.userId]
  );

  const payoutRequest = payoutRequestResult.rows[0];
  if (!payoutRequest) {
    throw createApiError('PAYOUT_REQUEST_NOT_FOUND', 'Payout request not found');
  }

  if (payoutRequest.status === input.targetStatus) {
    return {
      payoutRequest: toPayoutRequestPayload(payoutRequest),
      idempotent: true,
      fromStatus: payoutRequest.status,
    };
  }

  if (!canTransitionPayoutRequestStatus(payoutRequest.status, input.targetStatus)) {
    throw createApiError(
      'PAYOUT_INVALID_TRANSITION',
      `Payout request cannot transition from '${payoutRequest.status}' to '${input.targetStatus}'`
    );
  }

  const amountGbp = roundTo(Number(payoutRequest.amount_gbp), 2);

  if (await ledgerTablesAvailable(client)) {
    if (input.targetStatus === 'paid') {
      const withdrawalPendingBalance = await getLedgerAccountBalance(
        client,
        'user',
        input.userId,
        'withdrawal_pending'
      );

      if (amountGbp > withdrawalPendingBalance + 1e-6) {
        throw createApiError(
          'PAYOUT_PENDING_INSUFFICIENT',
          'Insufficient withdrawal pending balance to complete payout',
          {
            withdrawalPendingGbp: withdrawalPendingBalance,
          }
        );
      }

      const withdrawalPendingAccountId = await ensureLedgerAccount(
        client,
        'user',
        input.userId,
        'withdrawal_pending'
      );
      const withdrawableBalanceAccountId = await ensureLedgerAccount(
        client,
        'user',
        input.userId,
        'withdrawable_balance'
      );

      await appendLedgerEntry(client, {
        accountId: withdrawalPendingAccountId,
        counterpartyAccountId: withdrawableBalanceAccountId,
        direction: 'debit',
        amountGbp,
        sourceType: 'payout',
        sourceId: input.requestId,
        lineType: 'payout_paid',
        metadata: {
          fromStatus: payoutRequest.status,
          toStatus: input.targetStatus,
          source: input.source ?? 'manual_status',
        },
      });

      await appendLedgerEntry(client, {
        accountId: withdrawableBalanceAccountId,
        counterpartyAccountId: withdrawalPendingAccountId,
        direction: 'credit',
        amountGbp,
        sourceType: 'payout',
        sourceId: input.requestId,
        lineType: 'payout_paid',
        metadata: {
          fromStatus: payoutRequest.status,
          toStatus: input.targetStatus,
          source: input.source ?? 'manual_status',
        },
      });
    } else if (input.targetStatus === 'failed' || input.targetStatus === 'cancelled') {
      const withdrawalPendingBalance = await getLedgerAccountBalance(
        client,
        'user',
        input.userId,
        'withdrawal_pending'
      );

      if (amountGbp > withdrawalPendingBalance + 1e-6) {
        throw createApiError(
          'PAYOUT_PENDING_INSUFFICIENT',
          'Insufficient withdrawal pending balance to reverse payout',
          {
            withdrawalPendingGbp: withdrawalPendingBalance,
          }
        );
      }

      const withdrawalPendingAccountId = await ensureLedgerAccount(
        client,
        'user',
        input.userId,
        'withdrawal_pending'
      );
      const sellerPayableAccountId = await ensureLedgerAccount(
        client,
        'user',
        input.userId,
        'seller_payable'
      );

      await appendLedgerEntry(client, {
        accountId: withdrawalPendingAccountId,
        counterpartyAccountId: sellerPayableAccountId,
        direction: 'debit',
        amountGbp,
        sourceType: 'payout',
        sourceId: input.requestId,
        lineType: 'payout_reversed',
        metadata: {
          fromStatus: payoutRequest.status,
          toStatus: input.targetStatus,
          source: input.source ?? 'manual_status',
        },
      });

      await appendLedgerEntry(client, {
        accountId: sellerPayableAccountId,
        counterpartyAccountId: withdrawalPendingAccountId,
        direction: 'credit',
        amountGbp,
        sourceType: 'payout',
        sourceId: input.requestId,
        lineType: 'payout_reversed',
        metadata: {
          fromStatus: payoutRequest.status,
          toStatus: input.targetStatus,
          source: input.source ?? 'manual_status',
        },
      });
    }
  }

  const mergedMetadata = {
    ...(payoutRequest.metadata ?? {}),
    ...(input.metadata ?? {}),
    statusTransition: {
      from: payoutRequest.status,
      to: input.targetStatus,
      source: input.source ?? 'manual_status',
      at: new Date().toISOString(),
    },
  };

  const providerPayoutRef =
    input.targetStatus === 'paid'
      ? input.providerPayoutRef ?? payoutRequest.provider_payout_ref ?? createRuntimeId('mock_payout')
      : payoutRequest.provider_payout_ref;

  const failureReason =
    input.targetStatus === 'failed'
      ? input.failureReason ?? 'Payout failed'
      : input.targetStatus === 'cancelled'
        ? input.failureReason ?? 'Payout cancelled'
        : null;

  const updated = await client.query<PayoutRequestRow>(
    `
      UPDATE payout_requests
      SET
        status = $3,
        provider_payout_ref = $4,
        failure_reason = $5,
        metadata = $6::jsonb,
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
      RETURNING
        id,
        user_id,
        payout_account_id,
        amount_gbp,
        amount_currency,
        status,
        provider_payout_ref,
        failure_reason,
        metadata,
        created_at,
        updated_at
    `,
    [
      input.requestId,
      input.userId,
      input.targetStatus,
      providerPayoutRef,
      failureReason,
      toJsonString(mergedMetadata),
    ]
  );

  return {
    payoutRequest: toPayoutRequestPayload(updated.rows[0]),
    idempotent: false,
    fromStatus: payoutRequest.status,
  };
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

async function queueUserNotification(input: {
  userId: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const eventId = createRuntimeId('notif');

  await db.query(
    `
      INSERT INTO notification_events (
        id,
        user_id,
        channel,
        title,
        body,
        payload,
        status,
        metadata
      )
      VALUES ($1, $2, 'push', $3, $4, $5::jsonb, 'queued', $6::jsonb)
    `,
    [
      eventId,
      input.userId,
      input.title,
      input.body,
      toJsonString(input.payload ?? {}),
      toJsonString(input.metadata ?? {}),
    ]
  );

  await enqueuePushNotificationJob({
    eventId,
    userId: input.userId,
    title: input.title,
    body: input.body,
    payload: input.payload,
  });

  recordPushDelivery({
    provider: 'expo',
    status: 'queued',
  });

  publishRealtimeEvent({
    topic: `notifications.user:${input.userId}`,
    type: 'notification.queued',
    userId: input.userId,
    payload: {
      id: eventId,
      title: input.title,
      body: input.body,
      ...input.payload,
    },
  });

  return eventId;
}

async function processPushQueueJob(job: {
  eventId: string;
  userId: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const devicesResult = await db.query<{
    token: string;
    provider: string;
    platform: string;
  }>(
    `
      SELECT token, provider, platform
      FROM notification_devices
      WHERE user_id = $1
        AND is_active = TRUE
      ORDER BY last_seen_at DESC
    `,
    [job.userId]
  );

  if (!devicesResult.rowCount) {
    await db.query(
      `
        UPDATE notification_events
        SET
          status = 'failed',
          provider_error = $2,
          metadata = metadata || $3::jsonb
        WHERE id = $1
      `,
      [job.eventId, 'no_active_device', toJsonString({ reason: 'No active device token' })]
    );

    recordPushDelivery({ provider: 'expo', status: 'failed' });
    return;
  }

  const expoResponses: Array<Record<string, unknown>> = [];
  let deliveredCount = 0;

  for (const device of devicesResult.rows) {
    try {
      const response = await fetch(config.expoPushApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: toJsonString({
          to: device.token,
          title: job.title,
          body: job.body,
          channelId: config.pushDefaultChannel,
          data: {
            ...(job.payload ?? {}),
            eventId: job.eventId,
          },
        }),
      });

      const payload = response.ok
        ? (await response.json() as Record<string, unknown>)
        : { error: `http_${response.status}` };

      expoResponses.push({
        token: device.token,
        provider: device.provider,
        platform: device.platform,
        response: payload,
        ok: response.ok,
      });

      if (response.ok) {
        deliveredCount += 1;
      }
    } catch (error) {
      expoResponses.push({
        token: device.token,
        provider: device.provider,
        platform: device.platform,
        ok: false,
        error: (error as Error).message,
      });
    }
  }

  const status = deliveredCount > 0 ? 'sent' : 'failed';

  await db.query(
    `
      UPDATE notification_events
      SET
        status = $2,
        sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
        provider_message_id = COALESCE(provider_message_id, $3),
        provider_error = CASE WHEN $2 = 'failed' THEN $4 ELSE NULL END,
        metadata = metadata || $5::jsonb
      WHERE id = $1
    `,
    [
      job.eventId,
      status,
      deliveredCount > 0 ? `expo:${job.eventId}` : null,
      deliveredCount > 0 ? null : 'delivery_failed',
      toJsonString({
        providerResponses: expoResponses,
      }),
    ]
  );

  recordPushDelivery({
    provider: 'expo',
    status: deliveredCount > 0 ? 'sent' : 'failed',
  });

  publishRealtimeEvent({
    topic: `notifications.user:${job.userId}`,
    type: deliveredCount > 0 ? 'notification.sent' : 'notification.failed',
    userId: job.userId,
    payload: {
      id: job.eventId,
      title: job.title,
      body: job.body,
      deliveredCount,
    },
  });
}

async function sweepExpiredAuctions(reason: 'interval' | 'manual'): Promise<number> {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const expiring = await client.query<{
      id: string;
      listing_id: string;
      seller_id: string;
      title: string;
    }>(
      `
        SELECT a.id, a.listing_id, a.seller_id, l.title
        FROM auctions a
        INNER JOIN listings l ON l.id = a.listing_id
        WHERE a.ends_at <= NOW()
          AND (a.status <> 'ended' OR a.settled_at IS NULL)
        ORDER BY a.ends_at ASC
        FOR UPDATE SKIP LOCKED
      `
    );

    if (!expiring.rowCount) {
      await client.query('COMMIT');
      recordAuctionSettlement('no_action');
      return 0;
    }

    const canPostAuctionLedger = await ledgerTablesAvailable(client);

    for (const auction of expiring.rows) {
      const winner = await client.query<{
        id: number;
        bidder_id: string;
        amount_gbp: string;
      }>(
        `
          SELECT id, bidder_id, amount_gbp::text
          FROM auction_bids
          WHERE auction_id = $1
          ORDER BY amount_gbp DESC, created_at ASC, id ASC
          LIMIT 1
        `,
        [auction.id]
      );

      const topBid = winner.rows[0];
      const winningBidGbp = topBid ? Number(topBid.amount_gbp) : 0;
      const platformFeeGbp = topBid ? calculateAuctionPlatformFeeGbp(winningBidGbp) : 0;
      const sellerNetGbp = topBid ? roundTo(Math.max(0, winningBidGbp - platformFeeGbp), 2) : 0;

      await client.query(
        `
          UPDATE auctions
          SET
            status = 'ended',
            settled_at = NOW(),
            winner_bid_id = $2,
            winner_bidder_id = $3,
            updated_at = NOW()
          WHERE id = $1
        `,
        [auction.id, topBid?.id ?? null, topBid?.bidder_id ?? null]
      );

      if (topBid?.bidder_id && canPostAuctionLedger) {
        await postAuctionSettlementLedgerEntries(client, {
          auctionId: auction.id,
          buyerId: topBid.bidder_id,
          sellerId: auction.seller_id,
          winningBidGbp,
          platformFeeGbp,
        });
      }

      publishRealtimeEvent({
        topic: `auction:${auction.id}`,
        type: 'auction.settled',
        payload: {
          auctionId: auction.id,
          listingId: auction.listing_id,
          winnerBidderId: topBid?.bidder_id ?? null,
          winnerAmountGbp: topBid ? winningBidGbp : null,
          platformFeeRate: topBid ? AUCTION_PLATFORM_FEE_RATE : null,
          platformFeeGbp: topBid ? platformFeeGbp : null,
          sellerNetGbp: topBid ? sellerNetGbp : null,
          reason,
        },
      });

      if (topBid?.bidder_id) {
        await queueUserNotification({
          userId: topBid.bidder_id,
          title: 'Auction won',
          body: `You won ${auction.title}`,
          payload: {
            auctionId: auction.id,
            listingId: auction.listing_id,
            event: 'auction_won',
          },
          metadata: { reason },
        });
      }

      await queueUserNotification({
        userId: auction.seller_id,
        title: 'Auction settled',
        body: topBid?.bidder_id
          ? `${auction.title} settled with a winning bid.`
          : `${auction.title} ended without bids.`,
        payload: {
          auctionId: auction.id,
          listingId: auction.listing_id,
          event: topBid?.bidder_id ? 'auction_sold' : 'auction_no_sale',
        },
        metadata: { reason },
      });
    }

    await client.query('COMMIT');
    recordAuctionSettlement('settled');
    return expiring.rows.length;
  } catch (error) {
    await client.query('ROLLBACK');
    recordAuctionSettlement('failed');
    throw error;
  } finally {
    client.release();
  }
}

let auctionSweepTimer: NodeJS.Timeout | null = null;

function startAuctionSweepScheduler(): void {
  if (auctionSweepTimer) {
    return;
  }

  const queueSweep = async (reason: 'interval' | 'manual') => {
    try {
      await enqueueAuctionSweepJob(reason);
    } catch (error) {
      app.log.error({ err: error, reason }, 'Failed to enqueue auction sweep job');
    }
  };

  void queueSweep('interval');

  auctionSweepTimer = setInterval(() => {
    void queueSweep('interval');
  }, config.auctionSweepIntervalMs);

  auctionSweepTimer.unref?.();
}

function stopAuctionSweepScheduler(): void {
  if (!auctionSweepTimer) {
    return;
  }

  clearInterval(auctionSweepTimer);
  auctionSweepTimer = null;
}

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

app.get('/metrics', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  reply.header('Content-Type', metricsContentType());
  return renderMetrics();
});

app.post('/ops/auctions/sweep', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  await enqueueAuctionSweepJob('manual');
  return {
    ok: true,
    queued: true,
  };
});

app.get('/health/deep', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const status = {
    api: 'ok',
    postgres: 'unknown',
    replica: 'unknown',
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
      replica: string;
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

  if (replicaConfigured) {
    try {
      await readDb.query('SELECT 1');
      result.checks.replica = 'ok';
    } catch (error) {
      result.ok = false;
      result.checks.replica = 'error';
      result.details!.replica = (error as Error).message;
    }
  } else {
    result.checks.replica = 'not_configured';
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

  if (config.nodeEnv === 'production') {
    delete result.details;
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

  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
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

type AuthUserRow = {
  id: string;
  username: string;
  email: string | null;
  role: string;
  password_hash: string | null;
  email_verified_at: string | null;
  two_factor_enabled: boolean;
};

type OAuthIdentityLookupRow = {
  user_id: string;
};

type MagicLinkTokenRow = {
  id: number;
  user_id: string | null;
  email: string;
  expires_at: string;
  consumed_at: string | null;
};

type OtpChallengeRow = {
  id: string;
  user_id: string | null;
  email: string;
  code_hash: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  consumed_at: string | null;
};

type TotpFactorRow = {
  user_id: string;
  secret_ciphertext: string;
  enabled: boolean;
};

type RecoveryCodeRow = {
  id: number;
  code_hash: string;
  consumed_at: string | null;
};

function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

function createUsernameSeed(email: string | null, fallback = 'member'): string {
  const source = (email ? email.split('@')[0] : fallback).toLowerCase();
  const normalized = source.replace(/[^a-z0-9_]/g, '').slice(0, 22);
  const base = normalized.length >= 3 ? normalized : fallback;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}_${suffix}`.slice(0, 32);
}

function createFutureIsoTimestamp(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

function createOtpCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function normalizeOtpCode(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().toUpperCase();
}

function buildMagicLinkUrl(token: string, email: string): string {
  const separator = config.authMagicLinkBaseUrl.includes('?') ? '&' : '?';
  return `${config.authMagicLinkBaseUrl}${separator}token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
}

function buildMagicLinkEmail(url: string) {
  return {
    subject: 'Your Thryftverse login link',
    text: `Use this secure login link to access your Thryftverse account: ${url}\n\nThis link expires in ${Math.round(config.authMagicLinkTtlSeconds / 60)} minutes.`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.5; color: #171717;">
        <h2 style="margin-bottom: 12px;">Sign in to Thryftverse</h2>
        <p style="margin-bottom: 16px;">Use the secure link below to continue:</p>
        <p style="margin-bottom: 20px;"><a href="${url}" style="display:inline-block;padding:10px 16px;background:#111;color:#fff;border-radius:999px;text-decoration:none;">Sign in now</a></p>
        <p style="margin-bottom: 0; color: #525252;">This link expires in ${Math.round(config.authMagicLinkTtlSeconds / 60)} minutes.</p>
      </div>
    `.trim(),
  };
}

function buildOtpEmail(code: string) {
  return {
    subject: 'Your Thryftverse verification code',
    text: `Your Thryftverse one-time code is ${code}. It expires in ${Math.round(config.authOtpTtlSeconds / 60)} minutes.`,
    html: `
      <div style="font-family: Inter, Arial, sans-serif; line-height: 1.5; color: #171717;">
        <h2 style="margin-bottom: 12px;">Your one-time code</h2>
        <p style="margin-bottom: 12px;">Enter this code to continue signing in:</p>
        <p style="font-size: 30px; letter-spacing: 6px; font-weight: 700; margin: 0 0 16px;">${code}</p>
        <p style="margin-bottom: 0; color: #525252;">This code expires in ${Math.round(config.authOtpTtlSeconds / 60)} minutes.</p>
      </div>
    `.trim(),
  };
}

function resolveTotpAccountLabel(user: Pick<AuthUserRow, 'email' | 'username'>): string {
  if (user.email && user.email.trim().length > 0) {
    return user.email;
  }

  return user.username;
}

async function loadTotpFactor(client: Pool | PoolClient, userId: string, forUpdate = false): Promise<TotpFactorRow | null> {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const result = await client.query<TotpFactorRow>(
    `
      SELECT user_id, secret_ciphertext, enabled
      FROM user_totp_factors
      WHERE user_id = $1
      LIMIT 1
      ${lockClause}
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function readTotpSecret(client: Pool | PoolClient, userId: string): Promise<string | null> {
  const factor = await loadTotpFactor(client, userId, false);
  if (!factor) {
    return null;
  }

  const decrypted = await decryptJsonPayload<{ secret: string }>(
    factor.secret_ciphertext,
    `totp-factor:${userId}`
  );

  if (!decrypted?.secret || typeof decrypted.secret !== 'string') {
    return null;
  }

  return decrypted.secret;
}

async function validateTwoFactorTokenForUser(
  client: Pool | PoolClient,
  user: AuthUserRow,
  token: string
): Promise<{ ok: boolean; error?: string; status?: number; code?: string }> {
  const normalizedToken = normalizeOtpCode(token);
  if (normalizedToken.length < 6) {
    return {
      ok: false,
      error: 'Two-factor authentication code is required',
      status: 400,
      code: 'TWO_FACTOR_CODE_REQUIRED',
    };
  }

  const secret = await readTotpSecret(client, user.id);
  if (!secret) {
    return {
      ok: false,
      error: 'Two-factor authentication is not fully configured for this account',
      status: 409,
      code: 'TWO_FACTOR_NOT_CONFIGURED',
    };
  }

  const tokenValid = verifyTotp(secret, normalizedToken, {
    stepSeconds: 30,
    digits: 6,
    window: 1,
  });

  if (tokenValid) {
    return { ok: true };
  }

  return {
    ok: false,
    error: 'Invalid two-factor authentication code',
    status: 401,
    code: 'TWO_FACTOR_CODE_INVALID',
  };
}

async function validateRecoveryCodeForUser(
  client: Pool | PoolClient,
  userId: string,
  recoveryCode: string
): Promise<{ ok: boolean; error?: string; status?: number; code?: string }> {
  const normalizedCode = normalizeRecoveryCode(recoveryCode);
  if (!normalizedCode) {
    return {
      ok: false,
      error: 'Recovery code is required',
      status: 400,
      code: 'RECOVERY_CODE_REQUIRED',
    };
  }

  const codeHash = hashOpaqueValue(normalizedCode);
  const result = await client.query<RecoveryCodeRow>(
    `
      SELECT id, code_hash, consumed_at
      FROM user_recovery_codes
      WHERE user_id = $1
        AND code_hash = $2
      LIMIT 1
      FOR UPDATE
    `,
    [userId, codeHash]
  );

  const row = result.rows[0];
  if (!row || row.consumed_at) {
    return {
      ok: false,
      error: 'Recovery code is invalid or already used',
      status: 401,
      code: 'RECOVERY_CODE_INVALID',
    };
  }

  await client.query(
    `
      UPDATE user_recovery_codes
      SET consumed_at = NOW()
      WHERE id = $1
    `,
    [row.id]
  );

  return { ok: true };
}

async function loadAuthUserById(client: Pool | PoolClient, userId: string, forUpdate = false): Promise<AuthUserRow | null> {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const result = await client.query<AuthUserRow>(
    `
      SELECT id, username, email, role, password_hash, email_verified_at, two_factor_enabled
      FROM users
      WHERE id = $1
      LIMIT 1
      ${lockClause}
    `,
    [userId]
  );

  return result.rows[0] ?? null;
}

async function loadAuthUserByEmail(client: Pool | PoolClient, email: string, forUpdate = false): Promise<AuthUserRow | null> {
  const lockClause = forUpdate ? 'FOR UPDATE' : '';
  const result = await client.query<AuthUserRow>(
    `
      SELECT id, username, email, role, password_hash, email_verified_at, two_factor_enabled
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
      ${lockClause}
    `,
    [email]
  );

  return result.rows[0] ?? null;
}

async function createAuthUserFromIdentity(
  client: Pool | PoolClient,
  input: {
    email: string | null;
    emailVerified: boolean;
    usernameHint?: string | null;
  }
): Promise<AuthUserRow> {
  const userId = createPublicToken('usr');
  const emailVerifiedAt = input.email && input.emailVerified ? new Date().toISOString() : null;
  const username = createUsernameSeed(input.email, input.usernameHint?.trim() || 'member');

  const result = await client.query<AuthUserRow>(
    `
      INSERT INTO users (id, username, email, role, email_verified_at)
      VALUES ($1, $2, $3, 'user', $4)
      RETURNING id, username, email, role, password_hash, email_verified_at, two_factor_enabled
    `,
    [userId, username, input.email, emailVerifiedAt]
  );

  return result.rows[0];
}

function toAuthSuccessPayload(
  user: AuthUserRow,
  authSession: Awaited<ReturnType<typeof issueAuthSession>>
) {
  return {
    ok: true,
    user: toAuthUserPayload(user),
    accessToken: authSession.accessToken,
    refreshToken: authSession.refreshToken,
    accessTokenExpiresInSeconds: authSession.accessTokenExpiresInSeconds,
    refreshTokenExpiresAt: authSession.refreshTokenExpiresAt,
  };
}

async function issueSessionForAuthUser(
  user: AuthUserRow,
  request: {
    headers: Record<string, string | string[] | undefined>;
    ip: string;
  }
) {
  const authSession = await issueAuthSession(
    {
      userId: user.id,
      role: normalizeAuthRole(user.role),
    },
    {
      userAgent: resolveRequestUserAgent(request) ?? undefined,
      ipAddress: request.ip,
    }
  );

  return toAuthSuccessPayload(user, authSession);
}

async function resolveUserFromSocialIdentity(identity: VerifiedSocialIdentity): Promise<AuthUserRow> {
  const normalizedEmail = identity.email && identity.emailVerified
    ? normalizeAuthEmail(identity.email)
    : null;
  const client = await db.connect();
  let createdUserId: string | null = null;

  try {
    await client.query('BEGIN');

    const identityResult = await client.query<OAuthIdentityLookupRow>(
      `
        SELECT user_id
        FROM auth_oauth_identities
        WHERE provider = $1
          AND provider_user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [identity.provider, identity.providerUserId]
    );

    let user: AuthUserRow | null = null;

    if (identityResult.rowCount) {
      user = await loadAuthUserById(client, identityResult.rows[0].user_id, true);
    }

    if (!user && normalizedEmail) {
      user = await loadAuthUserByEmail(client, normalizedEmail, true);
    }

    if (!user) {
      user = await createAuthUserFromIdentity(client, {
        email: normalizedEmail,
        emailVerified: identity.emailVerified,
        usernameHint: identity.provider,
      });
      createdUserId = user.id;
    } else if (normalizedEmail) {
      const maybeUpdated = await client.query<AuthUserRow>(
        `
          UPDATE users
          SET
            email = COALESCE(email, $2),
            email_verified_at = CASE
              WHEN $3 THEN COALESCE(email_verified_at, NOW())
              ELSE email_verified_at
            END
          WHERE id = $1
          RETURNING id, username, email, role, password_hash, email_verified_at, two_factor_enabled
        `,
        [user.id, normalizedEmail, identity.emailVerified]
      );
      user = maybeUpdated.rows[0] ?? user;
    }

    const upsertIdentityResult = await client.query<OAuthIdentityLookupRow>(
      `
        INSERT INTO auth_oauth_identities (provider, provider_user_id, user_id, email, email_verified)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (provider, provider_user_id)
        DO UPDATE
          SET
            user_id = auth_oauth_identities.user_id,
            email = COALESCE(EXCLUDED.email, auth_oauth_identities.email),
            email_verified = auth_oauth_identities.email_verified OR EXCLUDED.email_verified,
            updated_at = NOW(),
            last_login_at = NOW()
        RETURNING user_id
      `,
      [identity.provider, identity.providerUserId, user.id, normalizedEmail, identity.emailVerified]
    );

    const resolvedUserId = upsertIdentityResult.rows[0]?.user_id;
    if (!resolvedUserId) {
      throw new Error('Unable to resolve social identity');
    }

    if (createdUserId && createdUserId !== resolvedUserId) {
      await client.query(
        `
          DELETE FROM users
          WHERE id = $1
            AND NOT EXISTS (
              SELECT 1
              FROM auth_oauth_identities
              WHERE user_id = $1
            )
        `,
        [createdUserId]
      );
    }

    if (user.id !== resolvedUserId) {
      const resolvedUser = await loadAuthUserById(client, resolvedUserId, true);
      if (!resolvedUser) {
        throw new Error('Unable to load social account');
      }
      user = resolvedUser;
    }

    await client.query('COMMIT');
    return user;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function normalizeAuthRole(role: string | null | undefined): AuthRole {
  if (role === 'seller' || role === 'moderator' || role === 'admin') {
    return role;
  }

  return 'user';
}

function toAuthUserPayload(row: Pick<AuthUserRow, 'id' | 'username' | 'email' | 'role' | 'email_verified_at' | 'two_factor_enabled'>) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: normalizeAuthRole(row.role),
    emailVerified: Boolean(row.email_verified_at),
    twoFactorEnabled: Boolean(row.two_factor_enabled),
  };
}

app.post(
  '/auth/signup',
  {
    config: {
      rateLimit: {
        max: 12,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().trim().email().max(320),
      username: z.string().trim().min(3).max(32),
      password: z.string().min(8).max(128),
    });

    const payload = bodySchema.parse(request.body ?? {});
    const email = payload.email.trim().toLowerCase();

    const existing = await db.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email]
    );

    if (existing.rowCount) {
      reply.code(409);
      return {
        ok: false,
        error: 'An account with this email already exists',
      };
    }

    const userId = createPublicToken('usr');
    const passwordHash = await hashPassword(payload.password);

    const createResult = await db.query<AuthUserRow>(
      `
        INSERT INTO users (id, username, email, password_hash, role)
        VALUES ($1, $2, $3, $4, 'user')
        RETURNING id, username, email, role, password_hash, email_verified_at, two_factor_enabled
      `,
      [userId, payload.username.trim(), email, passwordHash]
    );

    const user = createResult.rows[0];
    const authSession = await issueAuthSession(
      {
        userId: user.id,
        role: normalizeAuthRole(user.role),
      },
      {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      }
    );

    reply.code(201);
    return {
      ok: true,
      user: toAuthUserPayload(user),
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
      accessTokenExpiresInSeconds: authSession.accessTokenExpiresInSeconds,
      refreshTokenExpiresAt: authSession.refreshTokenExpiresAt,
    };
  }
);

app.post(
  '/auth/login',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().trim().email().max(320),
      password: z.string().min(1).max(128),
      twoFactorCode: z.string().trim().min(4).max(12).optional(),
      recoveryCode: z.string().trim().min(6).max(32).optional(),
    });

    const payload = bodySchema.parse(request.body ?? {});

    const userResult = await db.query<AuthUserRow>(
      `
        SELECT id, username, email, role, password_hash, email_verified_at, two_factor_enabled
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [payload.email.trim().toLowerCase()]
    );

    const user = userResult.rows[0];
    const passwordHash = user?.password_hash;

    if (!user || !passwordHash) {
      reply.code(401);
      return {
        ok: false,
        error: 'Invalid credentials',
      };
    }

    const passwordMatches = await verifyPassword(payload.password, passwordHash);
    if (!passwordMatches) {
      reply.code(401);
      return {
        ok: false,
        error: 'Invalid credentials',
      };
    }

    if (user.two_factor_enabled) {
      const client = await db.connect();
      try {
        await client.query('BEGIN');

        const lockedUser = await loadAuthUserById(client, user.id, true);
        if (!lockedUser || !lockedUser.two_factor_enabled) {
          await client.query('ROLLBACK');
        } else if (payload.recoveryCode) {
          const recoveryValidation = await validateRecoveryCodeForUser(
            client,
            lockedUser.id,
            payload.recoveryCode
          );

          if (!recoveryValidation.ok) {
            await client.query('ROLLBACK');
            reply.code(recoveryValidation.status ?? 401);
            return {
              ok: false,
              error: recoveryValidation.error ?? 'Two-factor authentication failed',
              code: recoveryValidation.code,
            };
          }

          await client.query('COMMIT');
        } else {
          const tokenValidation = await validateTwoFactorTokenForUser(
            client,
            lockedUser,
            payload.twoFactorCode ?? ''
          );

          if (!tokenValidation.ok) {
            await client.query('ROLLBACK');
            reply.code(tokenValidation.status ?? 401);
            return {
              ok: false,
              error: tokenValidation.error ?? 'Two-factor authentication failed',
              code: tokenValidation.code,
            };
          }

          await client.query('COMMIT');
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    const authSession = await issueAuthSession(
      {
        userId: user.id,
        role: normalizeAuthRole(user.role),
      },
      {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      }
    );

    return {
      ok: true,
      user: toAuthUserPayload(user),
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
      accessTokenExpiresInSeconds: authSession.accessTokenExpiresInSeconds,
      refreshTokenExpiresAt: authSession.refreshTokenExpiresAt,
    };
  }
);

app.post(
  '/auth/2fa/enroll',
  {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return {
        ok: false,
        error: 'Unauthorized',
      };
    }

    const user = await loadAuthUserById(db, request.authUser.userId, false);
    if (!user) {
      reply.code(404);
      return {
        ok: false,
        error: 'User not found',
      };
    }

    const secret = generateTotpSecret();
    const encrypted = await encryptJsonPayload(
      'profile',
      { secret },
      `totp-factor:${user.id}`
    );

    await db.query(
      `
        INSERT INTO user_totp_factors (user_id, secret_ciphertext, enabled, updated_at)
        VALUES ($1, $2, FALSE, NOW())
        ON CONFLICT (user_id)
        DO UPDATE
          SET secret_ciphertext = EXCLUDED.secret_ciphertext,
              enabled = FALSE,
              updated_at = NOW()
      `,
      [user.id, encrypted.ciphertext]
    );

    await db.query(
      `
        UPDATE users
        SET two_factor_enabled = FALSE
        WHERE id = $1
      `,
      [user.id]
    );

    const accountLabel = resolveTotpAccountLabel(user);
    const issuer = 'Thryftverse';
    const otpauthUrl = createOtpauthUrl({
      secret,
      issuer,
      accountName: accountLabel,
      digits: 6,
      period: 30,
    });

    return {
      ok: true,
      issuer,
      accountName: accountLabel,
      secret,
      otpauthUrl,
    };
  }
);

app.post(
  '/auth/2fa/verify',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    if (!request.authUser) {
      reply.code(401);
      return {
        ok: false,
        error: 'Unauthorized',
      };
    }

    const bodySchema = z.object({
      code: z.string().trim().min(4).max(12),
    });

    const payload = bodySchema.parse(request.body ?? {});

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const user = await loadAuthUserById(client, request.authUser.userId, true);
      if (!user) {
        await client.query('ROLLBACK');
        reply.code(404);
        return {
          ok: false,
          error: 'User not found',
        };
      }

      const factor = await loadTotpFactor(client, user.id, true);
      if (!factor) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Start two-factor enrollment before verification',
          code: 'TWO_FACTOR_ENROLLMENT_REQUIRED',
        };
      }

      const tokenValidation = await validateTwoFactorTokenForUser(client, user, payload.code);
      if (!tokenValidation.ok) {
        await client.query('ROLLBACK');
        reply.code(tokenValidation.status ?? 401);
        return {
          ok: false,
          error: tokenValidation.error ?? 'Invalid two-factor authentication code',
          code: tokenValidation.code,
        };
      }

      const recoveryCodes = generateRecoveryCodes(8);
      const recoveryCodeHashes = recoveryCodes.map((code) => hashOpaqueValue(code));

      await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [user.id]);
      for (const hash of recoveryCodeHashes) {
        await client.query(
          `
            INSERT INTO user_recovery_codes (user_id, code_hash)
            VALUES ($1, $2)
          `,
          [user.id, hash]
        );
      }

      await client.query(
        `
          UPDATE user_totp_factors
          SET enabled = TRUE, updated_at = NOW()
          WHERE user_id = $1
        `,
        [user.id]
      );

      await client.query(
        `
          UPDATE users
          SET two_factor_enabled = TRUE
          WHERE id = $1
        `,
        [user.id]
      );

      await client.query('COMMIT');

      return {
        ok: true,
        message: 'Two-factor authentication enabled',
        recoveryCodes,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
);

app.post('/auth/2fa/disable', async (request, reply) => {
  if (!request.authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const bodySchema = z.object({
    code: z.string().trim().min(4).max(12).optional(),
    recoveryCode: z.string().trim().min(6).max(32).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const user = await loadAuthUserById(client, request.authUser.userId, true);
    if (!user) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'User not found',
      };
    }

    if (user.two_factor_enabled) {
      if (!payload.code && !payload.recoveryCode) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Two-factor verification code is required to disable 2FA',
          code: 'TWO_FACTOR_CODE_REQUIRED',
        };
      }

      const validation = payload.recoveryCode
        ? await validateRecoveryCodeForUser(client, user.id, payload.recoveryCode)
        : await validateTwoFactorTokenForUser(client, user, payload.code ?? '');

      if (!validation.ok) {
        await client.query('ROLLBACK');
        reply.code(validation.status ?? 401);
        return {
          ok: false,
          error: validation.error ?? 'Two-factor authentication failed',
          code: validation.code,
        };
      }
    }

    await client.query(
      `
        UPDATE users
        SET two_factor_enabled = FALSE
        WHERE id = $1
      `,
      [request.authUser.userId]
    );

    await client.query(
      `
        UPDATE user_totp_factors
        SET enabled = FALSE, updated_at = NOW()
        WHERE user_id = $1
      `,
      [request.authUser.userId]
    );

    await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [request.authUser.userId]);

    await client.query('COMMIT');

    return {
      ok: true,
      message: 'Two-factor authentication disabled',
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.post(
  '/auth/oauth/google',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      idToken: z.string().min(20),
    });

    const payload = bodySchema.parse(request.body ?? {});

    let identity: VerifiedSocialIdentity;
    try {
      identity = await verifyGoogleIdentityToken(payload.idToken);
    } catch {
      reply.code(401);
      return {
        ok: false,
        error: 'Google identity token is invalid',
      };
    }

    const user = await resolveUserFromSocialIdentity(identity);
    return issueSessionForAuthUser(user, request);
  }
);

app.post(
  '/auth/oauth/apple',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      identityToken: z.string().min(20),
    });

    const payload = bodySchema.parse(request.body ?? {});

    let identity: VerifiedSocialIdentity;
    try {
      identity = await verifyAppleIdentityToken(payload.identityToken);
    } catch {
      reply.code(401);
      return {
        ok: false,
        error: 'Apple identity token is invalid',
      };
    }

    const user = await resolveUserFromSocialIdentity(identity);
    return issueSessionForAuthUser(user, request);
  }
);

app.post(
  '/auth/magic-link/request',
  {
    config: {
      rateLimit: {
        max: 12,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().trim().email().max(320),
    });

    const payload = bodySchema.parse(request.body ?? {});
    const normalizedEmail = normalizeAuthEmail(payload.email);

    const userLookup = await db.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [normalizedEmail]
    );

    const token = createPublicToken('mlk');
    const tokenHash = hashOpaqueValue(token);
    const expiresAt = createFutureIsoTimestamp(config.authMagicLinkTtlSeconds);

    await db.query(
      `
        INSERT INTO auth_magic_links (
          user_id,
          email,
          token_hash,
          expires_at,
          requested_ip,
          requested_user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        userLookup.rows[0]?.id ?? null,
        normalizedEmail,
        tokenHash,
        expiresAt,
        resolveRequestIpAddress(request),
        resolveRequestUserAgent(request),
      ]
    );

    const magicLinkUrl = buildMagicLinkUrl(token, normalizedEmail);
    const magicEmail = buildMagicLinkEmail(magicLinkUrl);

    try {
      await sendAuthEmail({
        to: normalizedEmail,
        subject: magicEmail.subject,
        html: magicEmail.html,
        text: magicEmail.text,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Magic link email delivery failed');
      reply.code(502);
      return {
        ok: false,
        error: 'Unable to send magic link right now',
      };
    }

    const response: {
      ok: true;
      message: string;
      developmentMagicLink?: string;
      developmentToken?: string;
    } = {
      ok: true,
      message: 'If your email is valid, a sign-in link has been sent.',
    };

    if (config.nodeEnv !== 'production' && config.authExposeDevelopmentArtifacts) {
      response.developmentMagicLink = magicLinkUrl;
      response.developmentToken = token;
    }

    return response;
  }
);

app.post(
  '/auth/magic-link/consume',
  {
    config: {
      rateLimit: {
        max: 20,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      token: z.string().min(20),
      email: z.string().trim().email().max(320).optional(),
    });

    const payload = bodySchema.parse(request.body ?? {});
    const tokenHash = hashOpaqueValue(payload.token);
    const normalizedRequestEmail = payload.email ? normalizeAuthEmail(payload.email) : null;

    const client = await db.connect();
    let user: AuthUserRow | null = null;
    let failure:
      | {
          status: number;
          body: { ok: false; error: string; code: string };
        }
      | null = null;

    try {
      await client.query('BEGIN');

      const tokenResult = await client.query<MagicLinkTokenRow>(
        `
          SELECT id, user_id, email, expires_at, consumed_at
          FROM auth_magic_links
          WHERE token_hash = $1
          LIMIT 1
          FOR UPDATE
        `,
        [tokenHash]
      );

      const tokenRow = tokenResult.rows[0];
      if (!tokenRow || tokenRow.consumed_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        failure = {
          status: 400,
          body: {
            ok: false,
            error: 'Magic link is invalid or expired',
            code: 'MAGIC_LINK_INVALID',
          },
        };
      } else {
        const tokenEmail = normalizeAuthEmail(tokenRow.email);
        if (normalizedRequestEmail && normalizedRequestEmail !== tokenEmail) {
          await client.query('ROLLBACK');
          failure = {
            status: 400,
            body: {
              ok: false,
              error: 'Magic link email does not match',
              code: 'MAGIC_LINK_EMAIL_MISMATCH',
            },
          };
        } else {
          if (tokenRow.user_id) {
            user = await loadAuthUserById(client, tokenRow.user_id, true);
          }

          if (!user) {
            user = await loadAuthUserByEmail(client, tokenEmail, true);
          }

          if (!user) {
            user = await createAuthUserFromIdentity(client, {
              email: tokenEmail,
              emailVerified: true,
              usernameHint: 'email',
            });
          } else {
            const maybeVerified = await client.query<AuthUserRow>(
              `
                UPDATE users
                SET
                  email = COALESCE(email, $2),
                  email_verified_at = COALESCE(email_verified_at, NOW())
                WHERE id = $1
                RETURNING id, username, email, role, password_hash, email_verified_at, two_factor_enabled
              `,
              [user.id, tokenEmail]
            );
            user = maybeVerified.rows[0] ?? user;
          }

          await client.query(
            `
              UPDATE auth_magic_links
              SET
                consumed_at = NOW(),
                user_id = $2
              WHERE id = $1
            `,
            [tokenRow.id, user.id]
          );

          await client.query('COMMIT');
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (failure) {
      reply.code(failure.status);
      return failure.body;
    }

    if (!user) {
      reply.code(500);
      return {
        ok: false,
        error: 'Unable to complete magic-link sign in',
      };
    }

    return issueSessionForAuthUser(user, request);
  }
);

app.post(
  '/auth/otp/request',
  {
    config: {
      rateLimit: {
        max: 12,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      email: z.string().trim().email().max(320),
    });

    const payload = bodySchema.parse(request.body ?? {});
    const normalizedEmail = normalizeAuthEmail(payload.email);

    const userLookup = await db.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [normalizedEmail]
    );

    const challengeId = createPublicToken('otp');
    const code = createOtpCode();
    const codeHash = hashOpaqueValue(code);
    const expiresAt = createFutureIsoTimestamp(config.authOtpTtlSeconds);

    await db.query(
      `
        INSERT INTO auth_otp_challenges (
          id,
          user_id,
          email,
          code_hash,
          max_attempts,
          expires_at,
          requested_ip,
          requested_user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        challengeId,
        userLookup.rows[0]?.id ?? null,
        normalizedEmail,
        codeHash,
        config.authOtpMaxAttempts,
        expiresAt,
        resolveRequestIpAddress(request),
        resolveRequestUserAgent(request),
      ]
    );

    const otpEmail = buildOtpEmail(code);

    try {
      await sendAuthEmail({
        to: normalizedEmail,
        subject: otpEmail.subject,
        html: otpEmail.html,
        text: otpEmail.text,
      });
    } catch (error) {
      request.log.error({ err: error }, 'OTP email delivery failed');
      reply.code(502);
      return {
        ok: false,
        error: 'Unable to send OTP right now',
      };
    }

    const response: {
      ok: true;
      challengeId: string;
      expiresInSeconds: number;
      developmentCode?: string;
    } = {
      ok: true,
      challengeId,
      expiresInSeconds: config.authOtpTtlSeconds,
    };

    if (config.nodeEnv !== 'production' && config.authExposeDevelopmentArtifacts) {
      response.developmentCode = code;
    }

    return response;
  }
);

app.post(
  '/auth/otp/verify',
  {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
      },
    },
  },
  async (request, reply) => {
    const bodySchema = z.object({
      challengeId: z.string().min(20),
      code: z.string().trim().min(4).max(10),
    });

    const payload = bodySchema.parse(request.body ?? {});

    const client = await db.connect();
    let user: AuthUserRow | null = null;
    let failure:
      | {
          status: number;
          body: { ok: false; error: string; code: string; attemptsRemaining?: number };
        }
      | null = null;

    try {
      await client.query('BEGIN');

      const challengeResult = await client.query<OtpChallengeRow>(
        `
          SELECT id, user_id, email, code_hash, attempts, max_attempts, expires_at, consumed_at
          FROM auth_otp_challenges
          WHERE id = $1
          LIMIT 1
          FOR UPDATE
        `,
        [payload.challengeId]
      );

      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.consumed_at) {
        await client.query('ROLLBACK');
        failure = {
          status: 400,
          body: {
            ok: false,
            error: 'OTP challenge is invalid or already used',
            code: 'OTP_CHALLENGE_INVALID',
          },
        };
      } else if (new Date(challenge.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        failure = {
          status: 400,
          body: {
            ok: false,
            error: 'OTP challenge has expired',
            code: 'OTP_CHALLENGE_EXPIRED',
          },
        };
      } else if (challenge.attempts >= challenge.max_attempts) {
        await client.query('ROLLBACK');
        failure = {
          status: 429,
          body: {
            ok: false,
            error: 'Maximum OTP attempts reached',
            code: 'OTP_ATTEMPTS_EXCEEDED',
            attemptsRemaining: 0,
          },
        };
      } else {
        const providedHash = hashOpaqueValue(payload.code.trim());
        if (providedHash !== challenge.code_hash) {
          const nextAttempts = challenge.attempts + 1;
          const attemptsRemaining = Math.max(0, challenge.max_attempts - nextAttempts);

          await client.query(
            `
              UPDATE auth_otp_challenges
              SET attempts = $2
              WHERE id = $1
            `,
            [challenge.id, nextAttempts]
          );

          await client.query('COMMIT');

          failure = {
            status: attemptsRemaining === 0 ? 429 : 400,
            body: {
              ok: false,
              error: attemptsRemaining === 0 ? 'Maximum OTP attempts reached' : 'OTP code is invalid',
              code: attemptsRemaining === 0 ? 'OTP_ATTEMPTS_EXCEEDED' : 'OTP_CODE_INVALID',
              attemptsRemaining,
            },
          };
        } else {
          if (challenge.user_id) {
            user = await loadAuthUserById(client, challenge.user_id, true);
          }

          if (!user) {
            user = await loadAuthUserByEmail(client, challenge.email, true);
          }

          if (!user) {
            user = await createAuthUserFromIdentity(client, {
              email: normalizeAuthEmail(challenge.email),
              emailVerified: true,
              usernameHint: 'otp',
            });
          } else {
            const maybeVerified = await client.query<AuthUserRow>(
              `
                UPDATE users
                SET
                  email = COALESCE(email, $2),
                  email_verified_at = COALESCE(email_verified_at, NOW())
                WHERE id = $1
                RETURNING id, username, email, role, password_hash, email_verified_at, two_factor_enabled
              `,
              [user.id, normalizeAuthEmail(challenge.email)]
            );
            user = maybeVerified.rows[0] ?? user;
          }

          await client.query(
            `
              UPDATE auth_otp_challenges
              SET
                attempts = attempts + 1,
                consumed_at = NOW(),
                user_id = $2
              WHERE id = $1
            `,
            [challenge.id, user.id]
          );

          await client.query('COMMIT');
        }
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    if (failure) {
      reply.code(failure.status);
      return failure.body;
    }

    if (!user) {
      reply.code(500);
      return {
        ok: false,
        error: 'Unable to complete OTP sign in',
      };
    }

    return issueSessionForAuthUser(user, request);
  }
);

app.post('/auth/refresh', async (request, reply) => {
  const bodySchema = z.object({
    refreshToken: z.string().min(20),
  });

  const payload = bodySchema.parse(request.body ?? {});

  try {
    const authSession = await rotateRefreshSession(payload.refreshToken, {
      userAgent: request.headers['user-agent'],
      ipAddress: request.ip,
    });

    const userResult = await db.query<AuthUserRow>(
      `
        SELECT id, username, email, role, password_hash, email_verified_at, two_factor_enabled
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [authSession.userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      reply.code(401);
      return {
        ok: false,
        error: 'Session is no longer valid',
      };
    }

    return {
      ok: true,
      user: toAuthUserPayload(user),
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
      accessTokenExpiresInSeconds: authSession.accessTokenExpiresInSeconds,
      refreshTokenExpiresAt: authSession.refreshTokenExpiresAt,
    };
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Refresh token invalid or expired',
    };
  }
});

app.get('/auth/me', async (request, reply) => {
  if (!request.authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const result = await db.query<AuthUserRow>(
    `
      SELECT id, username, email, role, password_hash, email_verified_at, two_factor_enabled
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [request.authUser.userId]
  );

  const user = result.rows[0];
  if (!user) {
    reply.code(404);
    return {
      ok: false,
      error: 'User not found',
    };
  }

  return {
    ok: true,
    user: toAuthUserPayload(user),
  };
});

app.post('/auth/logout', async (request) => {
  const bodySchema = z.object({
    refreshToken: z.string().min(20).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});

  if (payload.refreshToken) {
    await revokeSessionByRefreshToken(payload.refreshToken);
  }

  if (request.authUser) {
    await db.query(
      `
        UPDATE user_sessions
        SET revoked_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND revoked_at IS NULL
      `,
      [request.authUser.sessionId, request.authUser.userId]
    );

    await db.query(
      `
        UPDATE refresh_tokens
        SET revoked_at = NOW()
        WHERE session_id = $1
          AND user_id = $2
          AND revoked_at IS NULL
      `,
      [request.authUser.sessionId, request.authUser.userId]
    );
  }

  return { ok: true };
});

app.post('/auth/password-reset/request', async (request) => {
  const bodySchema = z.object({
    email: z.string().trim().email().max(320),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const normalizedEmail = payload.email.trim().toLowerCase();

  const userResult = await db.query<{ id: string }>(
    `
      SELECT id
      FROM users
      WHERE LOWER(email) = LOWER($1)
      LIMIT 1
    `,
    [normalizedEmail]
  );

  let developmentToken: string | undefined;

  if (userResult.rowCount) {
    const userId = userResult.rows[0].id;
    const resetToken = createPublicToken('pwd');
    const resetTokenHash = hashOpaqueValue(resetToken);
    const expiresAt = new Date(Date.now() + config.authPasswordResetTokenTtlSeconds * 1000).toISOString();

    await db.query(
      `
        INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
        VALUES ($1, $2, $3)
      `,
      [userId, resetTokenHash, expiresAt]
    );

    if (config.nodeEnv !== 'production' && config.authExposeDevelopmentArtifacts) {
      developmentToken = resetToken;
    }
  }

  return {
    ok: true,
    message: 'If an account exists for that email, a reset link has been issued.',
    developmentToken,
  };
});

app.post('/auth/password-reset/confirm', async (request, reply) => {
  const bodySchema = z.object({
    token: z.string().min(20),
    newPassword: z.string().min(8).max(128),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const tokenHash = hashOpaqueValue(payload.token);

  const tokenResult = await db.query<{
    id: number;
    user_id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `
      SELECT id, user_id, expires_at, used_at
      FROM password_reset_tokens
      WHERE token_hash = $1
      LIMIT 1
    `,
    [tokenHash]
  );

  const tokenRow = tokenResult.rows[0];
  if (!tokenRow || tokenRow.used_at || new Date(tokenRow.expires_at).getTime() <= Date.now()) {
    reply.code(400);
    return {
      ok: false,
      error: 'Reset token invalid or expired',
    };
  }

  const nextPasswordHash = await hashPassword(payload.newPassword);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `
        UPDATE users
        SET
          password_hash = $2,
          password_changed_at = NOW(),
          two_factor_enabled = COALESCE(two_factor_enabled, FALSE)
        WHERE id = $1
      `,
      [tokenRow.user_id, nextPasswordHash]
    );

    await client.query(
      `
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE id = $1
      `,
      [tokenRow.id]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await revokeAllUserSessions(tokenRow.user_id);

  return {
    ok: true,
    message: 'Password reset complete. Please log in again.',
  };
});

const complianceMarketSchema = z.enum(['syndicate', 'auctions', 'wallet']);
const kycStatusSchema = z.enum(['not_started', 'pending', 'verified', 'rejected', 'expired']);
const kycLevelSchema = z.enum(['none', 'basic', 'enhanced']);
const sanctionsStatusSchema = z.enum(['unknown', 'clear', 'watchlist', 'blocked']);
const documentStatusSchema = z.enum(['unsubmitted', 'submitted', 'approved', 'rejected']);
const livenessStatusSchema = z.enum(['unsubmitted', 'pending', 'passed', 'failed']);
const pepStatusSchema = z.enum(['unknown', 'clear', 'flagged']);
const amlRiskTierSchema = z.enum(['low', 'medium', 'high', 'critical']);

function toComplianceProfilePayload(profile: Awaited<ReturnType<typeof getOrCreateComplianceProfile>>) {
  return {
    userId: profile.userId,
    legalName: profile.legalName,
    dateOfBirth: profile.dateOfBirth,
    countryCode: profile.countryCode,
    residencyCountryCode: profile.residencyCountryCode,
    kycStatus: profile.kycStatus,
    kycLevel: profile.kycLevel,
    kycVendor: profile.kycVendor,
    kycVendorRef: profile.kycVendorRef,
    documentStatus: profile.documentStatus,
    livenessStatus: profile.livenessStatus,
    sanctionsStatus: profile.sanctionsStatus,
    pepStatus: profile.pepStatus,
    amlRiskTier: profile.amlRiskTier,
    tradingEnabled: profile.tradingEnabled,
    maxSingleTradeGbp: profile.maxSingleTradeGbp,
    maxDailyVolumeGbp: profile.maxDailyVolumeGbp,
    metadata: profile.metadata,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

app.get('/compliance/profile/:userId', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  await ensureUserExists(userId);
  const profile = await getOrCreateComplianceProfile(db, userId);

  return {
    ok: true,
    profile: toComplianceProfilePayload(profile),
  };
});

app.patch('/compliance/profile/:userId', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    legalName: z.string().trim().min(2).max(180).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    countryCode: z.string().trim().min(2).max(3).optional(),
    residencyCountryCode: z.string().trim().min(2).max(3).nullable().optional(),
    maxSingleTradeGbp: z.number().positive().nullable().optional(),
    maxDailyVolumeGbp: z.number().positive().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  await ensureUserExists(userId);
  const current = await getOrCreateComplianceProfile(db, userId);

  const nextLegalName = payload.legalName === undefined ? current.legalName : payload.legalName;
  const nextDateOfBirth = payload.dateOfBirth === undefined ? current.dateOfBirth : payload.dateOfBirth;
  const nextCountryCode =
    payload.countryCode === undefined ? current.countryCode : normalizeCountryCode(payload.countryCode);
  const nextResidencyCountryCode =
    payload.residencyCountryCode === undefined
      ? current.residencyCountryCode
      : payload.residencyCountryCode === null
        ? null
        : normalizeCountryCode(payload.residencyCountryCode);

  const countryChanged =
    nextCountryCode !== current.countryCode
    || nextResidencyCountryCode !== current.residencyCountryCode;
  if (countryChanged && current.kycStatus === 'verified' && request.authUser?.role !== 'admin') {
    reply.code(403);
    return {
      ok: false,
      error: 'Country updates require compliance review once KYC is verified.',
      code: 'COUNTRY_CHANGE_REVIEW_REQUIRED',
    };
  }

  const nextMaxSingleTradeGbp =
    payload.maxSingleTradeGbp === undefined ? current.maxSingleTradeGbp : payload.maxSingleTradeGbp;
  const nextMaxDailyVolumeGbp =
    payload.maxDailyVolumeGbp === undefined ? current.maxDailyVolumeGbp : payload.maxDailyVolumeGbp;
  const nextMetadata = payload.metadata
    ? {
      ...asRecord(current.metadata),
      ...asRecord(payload.metadata),
    }
    : current.metadata;

  await db.query(
    `
      UPDATE user_compliance_profiles
      SET
        legal_name = $2,
        date_of_birth = $3::date,
        country_code = $4,
        residency_country_code = $5,
        max_single_trade_gbp = $6,
        max_daily_volume_gbp = $7,
        metadata = $8::jsonb,
        updated_at = NOW()
      WHERE user_id = $1
    `,
    [
      userId,
      nextLegalName,
      nextDateOfBirth,
      nextCountryCode,
      nextResidencyCountryCode,
      nextMaxSingleTradeGbp,
      nextMaxDailyVolumeGbp,
      toJsonString(nextMetadata),
    ]
  );

  const profile = await getOrCreateComplianceProfile(db, userId);

  await appendComplianceAuditSafe(request, {
    eventType: 'compliance.profile.updated',
    subjectUserId: userId,
    payload: {
      countryCode: profile.countryCode,
      residencyCountryCode: profile.residencyCountryCode,
      maxSingleTradeGbp: profile.maxSingleTradeGbp,
      maxDailyVolumeGbp: profile.maxDailyVolumeGbp,
    },
  });

  return {
    ok: true,
    profile: toComplianceProfilePayload(profile),
  };
});

app.post('/compliance/kyc/sessions', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    vendor: z.string().trim().min(2).max(60).default(config.kycDefaultVendor),
    kycLevel: kycLevelSchema.default('basic'),
    requiredChecks: z.array(z.enum(['document', 'liveness', 'sanctions'])).min(1).max(6).default([
      'document',
      'liveness',
      'sanctions',
    ]),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});

  if (config.nodeEnv === 'production' && /^(mock|sandbox)[_\-]/i.test(payload.vendor)) {
    reply.code(503);
    return {
      ok: false,
      error: 'KYC vendor is not configured for production',
      code: 'KYC_VENDOR_NOT_CONFIGURED',
    };
  }

  await ensureUserExists(payload.userId);

  const caseId = createComplianceId('kyc_case');
  const userAgent = resolveRequestUserAgent(request);
  const ipAddress = resolveRequestIpAddress(request);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const current = await getOrCreateComplianceProfile(client, payload.userId);
    const kycVendorRef = `${payload.vendor}:${caseId}`;

    await client.query(
      `
        UPDATE user_compliance_profiles
        SET
          kyc_status = 'pending',
          kyc_level = $2,
          kyc_vendor = $3,
          kyc_vendor_ref = $4,
          document_status = CASE
            WHEN document_status = 'approved' THEN document_status
            ELSE 'submitted'
          END,
          liveness_status = CASE
            WHEN liveness_status = 'passed' THEN liveness_status
            ELSE 'pending'
          END,
          trading_enabled = FALSE,
          metadata = metadata || $5::jsonb,
          updated_at = NOW()
        WHERE user_id = $1
      `,
      [
        payload.userId,
        payload.kycLevel,
        payload.vendor,
        kycVendorRef,
        toJsonString({
          latestKycCaseId: caseId,
          initiatedAt: new Date().toISOString(),
        }),
      ]
    );

    await client.query(
      `
        INSERT INTO kyc_cases (
          id,
          user_id,
          vendor,
          vendor_case_ref,
          status,
          kyc_level,
          required_checks,
          document_status,
          liveness_status,
          sanctions_status,
          payload
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6::jsonb, 'submitted', 'pending', 'unknown', $7::jsonb)
      `,
      [
        caseId,
        payload.userId,
        payload.vendor,
        kycVendorRef,
        payload.kycLevel,
        toJsonString(payload.requiredChecks),
        toJsonString({
          requestedBy: request.authUser?.userId,
          userAgent,
          ipAddress,
          metadata: payload.metadata ?? {},
        }),
      ]
    );

    await client.query(
      `
        INSERT INTO kyc_verification_events (
          user_id,
          case_id,
          event_type,
          status,
          vendor,
          vendor_ref,
          payload,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, 'session_created', 'pending', $3, $4, $5::jsonb, $6, $7)
      `,
      [
        payload.userId,
        caseId,
        payload.vendor,
        kycVendorRef,
        toJsonString({
          requiredChecks: payload.requiredChecks,
          previousStatus: current.kycStatus,
          metadata: payload.metadata ?? {},
        }),
        ipAddress,
        userAgent,
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await appendComplianceAuditSafe(request, {
    eventType: 'kyc.session.created',
    subjectUserId: payload.userId,
    payload: {
      caseId,
      vendor: payload.vendor,
      kycLevel: payload.kycLevel,
      requiredChecks: payload.requiredChecks,
    },
  });

  reply.code(201);
  const verificationBaseUrl = config.kycVerificationBaseUrl.replace(/\/$/, '');
  return {
    ok: true,
    kycSession: {
      id: caseId,
      userId: payload.userId,
      vendor: payload.vendor,
      status: 'pending',
      kycLevel: payload.kycLevel,
      requiredChecks: payload.requiredChecks,
      verificationUrl: `${verificationBaseUrl}/${encodeURIComponent(caseId)}`,
    },
  };
});

app.post('/compliance/kyc/webhook', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const bodySchema = z.object({
    userId: z.string().min(2),
    caseId: z.string().min(6).optional(),
    vendor: z.string().trim().min(2).max(60).default(config.kycDefaultVendor),
    kycStatus: kycStatusSchema.optional(),
    kycLevel: kycLevelSchema.optional(),
    documentStatus: documentStatusSchema.optional(),
    livenessStatus: livenessStatusSchema.optional(),
    sanctionsStatus: sanctionsStatusSchema.optional(),
    pepStatus: pepStatusSchema.optional(),
    amlRiskTier: amlRiskTierSchema.optional(),
    tradingEnabled: z.boolean().optional(),
    reason: z.string().max(300).optional(),
    payload: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});

  if (config.nodeEnv === 'production' && /^(mock|sandbox)[_\-]/i.test(payload.vendor)) {
    reply.code(503);
    return {
      ok: false,
      error: 'KYC vendor is not configured for production',
      code: 'KYC_VENDOR_NOT_CONFIGURED',
    };
  }

  await ensureUserExists(payload.userId);

  const userAgent = resolveRequestUserAgent(request);
  const ipAddress = resolveRequestIpAddress(request);
  const effectiveCaseId = payload.caseId ?? createComplianceId('kyc_case');

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const current = await getOrCreateComplianceProfile(client, payload.userId);
    const nextKycStatus = payload.kycStatus ?? current.kycStatus;
    const nextKycLevel = payload.kycLevel ?? current.kycLevel;
    const nextDocumentStatus = payload.documentStatus ?? current.documentStatus;
    const nextLivenessStatus = payload.livenessStatus ?? current.livenessStatus;
    const nextSanctionsStatus = payload.sanctionsStatus ?? current.sanctionsStatus;
    const nextPepStatus = payload.pepStatus ?? current.pepStatus;
    const nextAmlRiskTier = payload.amlRiskTier ?? current.amlRiskTier;
    const nextTradingEnabled =
      payload.tradingEnabled
      ?? (
        nextKycStatus === 'verified'
        && nextDocumentStatus === 'approved'
        && nextLivenessStatus === 'passed'
        && nextSanctionsStatus === 'clear'
      );

    await client.query(
      `
        INSERT INTO kyc_cases (
          id,
          user_id,
          vendor,
          vendor_case_ref,
          status,
          kyc_level,
          required_checks,
          document_status,
          liveness_status,
          sanctions_status,
          decision_reason,
          payload,
          completed_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          '["document","liveness","sanctions"]'::jsonb,
          $7,
          $8,
          $9,
          $10,
          $11::jsonb,
          CASE WHEN $5 IN ('verified', 'rejected', 'expired') THEN NOW() ELSE NULL END
        )
        ON CONFLICT (id)
        DO UPDATE
          SET
            status = EXCLUDED.status,
            kyc_level = EXCLUDED.kyc_level,
            document_status = EXCLUDED.document_status,
            liveness_status = EXCLUDED.liveness_status,
            sanctions_status = EXCLUDED.sanctions_status,
            decision_reason = EXCLUDED.decision_reason,
            payload = kyc_cases.payload || EXCLUDED.payload,
            completed_at = CASE
              WHEN EXCLUDED.status IN ('verified', 'rejected', 'expired') THEN NOW()
              ELSE kyc_cases.completed_at
            END,
            updated_at = NOW()
      `,
      [
        effectiveCaseId,
        payload.userId,
        payload.vendor,
        `${payload.vendor}:${effectiveCaseId}`,
        nextKycStatus === 'pending' ? 'pending' : nextKycStatus,
        nextKycLevel,
        nextDocumentStatus,
        nextLivenessStatus,
        nextSanctionsStatus,
        payload.reason ?? null,
        toJsonString(payload.payload ?? {}),
      ]
    );

    await client.query(
      `
        UPDATE user_compliance_profiles
        SET
          kyc_status = $2,
          kyc_level = $3,
          kyc_vendor = $4,
          kyc_vendor_ref = $5,
          document_status = $6,
          liveness_status = $7,
          sanctions_status = $8,
          pep_status = $9,
          aml_risk_tier = $10,
          trading_enabled = $11,
          metadata = metadata || $12::jsonb,
          updated_at = NOW()
        WHERE user_id = $1
      `,
      [
        payload.userId,
        nextKycStatus,
        nextKycLevel,
        payload.vendor,
        `${payload.vendor}:${effectiveCaseId}`,
        nextDocumentStatus,
        nextLivenessStatus,
        nextSanctionsStatus,
        nextPepStatus,
        nextAmlRiskTier,
        nextTradingEnabled,
        toJsonString({
          lastKycWebhookAt: new Date().toISOString(),
          lastKycCaseId: effectiveCaseId,
        }),
      ]
    );

    await client.query(
      `
        INSERT INTO kyc_verification_events (
          user_id,
          case_id,
          event_type,
          status,
          vendor,
          vendor_ref,
          payload,
          reviewer_user_id,
          ip_address,
          user_agent
        )
        VALUES ($1, $2, 'webhook_received', $3, $4, $5, $6::jsonb, $7, $8, $9)
      `,
      [
        payload.userId,
        effectiveCaseId,
        nextKycStatus,
        payload.vendor,
        `${payload.vendor}:${effectiveCaseId}`,
        toJsonString({
          reason: payload.reason ?? null,
          payload: payload.payload ?? {},
        }),
        request.authUser?.userId ?? null,
        ipAddress,
        userAgent,
      ]
    );

    if (payload.sanctionsStatus) {
      await client.query(
        `
          INSERT INTO sanctions_screenings (
            user_id,
            provider,
            screening_ref,
            status,
            matched_entities,
            payload
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
        `,
        [
          payload.userId,
          payload.vendor,
          `${payload.vendor}:${effectiveCaseId}`,
          payload.sanctionsStatus === 'unknown' ? 'error' : payload.sanctionsStatus,
          '[]',
          toJsonString(payload.payload ?? {}),
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const profile = await getOrCreateComplianceProfile(db, payload.userId);

  await appendComplianceAuditSafe(request, {
    eventType: 'kyc.webhook.processed',
    subjectUserId: payload.userId,
    payload: {
      caseId: effectiveCaseId,
      kycStatus: profile.kycStatus,
      sanctionsStatus: profile.sanctionsStatus,
      tradingEnabled: profile.tradingEnabled,
    },
  });

  return {
    ok: true,
    profile: toComplianceProfilePayload(profile),
  };
});

app.get('/compliance/kyc/:userId', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    caseLimit: z.coerce.number().int().min(1).max(50).default(10),
    eventLimit: z.coerce.number().int().min(1).max(100).default(30),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { caseLimit, eventLimit } = querySchema.parse(request.query);

  await ensureUserExists(userId);
  const profile = await getOrCreateComplianceProfile(db, userId);

  const cases = await db.query<{
    id: string;
    vendor: string;
    vendor_case_ref: string | null;
    status: string;
    kyc_level: string;
    document_status: string;
    liveness_status: string;
    sanctions_status: string;
    decision_reason: string | null;
    payload: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
  }>(
    `
      SELECT
        id,
        vendor,
        vendor_case_ref,
        status,
        kyc_level,
        document_status,
        liveness_status,
        sanctions_status,
        decision_reason,
        payload,
        created_at::text,
        updated_at::text,
        completed_at::text
      FROM kyc_cases
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, caseLimit]
  );

  const events = await db.query<{
    id: number;
    case_id: string | null;
    event_type: string;
    status: string | null;
    vendor: string | null;
    vendor_ref: string | null;
    payload: Record<string, unknown>;
    reviewer_user_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    created_at: string;
  }>(
    `
      SELECT
        id,
        case_id,
        event_type,
        status,
        vendor,
        vendor_ref,
        payload,
        reviewer_user_id,
        ip_address,
        user_agent,
        created_at::text
      FROM kyc_verification_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, eventLimit]
  );

  return {
    ok: true,
    profile: toComplianceProfilePayload(profile),
    cases: cases.rows,
    events: events.rows,
  };
});

app.post('/compliance/aml/evaluate', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    market: complianceMarketSchema,
    eventType: z.enum(['trade', 'bid', 'deposit', 'withdrawal', 'manual']).default('manual'),
    amountGbp: z.number().nonnegative(),
    relatedUserId: z.string().min(2).optional(),
    referenceId: z.string().min(2).max(80).optional(),
    ruleCode: z.string().max(80).optional(),
    notes: z.string().max(300).optional(),
    context: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.userId);

  const assessment = await evaluateAmlRisk(db, {
    userId: payload.userId,
    market: payload.market,
    amountGbp: payload.amountGbp,
    counterpartyUserId: payload.relatedUserId,
  });

  let alert: { alertId: string; status: string } | null = null;

  if (assessment.shouldCreateAlert) {
    alert = await createAmlAlert(db, {
      userId: payload.userId,
      relatedUserId: payload.relatedUserId,
      market: payload.market,
      eventType: payload.eventType,
      amountGbp: payload.amountGbp,
      referenceId: payload.referenceId,
      ruleCode: payload.ruleCode,
      notes: payload.notes,
      context: payload.context,
      assessment,
    });
  }

  await appendComplianceAuditSafe(request, {
    eventType: 'aml.evaluated',
    subjectUserId: payload.userId,
    payload: {
      market: payload.market,
      eventType: payload.eventType,
      amountGbp: payload.amountGbp,
      riskScore: assessment.riskScore,
      riskLevel: assessment.riskLevel,
      alertId: alert?.alertId ?? null,
    },
  });

  return {
    ok: true,
    assessment,
    alert,
  };
});

app.get('/compliance/aml/alerts', async (request) => {
  const querySchema = z.object({
    userId: z.string().min(2).optional(),
    status: z.enum(['open', 'under_review', 'sar_required', 'sar_filed', 'dismissed']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  });

  const { userId, status, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: string;
    user_id: string;
    related_user_id: string | null;
    market: string;
    event_type: string;
    risk_score: string;
    risk_level: string;
    status: string;
    amount_gbp: string | null;
    reference_id: string | null;
    rule_code: string | null;
    notes: string | null;
    context: Record<string, unknown>;
    reviewed_by: string | null;
    reviewed_at: string | null;
    sar_filed_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        user_id,
        related_user_id,
        market,
        event_type,
        risk_score::text,
        risk_level,
        status,
        amount_gbp::text,
        reference_id,
        rule_code,
        notes,
        context,
        reviewed_by,
        reviewed_at::text,
        sar_filed_at::text,
        created_at::text,
        updated_at::text
      FROM aml_alerts
      WHERE ($1::text IS NULL OR user_id = $1)
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [userId ?? null, status ?? null, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      relatedUserId: row.related_user_id,
      market: row.market,
      eventType: row.event_type,
      riskScore: Number(row.risk_score),
      riskLevel: row.risk_level,
      status: row.status,
      amountGbp: row.amount_gbp === null ? null : Number(row.amount_gbp),
      referenceId: row.reference_id,
      ruleCode: row.rule_code,
      notes: row.notes,
      context: row.context,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      sarFiledAt: row.sar_filed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/compliance/aml/alerts/:alertId/review', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const paramsSchema = z.object({ alertId: z.string().min(4) });
  const bodySchema = z.object({
    status: z.enum(['under_review', 'sar_required', 'sar_filed', 'dismissed']),
    notes: z.string().max(300).optional(),
    jurisdictionCode: z.string().trim().min(2).max(12).optional(),
    narrative: z.string().max(2000).optional(),
    externalReportRef: z.string().max(120).optional(),
    metadata: z.record(z.unknown()).optional(),
  }).superRefine((value, ctx) => {
    if (value.status === 'sar_filed' && (!value.narrative || value.narrative.trim().length < 20)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['narrative'],
        message: 'narrative with at least 20 characters is required when filing SAR',
      });
    }
  });

  const { alertId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  const client = await db.connect();
  let resolvedUserId: string | null = null;

  try {
    await client.query('BEGIN');

    const alertUpdate = await client.query<{
      id: string;
      user_id: string;
      status: string;
    }>(
      `
        UPDATE aml_alerts
        SET
          status = $2,
          notes = COALESCE($3, notes),
          reviewed_by = $4,
          reviewed_at = NOW(),
          sar_filed_at = CASE WHEN $2 = 'sar_filed' THEN NOW() ELSE sar_filed_at END,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, user_id, status
      `,
      [alertId, payload.status, payload.notes ?? null, request.authUser?.userId ?? null]
    );

    if (!alertUpdate.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'AML alert not found',
      };
    }

    resolvedUserId = alertUpdate.rows[0].user_id;

    if (payload.status === 'sar_filed') {
      const sarId = createComplianceId('sar');
      await client.query(
        `
          INSERT INTO compliance_sar_reports (
            id,
            alert_id,
            user_id,
            jurisdiction_code,
            status,
            narrative,
            external_report_ref,
            submitted_by,
            submitted_at,
            metadata
          )
          VALUES ($1, $2, $3, $4, 'submitted', $5, $6, $7, NOW(), $8::jsonb)
          ON CONFLICT (alert_id)
          DO UPDATE
            SET
              status = 'submitted',
              narrative = EXCLUDED.narrative,
              external_report_ref = EXCLUDED.external_report_ref,
              submitted_by = EXCLUDED.submitted_by,
              submitted_at = NOW(),
              metadata = compliance_sar_reports.metadata || EXCLUDED.metadata,
              updated_at = NOW()
        `,
        [
          sarId,
          alertId,
          resolvedUserId,
          payload.jurisdictionCode ?? null,
          payload.narrative,
          payload.externalReportRef ?? null,
          request.authUser?.userId ?? null,
          toJsonString(payload.metadata ?? {}),
        ]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await appendComplianceAuditSafe(request, {
    eventType: 'aml.alert.reviewed',
    subjectUserId: resolvedUserId,
    payload: {
      alertId,
      status: payload.status,
      jurisdictionCode: payload.jurisdictionCode ?? null,
    },
  });

  return {
    ok: true,
    alertId,
    status: payload.status,
  };
});

app.get('/compliance/jurisdiction/rules', async (request) => {
  const querySchema = z.object({
    market: complianceMarketSchema.optional(),
    scope: z.enum(['country', 'region', 'global']).optional(),
    scopeCode: z.string().trim().min(2).max(32).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  });

  const { market, scope, scopeCode, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: string;
    market: string;
    scope: string;
    scope_code: string;
    is_enabled: boolean;
    min_kyc_level: string;
    require_sanctions_clear: boolean;
    max_order_notional_gbp: string | null;
    max_daily_notional_gbp: string | null;
    max_open_orders: number | null;
    blocked_reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        market,
        scope,
        scope_code,
        is_enabled,
        min_kyc_level,
        require_sanctions_clear,
        max_order_notional_gbp::text,
        max_daily_notional_gbp::text,
        max_open_orders,
        blocked_reason,
        metadata,
        created_at::text,
        updated_at::text
      FROM jurisdiction_rules
      WHERE ($1::text IS NULL OR market = $1)
        AND ($2::text IS NULL OR scope = $2)
        AND ($3::text IS NULL OR scope_code = $3)
      ORDER BY market ASC, scope ASC, scope_code ASC
      LIMIT $4
    `,
    [market ?? null, scope ?? null, scopeCode ? scopeCode.toUpperCase() : null, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      market: row.market,
      scope: row.scope,
      scopeCode: row.scope_code,
      isEnabled: row.is_enabled,
      minKycLevel: row.min_kyc_level,
      requireSanctionsClear: row.require_sanctions_clear,
      maxOrderNotionalGbp: row.max_order_notional_gbp === null ? null : Number(row.max_order_notional_gbp),
      maxDailyNotionalGbp: row.max_daily_notional_gbp === null ? null : Number(row.max_daily_notional_gbp),
      maxOpenOrders: row.max_open_orders,
      blockedReason: row.blocked_reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/compliance/jurisdiction/rules', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const bodySchema = z.object({
    id: z.string().min(4).max(80).optional(),
    market: complianceMarketSchema,
    scope: z.enum(['country', 'region', 'global']),
    scopeCode: z.string().trim().min(2).max(32),
    isEnabled: z.boolean().default(true),
    minKycLevel: kycLevelSchema.default('basic'),
    requireSanctionsClear: z.boolean().default(true),
    maxOrderNotionalGbp: z.number().positive().nullable().optional(),
    maxDailyNotionalGbp: z.number().positive().nullable().optional(),
    maxOpenOrders: z.number().int().positive().nullable().optional(),
    blockedReason: z.string().max(300).nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});

  const scopeCode = payload.scope === 'global' ? 'GLOBAL' : payload.scopeCode.trim().toUpperCase();
  const ruleId = payload.id ?? createComplianceId('jr');

  await db.query(
    `
      INSERT INTO jurisdiction_rules (
        id,
        market,
        scope,
        scope_code,
        is_enabled,
        min_kyc_level,
        require_sanctions_clear,
        max_order_notional_gbp,
        max_daily_notional_gbp,
        max_open_orders,
        blocked_reason,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
      ON CONFLICT (market, scope, scope_code)
      DO UPDATE
        SET
          is_enabled = EXCLUDED.is_enabled,
          min_kyc_level = EXCLUDED.min_kyc_level,
          require_sanctions_clear = EXCLUDED.require_sanctions_clear,
          max_order_notional_gbp = EXCLUDED.max_order_notional_gbp,
          max_daily_notional_gbp = EXCLUDED.max_daily_notional_gbp,
          max_open_orders = EXCLUDED.max_open_orders,
          blocked_reason = EXCLUDED.blocked_reason,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
    `,
    [
      ruleId,
      payload.market,
      payload.scope,
      scopeCode,
      payload.isEnabled,
      payload.minKycLevel,
      payload.requireSanctionsClear,
      payload.maxOrderNotionalGbp ?? null,
      payload.maxDailyNotionalGbp ?? null,
      payload.maxOpenOrders ?? null,
      payload.blockedReason ?? null,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  await appendComplianceAuditSafe(request, {
    eventType: 'jurisdiction.rule.upserted',
    payload: {
      market: payload.market,
      scope: payload.scope,
      scopeCode,
      isEnabled: payload.isEnabled,
    },
  });

  return {
    ok: true,
    id: ruleId,
  };
});

app.post('/compliance/jurisdiction/eligibility', async (request) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    market: complianceMarketSchema,
    orderNotionalGbp: z.number().nonnegative().default(0),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const decision = await evaluateMarketEligibility(db, {
    userId: payload.userId,
    market: payload.market,
    orderNotionalGbp: payload.orderNotionalGbp,
  });

  return {
    ok: true,
    decision,
  };
});

app.get('/compliance/consents/documents', async (request) => {
  const querySchema = z.object({
    docType: z.enum(['terms_of_service', 'privacy_policy', 'risk_disclosure', 'kyc_terms', 'consent_notice']).optional(),
    activeOnly: z.union([z.string(), z.boolean()]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80),
  });

  const parsed = querySchema.parse(request.query);
  const activeOnly = parseQueryBoolean(parsed.activeOnly, true);

  const result = await db.query<{
    id: string;
    doc_type: string;
    version: string;
    locale: string;
    title: string;
    content_url: string | null;
    content_hash: string | null;
    is_active: boolean;
    effective_at: string;
    retired_at: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>(
    `
      SELECT
        id,
        doc_type,
        version,
        locale,
        title,
        content_url,
        content_hash,
        is_active,
        effective_at::text,
        retired_at::text,
        metadata,
        created_at::text
      FROM legal_documents
      WHERE ($1::text IS NULL OR doc_type = $1)
        AND ($2::boolean = FALSE OR is_active = TRUE)
      ORDER BY effective_at DESC
      LIMIT $3
    `,
    [parsed.docType ?? null, activeOnly, parsed.limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      docType: row.doc_type,
      version: row.version,
      locale: row.locale,
      title: row.title,
      contentUrl: row.content_url,
      contentHash: row.content_hash,
      isActive: row.is_active,
      effectiveAt: row.effective_at,
      retiredAt: row.retired_at,
      metadata: row.metadata,
      createdAt: row.created_at,
    })),
  };
});

app.post('/compliance/consents/documents', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const bodySchema = z.object({
    id: z.string().min(4).max(80).optional(),
    docType: z.enum(['terms_of_service', 'privacy_policy', 'risk_disclosure', 'kyc_terms', 'consent_notice']),
    version: z.string().trim().min(2).max(40),
    locale: z.string().trim().min(2).max(12).default('en'),
    title: z.string().trim().min(4).max(200),
    contentUrl: z.string().url().optional(),
    contentHash: z.string().max(200).optional(),
    isActive: z.boolean().default(true),
    effectiveAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const documentId = payload.id ?? createComplianceId('doc');

  await db.query(
    `
      INSERT INTO legal_documents (
        id,
        doc_type,
        version,
        locale,
        title,
        content_url,
        content_hash,
        is_active,
        effective_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()), $10::jsonb)
      ON CONFLICT (doc_type, version, locale)
      DO UPDATE
        SET
          title = EXCLUDED.title,
          content_url = EXCLUDED.content_url,
          content_hash = EXCLUDED.content_hash,
          is_active = EXCLUDED.is_active,
          effective_at = EXCLUDED.effective_at,
          metadata = EXCLUDED.metadata
    `,
    [
      documentId,
      payload.docType,
      payload.version,
      payload.locale,
      payload.title,
      payload.contentUrl ?? null,
      payload.contentHash ?? null,
      payload.isActive,
      payload.effectiveAt ?? null,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  await appendComplianceAuditSafe(request, {
    eventType: 'consent.document.upserted',
    payload: {
      documentId,
      docType: payload.docType,
      version: payload.version,
      locale: payload.locale,
      isActive: payload.isActive,
    },
  });

  reply.code(201);
  return {
    ok: true,
    documentId,
  };
});

app.post('/compliance/consents/accept', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    documentId: z.string().min(4),
    accepted: z.boolean().default(true),
    evidence: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.userId);

  const documentExists = await db.query('SELECT id FROM legal_documents WHERE id = $1 LIMIT 1', [payload.documentId]);
  if (!documentExists.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Legal document not found',
    };
  }

  const ipAddress = resolveRequestIpAddress(request);
  const userAgent = resolveRequestUserAgent(request);

  await db.query(
    `
      INSERT INTO user_consents (
        user_id,
        document_id,
        accepted,
        accepted_at,
        ip_address,
        user_agent,
        evidence
      )
      VALUES ($1, $2, $3, NOW(), $4, $5, $6::jsonb)
      ON CONFLICT (user_id, document_id)
      DO UPDATE
        SET
          accepted = EXCLUDED.accepted,
          accepted_at = NOW(),
          ip_address = EXCLUDED.ip_address,
          user_agent = EXCLUDED.user_agent,
          evidence = user_consents.evidence || EXCLUDED.evidence,
          updated_at = NOW()
    `,
    [
      payload.userId,
      payload.documentId,
      payload.accepted,
      ipAddress,
      userAgent,
      toJsonString(payload.evidence ?? {}),
    ]
  );

  await appendComplianceAuditSafe(request, {
    eventType: payload.accepted ? 'consent.accepted' : 'consent.declined',
    subjectUserId: payload.userId,
    payload: {
      documentId: payload.documentId,
      accepted: payload.accepted,
      evidence: payload.evidence ?? {},
    },
  });

  return {
    ok: true,
    consent: {
      userId: payload.userId,
      documentId: payload.documentId,
      accepted: payload.accepted,
      acceptedAt: new Date().toISOString(),
      ipAddress,
    },
  };
});

app.get('/compliance/consents/:userId', async (request) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(80),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: number;
    user_id: string;
    document_id: string;
    accepted: boolean;
    accepted_at: string;
    ip_address: string | null;
    user_agent: string | null;
    evidence: Record<string, unknown>;
    created_at: string;
    updated_at: string;
    doc_type: string;
    version: string;
    locale: string;
    title: string;
    content_url: string | null;
  }>(
    `
      SELECT
        uc.id,
        uc.user_id,
        uc.document_id,
        uc.accepted,
        uc.accepted_at::text,
        uc.ip_address,
        uc.user_agent,
        uc.evidence,
        uc.created_at::text,
        uc.updated_at::text,
        ld.doc_type,
        ld.version,
        ld.locale,
        ld.title,
        ld.content_url
      FROM user_consents uc
      INNER JOIN legal_documents ld ON ld.id = uc.document_id
      WHERE uc.user_id = $1
      ORDER BY uc.accepted_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      documentId: row.document_id,
      accepted: row.accepted,
      acceptedAt: row.accepted_at,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      evidence: row.evidence,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      document: {
        docType: row.doc_type,
        version: row.version,
        locale: row.locale,
        title: row.title,
        contentUrl: row.content_url,
      },
    })),
  };
});

app.get('/compliance/audit/logs', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const querySchema = z.object({
    subjectUserId: z.string().min(2).optional(),
    eventType: z.string().min(3).optional(),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  });

  const { subjectUserId, eventType, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: number;
    event_type: string;
    actor_user_id: string | null;
    subject_user_id: string | null;
    request_id: string | null;
    ip_address: string | null;
    user_agent: string | null;
    payload: Record<string, unknown>;
    previous_hash: string;
    entry_hash: string;
    created_at: string;
  }>(
    `
      SELECT
        id,
        event_type,
        actor_user_id,
        subject_user_id,
        request_id,
        ip_address,
        user_agent,
        payload,
        previous_hash,
        entry_hash,
        created_at::text
      FROM compliance_audit_log
      WHERE ($1::text IS NULL OR subject_user_id = $1)
        AND ($2::text IS NULL OR event_type = $2)
      ORDER BY id DESC
      LIMIT $3
    `,
    [subjectUserId ?? null, eventType ?? null, limit]
  );

  return {
    ok: true,
    items: result.rows,
  };
});

app.get('/users/me/export', async (request, reply) => {
  if (!request.authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const userId = request.authUser.userId;
  const gdprRequestId = createComplianceId('gdpr_export');
  const ipAddress = resolveRequestIpAddress(request);
  const userAgent = resolveRequestUserAgent(request);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query<{
      id: string;
      username: string;
      email: string | null;
      role: string;
      email_verified_at: string | null;
      created_at: string;
      last_login_at: string | null;
      two_factor_enabled: boolean;
      is_erased: boolean;
      erased_at: string | null;
    }>(
      `
        SELECT
          id,
          username,
          email,
          role,
          email_verified_at::text,
          created_at::text,
          last_login_at::text,
          two_factor_enabled,
          is_erased,
          erased_at::text
        FROM users
        WHERE id = $1
        LIMIT 1
      `,
      [userId]
    );

    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'User not found',
      };
    }

    await client.query(
      `
        INSERT INTO gdpr_requests (
          id,
          user_id,
          request_type,
          status,
          requested_ip,
          requested_user_agent,
          requested_at,
          payload
        )
        VALUES ($1, $2, 'export', 'processing', $3, $4, NOW(), '{}'::jsonb)
      `,
      [gdprRequestId, userId, ipAddress, userAgent]
    );

    const [
      addresses,
      paymentMethods,
      sessions,
      interactions,
      orders,
      auctionBids,
      syndicateOrders,
      syndicateHoldings,
      consents,
      profile,
      kycCases,
      amlAlerts,
      gdprHistory,
    ] = await Promise.all([
      client.query('SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY updated_at DESC', [userId]),
      client.query('SELECT * FROM user_payment_methods WHERE user_id = $1 ORDER BY updated_at DESC', [userId]),
      client.query('SELECT id, created_at, last_seen_at, revoked_at, user_agent, ip_address FROM user_sessions WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      client.query('SELECT * FROM interactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM orders WHERE buyer_id = $1 OR seller_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM auction_bids WHERE bidder_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM syndicate_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM syndicate_holdings WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM user_consents WHERE user_id = $1 ORDER BY accepted_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM user_compliance_profiles WHERE user_id = $1 LIMIT 1', [userId]),
      client.query('SELECT * FROM kyc_cases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [userId]),
      client.query('SELECT * FROM aml_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [userId]),
      client.query('SELECT id, request_type, status, requested_at, completed_at FROM gdpr_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 100', [userId]),
    ]);

    const exportPayload = {
      user,
      addresses: addresses.rows,
      paymentMethods: paymentMethods.rows,
      sessions: sessions.rows,
      interactions: interactions.rows,
      orders: orders.rows,
      auctionBids: auctionBids.rows,
      syndicateOrders: syndicateOrders.rows,
      syndicateHoldings: syndicateHoldings.rows,
      consents: consents.rows,
      complianceProfile: profile.rows[0] ?? null,
      kycCases: kycCases.rows,
      amlAlerts: amlAlerts.rows,
      gdprHistory: gdprHistory.rows,
      exportedAt: new Date().toISOString(),
    };

    await client.query(
      `
        UPDATE gdpr_requests
        SET
          status = 'completed',
          completed_at = NOW(),
          payload = $2::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        gdprRequestId,
        toJsonString({
          records: {
            addresses: addresses.rowCount ?? 0,
            paymentMethods: paymentMethods.rowCount ?? 0,
            sessions: sessions.rowCount ?? 0,
            interactions: interactions.rowCount ?? 0,
            orders: orders.rowCount ?? 0,
            auctionBids: auctionBids.rowCount ?? 0,
            syndicateOrders: syndicateOrders.rowCount ?? 0,
            syndicateHoldings: syndicateHoldings.rowCount ?? 0,
            consents: consents.rowCount ?? 0,
            kycCases: kycCases.rowCount ?? 0,
            amlAlerts: amlAlerts.rowCount ?? 0,
          },
        }),
      ]
    );

    await client.query('COMMIT');

    await appendComplianceAuditSafe(request, {
      eventType: 'gdpr.export.completed',
      subjectUserId: userId,
      payload: {
        gdprRequestId,
      },
    });

    return {
      ok: true,
      requestId: gdprRequestId,
      export: exportPayload,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

app.delete('/users/me', async (request, reply) => {
  if (!request.authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const bodySchema = z.object({
    reason: z.string().max(500).optional(),
  });
  const payload = bodySchema.parse(request.body ?? {});

  const userId = request.authUser.userId;
  const gdprRequestId = createComplianceId('gdpr_erasure');
  const ipAddress = resolveRequestIpAddress(request);
  const userAgent = resolveRequestUserAgent(request);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const userExists = await client.query('SELECT id FROM users WHERE id = $1 LIMIT 1', [userId]);
    if (!userExists.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'User not found',
      };
    }

    await client.query(
      `
        INSERT INTO gdpr_requests (
          id,
          user_id,
          request_type,
          status,
          requested_ip,
          requested_user_agent,
          requested_at,
          payload
        )
        VALUES ($1, $2, 'erasure', 'processing', $3, $4, NOW(), $5::jsonb)
      `,
      [
        gdprRequestId,
        userId,
        ipAddress,
        userAgent,
        toJsonString({ reason: payload.reason ?? null }),
      ]
    );

    const anonymizedUsername = `deleted_user_${Date.now()}`;

    await client.query(
      `
        UPDATE users
        SET
          username = $2,
          email = NULL,
          password_hash = NULL,
          email_verified_at = NULL,
          last_login_at = NULL,
          two_factor_enabled = FALSE,
          is_erased = TRUE,
          erased_at = NOW(),
          deleted_at = NOW(),
          password_changed_at = NOW(),
          role = 'user'
        WHERE id = $1
      `,
      [userId, anonymizedUsername]
    );

    await client.query('DELETE FROM user_addresses WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_payment_methods WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_secure_profiles WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM wallet_secure_snapshots WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM secure_messages WHERE sender_id = $1 OR recipient_id = $1', [userId]);
    await client.query('DELETE FROM interactions WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM recommendations WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM recommendation_feedback WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM notification_devices WHERE user_id = $1', [userId]);

    await client.query(
      `
        UPDATE notification_events
        SET
          title = '[erased]',
          body = '[erased]',
          payload = '{}'::jsonb,
          metadata = metadata || '{"gdprErased": true}'::jsonb
        WHERE user_id = $1
      `,
      [userId]
    );

    await client.query('DELETE FROM user_totp_factors WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM user_recovery_codes WHERE user_id = $1', [userId]);
    await client.query('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [userId]);
    await client.query('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);

    await client.query(
      `
        UPDATE user_compliance_profiles
        SET
          legal_name = NULL,
          date_of_birth = NULL,
          kyc_status = 'expired',
          document_status = 'unsubmitted',
          liveness_status = 'unsubmitted',
          sanctions_status = 'unknown',
          pep_status = 'unknown',
          trading_enabled = FALSE,
          metadata = metadata || '{"gdprErased": true}'::jsonb,
          updated_at = NOW()
        WHERE user_id = $1
      `,
      [userId]
    );

    await client.query(
      `
        UPDATE gdpr_requests
        SET
          status = 'completed',
          completed_at = NOW(),
          resolution_notes = $2,
          updated_at = NOW()
        WHERE id = $1
      `,
      [gdprRequestId, 'User personal data anonymized and non-essential records erased']
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await revokeAllUserSessions(userId);

  await appendComplianceAuditSafe(request, {
    eventType: 'gdpr.erasure.completed',
    subjectUserId: userId,
    payload: {
      gdprRequestId,
      reason: payload.reason ?? null,
    },
  });

  return {
    ok: true,
    requestId: gdprRequestId,
    message: 'Account personal data has been anonymized and compliance records retained.',
  };
});

app.get('/listings', async () => {
  const result = await readDb.query(
    'SELECT id, seller_id, title, description, price_gbp, image_url, created_at FROM listings ORDER BY created_at DESC'
  );
  return { items: result.rows };
});

app.get('/search/listings', async (request) => {
  const querySchema = z.object({
    q: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(100).default(24),
  });

  const { q, limit } = querySchema.parse(request.query);

  const result = await readDb.query<{
    id: string;
    seller_id: string;
    title: string;
    description: string;
    price_gbp: string;
    image_url: string | null;
    created_at: string;
    rank_score: string;
  }>(
    `
      SELECT
        id,
        seller_id,
        title,
        description,
        price_gbp::text,
        image_url,
        created_at::text,
        ts_rank_cd(search_vector, websearch_to_tsquery('simple', $1))::text AS rank_score
      FROM listings
      WHERE search_vector @@ websearch_to_tsquery('simple', $1)
      ORDER BY rank_score::numeric DESC, created_at DESC
      LIMIT $2
    `,
    [q, limit]
  );

  if (result.rowCount && result.rowCount > 0) {
    return {
      ok: true,
      query: q,
      items: result.rows.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        title: row.title,
        description: row.description,
        priceGbp: Number(row.price_gbp),
        imageUrl: row.image_url,
        rank: Number(row.rank_score),
        createdAt: row.created_at,
      })),
    };
  }

  const fallback = await readDb.query<{
    id: string;
    seller_id: string;
    title: string;
    description: string;
    price_gbp: string;
    image_url: string | null;
    created_at: string;
  }>(
    `
      SELECT id, seller_id, title, description, price_gbp::text, image_url, created_at::text
      FROM listings
      WHERE title ILIKE $1 OR description ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [`%${q}%`, limit]
  );

  return {
    ok: true,
    query: q,
    fallback: true,
    items: fallback.rows.map((row) => ({
      id: row.id,
      sellerId: row.seller_id,
      title: row.title,
      description: row.description,
      priceGbp: Number(row.price_gbp),
      imageUrl: row.image_url,
      rank: 0,
      createdAt: row.created_at,
    })),
  };
});

app.get('/feed/looks', async () => {
  const listingRows = await db.query<{
    listing_id: string;
    seller_id: string;
    seller_username: string | null;
    title: string;
    image_url: string | null;
    created_at: string;
  }>(
    `
      SELECT
        l.id AS listing_id,
        l.seller_id,
        u.username AS seller_username,
        l.title,
        l.image_url,
        l.created_at::text
      FROM listings l
      LEFT JOIN users u ON u.id = l.seller_id
      ORDER BY l.created_at DESC
      LIMIT 18
    `
  );

  const rows = listingRows.rows;
  if (!rows.length) {
    return {
      items: [],
    };
  }

  const now = Date.now();
  const looks: Array<{
    id: string;
    rank: number;
    creator: {
      id: string;
      name: string;
      avatar: string;
      isVerified: boolean;
    };
    title: string;
    description: string;
    coverImage: string;
    items: Array<{ id: string; label: string }>;
    likes: number;
    comments: number;
    timeAgo: string;
  }> = [];

  for (let index = 0; index < rows.length; index += 3) {
    const chunk = rows.slice(index, index + 3);
    if (!chunk.length) {
      continue;
    }

    const lead = chunk[0];
    const createdAtMs = new Date(lead.created_at).getTime();
    const ageHours = Math.max(1, Math.floor((now - createdAtMs) / (60 * 60 * 1000)));
    const timeAgo = ageHours < 24 ? `${ageHours}h ago` : `${Math.floor(ageHours / 24)}d ago`;
    const coverImage =
      chunk.find((item) => item.image_url && item.image_url.trim().length > 0)?.image_url
      ?? `https://picsum.photos/seed/feed-${encodeURIComponent(lead.listing_id)}/800/800`;
    const rank = looks.length + 1;
    const likes = chunk.reduce((sum, item) => sum + Math.max(12, item.title.length * 2), 0);

    looks.push({
      id: `look_${lead.listing_id}`,
      rank,
      creator: {
        id: lead.seller_id,
        name: lead.seller_username ?? lead.seller_id,
        avatar: `https://picsum.photos/seed/${encodeURIComponent(lead.seller_id)}/200/200`,
        isVerified: true,
      },
      title: lead.title,
      description: `Curated from ${chunk.length} recent listings.`,
      coverImage,
      items: chunk.map((item) => ({
        id: item.listing_id,
        label: item.title,
      })),
      likes,
      comments: Math.max(1, Math.round(likes / 10)),
      timeAgo,
    });

    if (looks.length >= 6) {
      break;
    }
  }

  return {
    items: looks.sort((a, b) => a.rank - b.rank),
  };
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

app.get('/realtime/ws', { websocket: true }, (connection, request) => {
  const querySchema = z.object({
    topics: z.string().optional(),
  });

  const parsed = querySchema.safeParse(request.query ?? {});
  const authUserId = request.authUser?.userId;

  if (!authUserId) {
    connection.socket.close(4401, 'unauthorized');
    return;
  }

  const queryTopics = parsed.success ? parseRealtimeTopics(parsed.data.topics) : [];
  const topics = new Set<string>([
    `notifications.user:${authUserId}`,
    ...queryTopics,
  ]);

  registerWsClient({
    socket: connection.socket,
    topics: Array.from(topics.values()),
    userId: authUserId,
  });
});

app.get('/realtime/stream', async (request, reply) => {
  const querySchema = z.object({
    topics: z.string().optional(),
  });

  const parsed = querySchema.safeParse(request.query ?? {});
  const authUserId = request.authUser?.userId;

  if (!authUserId) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const queryTopics = parsed.success ? parseRealtimeTopics(parsed.data.topics) : [];
  const topics = new Set<string>([
    `notifications.user:${authUserId}`,
    ...queryTopics,
  ]);

  registerSseClient({
    reply,
    topics: Array.from(topics.values()),
    userId: authUserId,
  });
});

app.post('/notifications/devices/register', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    token: z.string().min(16).max(4096),
    provider: z.enum(['expo']).default('expo'),
    platform: z.enum(['ios', 'android', 'web']),
    appVersion: z.string().max(120).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.userId);

  const result = await db.query<{
    id: number;
    user_id: string;
    provider: string;
    platform: string;
    token: string;
    is_active: boolean;
    app_version: string | null;
    created_at: string;
    last_seen_at: string;
  }>(
    `
      INSERT INTO notification_devices (
        user_id,
        provider,
        platform,
        token,
        is_active,
        app_version,
        metadata,
        last_seen_at
      )
      VALUES ($1, $2, $3, $4, TRUE, $5, $6::jsonb, NOW())
      ON CONFLICT (token)
      DO UPDATE
        SET
          user_id = EXCLUDED.user_id,
          provider = EXCLUDED.provider,
          platform = EXCLUDED.platform,
          is_active = TRUE,
          app_version = EXCLUDED.app_version,
          metadata = notification_devices.metadata || EXCLUDED.metadata,
          last_seen_at = NOW()
      RETURNING id, user_id, provider, platform, token, is_active, app_version, created_at, last_seen_at
    `,
    [
      payload.userId,
      payload.provider,
      payload.platform,
      payload.token,
      payload.appVersion ?? null,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  reply.code(201);
  return {
    ok: true,
    device: {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      provider: result.rows[0].provider,
      platform: result.rows[0].platform,
      token: result.rows[0].token,
      isActive: result.rows[0].is_active,
      appVersion: result.rows[0].app_version,
      createdAt: result.rows[0].created_at,
      lastSeenAt: result.rows[0].last_seen_at,
    },
  };
});

app.delete('/notifications/devices/:token', async (request, reply) => {
  const paramsSchema = z.object({ token: z.string().min(16).max(4096) });
  const { token } = paramsSchema.parse(request.params);

  const userId = request.authUser?.userId;
  if (!userId) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  const deleted = await db.query(
    `
      UPDATE notification_devices
      SET is_active = FALSE, last_seen_at = NOW()
      WHERE user_id = $1
        AND token = $2
      RETURNING id
    `,
    [userId, token]
  );

  if (!deleted.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Notification device token not found',
    };
  }

  return {
    ok: true,
  };
});

app.get('/notifications/events', async (request) => {
  const querySchema = z.object({
    userId: z.string().min(2),
    limit: z.coerce.number().int().min(1).max(120).default(30),
  });

  const { userId, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: string;
    user_id: string;
    channel: string;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    status: 'queued' | 'sent' | 'failed';
    provider_message_id: string | null;
    provider_error: string | null;
    created_at: string;
    sent_at: string | null;
  }>(
    `
      SELECT
        id,
        user_id,
        channel,
        title,
        body,
        payload,
        status,
        provider_message_id,
        provider_error,
        created_at::text,
        sent_at::text
      FROM notification_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      title: row.title,
      body: row.body,
      payload: row.payload,
      status: row.status,
      providerMessageId: row.provider_message_id,
      providerError: row.provider_error,
      createdAt: row.created_at,
      sentAt: row.sent_at,
    })),
  };
});

app.post('/notifications/push/test', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2),
    title: z.string().min(2).max(160),
    body: z.string().min(2).max(500),
    payload: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.userId);

  const eventId = await queueUserNotification({
    userId: payload.userId,
    title: payload.title,
    body: payload.body,
    payload: payload.payload,
    metadata: {
      source: 'manual_test',
    },
  });

  reply.code(202);
  return {
    ok: true,
    eventId,
    status: 'queued',
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

  publishRealtimeEvent({
    topic: `chat.conversation:${payload.conversationId}`,
    type: 'chat.message.created',
    payload: {
      id: result.rows[0].id,
      conversationId: payload.conversationId,
      senderId: payload.senderId,
      recipientId: payload.recipientId,
      sentAt: result.rows[0].created_at,
    },
  });

  if (payload.senderId !== payload.recipientId) {
    try {
      await queueUserNotification({
        userId: payload.recipientId,
        title: 'New message',
        body: 'You have a new secure message in Thryftverse.',
        payload: {
          conversationId: payload.conversationId,
          messageId: result.rows[0].id,
          senderId: payload.senderId,
          event: 'chat_message',
        },
        metadata: {
          source: 'secure_messages',
        },
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to queue push notification for secure message');
    }
  }

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

app.post('/chat/groups', async (request, reply) => {
  const bodySchema = z.object({
    title: z.string().trim().min(2).max(80),
    memberIds: z.array(z.string().trim().min(2)).min(1).max(48),
    itemId: z.string().trim().min(2).max(120).optional(),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const payload = bodySchema.parse(request.body ?? {});
  const title = payload.title.trim();

  const normalizedMemberIds = [...new Set([actorUserId, ...payload.memberIds.map((value) => value.trim())])]
    .filter((value) => value.length > 0);

  await Promise.all(normalizedMemberIds.map((memberId) => ensureUserExists(memberId)));

  if (payload.itemId) {
    const listingResult = await db.query<{ id: string }>(
      `
        SELECT id
        FROM listings
        WHERE id = $1
        LIMIT 1
      `,
      [payload.itemId]
    );

    if (!listingResult.rowCount) {
      throw createApiError('LISTING_NOT_FOUND', 'Listing not found for group context', {
        itemId: payload.itemId,
      });
    }
  }

  const conversationId = createRuntimeId('chatgrp');
  const client = await db.connect();
  let createdMessage: { id: string; createdAt: string } | null = null;

  try {
    await client.query('BEGIN');

    await client.query(
      `
        INSERT INTO chat_conversations (
          id,
          type,
          title,
          owner_id,
          item_id,
          metadata
        )
        VALUES ($1, 'group', $2, $3, $4, $5::jsonb)
      `,
      [
        conversationId,
        title,
        actorUserId,
        payload.itemId ?? null,
        toJsonString({
          createdVia: 'chat_groups_api',
        }),
      ]
    );

    for (const memberId of normalizedMemberIds) {
      await client.query(
        `
          INSERT INTO chat_members (conversation_id, user_id, role)
          VALUES ($1, $2, $3)
          ON CONFLICT (conversation_id, user_id) DO NOTHING
        `,
        [conversationId, memberId, memberId === actorUserId ? 'owner' : 'member']
      );
    }

    createdMessage = await appendSystemChatMessage(client, {
      conversationId,
      text: `${title} was created.`,
      metadata: {
        event: 'group_created',
        actorUserId,
      },
    });

    await client.query(
      `
        UPDATE chat_conversations
        SET updated_at = NOW()
        WHERE id = $1
      `,
      [conversationId]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const notifyMemberIds = normalizedMemberIds.filter((memberId) => memberId !== actorUserId);
  await Promise.all(
    notifyMemberIds.map(async (memberId) => {
      try {
        await queueUserNotification({
          userId: memberId,
          title: 'You were added to a group chat',
          body: `${title} is now active in Thryftverse chat.`,
          payload: {
            conversationId,
            event: 'chat_group_added',
          },
          metadata: {
            source: 'chat.groups.create',
          },
        });
      } catch (error) {
        request.log.error(
          {
            err: error,
            conversationId,
            memberId,
          },
          'Failed to queue group add notification'
        );
      }
    })
  );

  publishRealtimeEvent({
    topic: `chat.conversation:${conversationId}`,
    type: 'chat.group.created',
    payload: {
      conversationId,
      title,
      ownerId: actorUserId,
      participantIds: normalizedMemberIds,
    },
  });

  reply.code(201);
  return {
    ok: true,
    conversation: {
      id: conversationId,
      type: 'group' as const,
      title,
      itemId: payload.itemId ?? null,
      ownerId: actorUserId,
      participantIds: normalizedMemberIds,
      botIds: [] as string[],
      lastMessage: createdMessage?.createdAt ? `${title} was created.` : 'Group created',
      lastMessageTime: createdMessage?.createdAt ?? new Date().toISOString(),
      unread: false,
    },
    initialMessage: createdMessage
      ? {
          id: createdMessage.id,
          senderType: 'system' as const,
          senderUserId: null,
          senderBotId: null,
          body: `${title} was created.`,
          metadata: {
            event: 'group_created',
            actorUserId,
          },
          createdAt: createdMessage.createdAt,
        }
      : null,
  };
});

app.get('/chat/conversations', async (request) => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(120).default(40),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { limit } = querySchema.parse(request.query ?? {});

  const conversationsResult = await db.query<{
    id: string;
    type: ChatConversationType;
    title: string | null;
    owner_id: string;
    item_id: string | null;
    updated_at: string;
    last_message: string | null;
    last_message_created_at: string | null;
  }>(
    `
      SELECT
        c.id,
        c.type,
        c.title,
        c.owner_id,
        c.item_id,
        c.updated_at::text,
        lm.body AS last_message,
        lm.created_at::text AS last_message_created_at
      FROM chat_conversations c
      INNER JOIN chat_members cm
        ON cm.conversation_id = c.id
      LEFT JOIN LATERAL (
        SELECT body, created_at
        FROM chat_messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC
        LIMIT 1
      ) lm ON TRUE
      WHERE cm.user_id = $1
      ORDER BY COALESCE(lm.created_at, c.updated_at) DESC
      LIMIT $2
    `,
    [actorUserId, limit]
  );

  const conversationIds = conversationsResult.rows.map((row) => row.id);
  if (!conversationIds.length) {
    return {
      ok: true,
      items: [],
    };
  }

  const [memberRows, botRows] = await Promise.all([
    db.query<{ conversation_id: string; user_id: string }>(
      `
        SELECT conversation_id, user_id
        FROM chat_members
        WHERE conversation_id = ANY($1::text[])
        ORDER BY joined_at ASC
      `,
      [conversationIds]
    ),
    db.query<{ conversation_id: string; bot_id: string }>(
      `
        SELECT conversation_id, bot_id
        FROM chat_bot_installs
        WHERE conversation_id = ANY($1::text[])
        ORDER BY installed_at ASC
      `,
      [conversationIds]
    ),
  ]);

  const membersByConversation = new Map<string, string[]>();
  for (const row of memberRows.rows) {
    const current = membersByConversation.get(row.conversation_id) ?? [];
    current.push(row.user_id);
    membersByConversation.set(row.conversation_id, current);
  }

  const botsByConversation = new Map<string, string[]>();
  for (const row of botRows.rows) {
    const current = botsByConversation.get(row.conversation_id) ?? [];
    current.push(row.bot_id);
    botsByConversation.set(row.conversation_id, current);
  }

  return {
    ok: true,
    items: conversationsResult.rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      ownerId: row.owner_id,
      itemId: row.item_id,
      participantIds: membersByConversation.get(row.id) ?? [],
      botIds: botsByConversation.get(row.id) ?? [],
      lastMessage: row.last_message ?? (row.type === 'group' ? `${row.title ?? 'Group'} created.` : 'No messages yet'),
      lastMessageTime: row.last_message_created_at ?? row.updated_at,
      unread: false,
    })),
  };
});

app.get('/chat/conversations/:conversationId/messages', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(250).default(120),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query ?? {});

  const conversation = await ensureChatConversationAccess(db, conversationId, actorUserId);

  const result = await db.query<{
    id: string;
    sender_type: ChatSenderType;
    sender_user_id: string | null;
    sender_bot_id: string | null;
    body: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }>(
    `
      SELECT
        id,
        sender_type,
        sender_user_id,
        sender_bot_id,
        body,
        metadata,
        created_at::text
      FROM chat_messages
      WHERE conversation_id = $1
      ORDER BY created_at ASC
      LIMIT $2
    `,
    [conversationId, limit]
  );

  return {
    ok: true,
    conversation: {
      id: conversation.id,
      type: conversation.type,
      title: conversation.title,
      ownerId: conversation.owner_id,
      itemId: conversation.item_id,
    },
    items: result.rows.map((row) => ({
      id: row.id,
      senderType: row.sender_type,
      senderUserId: row.sender_user_id,
      senderBotId: row.sender_bot_id,
      body: row.body,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    })),
  };
});

app.post('/chat/conversations/:conversationId/messages', async (request, reply) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });
  const bodySchema = z.object({
    text: z.string().trim().min(1).max(4000),
    metadata: z.record(z.unknown()).optional(),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  await ensureUserExists(actorUserId);
  const conversation = await ensureChatConversationAccess(db, conversationId, actorUserId);

  const messageId = createRuntimeId('chatmsg');
  const result = await db.query<{ id: string; created_at: string }>(
    `
      INSERT INTO chat_messages (
        id,
        conversation_id,
        sender_type,
        sender_user_id,
        sender_bot_id,
        body,
        metadata
      )
      VALUES ($1, $2, 'user', $3, NULL, $4, $5::jsonb)
      RETURNING id, created_at::text
    `,
    [
      messageId,
      conversationId,
      actorUserId,
      payload.text,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  await db.query(
    `
      UPDATE chat_conversations
      SET updated_at = NOW()
      WHERE id = $1
    `,
    [conversationId]
  );

  const participantIds = await listChatParticipantIds(db, conversationId);
  const recipientIds = participantIds.filter((memberId) => memberId !== actorUserId);

  await Promise.all(
    recipientIds.map(async (memberId) => {
      try {
        await queueUserNotification({
          userId: memberId,
          title: 'New message',
          body: conversation.type === 'group'
            ? `New message in ${conversation.title ?? 'your group chat'}`
            : 'You have a new message in Thryftverse.',
          payload: {
            conversationId,
            messageId: result.rows[0].id,
            senderId: actorUserId,
            event: 'chat_message',
          },
          metadata: {
            source: 'chat.conversations.message.create',
          },
        });
      } catch (error) {
        request.log.error(
          {
            err: error,
            conversationId,
            memberId,
          },
          'Failed to queue chat message notification'
        );
      }
    })
  );

  publishRealtimeEvent({
    topic: `chat.conversation:${conversationId}`,
    type: 'chat.message.created',
    payload: {
      id: result.rows[0].id,
      conversationId,
      senderType: 'user',
      senderUserId: actorUserId,
      senderBotId: null,
      body: payload.text,
      metadata: payload.metadata ?? {},
      createdAt: result.rows[0].created_at,
    },
  });

  reply.code(201);
  return {
    ok: true,
    message: {
      id: result.rows[0].id,
      senderType: 'user' as const,
      senderUserId: actorUserId,
      senderBotId: null,
      body: payload.text,
      metadata: payload.metadata ?? {},
      createdAt: result.rows[0].created_at,
    },
  };
});

app.post('/chat/conversations/:conversationId/members', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });
  const bodySchema = z.object({
    memberIds: z.array(z.string().trim().min(2)).min(1).max(48),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  const conversation = await ensureGroupConversationAccess(db, conversationId, actorUserId);
  if (conversation.owner_id !== actorUserId && request.authUser?.role !== 'admin') {
    throw createApiError('FORBIDDEN_USER_CONTEXT', 'Only group owners can add members', {
      actorUserId,
      ownerId: conversation.owner_id,
      conversationId,
    });
  }

  const normalizedMemberIds = [...new Set(payload.memberIds.map((value) => value.trim()))]
    .filter((value) => value.length > 0);
  await Promise.all(normalizedMemberIds.map((memberId) => ensureUserExists(memberId)));

  const client = await db.connect();
  const addedMemberIds: string[] = [];
  let participantIds: string[] = [];
  let updateMessage: { id: string; createdAt: string } | null = null;

  try {
    await client.query('BEGIN');

    for (const memberId of normalizedMemberIds) {
      const inserted = await client.query<{ user_id: string }>(
        `
          INSERT INTO chat_members (conversation_id, user_id, role)
          VALUES ($1, $2, 'member')
          ON CONFLICT (conversation_id, user_id) DO NOTHING
          RETURNING user_id
        `,
        [conversationId, memberId]
      );

      if (inserted.rowCount) {
        addedMemberIds.push(inserted.rows[0].user_id);
      }
    }

    if (addedMemberIds.length > 0) {
      updateMessage = await appendSystemChatMessage(client, {
        conversationId,
        text: `${addedMemberIds.length} member${addedMemberIds.length === 1 ? '' : 's'} added to the group.`,
        metadata: {
          event: 'group_members_added',
          actorUserId,
          memberIds: addedMemberIds,
        },
      });

      await client.query(
        `
          UPDATE chat_conversations
          SET updated_at = NOW()
          WHERE id = $1
        `,
        [conversationId]
      );
    }

    participantIds = await listChatParticipantIds(client, conversationId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await Promise.all(
    addedMemberIds
      .filter((memberId) => memberId !== actorUserId)
      .map(async (memberId) => {
        try {
          await queueUserNotification({
            userId: memberId,
            title: 'Added to a group chat',
            body: `You were added to ${conversation.title ?? 'a group chat'}.`,
            payload: {
              conversationId,
              event: 'chat_group_member_added',
            },
            metadata: {
              source: 'chat.conversations.members.add',
            },
          });
        } catch (error) {
          request.log.error(
            {
              err: error,
              conversationId,
              memberId,
            },
            'Failed to queue member add notification'
          );
        }
      })
  );

  if (updateMessage) {
    publishRealtimeEvent({
      topic: `chat.conversation:${conversationId}`,
      type: 'chat.member.added',
      payload: {
        conversationId,
        actorUserId,
        memberIds: addedMemberIds,
        messageId: updateMessage.id,
      },
    });
  }

  return {
    ok: true,
    conversationId,
    addedMemberIds,
    participantIds,
  };
});

app.get('/chat/bots', async () => {
  const result = await db.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    command_hint: string;
    category: 'moderation' | 'commerce' | 'automation';
  }>(
    `
      SELECT id, slug, name, description, command_hint, category
      FROM chat_bots
      WHERE is_active = TRUE
      ORDER BY name ASC
    `
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      commandHint: row.command_hint,
      category: row.category,
    })),
  };
});

app.get('/chat/conversations/:conversationId/bots', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  await ensureGroupConversationAccess(db, conversationId, actorUserId);

  const result = await db.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    command_hint: string;
    category: 'moderation' | 'commerce' | 'automation';
    installed_at: string;
  }>(
    `
      SELECT
        b.id,
        b.slug,
        b.name,
        b.description,
        b.command_hint,
        b.category,
        cbi.installed_at::text
      FROM chat_bot_installs cbi
      INNER JOIN chat_bots b
        ON b.id = cbi.bot_id
      WHERE cbi.conversation_id = $1
      ORDER BY cbi.installed_at ASC
    `,
    [conversationId]
  );

  return {
    ok: true,
    conversationId,
    items: result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      commandHint: row.command_hint,
      category: row.category,
      installedAt: row.installed_at,
    })),
  };
});

app.post('/chat/conversations/:conversationId/bots/:botId/deploy', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
    botId: z.string().min(2).max(120),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId, botId } = paramsSchema.parse(request.params);
  await ensureGroupConversationAccess(db, conversationId, actorUserId);

  const botResult = await db.query<{ id: string; name: string; command_hint: string }>(
    `
      SELECT id, name, command_hint
      FROM chat_bots
      WHERE id = $1
        AND is_active = TRUE
      LIMIT 1
    `,
    [botId]
  );

  if (!botResult.rowCount) {
    throw createApiError('CHAT_BOT_NOT_FOUND', 'Chat bot not found', {
      botId,
    });
  }

  const bot = botResult.rows[0];
  const client = await db.connect();
  let installed = false;
  let updateMessage: { id: string; createdAt: string } | null = null;
  let botIds: string[] = [];

  try {
    await client.query('BEGIN');

    const installResult = await client.query<{ bot_id: string }>(
      `
        INSERT INTO chat_bot_installs (conversation_id, bot_id, installed_by)
        VALUES ($1, $2, $3)
        ON CONFLICT (conversation_id, bot_id) DO NOTHING
        RETURNING bot_id
      `,
      [conversationId, botId, actorUserId]
    );

    installed = Boolean(installResult.rowCount);
    if (installed) {
      updateMessage = await appendSystemChatMessage(client, {
        conversationId,
        text: `${bot.name} deployed. Try ${bot.command_hint}`,
        metadata: {
          event: 'group_bot_deployed',
          actorUserId,
          botId,
        },
      });

      await client.query(
        `
          UPDATE chat_conversations
          SET updated_at = NOW()
          WHERE id = $1
        `,
        [conversationId]
      );
    }

    botIds = await listChatBotIds(client, conversationId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (updateMessage) {
    publishRealtimeEvent({
      topic: `chat.conversation:${conversationId}`,
      type: 'chat.bot.deployed',
      payload: {
        conversationId,
        botId,
        actorUserId,
        messageId: updateMessage.id,
      },
    });
  }

  return {
    ok: true,
    conversationId,
    botId,
    installed,
    botIds,
  };
});

app.delete('/chat/conversations/:conversationId/bots/:botId', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
    botId: z.string().min(2).max(120),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId, botId } = paramsSchema.parse(request.params);
  await ensureGroupConversationAccess(db, conversationId, actorUserId);

  const botResult = await db.query<{ id: string; name: string }>(
    `
      SELECT id, name
      FROM chat_bots
      WHERE id = $1
      LIMIT 1
    `,
    [botId]
  );

  if (!botResult.rowCount) {
    throw createApiError('CHAT_BOT_NOT_FOUND', 'Chat bot not found', {
      botId,
    });
  }

  const bot = botResult.rows[0];
  const client = await db.connect();
  let removed = false;
  let updateMessage: { id: string; createdAt: string } | null = null;
  let botIds: string[] = [];

  try {
    await client.query('BEGIN');

    const deleteResult = await client.query<{ bot_id: string }>(
      `
        DELETE FROM chat_bot_installs
        WHERE conversation_id = $1
          AND bot_id = $2
        RETURNING bot_id
      `,
      [conversationId, botId]
    );

    removed = Boolean(deleteResult.rowCount);
    if (removed) {
      updateMessage = await appendSystemChatMessage(client, {
        conversationId,
        text: `${bot.name} removed from the group.`,
        metadata: {
          event: 'group_bot_removed',
          actorUserId,
          botId,
        },
      });

      await client.query(
        `
          UPDATE chat_conversations
          SET updated_at = NOW()
          WHERE id = $1
        `,
        [conversationId]
      );
    }

    botIds = await listChatBotIds(client, conversationId);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (updateMessage) {
    publishRealtimeEvent({
      topic: `chat.conversation:${conversationId}`,
      type: 'chat.bot.removed',
      payload: {
        conversationId,
        botId,
        actorUserId,
        messageId: updateMessage.id,
      },
    });
  }

  return {
    ok: true,
    conversationId,
    botId,
    removed,
    botIds,
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

  let payoutSummary = {
    currentPendingWithdrawalGbp: 0,
    cumulativeWithdrawnGbp: 0,
  };

  if (await ledgerTablesAvailable(db)) {
    const [currentPendingWithdrawalGbp, cumulativeWithdrawnGbp] = await Promise.all([
      getLedgerAccountBalance(db, 'user', userId, 'withdrawal_pending'),
      getUserCumulativeWithdrawnGbp(db, userId),
    ]);

    payoutSummary = {
      currentPendingWithdrawalGbp,
      cumulativeWithdrawnGbp,
    };
  }

  return {
    ok: true,
    keyVersion: row.key_version,
    createdAt: row.created_at,
    snapshot,
    payoutSummary,
  };
});

app.get('/oracle/gold/latest', async (request, reply) => {
  const querySchema = z.object({
    currency: z.string().length(3).default('GBP'),
    forceRefresh: z.coerce.boolean().default(false),
  });

  const { currency, forceRefresh } = querySchema.parse(request.query);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  try {
    const rate = await resolveGoldRate(db, currency, {
      forceRefresh,
    });

    return {
      ok: true,
      rate,
    };
  } catch (error) {
    request.log.error({ err: error, currency }, 'Failed to resolve gold oracle rate');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to resolve gold oracle rate',
    };
  }
});

app.get('/wallet/1ze/quote', async (request, reply) => {
  const querySchema = z.object({
    fiatCurrency: z.string().length(3).default('GBP'),
    fiatAmount: z.coerce.number().positive().optional(),
    izeAmount: z.coerce.number().positive().optional(),
    forceRefresh: z.coerce.boolean().default(false),
  });

  const payload = querySchema.parse(request.query);
  const providedCount = Number(payload.fiatAmount !== undefined) + Number(payload.izeAmount !== undefined);
  if (providedCount !== 1) {
    reply.code(400);
    return {
      ok: false,
      error: 'Provide exactly one of fiatAmount or izeAmount for quote resolution',
    };
  }

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  try {
    const rate = await resolveGoldRate(db, payload.fiatCurrency, {
      forceRefresh: payload.forceRefresh,
    });

    const direction = payload.fiatAmount !== undefined ? 'mint' : 'burn';

    let fiatAmount: number;
    let izeAmount: number;
    let netFiatAmount: number;
    let platformFeeAmount = 0;
    let platformFeeRate = 0;

    if (direction === 'mint') {
      const feeBreakdown = calculateWalletTopupFeeBreakdown(payload.fiatAmount ?? 0);
      fiatAmount = feeBreakdown.grossFiatAmount;
      netFiatAmount = feeBreakdown.netFiatAmount;
      platformFeeAmount = feeBreakdown.platformFeeAmount;
      platformFeeRate = feeBreakdown.platformFeeRate;
      izeAmount = Number((netFiatAmount / rate.ratePerGram).toFixed(6));
    } else {
      fiatAmount = Number(((payload.izeAmount ?? 0) * rate.ratePerGram).toFixed(6));
      netFiatAmount = fiatAmount;
      izeAmount = Number((payload.izeAmount ?? 0).toFixed(6));
    }

    return {
      ok: true,
      quote: {
        direction,
        fiatCurrency: payload.fiatCurrency.toUpperCase(),
        fiatAmount,
        netFiatAmount,
        izeAmount,
        platformFeeRate,
        platformFeeAmount,
        ratePerGram: rate.ratePerGram,
        rateSource: rate.source,
      },
    };
  } catch (error) {
    request.log.error({ err: error, payload }, 'Failed to resolve 1ze quote');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to resolve 1ze quote',
    };
  }
});

app.get('/wallet/1ze/fx-quote', async (request, reply) => {
  const querySchema = z.object({
    fromCurrency: z.string().length(3),
    toCurrency: z.string().length(3),
    amount: z.coerce.number().positive(),
    forceRefresh: z.coerce.boolean().default(false),
  });

  const payload = querySchema.parse(request.query);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const fromCurrency = payload.fromCurrency.toUpperCase();
  const toCurrency = payload.toCurrency.toUpperCase();
  if (fromCurrency === toCurrency) {
    return {
      ok: true,
      quote: {
        fromCurrency,
        toCurrency,
        inputAmount: Number(payload.amount.toFixed(6)),
        fxRate: 1,
        convertedAmount: Number(payload.amount.toFixed(6)),
        source: 'identity',
      },
    };
  }

  try {
    const [fromRate, toRate] = await Promise.all([
      resolveGoldRate(db, fromCurrency, { forceRefresh: payload.forceRefresh }),
      resolveGoldRate(db, toCurrency, { forceRefresh: payload.forceRefresh }),
    ]);

    const fxRate = Number((toRate.ratePerGram / fromRate.ratePerGram).toFixed(8));
    const convertedAmount = Number((payload.amount * fxRate).toFixed(6));

    return {
      ok: true,
      quote: {
        fromCurrency,
        toCurrency,
        inputAmount: Number(payload.amount.toFixed(6)),
        fxRate,
        convertedAmount,
        source: 'xau_cross',
        referenceRates: {
          from: fromRate,
          to: toRate,
        },
      },
    };
  } catch (error) {
    request.log.error({ err: error, payload }, 'Failed to resolve 1ze FX quote');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to resolve FX quote',
    };
  }
});

app.post('/oracle/gold/override', async (request, reply) => {
  const bodySchema = z.object({
    currency: z.string().length(3),
    ratePerGram: z.number().positive(),
    reason: z.string().max(240).optional(),
    expiresAt: z.string().datetime().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    assertGoldOperatorToken(request.headers['x-gold-operator-token'] as string | undefined);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid gold operator token',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await setGoldRateOverride(client, {
      currency: payload.currency,
      ratePerGram: payload.ratePerGram,
      reason: payload.reason,
      createdBy: 'operator',
      expiresAt: payload.expiresAt,
      metadata: payload.metadata,
    });

    const rate = await resolveGoldRate(client, payload.currency, {
      forceRefresh: false,
    });

    await client.query('COMMIT');
    return {
      ok: true,
      rate,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error }, 'Failed to apply gold rate override');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to apply gold rate override',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/mint', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    fiatAmount: z.number().positive(),
    fiatCurrency: z.string().length(3).default('GBP'),
    paymentIntentId: z.string().min(4).max(120).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);
  const feeBreakdown = calculateWalletTopupFeeBreakdown(payload.fiatAmount);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    if (feeBreakdown.netFiatAmount <= 0) {
      throw createApiError('IZE_MINT_INVALID', 'Top-up amount is too low after platform fee');
    }

    if (config.nodeEnv === 'production' && !payload.paymentIntentId) {
      throw createApiError(
        'IZE_MINT_BACKING_REQUIRED',
        'A settled wallet_topup paymentIntentId is required to mint 1ze in production'
      );
    }

    let fundingGatewayId: string | null = null;
    if (payload.paymentIntentId) {
      const settledIntent = await assertSettledWalletTopupIntent(client, {
        paymentIntentId: payload.paymentIntentId,
        userId: actorUserId,
        fiatAmount: feeBreakdown.grossFiatAmount,
        fiatCurrency: payload.fiatCurrency,
      });

      fundingGatewayId = settledIntent.gatewayId;
    }

    const quote = await resolveGoldRate(client, payload.fiatCurrency, {
      forceRefresh: false,
    });
    const izeAmount = Number((feeBreakdown.netFiatAmount / quote.ratePerGram).toFixed(6));

    if (!Number.isFinite(izeAmount) || izeAmount <= 0) {
      throw createApiError('IZE_MINT_INVALID', 'Unable to derive a valid 1ze mint amount');
    }

    const operationId = createRuntimeId('ize_mint');
    await recordIzeMint(client, {
      operationId,
      userId: actorUserId,
      fiatAmount: feeBreakdown.netFiatAmount,
      fiatCurrency: payload.fiatCurrency.toUpperCase(),
      izeAmount,
      ratePerGram: quote.ratePerGram,
      paymentIntentId: payload.paymentIntentId,
      metadata: {
        ...(payload.metadata ?? {}),
        walletTopup: {
          grossFiatAmount: feeBreakdown.grossFiatAmount,
          netFiatAmount: feeBreakdown.netFiatAmount,
          platformFeeRate: feeBreakdown.platformFeeRate,
          platformFeeAmount: feeBreakdown.platformFeeAmount,
        },
      },
    });

    const [walletBalanceIze, reserveSnapshot] = await Promise.all([
      getLedgerAccountBalance(client, 'user', actorUserId, 'ize_wallet', 'IZE'),
      getPlatformIzeReserveSnapshot(client),
    ]);

    await client.query('COMMIT');
    reply.code(201);
    return {
      ok: true,
      operation: {
        id: operationId,
        type: 'mint',
        userId: actorUserId,
        fiatAmount: feeBreakdown.netFiatAmount,
        grossFiatAmount: feeBreakdown.grossFiatAmount,
        netFiatAmount: feeBreakdown.netFiatAmount,
        platformFeeRate: feeBreakdown.platformFeeRate,
        platformFeeAmount: feeBreakdown.platformFeeAmount,
        fiatCurrency: payload.fiatCurrency.toUpperCase(),
        izeAmount,
        ratePerGram: quote.ratePerGram,
        rateSource: quote.source,
        fundingGatewayId,
      },
      balances: {
        userIze: walletBalanceIze,
        outstandingIze: reserveSnapshot.outstandingIze,
        reserveGrams: reserveSnapshot.reserveGrams,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, userId: actorUserId }, 'Failed to mint 1ze');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to mint 1ze',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/burn', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    izeAmount: z.number().positive(),
    fiatCurrency: z.string().length(3).default('GBP'),
    payoutRequestId: z.string().min(4).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    if (config.nodeEnv === 'production' && !payload.payoutRequestId) {
      throw createApiError(
        'IZE_BURN_BACKING_REQUIRED',
        'A requested/processing/paid payoutRequestId is required to redeem 1ze in production'
      );
    }

    let payoutGatewayId: string | null = null;
    let payoutStatus: PayoutRequestStatus | null = null;
    let payoutAmountCurrency: string | null = null;
    let payoutAmountGbp: number | null = null;
    if (payload.payoutRequestId) {
      const payout = await assertRedeemablePayoutRequest(client, {
        payoutRequestId: payload.payoutRequestId,
        userId: actorUserId,
      });

      payoutGatewayId = payout.gatewayId;
      payoutStatus = payout.status;
      payoutAmountCurrency = payout.amountCurrency.toUpperCase();
      payoutAmountGbp = payout.amountGbp;
    }

    const quote = await resolveGoldRate(client, payload.fiatCurrency, {
      forceRefresh: false,
    });
    const fiatAmount = Number((payload.izeAmount * quote.ratePerGram).toFixed(6));

    if (payoutAmountCurrency && payoutAmountCurrency !== payload.fiatCurrency.toUpperCase()) {
      throw createApiError(
        'PAYOUT_REQUEST_CURRENCY_MISMATCH',
        'Payout request currency does not match requested 1ze burn currency',
        {
          payoutRequestId: payload.payoutRequestId,
          payoutAmountCurrency,
          burnCurrency: payload.fiatCurrency.toUpperCase(),
        }
      );
    }

    if (payoutAmountGbp !== null) {
      let redemptionAmountGbp = fiatAmount;
      if (payload.fiatCurrency.toUpperCase() !== 'GBP') {
        const gbpQuote = await resolveGoldRate(client, 'GBP', {
          forceRefresh: false,
        });
        redemptionAmountGbp = Number((payload.izeAmount * gbpQuote.ratePerGram).toFixed(6));
      }

      const tolerance = Math.max(0.5, payoutAmountGbp * 0.03);
      if (Math.abs(redemptionAmountGbp - payoutAmountGbp) > tolerance) {
        throw createApiError(
          'PAYOUT_REQUEST_AMOUNT_MISMATCH',
          'Computed redemption value does not match payout request amount',
          {
            payoutRequestId: payload.payoutRequestId,
            payoutAmountGbp,
            redemptionAmountGbp,
            tolerance,
          }
        );
      }
    }

    const operationId = createRuntimeId('ize_burn');
    await recordIzeBurn(client, {
      operationId,
      userId: actorUserId,
      fiatAmount,
      fiatCurrency: payload.fiatCurrency.toUpperCase(),
      izeAmount: Number(payload.izeAmount.toFixed(6)),
      ratePerGram: quote.ratePerGram,
      payoutRequestId: payload.payoutRequestId,
      metadata: payload.metadata,
    });

    const [walletBalanceIze, reserveSnapshot] = await Promise.all([
      getLedgerAccountBalance(client, 'user', actorUserId, 'ize_wallet', 'IZE'),
      getPlatformIzeReserveSnapshot(client),
    ]);

    await client.query('COMMIT');
    reply.code(201);
    return {
      ok: true,
      operation: {
        id: operationId,
        type: 'burn',
        userId: actorUserId,
        fiatAmount,
        fiatCurrency: payload.fiatCurrency.toUpperCase(),
        izeAmount: Number(payload.izeAmount.toFixed(6)),
        ratePerGram: quote.ratePerGram,
        rateSource: quote.source,
        payoutGatewayId,
        payoutStatus,
        payoutAmountCurrency,
        payoutAmountGbp,
      },
      balances: {
        userIze: walletBalanceIze,
        outstandingIze: reserveSnapshot.outstandingIze,
        reserveGrams: reserveSnapshot.reserveGrams,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, userId: actorUserId }, 'Failed to burn 1ze');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to burn 1ze',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/:userId/position', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    fiatCurrency: z.string().length(3).default('GBP'),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { fiatCurrency } = querySchema.parse(request.query);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const [quote, userIze, reserveSnapshot] = await Promise.all([
    resolveGoldRate(db, fiatCurrency, { forceRefresh: false }),
    getLedgerAccountBalance(db, 'user', userId, 'ize_wallet', 'IZE'),
    getPlatformIzeReserveSnapshot(db),
  ]);

  return {
    ok: true,
    userId,
    rate: quote,
    balances: {
      userIze,
      userFiatValue: Number((userIze * quote.ratePerGram).toFixed(2)),
      outstandingIze: reserveSnapshot.outstandingIze,
      reserveGrams: reserveSnapshot.reserveGrams,
      reserveCoverageRatio:
        reserveSnapshot.outstandingIze > 0
          ? Number((reserveSnapshot.reserveGrams / reserveSnapshot.outstandingIze).toFixed(6))
          : null,
    },
  };
});

app.post('/wallet/1ze/reconcile', async (request, reply) => {
  const bodySchema = z.object({
    reserveGramsOverride: z.number().nonnegative().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    assertGoldOperatorToken(request.headers['x-gold-operator-token'] as string | undefined);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid gold operator token',
    };
  }

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (payload.reserveGramsOverride !== undefined) {
      const currentReserve = await getLedgerAccountBalance(
        client,
        'platform',
        'platform',
        'gold_reserve_grams',
        'XAU'
      );

      const delta = Number((payload.reserveGramsOverride - currentReserve).toFixed(6));
      if (Math.abs(delta) > 1e-8) {
        const reserveAccountId = await ensureLedgerAccount(
          client,
          'platform',
          'platform',
          'gold_reserve_grams',
          'XAU'
        );

        await appendLedgerEntry(client, {
          accountId: reserveAccountId,
          counterpartyAccountId: reserveAccountId,
          direction: delta > 0 ? 'credit' : 'debit',
          amount: Math.abs(delta),
          currency: 'XAU',
          sourceType: 'reserve_reconcile',
          sourceId: createRuntimeId('reserve_adj'),
          lineType: 'operator_override',
          metadata: {
            previousReserveGrams: currentReserve,
            nextReserveGrams: payload.reserveGramsOverride,
            ...(payload.metadata ?? {}),
          },
        });
      }
    }

    const attestation = await createGoldReserveAttestation(client, {
      attestedBy: 'operator',
      metadata: payload.metadata,
      thresholdGrams: config.goldReserveDriftThresholdGrams,
    });

    await client.query('COMMIT');
    return {
      ok: true,
      attestation,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error }, 'Failed to reconcile 1ze reserve');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to reconcile 1ze reserve',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/attestations', async (request, reply) => {
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(120).default(30),
  });

  const { limit } = querySchema.parse(request.query);

  if (!(await onezeTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze money-layer tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<{
    id: string;
    reserve_grams: string;
    outstanding_ize: string;
    drift_grams: string;
    within_threshold: boolean;
    attested_by: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>(
    `
      SELECT
        id,
        reserve_grams::text,
        outstanding_ize::text,
        drift_grams::text,
        within_threshold,
        attested_by,
        metadata,
        created_at::text
      FROM gold_reserve_attestations
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      reserveGrams: Number(row.reserve_grams),
      outstandingIze: Number(row.outstanding_ize),
      driftGrams: Number(row.drift_grams),
      withinThreshold: row.within_threshold,
      attestedBy: row.attested_by,
      metadata: row.metadata,
      createdAt: row.created_at,
    })),
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

app.get('/payments/gateways', async () => {
  const tableCheck = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.payment_gateways') IS NOT NULL AS exists`
  );

  if (!tableCheck.rows[0]?.exists) {
    return {
      ok: true,
      items: [
        {
          id: 'stripe_americas',
          displayName: 'Stripe Americas',
          type: 'fiat',
          isActive: true,
        },
        {
          id: 'mollie_eu',
          displayName: 'Mollie Europe',
          type: 'fiat',
          isActive: true,
        },
        {
          id: 'razorpay_in',
          displayName: 'Razorpay India',
          type: 'fiat',
          isActive: true,
        },
        {
          id: 'flutterwave_africa',
          displayName: 'Flutterwave Africa',
          type: 'fiat',
          isActive: true,
        },
        {
          id: 'tap_gulf',
          displayName: 'Tap Payments Gulf',
          type: 'fiat',
          isActive: true,
        },
      ],
    };
  }

  const result = await db.query<{
    id: string;
    display_name: string;
    gateway_type: 'fiat' | 'stablecoin';
    is_active: boolean;
  }>(
    `
      SELECT id, display_name, gateway_type, is_active
      FROM payment_gateways
      WHERE is_active = TRUE
      ORDER BY id ASC
    `
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      type: row.gateway_type,
      isActive: row.is_active,
    })),
  };
});

app.get('/payments/platform/summary', async () => {
  if (!(await ledgerTablesAvailable(db))) {
    return {
      ok: true,
      balances: {
        platformRevenueGbp: 0,
        escrowLiabilityGbp: 0,
      },
    };
  }

  const [platformRevenueGbp, escrowLiabilityGbp] = await Promise.all([
    getLedgerAccountBalance(db, 'platform', 'platform', 'platform_revenue'),
    getLedgerAccountBalance(db, 'platform', 'platform', 'escrow_liability'),
  ]);

  return {
    ok: true,
    balances: {
      platformRevenueGbp,
      escrowLiabilityGbp,
    },
  };
});

app.get('/users/:userId/ledger/balances', async (request) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  if (!(await ledgerTablesAvailable(db))) {
    return {
      ok: true,
      userId,
      balances: {
        sellerPayableGbp: 0,
        buyerSpendGbp: 0,
        withdrawalPendingGbp: 0,
        withdrawableBalanceGbp: 0,
        cumulativeWithdrawnGbp: 0,
      },
    };
  }

  const [
    sellerPayableGbp,
    buyerSpendGbp,
    withdrawalPendingGbp,
    withdrawableBalanceGbp,
    cumulativeWithdrawnGbp,
  ] =
    await Promise.all([
    getLedgerAccountBalance(db, 'user', userId, 'seller_payable'),
    getLedgerAccountBalance(db, 'user', userId, 'buyer_spend'),
    getLedgerAccountBalance(db, 'user', userId, 'withdrawal_pending'),
    getLedgerAccountBalance(db, 'user', userId, 'withdrawable_balance'),
    getUserCumulativeWithdrawnGbp(db, userId),
  ]);

  return {
    ok: true,
    userId,
    balances: {
      sellerPayableGbp,
      buyerSpendGbp,
      withdrawalPendingGbp,
      withdrawableBalanceGbp,
      cumulativeWithdrawnGbp,
    },
  };
});

app.get('/users/:userId/payout-accounts', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<{
    id: number;
    user_id: string;
    gateway_id: string;
    provider_account_ref: string;
    country_code: string | null;
    currency: string;
    status: 'pending' | 'active' | 'disabled';
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        user_id,
        gateway_id,
        provider_account_ref,
        country_code,
        currency,
        status,
        metadata,
        created_at,
        updated_at
      FROM payout_accounts
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `,
    [userId]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      gatewayId: row.gateway_id,
      providerAccountRef: row.provider_account_ref,
      countryCode: row.country_code,
      currency: row.currency,
      status: row.status,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/users/:userId/payout-accounts', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    gatewayId: z.string().min(2).max(80).default('stripe_americas'),
    providerAccountRef: z.string().min(3).max(140).optional(),
    countryCode: z.string().min(2).max(3).optional(),
    currency: z.string().length(3).default('GBP'),
    status: z.enum(['pending', 'active', 'disabled']).default('active'),
    metadata: z.record(z.unknown()).optional(),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  await ensureUserExists(userId);

  const gateway = await db.query<{ id: string }>(
    'SELECT id FROM payment_gateways WHERE id = $1 AND is_active = TRUE LIMIT 1',
    [payload.gatewayId]
  );

  if (!gateway.rowCount) {
    reply.code(400);
    return {
      ok: false,
      error: 'Gateway is not available for payouts',
    };
  }

  const providerAccountRef = payload.providerAccountRef ?? createRuntimeId(`mock_payout_account_${userId}`);

  const result = await db.query<{
    id: number;
    user_id: string;
    gateway_id: string;
    provider_account_ref: string;
    country_code: string | null;
    currency: string;
    status: 'pending' | 'active' | 'disabled';
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      INSERT INTO payout_accounts (
        user_id,
        gateway_id,
        provider_account_ref,
        country_code,
        currency,
        status,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING
        id,
        user_id,
        gateway_id,
        provider_account_ref,
        country_code,
        currency,
        status,
        metadata,
        created_at,
        updated_at
    `,
    [
      userId,
      payload.gatewayId,
      providerAccountRef,
      payload.countryCode?.toUpperCase() ?? null,
      payload.currency.toUpperCase(),
      payload.status,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  reply.code(201);
  return {
    ok: true,
    item: {
      id: result.rows[0].id,
      userId: result.rows[0].user_id,
      gatewayId: result.rows[0].gateway_id,
      providerAccountRef: result.rows[0].provider_account_ref,
      countryCode: result.rows[0].country_code,
      currency: result.rows[0].currency,
      status: result.rows[0].status,
      metadata: result.rows[0].metadata,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    },
  };
});

app.get('/users/:userId/payout-requests', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<PayoutRequestRow>(
    `
      SELECT
        id,
        user_id,
        payout_account_id,
        amount_gbp,
        amount_currency,
        status,
        provider_payout_ref,
        failure_reason,
        metadata,
        created_at,
        updated_at
      FROM payout_requests
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => toPayoutRequestPayload(row)),
  };
});

app.get('/users/:userId/payout-requests/:requestId', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
    requestId: z.string().min(4).max(140),
  });

  const { userId, requestId } = paramsSchema.parse(request.params);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<PayoutRequestRow>(
    `
      SELECT
        id,
        user_id,
        payout_account_id,
        amount_gbp,
        amount_currency,
        status,
        provider_payout_ref,
        failure_reason,
        metadata,
        created_at,
        updated_at
      FROM payout_requests
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [requestId, userId]
  );

  const payoutRequest = result.rows[0];
  if (!payoutRequest) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payout request not found',
    };
  }

  return {
    ok: true,
    payoutRequest: toPayoutRequestPayload(payoutRequest),
  };
});

app.post('/users/:userId/payout-requests', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const bodySchema = z.object({
    payoutAccountId: z.coerce.number().int().positive(),
    amountGbp: z.number().positive().optional(),
    amount: z.number().positive().optional(),
    amountCurrency: z.string().length(3).default('GBP'),
    metadata: z.record(z.unknown()).optional(),
  });

  const { userId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const requestId = createRuntimeId('po');
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await ensureUserExists(userId);

    const payoutAccount = await client.query<{
      id: number;
      user_id: string;
      gateway_id: string;
      status: 'pending' | 'active' | 'disabled';
      currency: string;
    }>(
      `
        SELECT id, user_id, gateway_id, status, currency
        FROM payout_accounts
        WHERE id = $1 AND user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [payload.payoutAccountId, userId]
    );

    const payoutAccountRow = payoutAccount.rows[0];
    if (!payoutAccountRow) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Payout account not found for this user',
      };
    }

    if (payoutAccountRow.status !== 'active') {
      await client.query('ROLLBACK');
      reply.code(409);
      return {
        ok: false,
        error: 'Payout account is not active',
      };
    }

    const payoutCurrency = payload.amountCurrency.toUpperCase();
    if (payoutAccountRow.currency.toUpperCase() !== payoutCurrency) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Payout request currency must match payout account currency',
      };
    }

    const usingAmountGbp = payload.amountGbp !== undefined;
    const usingAmount = payload.amount !== undefined;
    if (usingAmountGbp === usingAmount) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Provide exactly one of amountGbp or amount for payout request',
      };
    }

    const requestedAmount = roundTo((payload.amount ?? payload.amountGbp) as number, 6);
    let amountGbp = 0;
    let conversionFxRate: number | null = null;

    if (payload.amountGbp !== undefined) {
      amountGbp = roundTo(payload.amountGbp, 2);
    } else if (payoutCurrency === 'GBP') {
      amountGbp = roundTo(requestedAmount, 2);
    } else {
      if (!(await onezeTablesAvailable(client))) {
        await client.query('ROLLBACK');
        reply.code(503);
        return {
          ok: false,
          error: 'Gold oracle tables are unavailable for payout currency conversion. Run migrations first.',
        };
      }

      const [sourceRate, gbpRate] = await Promise.all([
        resolveGoldRate(client, payoutCurrency, { forceRefresh: false }),
        resolveGoldRate(client, 'GBP', { forceRefresh: false }),
      ]);

      const gbpPerUnit = gbpRate.ratePerGram / sourceRate.ratePerGram;
      conversionFxRate = Number(gbpPerUnit.toFixed(8));
      amountGbp = roundTo(requestedAmount * gbpPerUnit, 2);
    }

    if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Unable to derive a valid GBP amount for payout request',
      };
    }

    const payoutRequestMetadata = {
      ...(payload.metadata ?? {}),
      amountSource: payload.amountGbp !== undefined ? 'amount_gbp' : 'amount_currency',
      requestedAmount,
      requestedAmountCurrency: payoutCurrency,
      conversionFxRate,
    };

    let sellerPayableBalanceBefore = 0;
    if (await ledgerTablesAvailable(client)) {
      sellerPayableBalanceBefore = await getLedgerAccountBalance(client, 'user', userId, 'seller_payable');
      if (amountGbp > sellerPayableBalanceBefore + 1e-6) {
        await client.query('ROLLBACK');
        reply.code(409);
        return {
          ok: false,
          error: 'Insufficient seller payable balance for this payout request',
          balance: {
            sellerPayableGbp: sellerPayableBalanceBefore,
          },
        };
      }
    }

    const result = await client.query<PayoutRequestRow>(
      `
        INSERT INTO payout_requests (
          id,
          user_id,
          payout_account_id,
          amount_gbp,
          amount_currency,
          status,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, 'requested', $6::jsonb)
        RETURNING
          id,
          user_id,
          payout_account_id,
          amount_gbp,
          amount_currency,
          status,
          provider_payout_ref,
          failure_reason,
          metadata,
          created_at,
          updated_at
      `,
      [
        requestId,
        userId,
        payload.payoutAccountId,
        amountGbp,
        payoutCurrency,
        toJsonString(payoutRequestMetadata),
      ]
    );

    if (await ledgerTablesAvailable(client)) {
      const sellerPayableAccountId = await ensureLedgerAccount(client, 'user', userId, 'seller_payable');
      const withdrawalPendingAccountId = await ensureLedgerAccount(client, 'user', userId, 'withdrawal_pending');

      await appendLedgerEntry(client, {
        accountId: sellerPayableAccountId,
        counterpartyAccountId: withdrawalPendingAccountId,
        direction: 'debit',
        amountGbp,
        sourceType: 'payout',
        sourceId: requestId,
        lineType: 'payout_requested',
        metadata: {
          payoutAccountId: payload.payoutAccountId,
        },
      });

      await appendLedgerEntry(client, {
        accountId: withdrawalPendingAccountId,
        counterpartyAccountId: sellerPayableAccountId,
        direction: 'credit',
        amountGbp,
        sourceType: 'payout',
        sourceId: requestId,
        lineType: 'payout_requested',
        metadata: {
          payoutAccountId: payload.payoutAccountId,
        },
      });
    }

    await client.query('COMMIT');

    reply.code(201);
    return {
      ok: true,
      payoutRequest: toPayoutRequestPayload(result.rows[0]),
      balance: {
        sellerPayableBeforeRequestGbp: sellerPayableBalanceBefore,
        sellerPayableAfterRequestGbp: roundTo(Math.max(0, sellerPayableBalanceBefore - amountGbp), 2),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error, userId, requestId }, 'Unable to create payout request');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to create payout request',
    };
  } finally {
    client.release();
  }
});

app.post('/users/:userId/payout-requests/:requestId/status', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
    requestId: z.string().min(4).max(140),
  });
  const bodySchema = z.object({
    status: z.enum(['processing', 'paid', 'failed', 'cancelled']),
    providerPayoutRef: z.string().min(4).max(140).optional(),
    failureReason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { userId, requestId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const settled = await settlePayoutRequest(client, {
      userId,
      requestId,
      targetStatus: payload.status,
      providerPayoutRef: payload.providerPayoutRef,
      failureReason: payload.failureReason,
      metadata: payload.metadata,
      source: 'manual_status',
    });

    await client.query('COMMIT');

    return {
      ok: true,
      idempotent: settled.idempotent,
      payoutRequest: settled.payoutRequest,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'PAYOUT_REQUEST_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'PAYOUT_INVALID_TRANSITION') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        balance: apiError.details,
      };
    }

    request.log.error({ err: error, userId, requestId }, 'Unable to update payout request status');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to update payout request status',
    };
  } finally {
    client.release();
  }
});

app.post('/payments/intents', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    gatewayId: z.string().min(2).max(80).optional(),
    instrumentId: z.coerce.number().int().positive().optional(),
    orderId: z.string().min(4).max(64).optional(),
    syndicateOrderId: z.coerce.number().int().positive().optional(),
    channel: z.enum(['wallet_topup', 'wallet_withdrawal']).optional(),
    amountGbp: z.number().positive().optional(),
    amountCurrency: z.string().length(3).default('GBP'),
    idempotencyKey: z.string().min(6).max(140).optional(),
    returnUrl: z.string().url().optional(),
    webhookUrl: z.string().url().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body);
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  if (payload.orderId && payload.syndicateOrderId) {
    reply.code(400);
    return {
      ok: false,
      error: 'Provide either orderId or syndicateOrderId, not both',
    };
  }

  if (!payload.orderId && !payload.syndicateOrderId && !payload.channel) {
    reply.code(400);
    return {
      ok: false,
      error: 'A payment intent source is required (orderId, syndicateOrderId, or channel)',
    };
  }

  if (payload.idempotencyKey) {
    const existing = await db.query<PaymentIntentRow>(
      `
        SELECT
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          syndicate_order_id,
          instrument_id,
          amount_gbp,
          amount_currency,
          status,
          provider_intent_ref,
          client_secret,
          provider_status,
          next_action_url,
          sca_expires_at,
          settled_at,
          failure_code,
          failure_message,
          created_at,
          updated_at
        FROM payment_intents
        WHERE idempotency_key = $1
          AND user_id = $2
        LIMIT 1
      `,
      [payload.idempotencyKey, actorUserId]
    );

    if (existing.rowCount) {
      return {
        ok: true,
        idempotent: true,
        intent: toPaymentIntentPayload(existing.rows[0]),
      };
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    let channel: PaymentIntentChannel;
    let amountGbp: number;
    let gatewayId = payload.gatewayId ?? resolveDefaultGatewayForChannel('commerce');
    let orderId: string | null = null;
    let syndicateOrderId: number | null = null;

    if (payload.orderId) {
      const order = await client.query<{
        id: string;
        buyer_id: string;
        total_gbp: number | string;
        status: string;
      }>(
        'SELECT id, buyer_id, total_gbp, status FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE',
        [payload.orderId]
      );

      const orderRow = order.rows[0];
      if (!orderRow) {
        await client.query('ROLLBACK');
        reply.code(404);
        return {
          ok: false,
          error: 'Order not found',
        };
      }

      if (orderRow.buyer_id !== actorUserId) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Order does not belong to this user',
        };
      }

      if (orderRow.status !== 'created') {
        await client.query('ROLLBACK');
        reply.code(409);
        return {
          ok: false,
          error: `Order cannot create a payment intent from status '${orderRow.status}'`,
        };
      }

      channel = 'commerce';
      amountGbp = Number(orderRow.total_gbp);
      orderId = orderRow.id;
      gatewayId = payload.gatewayId ?? resolveDefaultGatewayForChannel(channel);
    } else if (payload.syndicateOrderId) {
      const syndicateOrder = await client.query<{
        id: number;
        user_id: string;
        total_gbp: number | string;
      }>(
        'SELECT id, user_id, total_gbp FROM syndicate_orders WHERE id = $1 LIMIT 1',
        [payload.syndicateOrderId]
      );

      const syndicateOrderRow = syndicateOrder.rows[0];
      if (!syndicateOrderRow) {
        await client.query('ROLLBACK');
        reply.code(404);
        return {
          ok: false,
          error: 'Syndicate order not found',
        };
      }

      if (syndicateOrderRow.user_id !== actorUserId) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Syndicate order does not belong to this user',
        };
      }

      channel = 'syndicate';
      amountGbp = Number(syndicateOrderRow.total_gbp);
      syndicateOrderId = syndicateOrderRow.id;
      gatewayId = payload.gatewayId ?? resolveDefaultGatewayForChannel(channel);
    } else {
      channel = payload.channel as PaymentIntentChannel;
      if (!payload.amountGbp || !Number.isFinite(payload.amountGbp) || payload.amountGbp <= 0) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'amountGbp is required for wallet payment intents',
        };
      }

      amountGbp = roundTo(payload.amountGbp, 2);
      gatewayId = payload.gatewayId ?? resolveDefaultGatewayForChannel(channel);
    }

    const gateway = await client.query<{ id: string }>(
      'SELECT id FROM payment_gateways WHERE id = $1 AND is_active = TRUE LIMIT 1',
      [gatewayId]
    );

    if (!gateway.rowCount) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Gateway is not available for this intent',
      };
    }

    if (payload.instrumentId) {
      const instrument = await client.query<{ id: number }>(
        `
          SELECT id
          FROM payment_instruments
          WHERE id = $1 AND user_id = $2
          LIMIT 1
        `,
        [payload.instrumentId, actorUserId]
      );

      if (!instrument.rowCount) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Instrument does not belong to this user',
        };
      }
    }

    const intentId = createRuntimeId('pi');
    const gatewayIntent = await createGatewayPaymentIntent({
      gatewayId,
      intentId,
      channel,
      amountGbp,
      amountCurrency: payload.amountCurrency,
      returnUrl: payload.returnUrl,
      webhookUrl: payload.webhookUrl,
      metadata: {
        ...(payload.metadata ?? {}),
        userId: actorUserId,
        orderId,
        syndicateOrderId,
      },
    });

    const inserted = await client.query<PaymentIntentRow>(
      `
        INSERT INTO payment_intents (
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          syndicate_order_id,
          instrument_id,
          amount_gbp,
          amount_currency,
          status,
          provider_intent_ref,
          client_secret,
          provider_status,
          next_action_url,
          sca_expires_at,
          idempotency_key,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
        RETURNING
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          syndicate_order_id,
          instrument_id,
          amount_gbp,
          amount_currency,
          status,
          provider_intent_ref,
          client_secret,
          provider_status,
          next_action_url,
          sca_expires_at,
          settled_at,
          failure_code,
          failure_message,
          created_at,
          updated_at
      `,
      [
        intentId,
        actorUserId,
        gatewayId,
        channel,
        orderId,
        syndicateOrderId,
        payload.instrumentId ?? null,
        amountGbp,
        payload.amountCurrency.toUpperCase(),
        gatewayIntent.initialStatus,
        gatewayIntent.providerIntentRef,
        gatewayIntent.clientSecret,
        gatewayIntent.providerStatus ?? null,
        gatewayIntent.nextActionUrl ?? null,
        gatewayIntent.scaExpiresAt ?? null,
        payload.idempotencyKey ?? null,
        toJsonString(payload.metadata ?? {}),
      ]
    );

    await client.query('COMMIT');
    reply.code(201);
    return {
      ok: true,
      idempotent: false,
      intent: toPaymentIntentPayload(inserted.rows[0]),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error }, 'Failed to create payment intent');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to create payment intent',
    };
  } finally {
    client.release();
  }
});

app.get('/payments/intents/:intentId', async (request, reply) => {
  const paramsSchema = z.object({ intentId: z.string().min(4).max(120) });
  const { intentId } = paramsSchema.parse(request.params);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<PaymentIntentRow>(
    `
      SELECT
        id,
        user_id,
        gateway_id,
        channel,
        order_id,
        syndicate_order_id,
        instrument_id,
        amount_gbp,
        amount_currency,
        status,
        provider_intent_ref,
        client_secret,
        provider_status,
        next_action_url,
        sca_expires_at,
        settled_at,
        failure_code,
        failure_message,
        created_at,
        updated_at
      FROM payment_intents
      WHERE id = $1
      LIMIT 1
    `,
    [intentId]
  );

  const row = result.rows[0];
  if (!row) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payment intent not found',
    };
  }

  if (!request.authUser || (request.authUser.role !== 'admin' && request.authUser.userId !== row.user_id)) {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: payment intent access denied',
    };
  }

  return {
    ok: true,
    intent: toPaymentIntentPayload(row),
  };
});

app.post('/payments/intents/:intentId/confirm', async (request, reply) => {
  const paramsSchema = z.object({ intentId: z.string().min(4).max(120) });
  const bodySchema = z.object({
    simulateStatus: z.enum(['processing', 'succeeded', 'failed', 'cancelled']).default('processing'),
    providerFeeGbp: z.number().min(0).optional(),
    providerAttemptRef: z.string().min(4).max(140).optional(),
    providerStatus: z.string().max(120).optional(),
    nextActionUrl: z.string().url().optional(),
    scaExpiresAt: z.string().datetime().optional(),
    failureCode: z.string().max(80).optional(),
    failureMessage: z.string().max(240).optional(),
    payload: z.record(z.unknown()).optional(),
  });

  const { intentId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const ownerCheck = await client.query<{ user_id: string }>(
      `
        SELECT user_id
        FROM payment_intents
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [intentId]
    );

    const ownerRow = ownerCheck.rows[0];
    if (!ownerRow) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found',
      };
    }

    if (!request.authUser || (request.authUser.role !== 'admin' && request.authUser.userId !== ownerRow.user_id)) {
      await client.query('ROLLBACK');
      reply.code(403);
      return {
        ok: false,
        error: 'Forbidden: payment intent access denied',
      };
    }

    if (payload.simulateStatus === 'processing') {
      const transitioned = await transitionPaymentIntentStatus(client, {
        intentId,
        nextStatus: 'processing',
        providerStatus: payload.providerStatus ?? 'processing',
        nextActionUrl: payload.nextActionUrl ?? null,
        scaExpiresAt: payload.scaExpiresAt ?? null,
        metadataPatch: {
          source: 'manual_confirm',
          ...(payload.payload ?? {}),
        },
      });

      await client.query('COMMIT');
      return {
        ok: true,
        alreadyFinal: false,
        idempotent: transitioned.idempotent,
        intent: transitioned.intent,
      };
    }

    const settled = await settlePaymentIntent(client, {
      intentId,
      finalStatus: payload.simulateStatus,
      providerFeeGbp: payload.providerFeeGbp,
      providerAttemptRef: payload.providerAttemptRef,
      failureCode: payload.failureCode,
      failureMessage: payload.failureMessage,
      rawPayload: {
        source: 'manual_confirm',
        ...(payload.payload ?? {}),
      },
    });

    await client.query('COMMIT');
    return {
      ok: true,
      alreadyFinal: settled.alreadyFinal,
      intent: settled.intent,
      orderSettlement: settled.orderSettlement,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if ((error as Error).message === 'PAYMENT_INTENT_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found',
      };
    }

    const apiError = getApiError(error);
    if (apiError?.code === 'PAYMENT_INTENT_INVALID_TRANSITION') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    request.log.error({ err: error, intentId }, 'Failed to confirm payment intent');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to confirm payment intent',
    };
  } finally {
    client.release();
  }
});

app.post('/payments/intents/:intentId/refunds', async (request, reply) => {
  const paramsSchema = z.object({ intentId: z.string().min(4).max(120) });
  const bodySchema = z.object({
    amount: z.number().positive().optional(),
    currency: z.string().length(3).optional(),
    reason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { intentId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const intentResult = await client.query<PaymentIntentRow>(
      `
        SELECT
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          syndicate_order_id,
          instrument_id,
          amount_gbp,
          amount_currency,
          status,
          provider_intent_ref,
          client_secret,
          provider_status,
          next_action_url,
          sca_expires_at,
          settled_at,
          failure_code,
          failure_message,
          created_at,
          updated_at
        FROM payment_intents
        WHERE id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [intentId]
    );

    const intent = intentResult.rows[0];
    if (!intent) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found',
      };
    }

    if (!request.authUser || (request.authUser.role !== 'admin' && request.authUser.userId !== intent.user_id)) {
      await client.query('ROLLBACK');
      reply.code(403);
      return {
        ok: false,
        error: 'Forbidden: payment intent access denied',
      };
    }

    if (intent.status !== 'succeeded') {
      await client.query('ROLLBACK');
      reply.code(409);
      return {
        ok: false,
        error: 'Refunds can only be initiated for succeeded payment intents',
      };
    }

    const amount = roundTo(payload.amount ?? Number(intent.amount_gbp), 2);
    const currency = (payload.currency ?? intent.amount_currency ?? 'GBP').toUpperCase();
    let providerRefundRef = createRuntimeId(`refund_${intent.gateway_id}`);
    let refundStatus: 'pending' | 'succeeded' | 'failed' | 'cancelled' = 'pending';

    if (intent.gateway_id === 'stripe_americas' && config.stripeSecretKey && intent.provider_intent_ref) {
      const stripe = new Stripe(config.stripeSecretKey, {
        apiVersion: '2024-06-20',
      });

      const created = await stripe.refunds.create({
        payment_intent: intent.provider_intent_ref,
        amount: Math.max(1, Math.round(amount * 100)),
        reason: payload.reason ? 'requested_by_customer' : undefined,
        metadata: toStripeMetadata({
          intentId,
          ...(payload.metadata ?? {}),
        }),
      });

      providerRefundRef = created.id;
      refundStatus =
        created.status === 'succeeded'
          ? 'succeeded'
          : created.status === 'failed'
            ? 'failed'
            : created.status === 'canceled'
              ? 'cancelled'
              : 'pending';
    }

    await upsertPaymentRefund(client, {
      intentId,
      gatewayId: intent.gateway_id,
      providerRefundRef,
      status: refundStatus,
      amount,
      currency,
      reason: payload.reason,
      metadata: {
        source: 'manual_refund_request',
        ...(payload.metadata ?? {}),
      },
    });

    await client.query('COMMIT');
    reply.code(201);
    return {
      ok: true,
      refund: {
        intentId,
        gatewayId: intent.gateway_id,
        providerRefundRef,
        status: refundStatus,
        amount,
        currency,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error, intentId }, 'Failed to initiate refund');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to initiate refund',
    };
  } finally {
    client.release();
  }
});

app.get('/payments/intents/:intentId/refunds', async (request, reply) => {
  const paramsSchema = z.object({ intentId: z.string().min(4).max(120) });
  const { intentId } = paramsSchema.parse(request.params);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const intentOwner = await db.query<{ user_id: string }>(
    'SELECT user_id FROM payment_intents WHERE id = $1 LIMIT 1',
    [intentId]
  );

  const ownerRow = intentOwner.rows[0];
  if (!ownerRow) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payment intent not found',
    };
  }

  if (!request.authUser || (request.authUser.role !== 'admin' && request.authUser.userId !== ownerRow.user_id)) {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: payment intent access denied',
    };
  }

  const result = await db.query<{
    id: string;
    intent_id: string;
    gateway_id: string;
    amount: string;
    currency: string;
    status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
    provider_refund_ref: string;
    reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        intent_id,
        gateway_id,
        amount::text,
        currency,
        status,
        provider_refund_ref,
        reason,
        metadata,
        created_at::text,
        updated_at::text
      FROM payment_refunds
      WHERE intent_id = $1
      ORDER BY created_at DESC
    `,
    [intentId]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      intentId: row.intent_id,
      gatewayId: row.gateway_id,
      amount: Number(row.amount),
      currency: row.currency,
      status: row.status,
      providerRefundRef: row.provider_refund_ref,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.get('/payments/disputes', async (request, reply) => {
  const querySchema = z.object({
    status: z.enum(['open', 'warning', 'needs_response', 'won', 'lost', 'closed']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80),
  });
  const { status, limit } = querySchema.parse(request.query);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<{
    id: string;
    intent_id: string | null;
    gateway_id: string;
    provider_dispute_ref: string;
    status: 'open' | 'warning' | 'needs_response' | 'won' | 'lost' | 'closed';
    amount: string;
    currency: string;
    reason: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        intent_id,
        gateway_id,
        provider_dispute_ref,
        status,
        amount::text,
        currency,
        reason,
        metadata,
        created_at::text,
        updated_at::text
      FROM payment_disputes
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY updated_at DESC
      LIMIT $2
    `,
    [status ?? null, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      intentId: row.intent_id,
      gatewayId: row.gateway_id,
      providerDisputeRef: row.provider_dispute_ref,
      status: row.status,
      amount: Number(row.amount),
      currency: row.currency,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/payments/webhooks/mock', async (request, reply) => {
  const bodySchema = z.object({
    gatewayId: z.string().min(2).max(80).default('mock_fiat_gbp'),
    providerEventId: z.string().min(4).max(140),
    eventType: z.string().min(3).max(120),
    intentId: z.string().min(4).max(120),
    status: z.enum(['succeeded', 'failed', 'cancelled']),
    providerFeeGbp: z.number().min(0).optional(),
    failureCode: z.string().max(80).optional(),
    failureMessage: z.string().max(240).optional(),
    payload: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body);

  if (!config.apiEnableMockWebhooks) {
    reply.code(404);
    return {
      ok: false,
      error: 'Mock payment webhook endpoint is disabled',
    };
  }

  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const gateway = await client.query<{ id: string }>(
      'SELECT id FROM payment_gateways WHERE id = $1 LIMIT 1',
      [payload.gatewayId]
    );

    if (!gateway.rowCount) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Webhook gateway is unknown',
      };
    }

    const intentExists = await client.query<{ id: string }>(
      'SELECT id FROM payment_intents WHERE id = $1 LIMIT 1',
      [payload.intentId]
    );

    if (!intentExists.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found for webhook event',
      };
    }

    const webhookInsert = await client.query<{ id: number }>(
      `
        INSERT INTO payment_webhook_events (
          gateway_id,
          provider_event_id,
          event_type,
          intent_id,
          payload
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (gateway_id, provider_event_id)
        DO NOTHING
        RETURNING id
      `,
      [
        payload.gatewayId,
        payload.providerEventId,
        payload.eventType,
        payload.intentId,
        toJsonString(payload.payload ?? {}),
      ]
    );

    if (!webhookInsert.rowCount) {
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: true,
      };
    }

    const settled = await settlePaymentIntent(client, {
      intentId: payload.intentId,
      finalStatus: payload.status,
      providerFeeGbp: payload.providerFeeGbp,
      providerAttemptRef: payload.providerEventId,
      failureCode: payload.failureCode,
      failureMessage: payload.failureMessage,
      rawPayload: {
        source: 'mock_webhook',
        eventType: payload.eventType,
        ...(payload.payload ?? {}),
      },
    });

    await client.query(
      'UPDATE payment_webhook_events SET processed_at = NOW() WHERE id = $1',
      [webhookInsert.rows[0].id]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      duplicate: false,
      intent: settled.intent,
      orderSettlement: settled.orderSettlement,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if ((error as Error).message === 'PAYMENT_INTENT_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found for webhook event',
      };
    }

    request.log.error({ err: error, payload }, 'Failed to process mock payment webhook');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to process webhook event',
    };
  } finally {
    client.release();
  }
});

app.post('/payouts/webhooks/mock', async (request, reply) => {
  const bodySchema = z.object({
    gatewayId: z.string().min(2).max(80).default('mock_fiat_gbp'),
    providerEventId: z.string().min(4).max(140),
    eventType: z.string().min(3).max(120),
    payoutRequestId: z.string().min(4).max(140),
    status: z.enum(['processing', 'paid', 'failed', 'cancelled']),
    providerPayoutRef: z.string().min(4).max(140).optional(),
    failureReason: z.string().max(240).optional(),
    payload: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body);

  if (!config.apiEnableMockWebhooks) {
    reply.code(404);
    return {
      ok: false,
      error: 'Mock payout webhook endpoint is disabled',
    };
  }

  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const gateway = await client.query<{ id: string }>(
      'SELECT id FROM payment_gateways WHERE id = $1 LIMIT 1',
      [payload.gatewayId]
    );

    if (!gateway.rowCount) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Webhook gateway is unknown',
      };
    }

    const payoutRequest = await client.query<{ id: string; user_id: string }>(
      'SELECT id, user_id FROM payout_requests WHERE id = $1 LIMIT 1',
      [payload.payoutRequestId]
    );

    if (!payoutRequest.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Payout request not found for webhook event',
      };
    }

    const webhookInsert = await client.query<{ id: number }>(
      `
        INSERT INTO payment_webhook_events (
          gateway_id,
          provider_event_id,
          event_type,
          intent_id,
          payload
        )
        VALUES ($1, $2, $3, NULL, $4::jsonb)
        ON CONFLICT (gateway_id, provider_event_id)
        DO NOTHING
        RETURNING id
      `,
      [
        payload.gatewayId,
        payload.providerEventId,
        payload.eventType,
        toJsonString({
          kind: 'payout_webhook',
          payoutRequestId: payload.payoutRequestId,
          status: payload.status,
          providerPayoutRef: payload.providerPayoutRef,
          ...(payload.payload ?? {}),
        }),
      ]
    );

    if (!webhookInsert.rowCount) {
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: true,
      };
    }

    const settled = await settlePayoutRequest(client, {
      userId: payoutRequest.rows[0].user_id,
      requestId: payload.payoutRequestId,
      targetStatus: payload.status,
      providerPayoutRef: payload.providerPayoutRef,
      failureReason: payload.failureReason,
      metadata: payload.payload,
      source: 'mock_webhook',
    });

    await client.query(
      'UPDATE payment_webhook_events SET processed_at = NOW() WHERE id = $1',
      [webhookInsert.rows[0].id]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      duplicate: false,
      idempotent: settled.idempotent,
      payoutRequest: settled.payoutRequest,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'PAYOUT_REQUEST_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'PAYOUT_INVALID_TRANSITION') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        balance: apiError.details,
      };
    }

    request.log.error({ err: error, payload }, 'Failed to process mock payout webhook');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to process payout webhook event',
    };
  } finally {
    client.release();
  }
});

app.post('/webhooks/:provider', async (request, reply) => {
  const paramsSchema = z.object({ provider: z.string().min(3).max(40) });
  const { provider: providerSegment } = paramsSchema.parse(request.params);
  const provider = resolveProviderFromPathSegment(providerSegment);

  if (!provider) {
    reply.code(404);
    return {
      ok: false,
      error: 'Unsupported webhook provider',
    };
  }

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const rawBody =
    typeof request.rawBody === 'string'
      ? request.rawBody
      : request.rawBody
        ? request.rawBody.toString('utf8')
        : toJsonString(request.body ?? {});
  const verification = await verifyAndNormalizeWebhook(
    provider,
    rawBody,
    request.headers as Record<string, unknown>,
    request.body
  );

  if (!verification.verified || !verification.event) {
    reply.code(401);
    return {
      ok: false,
      error: verification.reason ?? 'Webhook signature verification failed',
    };
  }

  const event = verification.event;
  const expectedGateway = expectedGatewayIdForProvider(provider);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const gateway = await client.query<{ id: string }>(
      'SELECT id FROM payment_gateways WHERE id = $1 LIMIT 1',
      [expectedGateway]
    );

    if (!gateway.rowCount) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: `Gateway '${expectedGateway}' is not configured`,
      };
    }

    let intentRow: PaymentIntentRow | null = null;
    if (event.intentId) {
      const byId = await client.query<PaymentIntentRow>(
        `
          SELECT
            id,
            user_id,
            gateway_id,
            channel,
            order_id,
            syndicate_order_id,
            instrument_id,
            amount_gbp,
            amount_currency,
            status,
            provider_intent_ref,
            client_secret,
            provider_status,
            next_action_url,
            sca_expires_at,
            settled_at,
            failure_code,
            failure_message,
            created_at,
            updated_at
          FROM payment_intents
          WHERE id = $1
          LIMIT 1
        `,
        [event.intentId]
      );
      intentRow = byId.rows[0] ?? null;
    }

    if (!intentRow && event.providerIntentRef) {
      intentRow = await findPaymentIntentByProviderRef(client, expectedGateway, event.providerIntentRef);
    }

    const webhookInsert = await client.query<{ id: number }>(
      `
        INSERT INTO payment_webhook_events (
          gateway_id,
          provider_event_id,
          event_type,
          intent_id,
          payload
        )
        VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (gateway_id, provider_event_id)
        DO NOTHING
        RETURNING id
      `,
      [
        expectedGateway,
        event.providerEventId,
        event.eventType,
        intentRow?.id ?? null,
        toJsonString(event.rawPayload),
      ]
    );

    if (!webhookInsert.rowCount) {
      await client.query('COMMIT');
      return {
        ok: true,
        duplicate: true,
      };
    }

    let settledIntent: ReturnType<typeof toPaymentIntentPayload> | undefined;
    let settledPayout: ReturnType<typeof toPayoutRequestPayload> | undefined;

    if (event.paymentStatus && intentRow) {
      if (['succeeded', 'failed', 'cancelled'].includes(event.paymentStatus)) {
        const settled = await settlePaymentIntent(client, {
          intentId: intentRow.id,
          finalStatus: event.paymentStatus as PaymentIntentTerminalStatus,
          providerAttemptRef: event.providerEventId,
          failureCode: event.paymentStatus === 'failed' ? 'provider_failed' : undefined,
          failureMessage: event.paymentStatus === 'failed' ? `Provider event ${event.eventType}` : undefined,
          rawPayload: {
            source: 'provider_webhook',
            provider,
            eventType: event.eventType,
            payload: event.rawPayload,
          },
        });
        settledIntent = settled.intent;
      } else {
        const transitioned = await transitionPaymentIntentStatus(client, {
          intentId: intentRow.id,
          nextStatus: event.paymentStatus as Exclude<ProviderPaymentStatus, 'succeeded' | 'failed' | 'cancelled'>,
          providerStatus: event.eventType,
          nextActionUrl: (event.metadata.nextActionUrl as string | undefined) ?? null,
          metadataPatch: {
            source: 'provider_webhook',
            provider,
            eventType: event.eventType,
          },
        });
        settledIntent = transitioned.intent;
      }
    }

    if (event.refund && intentRow) {
      await upsertPaymentRefund(client, {
        intentId: intentRow.id,
        gatewayId: expectedGateway,
        providerRefundRef: event.refund.providerRefundRef,
        status: event.refund.status,
        amount: event.refund.amount,
        currency: event.refund.currency,
        reason: event.refund.reason,
        metadata: {
          provider,
          eventType: event.eventType,
        },
      });
    }

    if (event.dispute) {
      await upsertPaymentDispute(client, {
        intentId: intentRow?.id,
        gatewayId: expectedGateway,
        providerDisputeRef: event.dispute.providerDisputeRef,
        status: event.dispute.status,
        amount: event.dispute.amount,
        currency: event.dispute.currency,
        reason: event.dispute.reason,
        metadata: {
          provider,
          eventType: event.eventType,
        },
      });
    }

    if (event.payoutRequestId && event.payoutStatus) {
      const payoutRow = await client.query<{ id: string; user_id: string }>(
        'SELECT id, user_id FROM payout_requests WHERE id = $1 LIMIT 1',
        [event.payoutRequestId]
      );

      if (payoutRow.rowCount) {
        const payoutSettled = await settlePayoutRequest(client, {
          userId: payoutRow.rows[0].user_id,
          requestId: payoutRow.rows[0].id,
          targetStatus: event.payoutStatus,
          providerPayoutRef: event.providerIntentRef,
          failureReason: event.payoutStatus === 'failed' ? `Provider event ${event.eventType}` : undefined,
          metadata: {
            provider,
            eventType: event.eventType,
          },
          source: 'provider_webhook',
        });
        settledPayout = payoutSettled.payoutRequest;
      }
    }

    await client.query('UPDATE payment_webhook_events SET processed_at = NOW() WHERE id = $1', [
      webhookInsert.rows[0].id,
    ]);

    await client.query('COMMIT');
    return {
      ok: true,
      duplicate: false,
      unresolved: !intentRow && !event.payoutRequestId,
      intent: settledIntent,
      payoutRequest: settledPayout,
      refundRecorded: Boolean(event.refund),
      disputeRecorded: Boolean(event.dispute),
    };
  } catch (error) {
    await client.query('ROLLBACK');

    if ((error as Error).message === 'PAYMENT_INTENT_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: 'Payment intent not found for webhook event',
      };
    }

    const apiError = getApiError(error);
    if (apiError?.code === 'PAYOUT_INVALID_TRANSITION' || apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, provider, event }, 'Failed to process provider webhook');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to process provider webhook',
    };
  } finally {
    client.release();
  }
});

app.post('/orders', async (request, reply) => {
  const bodySchema = z.object({
    orderId: z.string().min(4).max(64).optional(),
    buyerId: z.string().min(2),
    listingId: z.string().min(2),
    addressId: z.coerce.number().int().positive().optional(),
    paymentMethodId: z.coerce.number().int().positive().optional(),
    platformChargeGbp: z.number().min(0).optional(),
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
  const platformChargeGbp =
    payload.platformChargeGbp !== undefined
      ? roundTo(payload.platformChargeGbp, 2)
      : payload.buyerProtectionFeeGbp !== undefined
        ? roundTo(payload.buyerProtectionFeeGbp, 2)
        : calculateCommercePlatformChargeGbp(subtotalGbp);
  const totalGbp = roundTo(subtotalGbp + platformChargeGbp, 2);

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
      platformChargeGbp,
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
      platformChargeGbp: Number(insertResult.rows[0].buyer_protection_fee_gbp),
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

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const paid = await client.query<{
      id: string;
      status: string;
      updated_at: string;
      buyer_id: string;
      seller_id: string;
      subtotal_gbp: number | string;
      buyer_protection_fee_gbp: number | string;
      total_gbp: number | string;
    }>(
      `
        UPDATE orders
        SET status = 'paid', updated_at = NOW()
        WHERE id = $1 AND status = 'created'
        RETURNING
          id,
          status,
          updated_at,
          buyer_id,
          seller_id,
          subtotal_gbp,
          buyer_protection_fee_gbp,
          total_gbp
      `,
      [orderId]
    );

    if (!paid.rowCount) {
      const existing = await client.query<{ id: string; status: string }>(
        'SELECT id, status FROM orders WHERE id = $1 LIMIT 1',
        [orderId]
      );

      await client.query('ROLLBACK');

      if (!existing.rowCount) {
        reply.code(404);
        return { ok: false, error: 'Order not found' };
      }

      reply.code(409);
      return { ok: false, error: `Order cannot be paid from status '${existing.rows[0].status}'` };
    }

    const paidRow = paid.rows[0];

    if (await ledgerTablesAvailable(client)) {
      await postCommerceOrderLedgerEntries(client, {
        orderId: paidRow.id,
        buyerId: paidRow.buyer_id,
        sellerId: paidRow.seller_id,
        subtotalGbp: Number(paidRow.subtotal_gbp),
        platformChargeGbp: Number(paidRow.buyer_protection_fee_gbp),
        totalGbp: Number(paidRow.total_gbp),
      });
    }

    await client.query('COMMIT');

    const platformChargeCreditedGbp = Number(paidRow.buyer_protection_fee_gbp);

    return {
      ok: true,
      id: paidRow.id,
      status: paidRow.status,
      updatedAt: paidRow.updated_at,
      settlement: {
        buyerChargedGbp: Number(paidRow.total_gbp),
        sellerPayableCreditedGbp: Number(paidRow.subtotal_gbp),
        platformCommissionCreditedGbp: platformChargeCreditedGbp,
        platformChargeCreditedGbp,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error, orderId }, 'Order payment settlement failed');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to settle payment for order',
    };
  } finally {
    client.release();
  }
});

app.get('/orders/:orderId/ledger', async (request) => {
  const paramsSchema = z.object({ orderId: z.string().min(4).max(64) });
  const { orderId } = paramsSchema.parse(request.params);

  if (!(await ledgerTablesAvailable(db))) {
    return {
      ok: true,
      items: [],
    };
  }

  const result = await db.query<{
    id: number;
    direction: 'debit' | 'credit';
    amount_gbp: number | string;
    source_type: string;
    line_type: string;
    created_at: string;
    account_code: string;
    owner_type: 'platform' | 'user';
    owner_id: string;
    counterparty_account_code: string;
    counterparty_owner_type: 'platform' | 'user';
    counterparty_owner_id: string;
  }>(
    `
      SELECT
        le.id,
        le.direction,
        le.amount_gbp,
        le.source_type,
        le.line_type,
        le.created_at,
        account_entry.account_code,
        account_entry.owner_type,
        account_entry.owner_id,
        counterparty.account_code AS counterparty_account_code,
        counterparty.owner_type AS counterparty_owner_type,
        counterparty.owner_id AS counterparty_owner_id
      FROM ledger_entries le
      INNER JOIN ledger_accounts account_entry
        ON account_entry.id = le.account_id
      INNER JOIN ledger_accounts counterparty
        ON counterparty.id = le.counterparty_account_id
      WHERE le.source_type = 'order_payment'
        AND le.source_id = $1
      ORDER BY le.created_at ASC, le.id ASC
    `,
    [orderId]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      direction: row.direction,
      amountGbp: Number(row.amount_gbp),
      sourceType: row.source_type,
      lineType: row.line_type,
      createdAt: row.created_at,
      account: {
        ownerType: row.owner_type,
        ownerId: row.owner_id,
        code: row.account_code,
      },
      counterparty: {
        ownerType: row.counterparty_owner_type,
        ownerId: row.counterparty_owner_id,
        code: row.counterparty_account_code,
      },
    })),
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
  const platformChargeGbp = Number(row.buyer_protection_fee_gbp);
  return {
    ok: true,
    order: {
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      listingId: row.listing_id,
      subtotalGbp: Number(row.subtotal_gbp),
      buyerProtectionFeeGbp: platformChargeGbp,
      platformChargeGbp,
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
    status: 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected' | null;
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
          CASE
            WHEN a.status = 'ended' AND a.winner_bid_id = ab.id
              THEN ROUND(ab.amount_gbp * $6::numeric, 2)
            ELSE NULL::NUMERIC
          END AS fee_gbp,
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
    [userId, channel, cursorTs ?? null, cursorId ?? null, fetchLimit, AUCTION_PLATFORM_FEE_RATE]
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
  let amlAlert: { alertId: string; status: string } | null = null;
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

    const eligibility = await evaluateMarketEligibility(client, {
      userId: payload.bidderId,
      market: 'auctions',
      orderNotionalGbp: amountGbp,
    });

    if (!eligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'auction.bid.blocked.eligibility',
        subjectUserId: payload.bidderId,
        payload: {
          auctionId,
          amountGbp,
          code: eligibility.code,
          message: eligibility.message,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: eligibility.message,
        code: eligibility.code,
      };
    }

    const amlAssessment = await evaluateAmlRisk(client, {
      userId: payload.bidderId,
      market: 'auctions',
      amountGbp,
      counterpartyUserId: auction.seller_id,
    });

    if (amlAssessment.shouldBlock) {
      await client.query('ROLLBACK');

      if (amlAssessment.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.bidderId,
          relatedUserId: auction.seller_id,
          market: 'auctions',
          eventType: 'bid',
          amountGbp,
          referenceId: auctionId,
          ruleCode: 'AML_PRE_TRADE_BLOCK',
          notes: 'Auction bid blocked by AML pre-trade evaluation',
          context: {
            auctionId,
            bidderId: payload.bidderId,
            sellerId: auction.seller_id,
          },
          assessment: amlAssessment,
        });
      }

      await appendComplianceAuditSafe(request, {
        eventType: 'auction.bid.blocked.aml',
        subjectUserId: payload.bidderId,
        payload: {
          auctionId,
          amountGbp,
          riskScore: amlAssessment.riskScore,
          riskLevel: amlAssessment.riskLevel,
          alertId: amlAlert?.alertId ?? null,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: 'Bid blocked by AML controls. Please contact support for manual review.',
        code: 'AML_BLOCKED',
        riskLevel: amlAssessment.riskLevel,
        alertId: amlAlert?.alertId ?? null,
      };
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

    if (amlAssessment.shouldCreateAlert) {
      amlAlert = await createAmlAlert(client, {
        userId: payload.bidderId,
        relatedUserId: auction.seller_id,
        market: 'auctions',
        eventType: 'bid',
        amountGbp,
        referenceId: auctionId,
        ruleCode: 'AML_POST_BID_MONITOR',
        notes: 'Auction bid generated elevated AML risk score',
        context: {
          auctionId,
          bidderId: payload.bidderId,
          sellerId: auction.seller_id,
        },
        assessment: amlAssessment,
      });
    }

    await client.query('COMMIT');

    publishRealtimeEvent({
      topic: `auction:${auctionId}`,
      type: 'auction.bid.created',
      payload: {
        auctionId,
        bidderId: payload.bidderId,
        amountGbp,
        bidCount: nextBidCount,
      },
    });

    publishRealtimeEvent({
      topic: 'auctions.market',
      type: 'auction.bid.created',
      payload: {
        auctionId,
        currentBidGbp: amountGbp,
        bidCount: nextBidCount,
      },
    });

    if (auction.seller_id !== payload.bidderId) {
      try {
        await queueUserNotification({
          userId: auction.seller_id,
          title: 'New auction bid',
          body: `A new bid was placed on auction ${auctionId}.`,
          payload: {
            auctionId,
            bidderId: payload.bidderId,
            amountGbp,
            event: 'auction_bid',
          },
          metadata: {
            source: 'auction_bid_route',
          },
        });
      } catch (error) {
        request.log.error({ err: error, auctionId }, 'Failed to queue seller bid notification');
      }
    }

    await appendComplianceAuditSafe(request, {
      eventType: 'auction.bid.created',
      subjectUserId: payload.bidderId,
      payload: {
        auctionId,
        amountGbp,
        bidCount: nextBidCount,
        amlAlertId: amlAlert?.alertId ?? null,
      },
    });

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
      aml: amlAlert
        ? {
          alertId: amlAlert.alertId,
          status: amlAlert.status,
        }
        : null,
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
    totalUnits: z.number().int().min(1).max(20),
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

type SyndicateOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
type SyndicateOrderType = 'market' | 'limit';

interface SyndicateHoldingRow {
  user_id: string;
  asset_id: string;
  units_owned: number;
  avg_entry_price_gbp: number | string;
  realized_pnl_gbp: number | string;
}

async function getSyndicateHoldingForUpdate(
  client: PoolClient,
  userId: string,
  assetId: string
): Promise<SyndicateHoldingRow | null> {
  const result = await client.query<SyndicateHoldingRow>(
    `
      SELECT
        user_id,
        asset_id,
        units_owned,
        avg_entry_price_gbp,
        realized_pnl_gbp
      FROM syndicate_holdings
      WHERE user_id = $1
        AND asset_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [userId, assetId]
  );

  return result.rows[0] ?? null;
}

async function saveSyndicateHolding(
  client: PoolClient,
  input: {
    userId: string;
    assetId: string;
    unitsOwned: number;
    avgEntryPriceGbp: number;
    realizedPnlGbp: number;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO syndicate_holdings (
        user_id,
        asset_id,
        units_owned,
        avg_entry_price_gbp,
        realized_pnl_gbp,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, asset_id)
      DO UPDATE
        SET
          units_owned = EXCLUDED.units_owned,
          avg_entry_price_gbp = EXCLUDED.avg_entry_price_gbp,
          realized_pnl_gbp = EXCLUDED.realized_pnl_gbp,
          updated_at = NOW()
    `,
    [
      input.userId,
      input.assetId,
      Math.max(0, Math.floor(input.unitsOwned)),
      roundTo(Math.max(0, input.avgEntryPriceGbp), 4),
      roundTo(input.realizedPnlGbp, 4),
    ]
  );
}

async function applySyndicateTransfer(
  client: PoolClient,
  input: {
    assetId: string;
    buyerId: string;
    sellerId: string;
    units: number;
    unitPriceGbp: number;
    feeGbp: number;
    sourceType: 'syndicate_trade' | 'buyout';
    buyOrderId?: number | null;
    sellOrderId?: number | null;
    enforceSellerHolding: boolean;
  }
): Promise<{ notionalGbp: number; feeGbp: number }> {
  const units = Math.max(0, Math.floor(input.units));
  if (units <= 0) {
    return {
      notionalGbp: 0,
      feeGbp: 0,
    };
  }

  const buyerHolding = await getSyndicateHoldingForUpdate(client, input.buyerId, input.assetId);
  const sellerHolding = await getSyndicateHoldingForUpdate(client, input.sellerId, input.assetId);

  if (input.enforceSellerHolding) {
    const sellerUnits = sellerHolding?.units_owned ?? 0;
    if (sellerUnits < units) {
      throw createApiError('SYNDICATE_SELLER_UNITS_INSUFFICIENT', 'Seller does not have enough units', {
        sellerId: input.sellerId,
        availableUnits: sellerUnits,
        requestedUnits: units,
      });
    }
  }

  const buyerUnitsBefore = buyerHolding?.units_owned ?? 0;
  const buyerAvgBefore = Number(buyerHolding?.avg_entry_price_gbp ?? 0);
  const buyerRealizedBefore = Number(buyerHolding?.realized_pnl_gbp ?? 0);
  const buyerUnitsAfter = buyerUnitsBefore + units;
  const buyerAvgAfter =
    buyerUnitsAfter > 0
      ? (buyerAvgBefore * buyerUnitsBefore + input.unitPriceGbp * units) / buyerUnitsAfter
      : input.unitPriceGbp;

  await saveSyndicateHolding(client, {
    userId: input.buyerId,
    assetId: input.assetId,
    unitsOwned: buyerUnitsAfter,
    avgEntryPriceGbp: buyerAvgAfter,
    realizedPnlGbp: buyerRealizedBefore,
  });

  if (input.enforceSellerHolding) {
    const sellerUnitsBefore = sellerHolding?.units_owned ?? 0;
    const sellerAvgBefore = Number(sellerHolding?.avg_entry_price_gbp ?? 0);
    const sellerRealizedBefore = Number(sellerHolding?.realized_pnl_gbp ?? 0);
    const sellerUnitsAfter = sellerUnitsBefore - units;
    const realizedDelta = (input.unitPriceGbp - sellerAvgBefore) * units;

    await saveSyndicateHolding(client, {
      userId: input.sellerId,
      assetId: input.assetId,
      unitsOwned: sellerUnitsAfter,
      avgEntryPriceGbp: sellerUnitsAfter > 0 ? sellerAvgBefore : 0,
      realizedPnlGbp: sellerRealizedBefore + realizedDelta,
    });
  }

  const notionalGbp = roundTo(units * input.unitPriceGbp, 4);

  await client.query(
    `
      INSERT INTO syndicate_trades (
        asset_id,
        buy_order_id,
        sell_order_id,
        buyer_id,
        seller_id,
        units,
        unit_price_gbp,
        notional_gbp,
        fee_gbp
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [
      input.assetId,
      input.buyOrderId ?? null,
      input.sellOrderId ?? null,
      input.buyerId,
      input.sellerId,
      units,
      input.unitPriceGbp,
      notionalGbp,
      input.feeGbp,
    ]
  );

  return {
    notionalGbp,
    feeGbp: input.feeGbp,
  };
}

async function recalcSyndicateHolders(client: PoolClient, assetId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM syndicate_holdings
      WHERE asset_id = $1
        AND units_owned > 0
    `,
    [assetId]
  );

  return Number(result.rows[0]?.count ?? '0');
}

app.get('/syndicate/assets/:assetId/orders', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    status: z.enum(['open', 'partially_filled', 'filled', 'cancelled', 'rejected']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { status, limit } = querySchema.parse(request.query);

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
    order_type: SyndicateOrderType;
    limit_price_gbp: number | string | null;
    units: number;
    remaining_units: number;
    filled_units: number;
    unit_price_gbp: number | string;
    fee_gbp: number | string;
    total_gbp: number | string;
    status: SyndicateOrderStatus;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        asset_id,
        user_id,
        side,
        order_type,
        limit_price_gbp,
        units,
        remaining_units,
        filled_units,
        unit_price_gbp,
        fee_gbp,
        total_gbp,
        status,
        created_at,
        updated_at
      FROM syndicate_orders
      WHERE asset_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [assetId, status ?? null, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      userId: row.user_id,
      side: row.side,
      orderType: row.order_type,
      limitPriceGbp: row.limit_price_gbp === null ? null : Number(row.limit_price_gbp),
      units: row.units,
      remainingUnits: row.remaining_units,
      filledUnits: row.filled_units,
      unitPriceGbp: Number(row.unit_price_gbp),
      feeGbp: Number(row.fee_gbp),
      totalGbp: Number(row.total_gbp),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.get('/syndicate/assets/:assetId/orderbook', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(40),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const assetExists = await db.query('SELECT id FROM syndicate_assets WHERE id = $1 LIMIT 1', [assetId]);
  if (!assetExists.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Syndicate asset not found' };
  }

  const result = await db.query<{
    side: 'buy' | 'sell';
    unit_price_gbp: string;
    units: string;
    order_count: string;
  }>(
    `
      SELECT
        side,
        unit_price_gbp::text,
        SUM(remaining_units)::text AS units,
        COUNT(*)::text AS order_count
      FROM syndicate_orders
      WHERE asset_id = $1
        AND status IN ('open', 'partially_filled')
        AND remaining_units > 0
      GROUP BY side, unit_price_gbp
      ORDER BY
        CASE WHEN side = 'buy' THEN unit_price_gbp END DESC,
        CASE WHEN side = 'sell' THEN unit_price_gbp END ASC,
        side ASC
      LIMIT $2
    `,
    [assetId, limit]
  );

  return {
    ok: true,
    bids: result.rows
      .filter((row) => row.side === 'buy')
      .map((row) => ({
        side: row.side,
        unitPriceGbp: Number(row.unit_price_gbp),
        units: Number(row.units),
        orderCount: Number(row.order_count),
      })),
    asks: result.rows
      .filter((row) => row.side === 'sell')
      .map((row) => ({
        side: row.side,
        unitPriceGbp: Number(row.unit_price_gbp),
        units: Number(row.units),
        orderCount: Number(row.order_count),
      })),
  };
});

app.get('/syndicate/assets/:assetId/holdings', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const result = await db.query<{
    user_id: string;
    units_owned: number;
    avg_entry_price_gbp: string;
    realized_pnl_gbp: string;
    updated_at: string;
  }>(
    `
      SELECT
        user_id,
        units_owned,
        avg_entry_price_gbp::text,
        realized_pnl_gbp::text,
        updated_at::text
      FROM syndicate_holdings
      WHERE asset_id = $1
      ORDER BY units_owned DESC, updated_at DESC
      LIMIT $2
    `,
    [assetId, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      userId: row.user_id,
      unitsOwned: row.units_owned,
      avgEntryPriceGbp: Number(row.avg_entry_price_gbp),
      realizedPnlGbp: Number(row.realized_pnl_gbp),
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/syndicate/assets/:assetId/orders', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const bodySchema = z.object({
    userId: z.string().min(2),
    side: z.enum(['buy', 'sell']),
    units: z.number().int().min(1).max(20),
    orderType: z.enum(['market', 'limit']).default('market'),
    limitPriceGbp: z.number().positive().optional(),
  }).superRefine((value, ctx) => {
    if (value.orderType === 'limit' && !value.limitPriceGbp) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'limitPriceGbp is required for limit orders',
        path: ['limitPriceGbp'],
      });
    }

    if (value.orderType === 'market' && value.limitPriceGbp !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'limitPriceGbp is only valid for limit orders',
        path: ['limitPriceGbp'],
      });
    }
  });

  const { assetId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);
  await ensureUserExists(payload.userId);

  const client = await db.connect();
  let amlAlert: { alertId: string; status: string } | null = null;
  try {
    await client.query('BEGIN');

    const assetResult = await client.query<{
      id: string;
      issuer_id: string;
      total_units: number;
      available_units: number;
      unit_price_gbp: number | string;
      unit_price_stable: number | string;
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
          unit_price_stable,
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

    const referencePriceGbp = Number(asset.unit_price_gbp);
    const proposedUnitPrice =
      payload.orderType === 'limit'
        ? roundTo(payload.limitPriceGbp ?? referencePriceGbp, 4)
        : referencePriceGbp;
    const proposedNotionalGbp = roundTo(Math.max(0, payload.units) * proposedUnitPrice, 2);

    const eligibility = await evaluateMarketEligibility(client, {
      userId: payload.userId,
      market: 'syndicate',
      orderNotionalGbp: proposedNotionalGbp,
    });

    if (!eligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'syndicate.order.blocked.eligibility',
        subjectUserId: payload.userId,
        payload: {
          assetId,
          side: payload.side,
          units: payload.units,
          orderType: payload.orderType,
          orderNotionalGbp: proposedNotionalGbp,
          code: eligibility.code,
          message: eligibility.message,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: eligibility.message,
        code: eligibility.code,
      };
    }

    const preTradeAml = await evaluateAmlRisk(client, {
      userId: payload.userId,
      market: 'syndicate',
      amountGbp: proposedNotionalGbp,
      counterpartyUserId: asset.issuer_id,
    });

    if (preTradeAml.shouldBlock) {
      await client.query('ROLLBACK');

      if (preTradeAml.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.userId,
          relatedUserId: asset.issuer_id,
          market: 'syndicate',
          eventType: 'trade',
          amountGbp: proposedNotionalGbp,
          referenceId: `${assetId}:pretrade`,
          ruleCode: 'AML_PRE_TRADE_BLOCK',
          notes: 'Syndicate order blocked by AML pre-trade evaluation',
          context: {
            assetId,
            side: payload.side,
            units: payload.units,
            orderType: payload.orderType,
          },
          assessment: preTradeAml,
        });
      }

      await appendComplianceAuditSafe(request, {
        eventType: 'syndicate.order.blocked.aml',
        subjectUserId: payload.userId,
        payload: {
          assetId,
          side: payload.side,
          units: payload.units,
          orderType: payload.orderType,
          orderNotionalGbp: proposedNotionalGbp,
          riskScore: preTradeAml.riskScore,
          riskLevel: preTradeAml.riskLevel,
          alertId: amlAlert?.alertId ?? null,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: 'Order blocked by AML controls. Please contact support for review.',
        code: 'AML_BLOCKED',
        riskLevel: preTradeAml.riskLevel,
        alertId: amlAlert?.alertId ?? null,
      };
    }

    if (payload.side === 'sell') {
      const sellerHolding = await getSyndicateHoldingForUpdate(client, payload.userId, assetId);
      const sellerUnits = sellerHolding?.units_owned ?? 0;
      if (sellerUnits < payload.units) {
        await client.query('ROLLBACK');
        reply.code(409);
        return {
          ok: false,
          error: `Insufficient units to sell. Available: ${sellerUnits}`,
        };
      }
    }

    const orderPriceGbp =
      payload.orderType === 'limit' ? roundTo(payload.limitPriceGbp ?? referencePriceGbp, 4) : referencePriceGbp;

    const orderResult = await client.query<{
      id: number;
      side: 'buy' | 'sell';
      units: number;
      remaining_units: number;
      filled_units: number;
      unit_price_gbp: string;
      fee_gbp: string;
      total_gbp: string;
      created_at: string;
    }>(
      `
        INSERT INTO syndicate_orders (
          asset_id,
          user_id,
          side,
          order_type,
          limit_price_gbp,
          units,
          remaining_units,
          filled_units,
          unit_price_gbp,
          fee_gbp,
          total_gbp,
          updated_at,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $6, 0, $7, 0, 0, NOW(), 'open')
        RETURNING id, side, units, remaining_units, filled_units, unit_price_gbp::text, fee_gbp::text, total_gbp::text, created_at
      `,
      [
        assetId,
        payload.userId,
        payload.side,
        payload.orderType,
        payload.orderType === 'limit' ? payload.limitPriceGbp : null,
        payload.units,
        orderPriceGbp,
      ]
    );

    const incomingOrderId = orderResult.rows[0].id;
    let remainingUnits = payload.units;
    let filledUnits = 0;
    let tradedNotionalGbp = 0;
    let tradedFeeGbp = 0;
    let nextAvailableUnits = asset.available_units;

    const restingOrders = await client.query<{
      id: number;
      user_id: string;
      side: 'buy' | 'sell';
      units: number;
      remaining_units: number;
      filled_units: number;
      unit_price_gbp: string;
      fee_gbp: string;
      total_gbp: string;
    }>(
      `
        SELECT
          id,
          user_id,
          side,
          units,
          remaining_units,
          filled_units,
          unit_price_gbp::text,
          fee_gbp::text,
          total_gbp::text
        FROM syndicate_orders
        WHERE asset_id = $1
          AND side = $2
          AND status IN ('open', 'partially_filled')
          AND id <> $3
          AND (
            $4::numeric IS NULL
            OR (
              $5 = 'buy' AND unit_price_gbp <= $4
            )
            OR (
              $5 = 'sell' AND unit_price_gbp >= $4
            )
          )
        ORDER BY
          CASE WHEN $5 = 'buy' THEN unit_price_gbp END ASC,
          CASE WHEN $5 = 'sell' THEN unit_price_gbp END DESC,
          id ASC
        FOR UPDATE
      `,
      [
        assetId,
        payload.side === 'buy' ? 'sell' : 'buy',
        incomingOrderId,
        payload.orderType === 'limit' ? payload.limitPriceGbp : null,
        payload.side,
      ]
    );

    for (const resting of restingOrders.rows) {
      if (remainingUnits <= 0) {
        break;
      }

      const restingRemaining = resting.remaining_units;
      if (restingRemaining <= 0) {
        continue;
      }

      const fillUnits = Math.min(remainingUnits, restingRemaining);
      const tradePrice = Number(resting.unit_price_gbp);
      const tradeNotional = roundTo(fillUnits * tradePrice, 4);
      const tradeFee = roundTo(tradeNotional * SYNDICATE_TRADE_FEE_RATE, 4);

      if (payload.side === 'buy') {
        await applySyndicateTransfer(client, {
          assetId,
          buyerId: payload.userId,
          sellerId: resting.user_id,
          units: fillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'syndicate_trade',
          buyOrderId: incomingOrderId,
          sellOrderId: resting.id,
          enforceSellerHolding: true,
        });
      } else {
        await applySyndicateTransfer(client, {
          assetId,
          buyerId: resting.user_id,
          sellerId: payload.userId,
          units: fillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'syndicate_trade',
          buyOrderId: resting.id,
          sellOrderId: incomingOrderId,
          enforceSellerHolding: true,
        });
      }

      tradedNotionalGbp = roundTo(tradedNotionalGbp + tradeNotional, 4);
      tradedFeeGbp = roundTo(tradedFeeGbp + tradeFee, 4);
      remainingUnits -= fillUnits;
      filledUnits += fillUnits;

      const restingRemainingAfter = restingRemaining - fillUnits;
      const restingFilledAfter = resting.filled_units + fillUnits;
      const restingStatus: SyndicateOrderStatus =
        restingRemainingAfter <= 0 ? 'filled' : 'partially_filled';
      const restingTradeNet =
        resting.side === 'buy'
          ? roundTo(tradeNotional + tradeFee, 4)
          : roundTo(Math.max(0, tradeNotional - tradeFee), 4);
      const restingTotalAfter = roundTo(Number(resting.total_gbp) + restingTradeNet, 4);
      const restingFeeAfter = roundTo(Number(resting.fee_gbp) + tradeFee, 4);

      await client.query(
        `
          UPDATE syndicate_orders
          SET
            remaining_units = $2,
            filled_units = $3,
            fee_gbp = $4,
            total_gbp = $5,
            status = $6,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          resting.id,
          Math.max(0, restingRemainingAfter),
          restingFilledAfter,
          restingFeeAfter,
          restingTotalAfter,
          restingStatus,
        ]
      );
    }

    if (
      payload.side === 'buy'
      && remainingUnits > 0
      && (payload.orderType === 'market' || (payload.limitPriceGbp ?? 0) >= referencePriceGbp)
      && nextAvailableUnits > 0
    ) {
      const primaryFillUnits = Math.min(remainingUnits, nextAvailableUnits);
      if (primaryFillUnits > 0) {
        const tradePrice = referencePriceGbp;
        const tradeNotional = roundTo(primaryFillUnits * tradePrice, 4);
        const tradeFee = roundTo(tradeNotional * SYNDICATE_TRADE_FEE_RATE, 4);

        await applySyndicateTransfer(client, {
          assetId,
          buyerId: payload.userId,
          sellerId: asset.issuer_id,
          units: primaryFillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'syndicate_trade',
          buyOrderId: incomingOrderId,
          sellOrderId: null,
          enforceSellerHolding: false,
        });

        tradedNotionalGbp = roundTo(tradedNotionalGbp + tradeNotional, 4);
        tradedFeeGbp = roundTo(tradedFeeGbp + tradeFee, 4);
        remainingUnits -= primaryFillUnits;
        filledUnits += primaryFillUnits;
        nextAvailableUnits -= primaryFillUnits;
      }
    }

    let orderStatus: SyndicateOrderStatus;
    let persistedRemainingUnits = Math.max(0, remainingUnits);

    if (payload.orderType === 'market') {
      orderStatus = filledUnits > 0 ? 'filled' : 'rejected';
      persistedRemainingUnits = 0;
    } else if (filledUnits === 0) {
      orderStatus = 'open';
    } else if (remainingUnits > 0) {
      orderStatus = 'partially_filled';
    } else {
      orderStatus = 'filled';
    }

    const orderTotalGbp =
      payload.side === 'buy'
        ? roundTo(tradedNotionalGbp + tradedFeeGbp, 4)
        : roundTo(Math.max(0, tradedNotionalGbp - tradedFeeGbp), 4);

    const incomingOrder = await client.query<{
      id: number;
      created_at: string;
      updated_at: string;
      status: SyndicateOrderStatus;
      remaining_units: number;
      filled_units: number;
    }>(
      `
        UPDATE syndicate_orders
        SET
          remaining_units = $2,
          filled_units = $3,
          fee_gbp = $4,
          total_gbp = $5,
          status = $6,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, created_at, updated_at, status, remaining_units, filled_units
      `,
      [incomingOrderId, persistedRemainingUnits, filledUnits, tradedFeeGbp, orderTotalGbp, orderStatus]
    );

    const impactPct =
      filledUnits > 0
        ? Math.min(0.14, (filledUnits / Math.max(1, asset.total_units)) * 0.14)
        : 0;
    const nextUnitPriceGbp =
      filledUnits > 0
        ? payload.side === 'buy'
          ? roundTo(referencePriceGbp * (1 + impactPct), 4)
          : roundTo(Math.max(0.05, referencePriceGbp * (1 - impactPct)), 4)
        : referencePriceGbp;
    const stableRatio = Number(asset.unit_price_stable) / Math.max(referencePriceGbp, 0.0001);
    const nextUnitPriceStable = roundTo(nextUnitPriceGbp * stableRatio, 4);
    const nextMarketMovePct24h = roundTo(
      ((nextUnitPriceGbp - referencePriceGbp) / Math.max(referencePriceGbp, 0.0001)) * 100,
      3
    );
    const nextVolume24hGbp = roundTo(Number(asset.volume_24h_gbp) + tradedNotionalGbp, 2);
    const nextHolders = await recalcSyndicateHolders(client, assetId);

    const updatedAssetResult = await client.query<{
      id: string;
      available_units: number;
      holders: number;
      volume_24h_gbp: string;
      unit_price_gbp: string;
      unit_price_stable: string;
      market_move_pct_24h: string;
      updated_at: string;
    }>(
      `
        UPDATE syndicate_assets
        SET
          available_units = $2,
          holders = $3,
          volume_24h_gbp = $4,
          unit_price_gbp = $5,
          unit_price_stable = $6,
          market_move_pct_24h = $7,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          available_units,
          holders,
          volume_24h_gbp::text,
          unit_price_gbp::text,
          unit_price_stable::text,
          market_move_pct_24h::text,
          updated_at
      `,
      [
        assetId,
        nextAvailableUnits,
        nextHolders,
        nextVolume24hGbp,
        nextUnitPriceGbp,
        nextUnitPriceStable,
        nextMarketMovePct24h,
      ]
    );

    if (preTradeAml.shouldCreateAlert) {
      const monitoredAmount = tradedNotionalGbp > 0 ? tradedNotionalGbp : proposedNotionalGbp;
      amlAlert = await createAmlAlert(client, {
        userId: payload.userId,
        relatedUserId: asset.issuer_id,
        market: 'syndicate',
        eventType: 'trade',
        amountGbp: monitoredAmount,
        referenceId: String(incomingOrder.rows[0].id),
        ruleCode: 'AML_POST_TRADE_MONITOR',
        notes: 'Syndicate order generated elevated AML risk score',
        context: {
          assetId,
          side: payload.side,
          orderType: payload.orderType,
          units: payload.units,
          filledUnits: incomingOrder.rows[0].filled_units,
        },
        assessment: preTradeAml,
      });
    }

    await client.query('COMMIT');

    await appendComplianceAuditSafe(request, {
      eventType: 'syndicate.order.created',
      subjectUserId: payload.userId,
      payload: {
        assetId,
        orderId: incomingOrder.rows[0].id,
        side: payload.side,
        orderType: payload.orderType,
        units: payload.units,
        filledUnits: incomingOrder.rows[0].filled_units,
        remainingUnits: incomingOrder.rows[0].remaining_units,
        status: incomingOrder.rows[0].status,
        amlAlertId: amlAlert?.alertId ?? null,
      },
    });

    reply.code(201);
    return {
      ok: true,
      order: {
        id: incomingOrder.rows[0].id,
        assetId,
        userId: payload.userId,
        side: payload.side,
        orderType: payload.orderType,
        limitPriceGbp: payload.limitPriceGbp ?? null,
        units: payload.units,
        filledUnits: incomingOrder.rows[0].filled_units,
        remainingUnits: incomingOrder.rows[0].remaining_units,
        unitPriceGbp: orderPriceGbp,
        feeGbp: tradedFeeGbp,
        totalGbp: orderTotalGbp,
        status: incomingOrder.rows[0].status,
        createdAt: incomingOrder.rows[0].created_at,
        updatedAt: incomingOrder.rows[0].updated_at,
      },
      asset: {
        id: updatedAssetResult.rows[0].id,
        availableUnits: updatedAssetResult.rows[0].available_units,
        holders: updatedAssetResult.rows[0].holders,
        volume24hGbp: Number(updatedAssetResult.rows[0].volume_24h_gbp),
        unitPriceGbp: Number(updatedAssetResult.rows[0].unit_price_gbp),
        unitPriceStable: Number(updatedAssetResult.rows[0].unit_price_stable),
        marketMovePct24h: Number(updatedAssetResult.rows[0].market_move_pct_24h),
        updatedAt: updatedAssetResult.rows[0].updated_at,
      },
      aml: amlAlert
        ? {
          alertId: amlAlert.alertId,
          status: amlAlert.status,
        }
        : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'SYNDICATE_SELLER_UNITS_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    reply.code(500);
    return {
      ok: false,
      error: `Unable to place syndicate order: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

app.get('/syndicate/assets/:assetId/buyout-offers', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    status: z.enum(['open', 'accepted', 'expired', 'cancelled', 'rejected', 'settled']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { status, limit } = querySchema.parse(request.query);

  const result = await db.query<{
    id: string;
    asset_id: string;
    bidder_user_id: string;
    offer_price_gbp: string;
    target_units: number;
    accepted_units: number;
    status: string;
    expires_at: string;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        id,
        asset_id,
        bidder_user_id,
        offer_price_gbp::text,
        target_units,
        accepted_units,
        status,
        expires_at::text,
        metadata,
        created_at::text,
        updated_at::text
      FROM syndicate_buyout_offers
      WHERE asset_id = $1
        AND ($2::text IS NULL OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [assetId, status ?? null, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      id: row.id,
      assetId: row.asset_id,
      bidderUserId: row.bidder_user_id,
      offerPriceGbp: Number(row.offer_price_gbp),
      targetUnits: row.target_units,
      acceptedUnits: row.accepted_units,
      status: row.status,
      expiresAt: row.expires_at,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
});

app.post('/syndicate/assets/:assetId/buyout-offers', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const bodySchema = z.object({
    bidderUserId: z.string().min(2),
    offerPriceGbp: z.number().positive(),
    targetUnits: z.number().int().min(1).max(20).optional(),
    expiresInHours: z.number().int().min(1).max(168).default(24),
    metadata: z.record(z.unknown()).optional(),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.bidderUserId);

  const client = await db.connect();
  let amlAlert: { alertId: string; status: string } | null = null;
  try {
    await client.query('BEGIN');

    const assetResult = await client.query<{
      id: string;
      total_units: number;
      is_open: boolean;
    }>(
      `
        SELECT id, total_units, is_open
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
      return { ok: false, error: 'Syndicate asset is closed for buyout offers' };
    }

    const bidderHolding = await getSyndicateHoldingForUpdate(client, payload.bidderUserId, assetId);
    const bidderUnits = bidderHolding?.units_owned ?? 0;
    const inferredTarget = Math.max(0, asset.total_units - bidderUnits);
    const targetUnits = payload.targetUnits ?? inferredTarget;

    if (targetUnits <= 0) {
      await client.query('ROLLBACK');
      reply.code(409);
      return {
        ok: false,
        error: 'Bidder already controls all units for this asset',
      };
    }

    const offerNotionalGbp = roundTo(targetUnits * payload.offerPriceGbp, 2);

    const eligibility = await evaluateMarketEligibility(client, {
      userId: payload.bidderUserId,
      market: 'syndicate',
      orderNotionalGbp: offerNotionalGbp,
    });

    if (!eligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'buyout.offer.blocked.eligibility',
        subjectUserId: payload.bidderUserId,
        payload: {
          assetId,
          targetUnits,
          offerPriceGbp: payload.offerPriceGbp,
          offerNotionalGbp,
          code: eligibility.code,
          message: eligibility.message,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: eligibility.message,
        code: eligibility.code,
      };
    }

    const amlAssessment = await evaluateAmlRisk(client, {
      userId: payload.bidderUserId,
      market: 'syndicate',
      amountGbp: offerNotionalGbp,
    });

    if (amlAssessment.shouldBlock) {
      await client.query('ROLLBACK');

      if (amlAssessment.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.bidderUserId,
          market: 'syndicate',
          eventType: 'trade',
          amountGbp: offerNotionalGbp,
          referenceId: `${assetId}:buyout-offer`,
          ruleCode: 'AML_BUYOUT_OFFER_BLOCK',
          notes: 'Buyout offer blocked by AML controls',
          context: {
            assetId,
            bidderUserId: payload.bidderUserId,
            targetUnits,
            offerPriceGbp: payload.offerPriceGbp,
          },
          assessment: amlAssessment,
        });
      }

      await appendComplianceAuditSafe(request, {
        eventType: 'buyout.offer.blocked.aml',
        subjectUserId: payload.bidderUserId,
        payload: {
          assetId,
          targetUnits,
          offerPriceGbp: payload.offerPriceGbp,
          offerNotionalGbp,
          riskScore: amlAssessment.riskScore,
          riskLevel: amlAssessment.riskLevel,
          alertId: amlAlert?.alertId ?? null,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: 'Buyout offer blocked by AML controls. Please contact support.',
        code: 'AML_BLOCKED',
        riskLevel: amlAssessment.riskLevel,
        alertId: amlAlert?.alertId ?? null,
      };
    }

    const offerId = createRuntimeId('buyout');
    const expiresAt = new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000).toISOString();

    const inserted = await client.query<{
      id: string;
      created_at: string;
      updated_at: string;
    }>(
      `
        INSERT INTO syndicate_buyout_offers (
          id,
          asset_id,
          bidder_user_id,
          offer_price_gbp,
          target_units,
          accepted_units,
          status,
          expires_at,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, 0, 'open', $6, $7::jsonb)
        RETURNING id, created_at::text, updated_at::text
      `,
      [
        offerId,
        assetId,
        payload.bidderUserId,
        roundTo(payload.offerPriceGbp, 4),
        targetUnits,
        expiresAt,
        toJsonString(payload.metadata ?? {}),
      ]
    );

    if (amlAssessment.shouldCreateAlert) {
      amlAlert = await createAmlAlert(client, {
        userId: payload.bidderUserId,
        market: 'syndicate',
        eventType: 'trade',
        amountGbp: offerNotionalGbp,
        referenceId: offerId,
        ruleCode: 'AML_BUYOUT_OFFER_MONITOR',
        notes: 'Buyout offer generated elevated AML risk score',
        context: {
          assetId,
          bidderUserId: payload.bidderUserId,
          targetUnits,
          offerPriceGbp: payload.offerPriceGbp,
        },
        assessment: amlAssessment,
      });
    }

    await client.query('COMMIT');

    publishRealtimeEvent({
      topic: `syndicate.asset:${assetId}`,
      type: 'buyout.offer.opened',
      payload: {
        offerId,
        assetId,
        bidderUserId: payload.bidderUserId,
        offerPriceGbp: roundTo(payload.offerPriceGbp, 4),
        targetUnits,
        expiresAt,
      },
    });

    await appendComplianceAuditSafe(request, {
      eventType: 'buyout.offer.opened',
      subjectUserId: payload.bidderUserId,
      payload: {
        offerId,
        assetId,
        targetUnits,
        offerPriceGbp: roundTo(payload.offerPriceGbp, 4),
        amlAlertId: amlAlert?.alertId ?? null,
      },
    });

    reply.code(201);
    return {
      ok: true,
      offer: {
        id: inserted.rows[0].id,
        assetId,
        bidderUserId: payload.bidderUserId,
        offerPriceGbp: roundTo(payload.offerPriceGbp, 4),
        targetUnits,
        acceptedUnits: 0,
        status: 'open',
        expiresAt,
        createdAt: inserted.rows[0].created_at,
        updatedAt: inserted.rows[0].updated_at,
      },
      aml: amlAlert
        ? {
          alertId: amlAlert.alertId,
          status: amlAlert.status,
        }
        : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    reply.code(500);
    return {
      ok: false,
      error: `Unable to create buyout offer: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

app.post('/syndicate/buyout-offers/:offerId/accept', async (request, reply) => {
  const paramsSchema = z.object({ offerId: z.string().min(4) });
  const bodySchema = z.object({
    holderUserId: z.string().min(2),
    units: z.number().int().min(1).max(20),
    metadata: z.record(z.unknown()).optional(),
  });

  const { offerId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});
  await ensureUserExists(payload.holderUserId);

  const client = await db.connect();
  let amlAlert: { alertId: string; status: string } | null = null;
  try {
    await client.query('BEGIN');

    const offerResult = await client.query<{
      id: string;
      asset_id: string;
      bidder_user_id: string;
      offer_price_gbp: string;
      target_units: number;
      accepted_units: number;
      status: string;
      expires_at: string;
      total_units: number;
    }>(
      `
        SELECT
          bo.id,
          bo.asset_id,
          bo.bidder_user_id,
          bo.offer_price_gbp::text,
          bo.target_units,
          bo.accepted_units,
          bo.status,
          bo.expires_at::text,
          sa.total_units
        FROM syndicate_buyout_offers bo
        INNER JOIN syndicate_assets sa ON sa.id = bo.asset_id
        WHERE bo.id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [offerId]
    );

    const offer = offerResult.rows[0];
    if (!offer) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Buyout offer not found',
      };
    }

    if (offer.bidder_user_id === payload.holderUserId) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Bidder cannot accept their own buyout offer',
      };
    }

    const offerExpired = new Date(offer.expires_at).getTime() <= Date.now();
    if (offer.status !== 'open' || offerExpired) {
      await client.query(
        `
          UPDATE syndicate_buyout_offers
          SET status = CASE WHEN expires_at <= NOW() THEN 'expired' ELSE status END,
              updated_at = NOW()
          WHERE id = $1
        `,
        [offerId]
      );
      await client.query('ROLLBACK');
      reply.code(409);
      return {
        ok: false,
        error: 'Buyout offer is no longer open',
      };
    }

    const remainingTarget = Math.max(0, offer.target_units - offer.accepted_units);
    const acceptedUnits = Math.min(payload.units, remainingTarget);
    if (acceptedUnits <= 0) {
      await client.query('ROLLBACK');
      reply.code(409);
      return {
        ok: false,
        error: 'Buyout offer target already fulfilled',
      };
    }

    const acceptanceNotionalGbp = roundTo(acceptedUnits * Number(offer.offer_price_gbp), 2);

    const holderEligibility = await evaluateMarketEligibility(client, {
      userId: payload.holderUserId,
      market: 'syndicate',
      orderNotionalGbp: acceptanceNotionalGbp,
    });

    if (!holderEligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'buyout.accept.blocked.holder_eligibility',
        subjectUserId: payload.holderUserId,
        payload: {
          offerId,
          assetId: offer.asset_id,
          acceptedUnits,
          acceptanceNotionalGbp,
          code: holderEligibility.code,
          message: holderEligibility.message,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: holderEligibility.message,
        code: holderEligibility.code,
      };
    }

    const bidderEligibility = await evaluateMarketEligibility(client, {
      userId: offer.bidder_user_id,
      market: 'syndicate',
      orderNotionalGbp: acceptanceNotionalGbp,
    });

    if (!bidderEligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'buyout.accept.blocked.bidder_eligibility',
        subjectUserId: offer.bidder_user_id,
        payload: {
          offerId,
          assetId: offer.asset_id,
          acceptedUnits,
          acceptanceNotionalGbp,
          code: bidderEligibility.code,
          message: bidderEligibility.message,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: 'Buyout bidder no longer eligible for this jurisdiction.',
        code: bidderEligibility.code,
      };
    }

    const amlAssessment = await evaluateAmlRisk(client, {
      userId: payload.holderUserId,
      market: 'syndicate',
      amountGbp: acceptanceNotionalGbp,
      counterpartyUserId: offer.bidder_user_id,
    });

    if (amlAssessment.shouldBlock) {
      await client.query('ROLLBACK');

      if (amlAssessment.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.holderUserId,
          relatedUserId: offer.bidder_user_id,
          market: 'syndicate',
          eventType: 'trade',
          amountGbp: acceptanceNotionalGbp,
          referenceId: offerId,
          ruleCode: 'AML_BUYOUT_ACCEPT_BLOCK',
          notes: 'Buyout acceptance blocked by AML controls',
          context: {
            offerId,
            assetId: offer.asset_id,
            holderUserId: payload.holderUserId,
            bidderUserId: offer.bidder_user_id,
            acceptedUnits,
          },
          assessment: amlAssessment,
        });
      }

      await appendComplianceAuditSafe(request, {
        eventType: 'buyout.accept.blocked.aml',
        subjectUserId: payload.holderUserId,
        payload: {
          offerId,
          assetId: offer.asset_id,
          acceptedUnits,
          acceptanceNotionalGbp,
          riskScore: amlAssessment.riskScore,
          riskLevel: amlAssessment.riskLevel,
          alertId: amlAlert?.alertId ?? null,
        },
      });

      reply.code(403);
      return {
        ok: false,
        error: 'Buyout acceptance blocked by AML controls.',
        code: 'AML_BLOCKED',
        riskLevel: amlAssessment.riskLevel,
        alertId: amlAlert?.alertId ?? null,
      };
    }

    await applySyndicateTransfer(client, {
      assetId: offer.asset_id,
      buyerId: offer.bidder_user_id,
      sellerId: payload.holderUserId,
      units: acceptedUnits,
      unitPriceGbp: Number(offer.offer_price_gbp),
      feeGbp: 0,
      sourceType: 'buyout',
      buyOrderId: null,
      sellOrderId: null,
      enforceSellerHolding: true,
    });

    await client.query(
      `
        INSERT INTO syndicate_buyout_acceptances (
          offer_id,
          holder_user_id,
          units,
          status,
          responded_at,
          metadata
        )
        VALUES ($1, $2, $3, 'accepted', NOW(), $4::jsonb)
        ON CONFLICT (offer_id, holder_user_id)
        DO UPDATE
          SET
            units = EXCLUDED.units,
            status = EXCLUDED.status,
            responded_at = NOW(),
            metadata = syndicate_buyout_acceptances.metadata || EXCLUDED.metadata
      `,
      [offerId, payload.holderUserId, acceptedUnits, toJsonString(payload.metadata ?? {})]
    );

    const nextAcceptedUnits = offer.accepted_units + acceptedUnits;
    const nextStatus = nextAcceptedUnits >= offer.target_units ? 'settled' : 'accepted';

    await client.query(
      `
        UPDATE syndicate_buyout_offers
        SET
          accepted_units = $2,
          status = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [offerId, nextAcceptedUnits, nextStatus]
    );

    const bidderHolding = await getSyndicateHoldingForUpdate(client, offer.bidder_user_id, offer.asset_id);
    const bidderUnits = bidderHolding?.units_owned ?? 0;
    if (nextStatus === 'settled' && bidderUnits >= offer.total_units) {
      await client.query(
        `
          UPDATE syndicate_assets
          SET is_open = FALSE, updated_at = NOW()
          WHERE id = $1
        `,
        [offer.asset_id]
      );
    }

    const nextHolders = await recalcSyndicateHolders(client, offer.asset_id);
    await client.query(
      `
        UPDATE syndicate_assets
        SET holders = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [offer.asset_id, nextHolders]
    );

    if (amlAssessment.shouldCreateAlert) {
      amlAlert = await createAmlAlert(client, {
        userId: payload.holderUserId,
        relatedUserId: offer.bidder_user_id,
        market: 'syndicate',
        eventType: 'trade',
        amountGbp: acceptanceNotionalGbp,
        referenceId: offerId,
        ruleCode: 'AML_BUYOUT_ACCEPT_MONITOR',
        notes: 'Buyout acceptance generated elevated AML risk score',
        context: {
          offerId,
          assetId: offer.asset_id,
          holderUserId: payload.holderUserId,
          bidderUserId: offer.bidder_user_id,
          acceptedUnits,
        },
        assessment: amlAssessment,
      });
    }

    await client.query('COMMIT');

    publishRealtimeEvent({
      topic: `syndicate.asset:${offer.asset_id}`,
      type: 'buyout.offer.accepted',
      payload: {
        offerId,
        holderUserId: payload.holderUserId,
        units: acceptedUnits,
        acceptedUnits: nextAcceptedUnits,
        status: nextStatus,
      },
    });

    try {
      await queueUserNotification({
        userId: offer.bidder_user_id,
        title: 'Buyout accepted',
        body: `${payload.holderUserId} accepted ${acceptedUnits} units from your buyout offer.`,
        payload: {
          offerId,
          assetId: offer.asset_id,
          holderUserId: payload.holderUserId,
          units: acceptedUnits,
          event: 'buyout_acceptance',
        },
        metadata: {
          source: 'buyout_accept_route',
        },
      });
    } catch (error) {
      request.log.error({ err: error, offerId }, 'Failed to queue bidder buyout notification');
    }

    await appendComplianceAuditSafe(request, {
      eventType: 'buyout.accepted',
      subjectUserId: payload.holderUserId,
      payload: {
        offerId,
        assetId: offer.asset_id,
        holderUserId: payload.holderUserId,
        bidderUserId: offer.bidder_user_id,
        acceptedUnits,
        status: nextStatus,
        amlAlertId: amlAlert?.alertId ?? null,
      },
    });

    return {
      ok: true,
      offer: {
        id: offerId,
        assetId: offer.asset_id,
        bidderUserId: offer.bidder_user_id,
        offerPriceGbp: Number(offer.offer_price_gbp),
        targetUnits: offer.target_units,
        acceptedUnits: nextAcceptedUnits,
        status: nextStatus,
        expiresAt: offer.expires_at,
      },
      accepted: {
        holderUserId: payload.holderUserId,
        units: acceptedUnits,
      },
      aml: amlAlert
        ? {
          alertId: amlAlert.alertId,
          status: amlAlert.status,
        }
        : null,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'SYNDICATE_SELLER_UNITS_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    reply.code(500);
    return {
      ok: false,
      error: `Unable to accept buyout offer: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

let isShuttingDown = false;

const start = async () => {
  try {
    startBackgroundWorkers({
      handlePushJob: processPushQueueJob,
      handleAuctionSweepJob: async ({ reason }) => {
        await sweepExpiredAuctions(reason);
      },
    });

    startAuctionSweepScheduler();

    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`API running on :${config.port}`);
  } catch (error) {
    app.log.error(error);
    await shutdown();
    process.exit(1);
  }
};

const shutdown = async () => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  stopAuctionSweepScheduler();

  try {
    await app.close();
  } catch (error) {
    app.log.error({ err: error }, 'Failed closing HTTP server');
  }

  try {
    await closeRealtimeConnections();
  } catch (error) {
    app.log.error({ err: error }, 'Failed closing realtime connections');
  }

  try {
    await closeBackgroundQueues();
  } catch (error) {
    app.log.error({ err: error }, 'Failed closing background queues');
  }

  try {
    await closeRedis();
  } catch (error) {
    app.log.error({ err: error }, 'Failed closing Redis client');
  }

  try {
    await closeDb();
  } catch (error) {
    app.log.error({ err: error }, 'Failed closing Postgres pool');
  }

  try {
    await shutdownTelemetry();
  } catch (error) {
    app.log.error({ err: error }, 'Failed shutting down telemetry');
  }
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
