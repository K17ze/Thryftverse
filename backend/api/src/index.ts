import crypto from 'node:crypto';
import { shutdownTelemetry } from './telemetry.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
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
  assertOnezeOperatorToken,
  createOnezeReconciliationAttestation,
} from './lib/onezeGovernance.js';
import {
  PRICING_PARAMETER_BOUNDS,
  findPricingArbitrageViolations,
  getCountryPricingProfile,
  listCountryPricingQuotes,
  pricingTablesAvailable as onezePricingTablesAvailable,
  resolveCountryPricingQuote,
  resolveCountryPricingQuoteByCurrency,
  resolveInternalFxRate,
  setInternalFxRate,
  setOnezeAnchorConfig,
  upsertCountryPricingProfile,
  validatePricingProfileInput,
} from './lib/pricingEngine.js';
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
  enqueueOnezeMintReserveJob,
  enqueueReconciliationJob,
  enqueueOnezeWithdrawalExecuteJob,
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
import { assertS3BucketConnectivity, createUploadUrl, putJsonObject } from './lib/s3.js';
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
  getConfiguredClusters,
  isGatewayConfigured,
  resolveCountryCapabilities,
  type CapabilityCarrier,
} from './lib/countryCapabilities.js';
import {
  getAllowedGatewayIds,
  isGatewayAllowedForChannel,
  isPaymentMethodTypeAllowed,
  isPayoutCurrencyAllowed,
  isPayoutGatewayAllowed,
  resolveChannelGateway,
  resolvePayoutPolicyDefaults,
} from './lib/countryCapabilityPolicy.js';
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
import {
  createShipment,
  getShippingQuotes,
  isCarrierLiveConfigured,
  normalizeAndVerifyShippingWebhook,
} from './lib/shippingProvider.js';
import {
  getLatestReconciliationRun,
  reconciliationTableAvailable,
  runDailyReconciliation,
  type DailyReconciliationRun,
} from './lib/reconciliation.js';
import {
  collectOperationalAlerts,
  type OpsAlert,
} from './lib/alerting.js';

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
  routes: ['/webhooks/*', '/shipping/webhooks/*'],
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

// ── CORS & Security Headers ──────────────────────────────────────────
const ALLOWED_ORIGINS = config.nodeEnv === 'production'
  ? [
      'https://thryftverse.app',
      'https://www.thryftverse.app',
      'https://admin.thryftverse.app',
    ]
  : true; // Allow all origins in development

app.addHook('onRequest', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (config.nodeEnv === 'production') {
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
});

app.addHook('onRequest', async (request, reply) => {
  const origin = request.headers.origin;
  if (typeof ALLOWED_ORIGINS === 'boolean' && ALLOWED_ORIGINS) {
    reply.header('Access-Control-Allow-Origin', origin ?? '*');
  } else if (Array.isArray(ALLOWED_ORIGINS) && origin && ALLOWED_ORIGINS.includes(origin)) {
    reply.header('Access-Control-Allow-Origin', origin);
  }
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Security-Admin-Token');
  reply.header('Access-Control-Allow-Credentials', 'true');
  reply.header('Access-Control-Max-Age', '86400');

  if (request.method === 'OPTIONS') {
    reply.code(204).send();
  }
});

// ── Body size limit ──────────────────────────────────────────────────
app.addContentTypeParser(
  'application/json',
  { parseAs: 'string', bodyLimit: 2 * 1024 * 1024 },
  app.getDefaultJsonParser('error', 'error')
);

function toJsonString(value: unknown): string {
  return JSON.stringify(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function normalizePostcode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSafeInteger(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function ratioOrNull(numerator: number, denominator: number, decimals = 6): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }

  return roundTo(numerator / denominator, decimals);
}

const COMMERCE_PLATFORM_CHARGE_RATE = 0.05;
const COMMERCE_PLATFORM_CHARGE_FIXED_GBP = 0.7;
const COMMERCE_PLATFORM_CHARGE_MIN_RATE = 0.02;
const CO_OWN_TRADE_FEE_RATE = 0.01;
const AUCTION_PLATFORM_FEE_RATE = 0.03;
const WALLET_TOPUP_PLATFORM_FEE_RATE = 0.01;
const ONEZE_MG_PER_IZE = 1_000;
const DEFAULT_WALLET_FIAT_CURRENCY = 'INR';
const ONEZE_MINT_BURN_HALT_REDIS_KEY = 'oneze:mint_burn_halted';
const PAYOUTS_PAUSED_REDIS_KEY = 'ops:payouts_paused';
const ALERT_DEDUP_REDIS_PREFIX = 'ops:alerted:';
const ONEZE_MINT_DEFAULT_CUSTODIAN = 'MMTC-PAMP';
const PARCEL_EVENT_TYPES = [
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'collection_confirmed',
  'delivery_failed',
  'returned',
] as const;
type ParcelEventType = (typeof PARCEL_EVENT_TYPES)[number];
const PARCEL_DELIVERY_RELEASE_EVENTS = new Set<ParcelEventType>([
  'delivered',
  'collection_confirmed',
]);
const PARCEL_SHIPPING_PROGRESS_EVENTS = new Set<ParcelEventType>([
  'picked_up',
  'in_transit',
  'out_for_delivery',
]);
const COMMERCE_ORDER_STATUSES = [
  'created',
  'paid',
  'shipped',
  'delivered',
  'cancelled',
] as const;
type CommerceOrderStatus = (typeof COMMERCE_ORDER_STATUSES)[number];

let listingsStatusColumnAvailableCache: boolean | null = null;

const MINT_OPERATION_TERMINAL_STATES = new Set<string>([
  'SETTLED',
  'PAYMENT_FAILED',
  'PAYMENT_REFUNDED',
  'RESERVE_FAILED',
  'RESERVE_UNKNOWN',
]);

const FIAT_MINOR_DIGITS: Record<string, number> = {
  BIF: 0,
  CLP: 0,
  DJF: 0,
  GNF: 0,
  JPY: 0,
  KMF: 0,
  KRW: 0,
  MGA: 1,
  PYG: 0,
  RWF: 0,
  UGX: 0,
  VND: 0,
  VUV: 0,
  XAF: 0,
  XOF: 0,
  XPF: 0,
};

function onezeAmountToMg(amount: number): number {
  const mg = Math.round(amount * ONEZE_MG_PER_IZE);
  if (!Number.isSafeInteger(mg) || mg <= 0) {
    throw createApiError('IZE_AMOUNT_INVALID', '1ze amount cannot be represented safely in mg units');
  }

  return mg;
}

function mgToOnezeAmount(amountMg: number): number {
  return Number((amountMg / ONEZE_MG_PER_IZE).toFixed(6));
}

function getFiatMinorDigits(currency: string): number {
  return FIAT_MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

function toFiatMinor(amountMajor: number, currency: string): number {
  const digits = getFiatMinorDigits(currency);
  const factor = 10 ** digits;
  const minor = Math.round(amountMajor * factor);
  if (!Number.isSafeInteger(minor)) {
    throw createApiError('FIAT_AMOUNT_INVALID', 'Fiat amount cannot be represented safely in minor units');
  }

  return minor;
}

function fromFiatMinor(amountMinor: number, currency: string): number {
  const digits = getFiatMinorDigits(currency);
  const factor = 10 ** digits;
  return Number((amountMinor / factor).toFixed(Math.max(2, digits)));
}

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
  statusCode?: number;
}

function createApiError(code: string, message: string, details?: Record<string, unknown>): ApiError {
  const error = new Error(message) as ApiError;
  error.code = code;
  error.statusCode = statusCodeForApiError(code);
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

  if (method === 'POST' && (path.startsWith('/webhooks/') || path.startsWith('/shipping/webhooks/'))) {
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

  if (method === 'GET' && (path === '/co-own/assets' || path.startsWith('/co-own/assets/'))) {
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
  if (code === 'ONEZE_OPERATIONS_HALTED' || code === 'RECONCILIATION_TABLES_UNAVAILABLE' || code === 'PAYOUTS_PAUSED') {
    return 503;
  }

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

  if (code.startsWith('P2P_TRANSFER_') && code.endsWith('_BLOCKED')) {
    return 403;
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
  | 'platform_operating'
  | 'seller_payable'
  | 'buyer_spend'
  | 'withdrawal_pending'
  | 'withdrawable_balance'
  | 'ize_wallet'
  | 'ize_pending_redemption'
  | 'ize_outstanding'
  | 'ize_fiat_received';
type PaymentIntentStatus =
  | 'requires_payment_method'
  | 'requires_confirmation'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
type PaymentIntentTerminalStatus = 'succeeded' | 'failed' | 'cancelled';
type PaymentIntentChannel = 'commerce' | 'co-own' | 'wallet_topup' | 'wallet_withdrawal';
type MintOperationState =
  | 'INITIATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_CONFIRMED'
  | 'RESERVE_PURCHASING'
  | 'RESERVE_ALLOCATED'
  | 'WALLET_CREDITED'
  | 'SETTLED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_REFUNDED'
  | 'RESERVE_FAILED'
  | 'RECONCILIATION_HOLD'
  | 'RESERVE_UNKNOWN';

interface PaymentIntentRow {
  id: string;
  user_id: string;
  gateway_id: string;
  channel: PaymentIntentChannel;
  order_id: string | null;
  coOwn_order_id: number | null;
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

interface WalletIzeTransferRow {
  id: string;
  sender_user_id: string;
  recipient_user_id: string;
  ize_amount: number | string;
  fiat_amount: number | string;
  fiat_currency: string;
  rate_per_gram: number | string;
  status: 'committed' | 'blocked' | 'reversed';
  eligibility_code: string | null;
  aml_risk_score: number | string | null;
  aml_risk_level: string | null;
  aml_alert_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  committed_at: string | null;
  sender_country?: string | null;
  recipient_country?: string | null;
  is_cross_border?: boolean;
  travel_rule_payload?: Record<string, unknown>;
}

interface WalletRow {
  id: string;
  user_id: string;
  oneze_balance_mg: number | string;
  fiat_balance_minor: number | string;
  fiat_currency: string;
  version: number | string;
  created_at: string;
  updated_at: string;
}

interface WalletSegmentRow {
  wallet_id: string;
  purchased_balance_mg: number | string;
  earned_balance_mg: number | string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface WalletLedgerRow {
  id: number;
  wallet_id: string;
  tx_id: string;
  asset: '1ZE' | 'FIAT';
  amount: number | string;
  balance_after: number | string;
  kind: string;
  ref_type: string | null;
  ref_id: string | null;
  anchor_value_in_inr: number | string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface PayoutCorridorRow {
  currency: string;
  rail: string;
  min_amount_minor: number | string;
  max_amount_minor: number | string;
  spread_bps: number;
  network_fee_minor: number | string;
  enabled: boolean;
  settlement_sla_hours: number;
}

interface WithdrawalRow {
  id: string;
  user_id: string;
  burn_tx_id: string | null;
  amount_mg: number | string;
  target_currency: string;
  gross_minor: number | string;
  spread_minor: number | string;
  network_fee_minor: number | string;
  net_minor: number | string;
  rate_locked: number | string;
  rate_expires_at: string;
  rail: string;
  rail_ref: string | null;
  status: 'QUOTED' | 'ACCEPTED' | 'RESERVED' | 'PAID_OUT' | 'FAILED' | 'REVERSED';
  payout_destination: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

interface MintOperationRow {
  id: string;
  user_id: string;
  state: MintOperationState;
  fiat_amount_minor: number | string;
  fiat_currency: string;
  net_fiat_amount_minor: number | string;
  platform_fee_minor: number | string;
  ize_amount_mg: number | string;
  rate_per_gram: number | string;
  rate_source: string;
  rate_locked_at: string;
  rate_expires_at: string;
  payment_intent_id: string | null;
  lot_id: string | null;
  custodian_ref: string | null;
  escrow_ledger_tx_id: string | null;
  wallet_credit_tx_id: string | null;
  purchase_attempted_at: string | null;
  settled_at: string | null;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface JurisdictionPolicyRow {
  country_code: string;
  p2p_send_allowed: boolean;
  p2p_receive_allowed: boolean;
  p2p_daily_limit_mg: number | string | null;
  p2p_monthly_limit_mg: number | string | null;
  p2p_per_tx_limit_mg: number | string | null;
  requires_context: boolean;
  notes: string | null;
}

interface OnezeReconciliationRow {
  id: string;
  circulating_mg: number | string;
  reserve_active_mg: number | string;
  within_invariant: boolean;
  invariant_hash: string;
  reason: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

function createRuntimeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function directOnezeWithdrawalRoutesDisabled(): boolean {
  return !config.onezeEnableDirectRedemption;
}

type ChatConversationType = 'dm' | 'group';
type ChatSenderType = 'user' | 'bot' | 'system';
type ChatGroupMemberRole = 'owner' | 'admin' | 'member';

interface ChatConversationAccessRow {
  id: string;
  type: ChatConversationType;
  title: string | null;
  owner_id: string;
  item_id: string | null;
}

interface ChatGroupMembershipRoleRow {
  role: ChatGroupMemberRole;
}

function buildGroupInviteLink(inviteToken: string): string {
  return `thryftverse://group-invite?token=${encodeURIComponent(inviteToken)}`;
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

async function resolveGroupConversationMembershipRole(
  client: DbQueryable,
  conversationId: string,
  userId: string
): Promise<ChatGroupMemberRole | null> {
  const result = await client.query<ChatGroupMembershipRoleRow>(
    `
      SELECT role
      FROM chat_members
      WHERE conversation_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [conversationId, userId]
  );

  return result.rows[0]?.role ?? null;
}

async function ensureGroupManagementAccess(
  client: DbQueryable,
  conversationId: string,
  userId: string,
  platformRole?: AuthRole
): Promise<ChatConversationAccessRow> {
  const conversation = await ensureGroupConversationAccess(client, conversationId, userId);

  if (platformRole === 'admin' || conversation.owner_id === userId) {
    return conversation;
  }

  const membershipRole = await resolveGroupConversationMembershipRole(client, conversationId, userId);
  if (membershipRole === 'owner' || membershipRole === 'admin') {
    return conversation;
  }

  throw createApiError('FORBIDDEN_USER_CONTEXT', 'Only group owners/admins can perform this action', {
    actorUserId: userId,
    conversationId,
    ownerId: conversation.owner_id,
    membershipRole,
  });
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
    coOwnOrderId: row.coOwn_order_id,
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

function toWalletIzeTransferPayload(row: WalletIzeTransferRow) {
  return {
    id: row.id,
    senderUserId: row.sender_user_id,
    recipientUserId: row.recipient_user_id,
    izeAmount: Number(row.ize_amount),
    fiatAmount: Number(row.fiat_amount),
    fiatCurrency: row.fiat_currency,
    ratePerGram: Number(row.rate_per_gram),
    status: row.status,
    eligibilityCode: row.eligibility_code,
    amlRiskScore: row.aml_risk_score === null ? null : Number(row.aml_risk_score),
    amlRiskLevel: row.aml_risk_level,
    amlAlertId: row.aml_alert_id,
    metadata: row.metadata,
    createdAt: row.created_at,
    committedAt: row.committed_at,
    senderCountry: row.sender_country ?? null,
    recipientCountry: row.recipient_country ?? null,
    isCrossBorder: row.is_cross_border ?? null,
    travelRulePayload: row.travel_rule_payload ?? {},
  };
}

function toWalletPayload(row: WalletRow) {
  const onezeBalanceMg = Number(row.oneze_balance_mg);
  const fiatBalanceMinor = Number(row.fiat_balance_minor);

  return {
    id: row.id,
    userId: row.user_id,
    onezeBalanceMg,
    onezeBalance: mgToOnezeAmount(onezeBalanceMg),
    fiatBalanceMinor,
    fiatBalance: fromFiatMinor(fiatBalanceMinor, row.fiat_currency),
    fiatCurrency: row.fiat_currency,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toWalletLedgerPayload(row: WalletLedgerRow) {
  const asset = row.asset;
  const amount = Number(row.amount);
  const balanceAfter = Number(row.balance_after);
  // The internal anchor is intentionally hidden from user-facing responses.
  const anchorValueInInr = null;

  return {
    id: row.id,
    walletId: row.wallet_id,
    txId: row.tx_id,
    asset,
    amount,
    amountDisplay: asset === '1ZE' ? mgToOnezeAmount(amount) : amount,
    balanceAfter,
    balanceAfterDisplay: asset === '1ZE' ? mgToOnezeAmount(balanceAfter) : balanceAfter,
    kind: row.kind,
    refType: row.ref_type,
    refId: row.ref_id,
    anchorValueInInr,
    goldRateInrPerG: anchorValueInInr,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

function toWithdrawalPayload(row: WithdrawalRow) {
  const grossMinor = Number(row.gross_minor);
  const spreadMinor = Number(row.spread_minor);
  const networkFeeMinor = Number(row.network_fee_minor);
  const netMinor = Number(row.net_minor);

  return {
    id: row.id,
    userId: row.user_id,
    burnTxId: row.burn_tx_id,
    amountMg: Number(row.amount_mg),
    amountOneze: mgToOnezeAmount(Number(row.amount_mg)),
    targetCurrency: row.target_currency,
    grossMinor,
    gross: fromFiatMinor(grossMinor, row.target_currency),
    spreadMinor,
    spread: fromFiatMinor(spreadMinor, row.target_currency),
    networkFeeMinor,
    networkFee: fromFiatMinor(networkFeeMinor, row.target_currency),
    netMinor,
    net: fromFiatMinor(netMinor, row.target_currency),
    rateLocked: Number(row.rate_locked),
    rateExpiresAt: row.rate_expires_at,
    rail: row.rail,
    railRef: row.rail_ref,
    status: row.status,
    payoutDestination: row.payout_destination,
    metadata: row.metadata,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

function toMintOperationPayload(row: MintOperationRow) {
  const fiatAmountMinor = Number(row.fiat_amount_minor);
  const netFiatAmountMinor = Number(row.net_fiat_amount_minor);
  const platformFeeMinor = Number(row.platform_fee_minor);
  const izeAmountMg = Number(row.ize_amount_mg);

  return {
    id: row.id,
    userId: row.user_id,
    state: row.state,
    fiatCurrency: row.fiat_currency,
    fiatAmountMinor,
    fiatAmount: fromFiatMinor(fiatAmountMinor, row.fiat_currency),
    netFiatAmountMinor,
    netFiatAmount: fromFiatMinor(netFiatAmountMinor, row.fiat_currency),
    platformFeeMinor,
    platformFeeAmount: fromFiatMinor(platformFeeMinor, row.fiat_currency),
    izeAmountMg,
    izeAmount: mgToOnezeAmount(izeAmountMg),
    ratePerGram: Number(row.rate_per_gram),
    rateSource: row.rate_source,
    rateLockedAt: row.rate_locked_at,
    rateExpiresAt: row.rate_expires_at,
    paymentIntentId: row.payment_intent_id,
    lotId: row.lot_id,
    custodianRef: row.custodian_ref,
    escrowLedgerTxId: row.escrow_ledger_tx_id,
    walletCreditTxId: row.wallet_credit_tx_id,
    purchaseAttemptedAt: row.purchase_attempted_at,
    settledAt: row.settled_at,
    lastError: row.last_error,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function canTransitionMintOperationState(current: MintOperationState, next: MintOperationState): boolean {
  if (current === next) {
    return true;
  }

  if (MINT_OPERATION_TERMINAL_STATES.has(current)) {
    return false;
  }

  if (current === 'INITIATED') {
    return ['PAYMENT_PENDING', 'PAYMENT_FAILED'].includes(next);
  }

  if (current === 'PAYMENT_PENDING') {
    return ['PAYMENT_CONFIRMED', 'PAYMENT_FAILED', 'PAYMENT_REFUNDED', 'RECONCILIATION_HOLD'].includes(next);
  }

  if (current === 'PAYMENT_CONFIRMED') {
    return ['RESERVE_PURCHASING', 'PAYMENT_REFUNDED', 'RECONCILIATION_HOLD'].includes(next);
  }

  if (current === 'RESERVE_PURCHASING') {
    return ['RESERVE_ALLOCATED', 'RESERVE_FAILED', 'RESERVE_UNKNOWN', 'RECONCILIATION_HOLD'].includes(next);
  }

  if (current === 'RESERVE_ALLOCATED') {
    return ['WALLET_CREDITED', 'RECONCILIATION_HOLD'].includes(next);
  }

  if (current === 'WALLET_CREDITED') {
    return ['SETTLED', 'RECONCILIATION_HOLD'].includes(next);
  }

  if (current === 'RECONCILIATION_HOLD') {
    return ['PAYMENT_REFUNDED', 'RESERVE_FAILED'].includes(next);
  }

  return false;
}

async function loadMintOperationById(
  client: DbQueryable,
  operationId: string,
  options?: { forUpdate?: boolean }
): Promise<MintOperationRow | null> {
  const baseQuery = `
    SELECT
      id,
      user_id,
      state,
      fiat_amount_minor::text,
      fiat_currency,
      net_fiat_amount_minor::text,
      platform_fee_minor::text,
      ize_amount_mg::text,
      rate_per_gram::text,
      rate_source,
      rate_locked_at::text,
      rate_expires_at::text,
      payment_intent_id,
      lot_id,
      custodian_ref,
      escrow_ledger_tx_id,
      wallet_credit_tx_id,
      purchase_attempted_at::text,
      settled_at::text,
      last_error,
      metadata,
      created_at::text,
      updated_at::text
    FROM mint_operations
    WHERE id = $1
    LIMIT 1
  `;

  const queryText = options?.forUpdate ? `${baseQuery} FOR UPDATE` : baseQuery;
  const result = await client.query<MintOperationRow>(queryText, [operationId]);
  return result.rows[0] ?? null;
}

async function loadMintOperationByPaymentIntentId(
  client: DbQueryable,
  paymentIntentId: string,
  options?: { forUpdate?: boolean }
): Promise<MintOperationRow | null> {
  const baseQuery = `
    SELECT
      id,
      user_id,
      state,
      fiat_amount_minor::text,
      fiat_currency,
      net_fiat_amount_minor::text,
      platform_fee_minor::text,
      ize_amount_mg::text,
      rate_per_gram::text,
      rate_source,
      rate_locked_at::text,
      rate_expires_at::text,
      payment_intent_id,
      lot_id,
      custodian_ref,
      escrow_ledger_tx_id,
      wallet_credit_tx_id,
      purchase_attempted_at::text,
      settled_at::text,
      last_error,
      metadata,
      created_at::text,
      updated_at::text
    FROM mint_operations
    WHERE payment_intent_id = $1
    LIMIT 1
  `;

  const queryText = options?.forUpdate ? `${baseQuery} FOR UPDATE` : baseQuery;
  const result = await client.query<MintOperationRow>(queryText, [paymentIntentId]);
  return result.rows[0] ?? null;
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
    throw createApiError('PAYOUT_REQUEST_NOT_FOUND', 'Payout request not found for closed-loop settlement');
  }

  if (payoutRequest.user_id !== input.userId) {
    throw createApiError('PAYOUT_REQUEST_USER_MISMATCH', 'Payout request does not belong to this user', {
      payoutRequestId: input.payoutRequestId,
      expectedUserId: input.userId,
      actualUserId: payoutRequest.user_id,
    });
  }

  if (payoutRequest.status === 'failed' || payoutRequest.status === 'cancelled') {
    throw createApiError('PAYOUT_REQUEST_INVALID', 'Payout request is not withdrawable in its current status', {
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

async function orderParcelEventsTableAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.order_parcel_events') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function paymentDisputesTableAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.payment_disputes') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function listingsStatusColumnAvailable(client: DbQueryable): Promise<boolean> {
  if (listingsStatusColumnAvailableCache !== null) {
    return listingsStatusColumnAvailableCache;
  }

  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'listings'
          AND column_name = 'status'
      ) AS exists
    `
  );

  listingsStatusColumnAvailableCache = Boolean(result.rows[0]?.exists);
  return listingsStatusColumnAvailableCache;
}

async function onezeTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.ledger_accounts') IS NOT NULL
        AND to_regclass('public.ledger_entries') IS NOT NULL
        AND to_regclass('public.payment_intents') IS NOT NULL
        AND to_regclass('public.wallet_ize_operations') IS NOT NULL
        AND to_regclass('public.oneze_anchor_config') IS NOT NULL
        AND to_regclass('public.oneze_country_pricing_profiles') IS NOT NULL
        AND to_regclass('public.oneze_internal_fx_rates') IS NOT NULL
        AND to_regclass('public.ize_reconciliation_snapshots') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function onezeP2pTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.wallet_ize_transfers') IS NOT NULL
        AND to_regclass('public.user_compliance_profiles') IS NOT NULL
        AND to_regclass('public.jurisdiction_rules') IS NOT NULL
        AND to_regclass('public.aml_alerts') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function onezeArchitectureTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.wallets') IS NOT NULL
        AND to_regclass('public.wallet_ledger') IS NOT NULL
        AND to_regclass('public.payout_corridors') IS NOT NULL
        AND to_regclass('public.fx_rates') IS NOT NULL
        AND to_regclass('public.withdrawals') IS NOT NULL
        AND to_regclass('public.wallet_idempotency_keys') IS NOT NULL
        AND to_regclass('public.oneze_reconciliation_snapshots') IS NOT NULL
        AND to_regclass('public.jurisdiction_policies') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function onezeMintFlowTablesAvailable(client: DbQueryable): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT
        to_regclass('public.mint_operations') IS NOT NULL
        AND to_regclass('public.payment_intents') IS NOT NULL
        AND to_regclass('public.wallets') IS NOT NULL
        AND to_regclass('public.wallet_ledger') IS NOT NULL AS exists
    `
  );

  return Boolean(result.rows[0]?.exists);
}

async function setOnezeMintBurnHaltState(input: {
  halted: boolean;
  reason: string;
  reconciliationId?: string;
}): Promise<void> {
  if (!input.halted) {
    await redis.del(ONEZE_MINT_BURN_HALT_REDIS_KEY);
    return;
  }

  await redis.set(
    ONEZE_MINT_BURN_HALT_REDIS_KEY,
    toJsonString({
      halted: true,
      reason: input.reason,
      reconciliationId: input.reconciliationId ?? null,
      haltedAt: new Date().toISOString(),
    })
  );
}

async function getOnezeMintBurnHaltState(): Promise<{
  halted: boolean;
  reason?: string;
  reconciliationId?: string | null;
}> {
  const raw = await redis.get(ONEZE_MINT_BURN_HALT_REDIS_KEY);
  if (!raw) {
    return { halted: false };
  }

  try {
    const parsed = JSON.parse(raw) as {
      halted?: boolean;
      reason?: string;
      reconciliationId?: string | null;
    };

    if (!parsed.halted) {
      return { halted: false };
    }

    return {
      halted: true,
      reason: parsed.reason,
      reconciliationId: parsed.reconciliationId ?? null,
    };
  } catch {
    return {
      halted: true,
      reason: 'halt_state_decode_failed',
    };
  }
}

async function setPayoutPauseState(input: {
  paused: boolean;
  reason: string;
  reconciliationRunId?: string;
  mismatchGbp?: number;
}): Promise<void> {
  if (!input.paused) {
    await redis.del(PAYOUTS_PAUSED_REDIS_KEY);
    return;
  }

  await redis.set(
    PAYOUTS_PAUSED_REDIS_KEY,
    toJsonString({
      paused: true,
      reason: input.reason,
      reconciliationRunId: input.reconciliationRunId ?? null,
      mismatchGbp: input.mismatchGbp ?? null,
      pausedAt: new Date().toISOString(),
    })
  );
}

async function getPayoutPauseState(): Promise<{
  paused: boolean;
  reason?: string;
  reconciliationRunId?: string | null;
  mismatchGbp?: number | null;
}> {
  const raw = await redis.get(PAYOUTS_PAUSED_REDIS_KEY);
  if (!raw) {
    return { paused: false };
  }

  try {
    const parsed = JSON.parse(raw) as {
      paused?: boolean;
      reason?: string;
      reconciliationRunId?: string | null;
      mismatchGbp?: number | null;
    };

    if (!parsed.paused) {
      return { paused: false };
    }

    return {
      paused: true,
      reason: parsed.reason,
      reconciliationRunId: parsed.reconciliationRunId ?? null,
      mismatchGbp: parsed.mismatchGbp ?? null,
    };
  } catch {
    return {
      paused: true,
      reason: 'payout_pause_state_decode_failed',
    };
  }
}

function toUtcDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseRunDateOrToday(runDate?: string): string {
  if (!runDate) {
    return toUtcDateString(new Date());
  }

  const parsed = new Date(`${runDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return toUtcDateString(new Date());
  }

  return toUtcDateString(parsed);
}

async function assertOnezeMintBurnNotHalted(): Promise<void> {
  const state = await getOnezeMintBurnHaltState();
  if (!state.halted) {
    return;
  }

  throw createApiError(
    'ONEZE_OPERATIONS_HALTED',
    '1ze mint and burn operations are temporarily halted due to reconciliation hold',
    {
      reason: state.reason ?? null,
      reconciliationId: state.reconciliationId ?? null,
    }
  );
}

function hashWalletIdempotencyPayload(payload: unknown): string {
  return crypto.createHash('sha256').update(toJsonString(payload ?? {})).digest('hex');
}

async function getWalletIdempotentResponse(
  client: DbQueryable,
  input: {
    userId: string;
    operation: string;
    idempotencyKey: string;
    requestHash: string;
  }
): Promise<Record<string, unknown> | null> {
  const result = await client.query<{
    request_hash: string;
    response_payload: Record<string, unknown>;
  }>(
    `
      SELECT request_hash, response_payload
      FROM wallet_idempotency_keys
      WHERE user_id = $1
        AND operation = $2
        AND idempotency_key = $3
      LIMIT 1
    `,
    [input.userId, input.operation, input.idempotencyKey]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  if (row.request_hash !== input.requestHash) {
    throw createApiError(
      'IDEMPOTENCY_KEY_REUSED',
      'Idempotency key was already used with a different request payload'
    );
  }

  return row.response_payload;
}

async function saveWalletIdempotentResponse(
  client: DbQueryable,
  input: {
    userId: string;
    operation: string;
    idempotencyKey: string;
    requestHash: string;
    responsePayload: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO wallet_idempotency_keys (
        user_id,
        operation,
        idempotency_key,
        request_hash,
        response_payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (user_id, operation, idempotency_key)
      DO NOTHING
    `,
    [
      input.userId,
      input.operation,
      input.idempotencyKey,
      input.requestHash,
      toJsonString(input.responsePayload),
    ]
  );
}

async function ensureWallet(
  client: DbQueryable,
  userId: string,
  fiatCurrency = DEFAULT_WALLET_FIAT_CURRENCY
): Promise<WalletRow> {
  const result = await client.query<WalletRow>(
    `
      INSERT INTO wallets (
        id,
        user_id,
        fiat_currency
      )
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id)
      DO UPDATE SET user_id = EXCLUDED.user_id
      RETURNING
        id,
        user_id,
        oneze_balance_mg,
        fiat_balance_minor,
        fiat_currency,
        version,
        created_at::text,
        updated_at::text
    `,
    [createRuntimeId('wal'), userId, fiatCurrency.toUpperCase()]
  );

  const wallet = result.rows[0];

  const walletLedgerCountResult = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM wallet_ledger
      WHERE wallet_id = $1
    `,
    [wallet.id]
  );

  const walletLedgerCount = Number(walletLedgerCountResult.rows[0]?.count ?? '0');
  if (walletLedgerCount > 0) {
    return wallet;
  }

  if (!(await ledgerTablesAvailable(client))) {
    return wallet;
  }

  const legacyIzeBalance = await getLedgerAccountBalance(client, 'user', userId, 'ize_wallet', 'IZE');
  const syncedOnezeBalanceMg = Math.max(0, Math.round(legacyIzeBalance * ONEZE_MG_PER_IZE));

  if (
    !Number.isSafeInteger(syncedOnezeBalanceMg)
    || syncedOnezeBalanceMg === Number(wallet.oneze_balance_mg)
  ) {
    return wallet;
  }

  const syncedResult = await client.query<WalletRow>(
    `
      UPDATE wallets
      SET
        oneze_balance_mg = $2,
        version = version + 1,
        updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        user_id,
        oneze_balance_mg,
        fiat_balance_minor,
        fiat_currency,
        version,
        created_at::text,
        updated_at::text
    `,
    [wallet.id, syncedOnezeBalanceMg]
  );

  return syncedResult.rows[0] ?? wallet;
}

async function loadWalletForUpdate(client: DbQueryable, walletId: string): Promise<WalletRow> {
  const result = await client.query<WalletRow>(
    `
      SELECT
        id,
        user_id,
        oneze_balance_mg,
        fiat_balance_minor,
        fiat_currency,
        version,
        created_at::text,
        updated_at::text
      FROM wallets
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [walletId]
  );

  const wallet = result.rows[0];
  if (!wallet) {
    throw createApiError('WALLET_NOT_FOUND', 'Wallet not found', { walletId });
  }

  return wallet;
}

async function applyWalletLedgerDelta(
  client: DbQueryable,
  input: {
    walletId: string;
    txId: string;
    asset: '1ZE' | 'FIAT';
    amount: number;
    kind: string;
    refType?: string;
    refId?: string;
    anchorValueInInr?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<number> {
  if (!Number.isSafeInteger(input.amount)) {
    throw createApiError('WALLET_AMOUNT_INVALID', 'Wallet ledger amount must be an integer unit');
  }

  const wallet = await loadWalletForUpdate(client, input.walletId);
  const currentBalance = Number(
    input.asset === '1ZE' ? wallet.oneze_balance_mg : wallet.fiat_balance_minor
  );
  const nextBalance = currentBalance + input.amount;

  if (nextBalance < 0) {
    throw createApiError('WALLET_INSUFFICIENT_BALANCE', 'Wallet balance is insufficient for this operation', {
      walletId: input.walletId,
      asset: input.asset,
      currentBalance,
      attemptedDelta: input.amount,
    });
  }

  if (input.asset === '1ZE') {
    await client.query(
      `
        UPDATE wallets
        SET
          oneze_balance_mg = $2,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $1
      `,
      [input.walletId, nextBalance]
    );
  } else {
    await client.query(
      `
        UPDATE wallets
        SET
          fiat_balance_minor = $2,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $1
      `,
      [input.walletId, nextBalance]
    );
  }

  await client.query(
    `
      INSERT INTO wallet_ledger (
        wallet_id,
        tx_id,
        asset,
        amount,
        balance_after,
        kind,
        ref_type,
        ref_id,
        anchor_value_in_inr,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
    `,
    [
      input.walletId,
      input.txId,
      input.asset,
      input.amount,
      nextBalance,
      input.kind,
      input.refType ?? null,
      input.refId ?? null,
      input.anchorValueInInr ?? null,
      toJsonString(input.metadata ?? {}),
    ]
  );

  return nextBalance;
}

function normalizeOnezeCountryTag(country: string | null | undefined): string {
  const raw = (country ?? '').trim().toUpperCase();
  return raw.length >= 2 ? raw : 'GLOBAL';
}

async function ensureWalletSegments(client: DbQueryable, wallet: WalletRow): Promise<WalletSegmentRow> {
  const seededPurchasedMg = Math.max(0, Number(wallet.oneze_balance_mg));

  const upserted = await client.query<WalletSegmentRow>(
    `
      INSERT INTO oneze_wallet_segments (
        wallet_id,
        purchased_balance_mg,
        earned_balance_mg,
        metadata
      )
      VALUES ($1, $2, 0, $3::jsonb)
      ON CONFLICT (wallet_id)
      DO UPDATE SET wallet_id = EXCLUDED.wallet_id
      RETURNING
        wallet_id,
        purchased_balance_mg,
        earned_balance_mg,
        metadata,
        created_at::text,
        updated_at::text
    `,
    [
      wallet.id,
      seededPurchasedMg,
      toJsonString({
        bootstrapFromWalletMg: seededPurchasedMg,
      }),
    ]
  );

  const segments = upserted.rows[0];
  const walletBalanceMg = Math.max(0, Number(wallet.oneze_balance_mg));
  const segmentTotalMg = Number(segments.purchased_balance_mg) + Number(segments.earned_balance_mg);

  if (segmentTotalMg >= walletBalanceMg) {
    return segments;
  }

  const parityDeltaMg = walletBalanceMg - segmentTotalMg;
  const parityPatched = await client.query<WalletSegmentRow>(
    `
      UPDATE oneze_wallet_segments
      SET
        purchased_balance_mg = purchased_balance_mg + $2,
        metadata = metadata || $3::jsonb,
        updated_at = NOW()
      WHERE wallet_id = $1
      RETURNING
        wallet_id,
        purchased_balance_mg,
        earned_balance_mg,
        metadata,
        created_at::text,
        updated_at::text
    `,
    [
      wallet.id,
      parityDeltaMg,
      toJsonString({
        paritySync: {
          at: new Date().toISOString(),
          deltaMg: parityDeltaMg,
          reason: 'segment_total_below_wallet_balance',
        },
      }),
    ]
  );

  return parityPatched.rows[0] ?? segments;
}

async function loadWalletSegmentsForUpdate(
  client: DbQueryable,
  wallet: WalletRow
): Promise<WalletSegmentRow> {
  await ensureWalletSegments(client, wallet);

  const result = await client.query<WalletSegmentRow>(
    `
      SELECT
        wallet_id,
        purchased_balance_mg,
        earned_balance_mg,
        metadata,
        created_at::text,
        updated_at::text
      FROM oneze_wallet_segments
      WHERE wallet_id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [wallet.id]
  );

  const segments = result.rows[0];
  if (!segments) {
    throw createApiError('WALLET_SEGMENTS_NOT_FOUND', 'Wallet segment record is missing', {
      walletId: wallet.id,
      userId: wallet.user_id,
    });
  }

  return segments;
}

async function appendWalletOriginEvent(
  client: DbQueryable,
  input: {
    walletId: string;
    txId: string;
    amountMg: number;
    originCountry: string;
    segment: 'purchased' | 'earned';
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!Number.isSafeInteger(input.amountMg) || input.amountMg === 0) {
    return;
  }

  await client.query(
    `
      INSERT INTO oneze_balance_origin_events (
        wallet_id,
        tx_id,
        amount_mg,
        origin_country,
        segment,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      input.walletId,
      input.txId,
      input.amountMg,
      normalizeOnezeCountryTag(input.originCountry),
      input.segment,
      toJsonString(input.metadata ?? {}),
    ]
  );
}

async function creditWalletSegmentBalance(
  client: DbQueryable,
  input: {
    wallet: WalletRow;
    txId: string;
    purchasedCreditMg?: number;
    earnedCreditMg?: number;
    originCountry: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{ purchasedBalanceMg: number; earnedBalanceMg: number }> {
  const purchasedCreditMg = input.purchasedCreditMg ?? 0;
  const earnedCreditMg = input.earnedCreditMg ?? 0;

  if (!Number.isSafeInteger(purchasedCreditMg) || !Number.isSafeInteger(earnedCreditMg)) {
    throw createApiError('WALLET_SEGMENT_AMOUNT_INVALID', 'Wallet segment credits must be integer mg units');
  }

  if (purchasedCreditMg < 0 || earnedCreditMg < 0) {
    throw createApiError('WALLET_SEGMENT_AMOUNT_INVALID', 'Wallet segment credits cannot be negative');
  }

  const segments = await loadWalletSegmentsForUpdate(client, input.wallet);
  const nextPurchasedMg = Number(segments.purchased_balance_mg) + purchasedCreditMg;
  const nextEarnedMg = Number(segments.earned_balance_mg) + earnedCreditMg;

  await client.query(
    `
      UPDATE oneze_wallet_segments
      SET
        purchased_balance_mg = $2,
        earned_balance_mg = $3,
        metadata = metadata || $4::jsonb,
        updated_at = NOW()
      WHERE wallet_id = $1
    `,
    [
      input.wallet.id,
      nextPurchasedMg,
      nextEarnedMg,
      toJsonString({
        txId: input.txId,
        operation: 'credit',
        purchasedCreditMg,
        earnedCreditMg,
        ...(input.metadata ?? {}),
      }),
    ]
  );

  if (purchasedCreditMg > 0) {
    await appendWalletOriginEvent(client, {
      walletId: input.wallet.id,
      txId: input.txId,
      amountMg: purchasedCreditMg,
      originCountry: input.originCountry,
      segment: 'purchased',
      metadata: {
        direction: 'credit',
        ...(input.metadata ?? {}),
      },
    });
  }

  if (earnedCreditMg > 0) {
    await appendWalletOriginEvent(client, {
      walletId: input.wallet.id,
      txId: input.txId,
      amountMg: earnedCreditMg,
      originCountry: input.originCountry,
      segment: 'earned',
      metadata: {
        direction: 'credit',
        ...(input.metadata ?? {}),
      },
    });
  }

  return {
    purchasedBalanceMg: nextPurchasedMg,
    earnedBalanceMg: nextEarnedMg,
  };
}

async function getLockedPurchasedBalanceMg(
  client: DbQueryable,
  walletId: string,
  lockHours: number
): Promise<number> {
  if (!Number.isFinite(lockHours) || lockHours <= 0) {
    return 0;
  }

  const result = await client.query<{ total: string }>(
    `
      SELECT COALESCE(SUM(amount_mg), 0)::text AS total
      FROM oneze_balance_origin_events
      WHERE wallet_id = $1
        AND segment = 'purchased'
        AND amount_mg > 0
        AND created_at >= NOW() - make_interval(hours => $2::int)
    `,
    [walletId, Math.round(lockHours)]
  );

  return Math.max(0, Number(result.rows[0]?.total ?? '0'));
}

async function debitWalletSegmentBalance(
  client: DbQueryable,
  input: {
    wallet: WalletRow;
    txId: string;
    amountMg: number;
    originCountry: string;
    metadata?: Record<string, unknown>;
    lockHours?: number;
  }
): Promise<{
  purchasedDebitedMg: number;
  earnedDebitedMg: number;
  lockedPurchasedMg: number;
  redeemableMg: number;
  purchasedBalanceMg: number;
  earnedBalanceMg: number;
}> {
  if (!Number.isSafeInteger(input.amountMg) || input.amountMg <= 0) {
    throw createApiError('WALLET_SEGMENT_AMOUNT_INVALID', 'Wallet segment debit must be a positive integer mg value');
  }

  const segments = await loadWalletSegmentsForUpdate(client, input.wallet);
  const purchasedMg = Number(segments.purchased_balance_mg);
  const earnedMg = Number(segments.earned_balance_mg);
  const lockedPurchasedMg = await getLockedPurchasedBalanceMg(client, input.wallet.id, input.lockHours ?? 0);
  const redeemablePurchasedMg = Math.max(0, purchasedMg - lockedPurchasedMg);
  const redeemableMg = earnedMg + redeemablePurchasedMg;

  if (input.amountMg > redeemableMg) {
    throw createApiError('WALLET_SEGMENT_REDEEM_LOCKED', 'Requested amount exceeds redeemable segmented balance', {
      walletId: input.wallet.id,
      amountMg: input.amountMg,
      redeemableMg,
      purchasedMg,
      earnedMg,
      lockedPurchasedMg,
      lockHours: input.lockHours ?? 0,
    });
  }

  const earnedDebitedMg = Math.min(earnedMg, input.amountMg);
  const purchasedDebitedMg = input.amountMg - earnedDebitedMg;
  const nextPurchasedMg = purchasedMg - purchasedDebitedMg;
  const nextEarnedMg = earnedMg - earnedDebitedMg;

  if (nextPurchasedMg < 0 || nextEarnedMg < 0) {
    throw createApiError('WALLET_SEGMENT_AMOUNT_INVALID', 'Segment balances cannot go negative');
  }

  await client.query(
    `
      UPDATE oneze_wallet_segments
      SET
        purchased_balance_mg = $2,
        earned_balance_mg = $3,
        metadata = metadata || $4::jsonb,
        updated_at = NOW()
      WHERE wallet_id = $1
    `,
    [
      input.wallet.id,
      nextPurchasedMg,
      nextEarnedMg,
      toJsonString({
        txId: input.txId,
        operation: 'debit',
        purchasedDebitedMg,
        earnedDebitedMg,
        lockHours: input.lockHours ?? 0,
        ...(input.metadata ?? {}),
      }),
    ]
  );

  if (purchasedDebitedMg > 0) {
    await appendWalletOriginEvent(client, {
      walletId: input.wallet.id,
      txId: input.txId,
      amountMg: -purchasedDebitedMg,
      originCountry: input.originCountry,
      segment: 'purchased',
      metadata: {
        direction: 'debit',
        ...(input.metadata ?? {}),
      },
    });
  }

  if (earnedDebitedMg > 0) {
    await appendWalletOriginEvent(client, {
      walletId: input.wallet.id,
      txId: input.txId,
      amountMg: -earnedDebitedMg,
      originCountry: input.originCountry,
      segment: 'earned',
      metadata: {
        direction: 'debit',
        ...(input.metadata ?? {}),
      },
    });
  }

  return {
    purchasedDebitedMg,
    earnedDebitedMg,
    lockedPurchasedMg,
    redeemableMg,
    purchasedBalanceMg: nextPurchasedMg,
    earnedBalanceMg: nextEarnedMg,
  };
}

async function getCommittedBurnIzeInWindow(
  client: DbQueryable,
  userId: string,
  hours: number
): Promise<number> {
  const safeHours = Math.max(1, Math.round(hours));
  const result = await client.query<{ total: string }>(
    `
      SELECT COALESCE(SUM(ize_amount), 0)::text AS total
      FROM wallet_ize_operations
      WHERE user_id = $1
        AND operation_type = 'burn'
        AND status = 'committed'
        AND committed_at >= NOW() - make_interval(hours => $2::int)
    `,
    [userId, safeHours]
  );

  return Number(result.rows[0]?.total ?? '0');
}

async function resolveUserCountryCode(client: DbQueryable, userId: string): Promise<string> {
  const result = await client.query<{ country_code: string | null }>(
    `
      SELECT country_code
      FROM user_compliance_profiles
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  return normalizeCountryCode(result.rows[0]?.country_code ?? 'GB');
}

async function resolveJurisdictionPolicy(
  client: DbQueryable,
  countryCode: string
): Promise<JurisdictionPolicyRow> {
  const normalizedCountry = countryCode.toUpperCase();
  const exact = await client.query<JurisdictionPolicyRow>(
    `
      SELECT
        country_code,
        p2p_send_allowed,
        p2p_receive_allowed,
        p2p_daily_limit_mg,
        p2p_monthly_limit_mg,
        p2p_per_tx_limit_mg,
        requires_context,
        notes
      FROM jurisdiction_policies
      WHERE country_code = $1
      LIMIT 1
    `,
    [normalizedCountry]
  );

  if (exact.rowCount) {
    return exact.rows[0];
  }

  const global = await client.query<JurisdictionPolicyRow>(
    `
      SELECT
        country_code,
        p2p_send_allowed,
        p2p_receive_allowed,
        p2p_daily_limit_mg,
        p2p_monthly_limit_mg,
        p2p_per_tx_limit_mg,
        requires_context,
        notes
      FROM jurisdiction_policies
      WHERE country_code = 'GLOBAL'
      LIMIT 1
    `
  );

  if (global.rowCount) {
    return global.rows[0];
  }

  return {
    country_code: 'GLOBAL',
    p2p_send_allowed: false,
    p2p_receive_allowed: false,
    p2p_daily_limit_mg: null,
    p2p_monthly_limit_mg: null,
    p2p_per_tx_limit_mg: null,
    requires_context: true,
    notes: 'Default deny policy',
  };
}

async function evaluateP2pPolicyEligibility(
  client: DbQueryable,
  input: {
    senderUserId: string;
    recipientUserId: string;
    amountMg: number;
    contextType?: string;
    contextId?: string;
  }
): Promise<{
  senderCountry: string;
  recipientCountry: string;
  requiresTravelRule: boolean;
}> {
  const [senderCountry, recipientCountry] = await Promise.all([
    resolveUserCountryCode(client, input.senderUserId),
    resolveUserCountryCode(client, input.recipientUserId),
  ]);

  const [senderPolicy, recipientPolicy] = await Promise.all([
    resolveJurisdictionPolicy(client, senderCountry),
    resolveJurisdictionPolicy(client, recipientCountry),
  ]);

  if (!senderPolicy.p2p_send_allowed) {
    throw createApiError('P2P_TRANSFER_SENDER_BLOCKED', 'P2P sending is not enabled in sender jurisdiction', {
      senderCountry,
      policy: senderPolicy,
    });
  }

  if (!recipientPolicy.p2p_receive_allowed) {
    throw createApiError('P2P_TRANSFER_RECIPIENT_BLOCKED', 'P2P receiving is not enabled in recipient jurisdiction', {
      recipientCountry,
      policy: recipientPolicy,
    });
  }

  if (!input.contextType || !input.contextId) {
    throw createApiError(
      'P2P_TRANSFER_CONTEXT_REQUIRED',
      'P2P transfer context is required for all jurisdictions in closed-loop mode'
    );
  }

  const perTxLimit = Math.min(
    Number(senderPolicy.p2p_per_tx_limit_mg ?? Number.MAX_SAFE_INTEGER),
    Number(recipientPolicy.p2p_per_tx_limit_mg ?? Number.MAX_SAFE_INTEGER)
  );

  if (input.amountMg > perTxLimit) {
    throw createApiError('P2P_TRANSFER_LIMIT_EXCEEDED', 'Transfer exceeds jurisdiction per-transaction limit', {
      perTxLimitMg: perTxLimit,
      requestedMg: input.amountMg,
    });
  }

  const dailyResult = await client.query<{ total: string }>(
    `
      SELECT COALESCE(SUM(ROUND(ize_amount * $2)), 0)::text AS total
      FROM wallet_ize_transfers
      WHERE sender_user_id = $1
        AND status = 'committed'
        AND created_at >= date_trunc('day', NOW())
    `,
    [input.senderUserId, ONEZE_MG_PER_IZE]
  );

  const monthlyResult = await client.query<{ total: string }>(
    `
      SELECT COALESCE(SUM(ROUND(ize_amount * $2)), 0)::text AS total
      FROM wallet_ize_transfers
      WHERE sender_user_id = $1
        AND status = 'committed'
        AND created_at >= date_trunc('month', NOW())
    `,
    [input.senderUserId, ONEZE_MG_PER_IZE]
  );

  const dailySpentMg = Number(dailyResult.rows[0]?.total ?? '0');
  const monthlySpentMg = Number(monthlyResult.rows[0]?.total ?? '0');

  const dailyLimit = Number(senderPolicy.p2p_daily_limit_mg ?? Number.MAX_SAFE_INTEGER);
  if (dailySpentMg + input.amountMg > dailyLimit) {
    throw createApiError('P2P_TRANSFER_DAILY_LIMIT_EXCEEDED', 'Transfer exceeds sender daily P2P limit', {
      dailyLimitMg: dailyLimit,
      dailySpentMg,
      requestedMg: input.amountMg,
    });
  }

  const monthlyLimit = Number(senderPolicy.p2p_monthly_limit_mg ?? Number.MAX_SAFE_INTEGER);
  if (monthlySpentMg + input.amountMg > monthlyLimit) {
    throw createApiError('P2P_TRANSFER_MONTHLY_LIMIT_EXCEEDED', 'Transfer exceeds sender monthly P2P limit', {
      monthlyLimitMg: monthlyLimit,
      monthlySpentMg,
      requestedMg: input.amountMg,
    });
  }

  return {
    senderCountry,
    recipientCountry,
    requiresTravelRule:
      senderCountry !== recipientCountry && input.amountMg >= config.onezeTravelRuleThresholdMg,
  };
}

async function resolvePayoutCorridor(client: DbQueryable, currency: string): Promise<PayoutCorridorRow | null> {
  const result = await client.query<PayoutCorridorRow>(
    `
      SELECT
        currency,
        rail,
        min_amount_minor,
        max_amount_minor,
        spread_bps,
        network_fee_minor,
        enabled,
        settlement_sla_hours
      FROM payout_corridors
      WHERE currency = $1
      LIMIT 1
    `,
    [currency.toUpperCase()]
  );

  return result.rows[0] ?? null;
}

async function resolveOnezeFiatFxRate(
  client: DbQueryable,
  currency: string,
  options?: { forceRefresh?: boolean }
): Promise<{ rate: number; source: string; observedAt: string }> {
  void options;
  const quote = await resolveCountryPricingQuoteByCurrency(client, currency);
  return {
    rate: quote.sellPrice,
    source: `internal_pricing:${quote.countryCode}:sell`,
    observedAt: new Date().toISOString(),
  };
}

function canTransitionWithdrawalStatus(
  currentStatus: WithdrawalRow['status'],
  nextStatus: WithdrawalRow['status']
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }

  if (currentStatus === 'QUOTED') {
    return ['ACCEPTED', 'RESERVED', 'FAILED'].includes(nextStatus);
  }

  if (currentStatus === 'ACCEPTED') {
    return ['RESERVED', 'FAILED', 'REVERSED'].includes(nextStatus);
  }

  if (currentStatus === 'RESERVED') {
    return ['PAID_OUT', 'FAILED', 'REVERSED'].includes(nextStatus);
  }

  if (currentStatus === 'FAILED') {
    return ['REVERSED'].includes(nextStatus);
  }

  return false;
}

async function loadWithdrawalById(
  client: DbQueryable,
  withdrawalId: string,
  options?: { forUpdate?: boolean }
): Promise<WithdrawalRow | null> {
  const baseQuery = `
    SELECT
      id,
      user_id,
      burn_tx_id,
      amount_mg::text,
      target_currency,
      gross_minor::text,
      spread_minor::text,
      network_fee_minor::text,
      net_minor::text,
      rate_locked::text,
      rate_expires_at::text,
      rail,
      rail_ref,
      status,
      payout_destination,
      metadata,
      created_at::text,
      completed_at::text
    FROM withdrawals
    WHERE id = $1
    LIMIT 1
  `;

  const queryText = options?.forUpdate ? `${baseQuery} FOR UPDATE` : baseQuery;
  const result = await client.query<WithdrawalRow>(queryText, [withdrawalId]);
  return result.rows[0] ?? null;
}

interface OnezeReservePolicyState {
  enabled: boolean;
  minRatio: number;
  maxRatio: number;
  configuredOperationalReserveMg: number;
  reservedWithdrawalMg: number;
  operationalLiquidityMg: number;
  configuredReserveRatio: number | null;
  effectiveReserveRatio: number | null;
  withinPolicy: boolean;
}

interface OnezeRiskDashboardMetrics {
  evaluatedAt: string;
  lookbackHours: number;
  countryFlows: Array<{
    countryCode: string;
    inflowMg: number;
    outflowMg: number;
    netFlowMg: number;
  }>;
  totals: {
    inflowMg: number;
    outflowMg: number;
    netFlowMg: number;
  };
  redemption: {
    mintedIze: number;
    burnedIze: number;
    mintCount: number;
    burnCount: number;
    redemptionRate: number | null;
  };
  crossBorder: {
    transferIze: number;
    burnIze: number;
    totalIze: number;
    transferCount: number;
    burnCount: number;
    totalCount: number;
  };
  liquidity: {
    pendingWithdrawalMg: number;
    operationalLiquidityMg: number;
    stressIndex: number | null;
    stressSignal: number;
    stressLevel: 'normal' | 'elevated' | 'high' | 'critical';
  };
  exposure: {
    circulatingMg: number;
    reserveActiveMg: number;
    supplyDeltaMg: number;
    toleranceMg: number;
    withinSupplyInvariant: boolean;
    netExposureMg: number;
    netExposureIze: number;
  };
  reservePolicy: OnezeReservePolicyState;
}

async function getPendingWithdrawalAmountMg(client: DbQueryable): Promise<number> {
  const result = await client.query<{ total: string }>(
    `
      SELECT COALESCE(SUM(amount_mg), 0)::text AS total
      FROM withdrawals
      WHERE status IN ('ACCEPTED', 'RESERVED')
    `
  );

  return Math.max(0, Number(result.rows[0]?.total ?? '0'));
}

function buildOnezeReservePolicyState(input: {
  reserveActiveMg: number;
  reservedWithdrawalMg: number;
}): OnezeReservePolicyState {
  const minRatio = clampNumber(config.onezeReserveRatioMin, 0, 1);
  const maxRatio = clampNumber(config.onezeReserveRatioMax, minRatio, 1);
  const configuredOperationalReserveMg = toSafeInteger(config.onezeOperationalReserveMg);
  const reservedWithdrawalMg = toSafeInteger(input.reservedWithdrawalMg);
  const operationalLiquidityMg = Math.max(0, configuredOperationalReserveMg - reservedWithdrawalMg);
  const configuredReserveRatio = ratioOrNull(configuredOperationalReserveMg, input.reserveActiveMg);
  const effectiveReserveRatio = ratioOrNull(operationalLiquidityMg, input.reserveActiveMg);
  const withinPolicy =
    !config.onezeReservePolicyEnabled
    || input.reserveActiveMg <= 0
    || (effectiveReserveRatio !== null && effectiveReserveRatio >= minRatio && effectiveReserveRatio <= maxRatio);

  return {
    enabled: config.onezeReservePolicyEnabled,
    minRatio,
    maxRatio,
    configuredOperationalReserveMg,
    reservedWithdrawalMg,
    operationalLiquidityMg,
    configuredReserveRatio,
    effectiveReserveRatio,
    withinPolicy,
  };
}

async function collectOnezeRiskDashboardMetrics(
  client: DbQueryable,
  lookbackHours: number
): Promise<OnezeRiskDashboardMetrics> {
  const safeLookbackHours = clampNumber(Math.round(lookbackHours), 1, 24 * 30);
  const [
    flowRows,
    operationRows,
    crossBorderTransferRows,
    crossBorderBurnRows,
    pendingWithdrawalMg,
    latestSnapshotRows,
    circulatingRows,
    outstandingIze,
  ] = await Promise.all([
    client.query<{ origin_country: string; inflow_mg: string; outflow_mg: string }>(
      `
        SELECT
          origin_country,
          COALESCE(SUM(CASE WHEN amount_mg > 0 THEN amount_mg ELSE 0 END), 0)::text AS inflow_mg,
          COALESCE(SUM(CASE WHEN amount_mg < 0 THEN -amount_mg ELSE 0 END), 0)::text AS outflow_mg
        FROM oneze_balance_origin_events
        WHERE created_at >= NOW() - make_interval(hours => $1::int)
        GROUP BY origin_country
        ORDER BY origin_country ASC
      `,
      [safeLookbackHours]
    ),
    client.query<{
      minted_ize: string;
      burned_ize: string;
      mint_count: number | string;
      burn_count: number | string;
    }>(
      `
        SELECT
          COALESCE(SUM(CASE WHEN operation_type = 'mint' AND status = 'committed' THEN ize_amount ELSE 0 END), 0)::text AS minted_ize,
          COALESCE(SUM(CASE WHEN operation_type = 'burn' AND status = 'committed' THEN ize_amount ELSE 0 END), 0)::text AS burned_ize,
          COALESCE(COUNT(*) FILTER (WHERE operation_type = 'mint' AND status = 'committed'), 0)::text AS mint_count,
          COALESCE(COUNT(*) FILTER (WHERE operation_type = 'burn' AND status = 'committed'), 0)::text AS burn_count
        FROM wallet_ize_operations
        WHERE committed_at >= NOW() - make_interval(hours => $1::int)
      `,
      [safeLookbackHours]
    ),
    client.query<{ total_ize: string; tx_count: number | string }>(
      `
        SELECT
          COALESCE(SUM(ize_amount), 0)::text AS total_ize,
          COALESCE(COUNT(*), 0)::text AS tx_count
        FROM wallet_ize_transfers
        WHERE status = 'committed'
          AND committed_at >= NOW() - make_interval(hours => $1::int)
          AND (
            is_cross_border = TRUE
            OR (
              sender_country IS NOT NULL
              AND recipient_country IS NOT NULL
              AND sender_country <> recipient_country
            )
          )
      `,
      [safeLookbackHours]
    ),
    client.query<{ total_ize: string; tx_count: number | string }>(
      `
        SELECT
          COALESCE(SUM(ize_amount), 0)::text AS total_ize,
          COALESCE(COUNT(*), 0)::text AS tx_count
        FROM wallet_ize_operations
        WHERE operation_type = 'burn'
          AND status = 'committed'
          AND committed_at >= NOW() - make_interval(hours => $1::int)
          AND LOWER(COALESCE(metadata->>'isCrossBorder', 'false')) = 'true'
      `,
      [safeLookbackHours]
    ),
    getPendingWithdrawalAmountMg(client),
    client.query<{
      circulating_mg: string;
      reserve_active_mg: string;
      within_invariant: boolean;
      metadata: Record<string, unknown>;
    }>(
      `
        SELECT
          circulating_mg::text,
          reserve_active_mg::text,
          within_invariant,
          metadata
        FROM oneze_reconciliation_snapshots
        ORDER BY created_at DESC
        LIMIT 1
      `
    ),
    client.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(oneze_balance_mg), 0)::text AS total
        FROM wallets
      `
    ),
    getLedgerAccountBalance(client, 'platform', 'platform', 'ize_outstanding', 'IZE'),
  ]);

  const countryFlows = flowRows.rows.map((row) => {
    const inflowMg = Number(row.inflow_mg);
    const outflowMg = Number(row.outflow_mg);
    return {
      countryCode: normalizeOnezeCountryTag(row.origin_country),
      inflowMg,
      outflowMg,
      netFlowMg: inflowMg - outflowMg,
    };
  });

  const totals = countryFlows.reduce(
    (accumulator, row) => {
      accumulator.inflowMg += row.inflowMg;
      accumulator.outflowMg += row.outflowMg;
      accumulator.netFlowMg += row.netFlowMg;
      return accumulator;
    },
    {
      inflowMg: 0,
      outflowMg: 0,
      netFlowMg: 0,
    }
  );

  const operationSummary = operationRows.rows[0];
  const mintedIze = Number(operationSummary?.minted_ize ?? '0');
  const burnedIze = Number(operationSummary?.burned_ize ?? '0');
  const mintCount = Number(operationSummary?.mint_count ?? '0');
  const burnCount = Number(operationSummary?.burn_count ?? '0');
  const redemptionRate = mintedIze > 0 ? roundTo(burnedIze / mintedIze, 6) : null;

  const crossBorderTransfers = crossBorderTransferRows.rows[0];
  const crossBorderBurns = crossBorderBurnRows.rows[0];
  const transferIze = Number(crossBorderTransfers?.total_ize ?? '0');
  const burnIze = Number(crossBorderBurns?.total_ize ?? '0');
  const transferCount = Number(crossBorderTransfers?.tx_count ?? '0');
  const burnCountCrossBorder = Number(crossBorderBurns?.tx_count ?? '0');

  const latestSnapshot = latestSnapshotRows.rows[0];
  const latestSnapshotMetadata = asObject(latestSnapshot?.metadata);
  const circulatingMg = latestSnapshot
    ? Number(latestSnapshot.circulating_mg)
    : Number(circulatingRows.rows[0]?.total ?? '0');
  const reserveActiveMg = latestSnapshot
    ? Number(latestSnapshot.reserve_active_mg)
    : Math.max(0, Math.round(outstandingIze * ONEZE_MG_PER_IZE));
  const supplyDeltaMg =
    asFiniteNumber(latestSnapshotMetadata.supplyDeltaMg)
    ?? (circulatingMg - reserveActiveMg);
  const toleranceMg =
    asFiniteNumber(latestSnapshotMetadata.toleranceMg)
    ?? Math.max(0, Math.round(Math.abs(config.onezeSupplyDriftThresholdIze) * ONEZE_MG_PER_IZE));
  const withinSupplyInvariant =
    (typeof latestSnapshotMetadata.withinSupplyInvariant === 'boolean'
      ? latestSnapshotMetadata.withinSupplyInvariant
      : null)
    ?? latestSnapshot?.within_invariant
    ?? (Math.abs(supplyDeltaMg) <= toleranceMg);

  const reservePolicy = buildOnezeReservePolicyState({
    reserveActiveMg,
    reservedWithdrawalMg: pendingWithdrawalMg,
  });
  const stressSignal =
    reservePolicy.operationalLiquidityMg > 0
      ? pendingWithdrawalMg / reservePolicy.operationalLiquidityMg
      : pendingWithdrawalMg > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  const stressIndex = Number.isFinite(stressSignal) ? roundTo(stressSignal, 6) : null;
  const stressLevel: 'normal' | 'elevated' | 'high' | 'critical' =
    !Number.isFinite(stressSignal)
      ? (pendingWithdrawalMg > 0 ? 'critical' : 'normal')
      : stressSignal >= 1
        ? 'critical'
        : stressSignal >= 0.85
          ? 'high'
          : stressSignal >= 0.5
            ? 'elevated'
            : 'normal';

  const netExposureMg = circulatingMg - reservePolicy.configuredOperationalReserveMg;

  return {
    evaluatedAt: new Date().toISOString(),
    lookbackHours: safeLookbackHours,
    countryFlows,
    totals,
    redemption: {
      mintedIze,
      burnedIze,
      mintCount,
      burnCount,
      redemptionRate,
    },
    crossBorder: {
      transferIze,
      burnIze,
      totalIze: roundTo(transferIze + burnIze, 6),
      transferCount,
      burnCount: burnCountCrossBorder,
      totalCount: transferCount + burnCountCrossBorder,
    },
    liquidity: {
      pendingWithdrawalMg,
      operationalLiquidityMg: reservePolicy.operationalLiquidityMg,
      stressIndex,
      stressSignal,
      stressLevel,
    },
    exposure: {
      circulatingMg,
      reserveActiveMg,
      supplyDeltaMg,
      toleranceMg,
      withinSupplyInvariant,
      netExposureMg,
      netExposureIze: mgToOnezeAmount(netExposureMg),
    },
    reservePolicy,
  };
}

async function captureOnezeReconciliationSnapshot(
  client: DbQueryable,
  reason: string,
  metadata?: Record<string, unknown>
): Promise<{
  id: string;
  circulatingMg: number;
  reserveActiveMg: number;
  withinInvariant: boolean;
  withinSupplyInvariant: boolean;
  withinReservePolicy: boolean;
  invariantHash: string;
  supplyDeltaMg: number;
  toleranceMg: number;
  operationalLiquidityMg: number;
  configuredOperationalReserveMg: number;
  reservedWithdrawalMg: number;
  configuredReserveRatio: number | null;
  effectiveReserveRatio: number | null;
  createdAt: string;
}> {
  const [circulatingResult, outstandingIze, reservedWithdrawalMg] = await Promise.all([
    client.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(oneze_balance_mg), 0)::text AS total
        FROM wallets
      `
    ),
    getLedgerAccountBalance(client, 'platform', 'platform', 'ize_outstanding', 'IZE'),
    getPendingWithdrawalAmountMg(client),
  ]);

  const circulatingMg = Number(circulatingResult.rows[0]?.total ?? '0');
  const reserveActiveMg = Math.max(0, Math.round(outstandingIze * ONEZE_MG_PER_IZE));
  const reservePolicy = buildOnezeReservePolicyState({
    reserveActiveMg,
    reservedWithdrawalMg,
  });
  const operationalLiquidityMg = reservePolicy.operationalLiquidityMg;
  const supplyDeltaMg = circulatingMg - reserveActiveMg;
  const toleranceMg = Math.max(0, Math.round(Math.abs(config.onezeSupplyDriftThresholdIze) * ONEZE_MG_PER_IZE));
  const withinSupplyInvariant = Math.abs(supplyDeltaMg) <= toleranceMg;
  const withinInvariant = withinSupplyInvariant && reservePolicy.withinPolicy;
  const invariantHash = crypto
    .createHash('sha256')
    .update(`${circulatingMg}|${reserveActiveMg}|${reason}|${reservePolicy.effectiveReserveRatio ?? 'na'}`)
    .digest('hex');
  const snapshotId = createRuntimeId('recon');

  const inserted = await client.query<{ created_at: string }>(
    `
      INSERT INTO oneze_reconciliation_snapshots (
        id,
        circulating_mg,
        reserve_active_mg,
        within_invariant,
        invariant_hash,
        reason,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING created_at::text
    `,
    [
      snapshotId,
      circulatingMg,
      reserveActiveMg,
      withinInvariant,
      invariantHash,
      reason,
      toJsonString({
        invariantMode: 'closed_loop_supply_parity',
        supplyDeltaMg,
        toleranceMg,
        withinSupplyInvariant,
        reservePolicy: {
          enabled: reservePolicy.enabled,
          minRatio: reservePolicy.minRatio,
          maxRatio: reservePolicy.maxRatio,
          configuredOperationalReserveMg: reservePolicy.configuredOperationalReserveMg,
          reservedWithdrawalMg: reservePolicy.reservedWithdrawalMg,
          configuredReserveRatio: reservePolicy.configuredReserveRatio,
          effectiveReserveRatio: reservePolicy.effectiveReserveRatio,
          withinPolicy: reservePolicy.withinPolicy,
        },
        operationalLiquidityMg,
        ...(metadata ?? {}),
      }),
    ]
  );

  return {
    id: snapshotId,
    circulatingMg,
    reserveActiveMg,
    withinInvariant,
    withinSupplyInvariant,
    withinReservePolicy: reservePolicy.withinPolicy,
    invariantHash,
    supplyDeltaMg,
    toleranceMg,
    operationalLiquidityMg,
    configuredOperationalReserveMg: reservePolicy.configuredOperationalReserveMg,
    reservedWithdrawalMg: reservePolicy.reservedWithdrawalMg,
    configuredReserveRatio: reservePolicy.configuredReserveRatio,
    effectiveReserveRatio: reservePolicy.effectiveReserveRatio,
    createdAt: inserted.rows[0]?.created_at ?? new Date().toISOString(),
  };
}

async function executeReservedWithdrawal(
  client: DbQueryable,
  input: {
    withdrawalId: string;
    railRef?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<{
  alreadySettled: boolean;
  withdrawal: ReturnType<typeof toWithdrawalPayload>;
  settlement: {
    railRef: string;
    reserveConsumption: Array<{ lotId: string; consumedMg: number }>;
  } | null;
  wallet: {
    walletId: string;
    onezeBalanceMg: number;
    onezeBalance: number;
  } | null;
}> {
  const withdrawal = await loadWithdrawalById(client, input.withdrawalId, { forUpdate: true });
  if (!withdrawal) {
    throw createApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found', {
      withdrawalId: input.withdrawalId,
    });
  }

  if (withdrawal.status === 'PAID_OUT') {
    return {
      alreadySettled: true,
      withdrawal: toWithdrawalPayload(withdrawal),
      settlement: null,
      wallet: null,
    };
  }

  if (!canTransitionWithdrawalStatus(withdrawal.status, 'PAID_OUT')) {
    throw createApiError('WITHDRAWAL_STATE_INVALID', 'Withdrawal cannot be executed from current status', {
      withdrawalId: input.withdrawalId,
      status: withdrawal.status,
    });
  }

  const amountMg = Number(withdrawal.amount_mg);
  const linkedTxId = withdrawal.burn_tx_id ?? createRuntimeId('wdburn');
  const reserveConsumption: Array<{ lotId: string; consumedMg: number }> = [];
  const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, withdrawal.target_currency);

  const wallet = await ensureWallet(client, withdrawal.user_id, withdrawal.target_currency);
  const walletBalanceAfterMg = await applyWalletLedgerDelta(client, {
    walletId: wallet.id,
    txId: linkedTxId,
    asset: '1ZE',
    amount: 0,
    kind: 'WITHDRAWAL_SETTLED',
    refType: 'withdrawal',
    refId: withdrawal.id,
    anchorValueInInr: pricingQuote.anchorValueInInr,
    metadata: {
      withdrawalId: withdrawal.id,
      reserveLots: reserveConsumption,
      pricingSource: `internal_pricing:${pricingQuote.countryCode}:sell`,
      ...(input.metadata ?? {}),
    },
  });

  const railRef = input.railRef ?? `${withdrawal.rail}_${createRuntimeId('payout')}`;
  const updatedResult = await client.query<WithdrawalRow>(
    `
      UPDATE withdrawals
      SET
        burn_tx_id = COALESCE(burn_tx_id, $2),
        rail_ref = $3,
        status = 'PAID_OUT',
        completed_at = NOW(),
        metadata = metadata || $4::jsonb
      WHERE id = $1
      RETURNING
        id,
        user_id,
        burn_tx_id,
        amount_mg::text,
        target_currency,
        gross_minor::text,
        spread_minor::text,
        network_fee_minor::text,
        net_minor::text,
        rate_locked::text,
        rate_expires_at::text,
        rail,
        rail_ref,
        status,
        payout_destination,
        metadata,
        created_at::text,
        completed_at::text
    `,
    [
      withdrawal.id,
      linkedTxId,
      railRef,
      toJsonString({
        executedAt: new Date().toISOString(),
        reserveConsumption,
        ...(input.metadata ?? {}),
      }),
    ]
  );

  return {
    alreadySettled: false,
    withdrawal: toWithdrawalPayload(updatedResult.rows[0]),
    settlement: {
      railRef,
      reserveConsumption,
    },
    wallet: {
      walletId: wallet.id,
      onezeBalanceMg: walletBalanceAfterMg,
      onezeBalance: mgToOnezeAmount(walletBalanceAfterMg),
    },
  };
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
      | 'order_delivery'
      | 'payout'
      | 'refund'
      | 'adjustment'
      | 'mint'
      | 'burn'
      | 'coOwn_trade'
      | 'buyout'
      | 'reserve_reconcile'
      | 'transfer';
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

async function getTotalUserLedgerIzeBalance(client: DbQueryable): Promise<number> {
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
      WHERE la.owner_type = 'user'
        AND la.account_code = 'ize_wallet'
        AND la.currency = 'IZE'
    `
  );

  return Number(result.rows[0]?.balance ?? '0');
}

async function getPlatformIzeReserveSnapshot(client: DbQueryable): Promise<{
  outstandingIze: number;
  liquidityBufferIze: null;
  circulatingIze: number;
  supplyDeltaIze: number;
  supplyParityRatio: number | null;
}> {
  const [outstandingIze, circulatingIze] = await Promise.all([
    getLedgerAccountBalance(client, 'platform', 'platform', 'ize_outstanding', 'IZE'),
    getTotalUserLedgerIzeBalance(client),
  ]);

  const supplyDeltaIze = Number((circulatingIze - outstandingIze).toFixed(6));
  const supplyParityRatio =
    outstandingIze > 0
      ? Number((circulatingIze / outstandingIze).toFixed(6))
      : null;

  return {
    outstandingIze,
    liquidityBufferIze: null,
    circulatingIze,
    supplyDeltaIze,
    supplyParityRatio,
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

async function recordIzeTransfer(
  client: PoolClient,
  input: {
    transferId: string;
    senderUserId: string;
    recipientUserId: string;
    izeAmount: number;
    fiatAmount: number;
    fiatCurrency: string;
    ratePerGram: number;
    eligibilityCode: string;
    amlRiskScore: number;
    amlRiskLevel: string;
    amlAlertId?: string | null;
    senderCountry?: string;
    recipientCountry?: string;
    travelRulePayload?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (input.senderUserId === input.recipientUserId) {
    throw createApiError('P2P_TRANSFER_INVALID', 'Sender and recipient must be different users');
  }

  const availableIze = await getLedgerAccountBalance(client, 'user', input.senderUserId, 'ize_wallet', 'IZE');
  if (input.izeAmount > availableIze + 1e-8) {
    throw createApiError('IZE_TRANSFER_INSUFFICIENT_BALANCE', 'Insufficient 1ze balance for transfer', {
      availableIze,
      requestedIze: input.izeAmount,
    });
  }

  const senderWalletAccountId = await ensureLedgerAccount(client, 'user', input.senderUserId, 'ize_wallet', 'IZE');
  const recipientWalletAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.recipientUserId,
    'ize_wallet',
    'IZE'
  );

  await appendLedgerEntry(client, {
    accountId: senderWalletAccountId,
    counterpartyAccountId: recipientWalletAccountId,
    direction: 'debit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'transfer',
    sourceId: input.transferId,
    lineType: 'p2p_sender_debit',
    metadata: {
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      ratePerGram: input.ratePerGram,
      ...(input.metadata ?? {}),
    },
  });

  await appendLedgerEntry(client, {
    accountId: recipientWalletAccountId,
    counterpartyAccountId: senderWalletAccountId,
    direction: 'credit',
    amount: input.izeAmount,
    currency: 'IZE',
    sourceType: 'transfer',
    sourceId: input.transferId,
    lineType: 'p2p_recipient_credit',
    metadata: {
      senderUserId: input.senderUserId,
      recipientUserId: input.recipientUserId,
      fiatAmount: input.fiatAmount,
      fiatCurrency: input.fiatCurrency,
      ratePerGram: input.ratePerGram,
      ...(input.metadata ?? {}),
    },
  });

  await client.query(
    `
      INSERT INTO wallet_ize_transfers (
        id,
        sender_user_id,
        recipient_user_id,
        ize_amount,
        fiat_amount,
        fiat_currency,
        rate_per_gram,
        status,
        eligibility_code,
        aml_risk_score,
        aml_risk_level,
        aml_alert_id,
        sender_country,
        recipient_country,
        travel_rule_payload,
        metadata,
        committed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'committed', $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, NOW())
    `,
    [
      input.transferId,
      input.senderUserId,
      input.recipientUserId,
      input.izeAmount,
      input.fiatAmount,
      input.fiatCurrency,
      input.ratePerGram,
      input.eligibilityCode,
      input.amlRiskScore,
      input.amlRiskLevel,
      input.amlAlertId ?? null,
      input.senderCountry ?? null,
      input.recipientCountry ?? null,
      toJsonString(input.travelRulePayload ?? {}),
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
    postageFeeGbp?: number;
    totalGbp: number;
  }
): Promise<void> {
  const totalGbp = roundTo(input.totalGbp, 2);
  const subtotalGbp = roundTo(input.subtotalGbp, 2);
  const platformChargeGbp = roundTo(input.platformChargeGbp, 2);
  const postageFeeGbp = roundTo(Math.max(0, input.postageFeeGbp ?? 0), 2);

  if (totalGbp <= 0) {
    return;
  }

  const buyerSpendAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.buyerId,
    'buyer_spend'
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
      sellerEscrowHeldGbp: subtotalGbp,
      releasePolicy: 'parcel_delivery_confirmation',
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
      sellerEscrowHeldGbp: subtotalGbp,
      releasePolicy: 'parcel_delivery_confirmation',
    },
  });

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

  if (postageFeeGbp > 0) {
    await appendLedgerEntry(client, {
      accountId: escrowAccountId,
      counterpartyAccountId: platformRevenueAccountId,
      direction: 'debit',
      amountGbp: postageFeeGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'postage_fee_credit',
      metadata: {
        component: 'postage_fee',
      },
    });

    await appendLedgerEntry(client, {
      accountId: platformRevenueAccountId,
      counterpartyAccountId: escrowAccountId,
      direction: 'credit',
      amountGbp: postageFeeGbp,
      sourceType: 'order_payment',
      sourceId: input.orderId,
      lineType: 'postage_fee_credit',
      metadata: {
        component: 'postage_fee',
      },
    });
  }
}

async function hasCommerceOrderRefundReversalPosted(
  client: DbQueryable,
  orderId: string
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM ledger_entries
        WHERE source_id = $1
          AND source_type = 'refund'
          AND line_type = 'buyer_refund'
      ) AS exists
    `,
    [orderId]
  );

  return Boolean(result.rows[0]?.exists);
}

async function postCommerceOrderRefundLedgerReversal(
  client: DbQueryable,
  orderId: string,
  buyerId: string,
  totalGbp: number
): Promise<{ reversed: boolean; alreadyReversed: boolean }> {
  if (totalGbp <= 0) {
    return {
      reversed: false,
      alreadyReversed: true,
    };
  }

  if (await hasCommerceOrderRefundReversalPosted(client, orderId)) {
    return {
      reversed: false,
      alreadyReversed: true,
    };
  }

  const buyerSpendAccountId = await ensureLedgerAccount(
    client,
    'user',
    buyerId,
    'buyer_spend'
  );
  const escrowAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'escrow_liability'
  );

  await appendLedgerEntry(client, {
    accountId: escrowAccountId,
    counterpartyAccountId: buyerSpendAccountId,
    direction: 'debit',
    amountGbp: totalGbp,
    sourceType: 'refund',
    sourceId: orderId,
    lineType: 'buyer_refund',
  });

  await appendLedgerEntry(client, {
    accountId: buyerSpendAccountId,
    counterpartyAccountId: escrowAccountId,
    direction: 'credit',
    amountGbp: totalGbp,
    sourceType: 'refund',
    sourceId: orderId,
    lineType: 'buyer_refund',
  });

  return {
    reversed: true,
    alreadyReversed: false,
  };
}

async function hasCommerceOrderSellerEscrowReleased(
  client: DbQueryable,
  orderId: string
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM ledger_entries
        WHERE source_id = $1
          AND (
            (source_type = 'order_delivery' AND line_type = 'seller_payable_release')
            OR (source_type = 'order_payment' AND line_type = 'seller_payable_credit')
          )
      ) AS exists
    `,
    [orderId]
  );

  return Boolean(result.rows[0]?.exists);
}

async function releaseCommerceOrderEscrowToSeller(
  client: DbQueryable,
  input: {
    orderId: string;
    sellerId: string;
    subtotalGbp: number;
    parcelProvider: string;
    parcelEventType: ParcelEventType;
    trackingId?: string;
    providerEventId?: string;
  }
): Promise<{ released: boolean; alreadyReleased: boolean }> {
  const subtotalGbp = roundTo(Math.max(0, input.subtotalGbp), 2);
  if (subtotalGbp <= 0) {
    return {
      released: false,
      alreadyReleased: true,
    };
  }

  if (await hasCommerceOrderSellerEscrowReleased(client, input.orderId)) {
    return {
      released: false,
      alreadyReleased: true,
    };
  }

  const escrowBalanceGbp = await getLedgerAccountBalance(
    client,
    'platform',
    'platform',
    'escrow_liability'
  );
  if (subtotalGbp > escrowBalanceGbp + 1e-6) {
    throw createApiError(
      'ESCROW_INSUFFICIENT',
      'Escrow balance is insufficient to release seller funds for this order',
      {
        orderId: input.orderId,
        subtotalGbp,
        escrowBalanceGbp,
      }
    );
  }

  const escrowAccountId = await ensureLedgerAccount(
    client,
    'platform',
    'platform',
    'escrow_liability'
  );
  const sellerPayableAccountId = await ensureLedgerAccount(
    client,
    'user',
    input.sellerId,
    'seller_payable'
  );

  await appendLedgerEntry(client, {
    accountId: escrowAccountId,
    counterpartyAccountId: sellerPayableAccountId,
    direction: 'debit',
    amountGbp: subtotalGbp,
    sourceType: 'order_delivery',
    sourceId: input.orderId,
    lineType: 'seller_payable_release',
    metadata: {
      sellerId: input.sellerId,
      parcelProvider: input.parcelProvider,
      parcelEventType: input.parcelEventType,
      trackingId: input.trackingId ?? null,
      providerEventId: input.providerEventId ?? null,
      releasePolicy: 'parcel_delivery_confirmation',
    },
  });

  await appendLedgerEntry(client, {
    accountId: sellerPayableAccountId,
    counterpartyAccountId: escrowAccountId,
    direction: 'credit',
    amountGbp: subtotalGbp,
    sourceType: 'order_delivery',
    sourceId: input.orderId,
    lineType: 'seller_payable_release',
    metadata: {
      sellerId: input.sellerId,
      parcelProvider: input.parcelProvider,
      parcelEventType: input.parcelEventType,
      trackingId: input.trackingId ?? null,
      providerEventId: input.providerEventId ?? null,
      releasePolicy: 'parcel_delivery_confirmation',
    },
  });

  return {
    released: true,
    alreadyReleased: false,
  };
}

interface CommerceOrderDbRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  subtotal_gbp: number | string;
  buyer_protection_fee_gbp: number | string;
  postage_fee_gbp: number | string;
  total_gbp: number | string;
  status: string;
  address_id: number | null;
  payment_method_id: number | null;
  shipping_carrier_id: string | null;
  shipping_provider: string | null;
  tracking_number: string | null;
  shipping_label_url: string | null;
  shipping_quote_gbp: number | string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  shipping_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

async function resolveUserPrimaryPostcode(client: DbQueryable, userId: string): Promise<string | null> {
  const result = await client.query<{ postcode: string }>(
    `
      SELECT postcode
      FROM user_addresses
      WHERE user_id = $1
      ORDER BY is_default DESC, updated_at DESC, created_at DESC
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0]?.postcode ?? null;
}

async function provisionOrderShipmentIfMissing(
  client: DbQueryable,
  input: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    addressId: number | null;
    listingId: string;
    preferredCarrierId?: string | null;
    postageFeeGbp?: number;
  }
): Promise<
  | {
    provisioned: true;
    shippingProvider: string;
    trackingNumber: string;
    shippingLabelUrl: string | null;
    quoteGbp: number;
  }
  | {
    provisioned: false;
    reason: string;
    shippingProvider?: string | null;
    trackingNumber?: string | null;
    shippingLabelUrl?: string | null;
    quoteGbp?: number | null;
  }
> {
  const existing = await client.query<{
    tracking_number: string | null;
    shipping_provider: string | null;
    shipping_label_url: string | null;
    shipping_quote_gbp: number | string | null;
  }>(
    `
      SELECT
        tracking_number,
        shipping_provider,
        shipping_label_url,
        shipping_quote_gbp
      FROM orders
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [input.orderId]
  );

  const current = existing.rows[0];
  if (current?.tracking_number) {
    return {
      provisioned: false,
      reason: 'tracking_already_present',
      trackingNumber: current.tracking_number,
      shippingProvider: current.shipping_provider,
      shippingLabelUrl: current.shipping_label_url,
      quoteGbp: current.shipping_quote_gbp === null ? null : Number(current.shipping_quote_gbp),
    };
  }

  const destinationPostcode = input.addressId
    ? (
      await client.query<{ postcode: string }>(
        'SELECT postcode FROM user_addresses WHERE id = $1 AND user_id = $2 LIMIT 1',
        [input.addressId, input.buyerId]
      )
    ).rows[0]?.postcode ?? null
    : await resolveUserPrimaryPostcode(client, input.buyerId);

  const originPostcode = await resolveUserPrimaryPostcode(client, input.sellerId);

  if (!originPostcode || !destinationPostcode) {
    return {
      provisioned: false,
      reason: 'postcode_context_missing',
    };
  }

  let postageCarriers: CapabilityCarrier[] = resolveCountryCapabilities({
    countryCode: 'GB',
  }).postage.carriers;

  try {
    if (await onezeP2pTablesAvailable(client)) {
      const buyerProfile = await getOrCreateComplianceProfile(client, input.buyerId);
      const capabilities = resolveCountryCapabilities({
        countryCode: buyerProfile.countryCode,
        residencyCountryCode: buyerProfile.residencyCountryCode,
      });

      if (capabilities.postage.carriers.length > 0) {
        postageCarriers = capabilities.postage.carriers;
      }
    }
  } catch {
    // Default carrier profile is used when compliance context is unavailable.
  }

  const selectedCarrier =
    postageCarriers.find((carrier) => carrier.id === input.preferredCarrierId)
    ?? postageCarriers[0]
    ?? {
      id: input.preferredCarrierId ?? 'evri',
      label: 'Evri',
      priceFromGbp: 2.9,
      etaMinDays: 2,
      etaMaxDays: 4,
      tracking: true,
    };

  const shipment = await createShipment({
    orderId: input.orderId,
    carrierId: selectedCarrier.id,
    carrierLabel: selectedCarrier.label,
    originPostcode,
    destinationPostcode,
    declaredValueGbp: input.postageFeeGbp,
  });

  const resolvedQuoteGbp = roundTo(
    Math.max(0, input.postageFeeGbp ?? shipment.priceGbp ?? selectedCarrier.priceFromGbp),
    2
  );

  await client.query(
    `
      UPDATE orders
      SET
        shipping_carrier_id = COALESCE(shipping_carrier_id, $2),
        shipping_provider = COALESCE(shipping_provider, $3),
        tracking_number = COALESCE(tracking_number, $4),
        shipping_label_url = COALESCE(shipping_label_url, $5),
        shipping_quote_gbp = COALESCE(shipping_quote_gbp, $6),
        shipping_metadata = COALESCE(shipping_metadata, '{}'::jsonb) || $7::jsonb,
        updated_at = NOW()
      WHERE id = $1
    `,
    [
      input.orderId,
      selectedCarrier.id,
      shipment.provider,
      shipment.trackingNumber,
      shipment.labelUrl,
      resolvedQuoteGbp,
      toJsonString({
        shipment: {
          carrierId: selectedCarrier.id,
          provider: shipment.provider,
          trackingNumber: shipment.trackingNumber,
          labelUrl: shipment.labelUrl,
          quoteGbp: resolvedQuoteGbp,
          live: shipment.live,
          metadata: shipment.metadata,
          provisionedAt: new Date().toISOString(),
        },
      }),
    ]
  );

  return {
    provisioned: true,
    shippingProvider: shipment.provider,
    trackingNumber: shipment.trackingNumber,
    shippingLabelUrl: shipment.labelUrl,
    quoteGbp: resolvedQuoteGbp,
  };
}

async function applyOrderParcelEvent(
  client: PoolClient,
  input: {
    orderId: string;
    provider: string;
    eventType: ParcelEventType;
    providerEventId?: string;
    trackingId?: string;
    occurredAt?: string;
    payload?: Record<string, unknown>;
    source: 'admin' | 'shipping_webhook';
  }
): Promise<{
  idempotent: boolean;
  parcelEvent: {
    provider: string;
    eventType: ParcelEventType;
    providerEventId: string | null;
    trackingId: string | null;
    occurredAt: string | null;
    recorded: boolean;
    duplicate: boolean;
  };
  order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    subtotalGbp: number;
    buyerProtectionFeeGbp: number;
    platformChargeGbp: number;
    postageFeeGbp: number;
    totalGbp: number;
    status: string;
    addressId: number | null;
    paymentMethodId: number | null;
    shippingCarrierId: string | null;
    shippingProvider: string | null;
    trackingNumber: string | null;
    shippingLabelUrl: string | null;
    shippingQuoteGbp: number | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  settlement: {
    releasePolicy: 'parcel_delivery_confirmation';
    sellerEscrowHeldGbp: number;
    sellerPayableReleasedGbp: number;
    sellerCashoutEligible: boolean;
    alreadyReleased: boolean;
  };
}> {
  const orderResult = await client.query<CommerceOrderDbRow>(
    `
      SELECT
        id,
        buyer_id,
        seller_id,
        listing_id,
        subtotal_gbp,
        buyer_protection_fee_gbp,
        postage_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        shipping_carrier_id,
        shipping_provider,
        tracking_number,
        shipping_label_url,
        shipping_quote_gbp,
        shipped_at::text,
        delivered_at::text,
        shipping_metadata,
        created_at::text,
        updated_at::text
      FROM orders
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [input.orderId]
  );

  const order = orderResult.rows[0];
  if (!order) {
    throw createApiError('ORDER_NOT_FOUND', 'Order not found', {
      orderId: input.orderId,
      source: input.source,
    });
  }

  if (order.status === 'created') {
    throw createApiError('ORDER_NOT_READY', 'Order has not been paid yet, parcel events cannot be applied', {
      orderId: input.orderId,
      source: input.source,
    });
  }

  if (order.status === 'cancelled') {
    throw createApiError('ORDER_INVALID_STATE', 'Order is cancelled and cannot accept parcel events', {
      orderId: input.orderId,
      source: input.source,
    });
  }

  let parcelEventRecorded = true;
  let parcelEventDuplicate = false;
  if (await orderParcelEventsTableAvailable(client)) {
    const storedEvent = await client.query<{ id: number }>(
      `
        INSERT INTO order_parcel_events (
          order_id,
          provider,
          event_type,
          provider_event_id,
          tracking_id,
          occurred_at,
          payload
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (provider, provider_event_id)
        WHERE provider_event_id IS NOT NULL
        DO NOTHING
        RETURNING id
      `,
      [
        input.orderId,
        input.provider,
        input.eventType,
        input.providerEventId ?? null,
        input.trackingId ?? null,
        input.occurredAt ?? null,
        toJsonString(input.payload ?? {}),
      ]
    );

    const insertedEventCount = storedEvent.rowCount ?? 0;
    parcelEventRecorded = insertedEventCount > 0 || !input.providerEventId;
    parcelEventDuplicate = Boolean(input.providerEventId) && insertedEventCount === 0;
  }

  let nextStatus = order.status;
  if (PARCEL_DELIVERY_RELEASE_EVENTS.has(input.eventType)) {
    if (order.status === 'paid' || order.status === 'shipped') {
      nextStatus = 'delivered';
    }
  } else if (PARCEL_SHIPPING_PROGRESS_EVENTS.has(input.eventType)) {
    if (order.status === 'paid') {
      nextStatus = 'shipped';
    }
  }

  let status = order.status;
  let updatedAt = order.updated_at;
  let shippedAt = order.shipped_at;
  let deliveredAt = order.delivered_at;
  let trackingNumber = order.tracking_number;
  let shippingProvider = order.shipping_provider;
  let shippingLabelUrl = order.shipping_label_url;
  let shippingQuoteGbp = order.shipping_quote_gbp === null ? null : Number(order.shipping_quote_gbp);
  let shippingCarrierId = order.shipping_carrier_id;
  let statusChanged = false;

  const shouldUpdateTracking = Boolean(input.trackingId) && trackingNumber !== input.trackingId;
  const shouldUpdateProvider = !shippingProvider && input.provider.trim().length > 0;

  if (nextStatus !== order.status || shouldUpdateTracking || shouldUpdateProvider) {
    const updatedOrder = await client.query<{
      status: string;
      updated_at: string;
      shipped_at: string | null;
      delivered_at: string | null;
      tracking_number: string | null;
      shipping_provider: string | null;
      shipping_label_url: string | null;
      shipping_quote_gbp: number | string | null;
      shipping_carrier_id: string | null;
    }>(
      `
        UPDATE orders
        SET
          status = $2,
          shipped_at = CASE
            WHEN $2 = 'shipped' THEN COALESCE(shipped_at, NOW())
            ELSE shipped_at
          END,
          delivered_at = CASE
            WHEN $2 = 'delivered' THEN COALESCE(delivered_at, NOW())
            ELSE delivered_at
          END,
          tracking_number = COALESCE($3, tracking_number),
          shipping_provider = COALESCE($4, shipping_provider),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          status,
          updated_at::text,
          shipped_at::text,
          delivered_at::text,
          tracking_number,
          shipping_provider,
          shipping_label_url,
          shipping_quote_gbp::text,
          shipping_carrier_id
      `,
      [
        input.orderId,
        nextStatus,
        input.trackingId ?? null,
        shouldUpdateProvider ? input.provider : null,
      ]
    );

    const updatedRow = updatedOrder.rows[0];
    if (updatedRow) {
      status = updatedRow.status;
      updatedAt = updatedRow.updated_at;
      shippedAt = updatedRow.shipped_at;
      deliveredAt = updatedRow.delivered_at;
      trackingNumber = updatedRow.tracking_number;
      shippingProvider = updatedRow.shipping_provider;
      shippingLabelUrl = updatedRow.shipping_label_url;
      shippingQuoteGbp = updatedRow.shipping_quote_gbp === null ? null : Number(updatedRow.shipping_quote_gbp);
      shippingCarrierId = updatedRow.shipping_carrier_id;
      statusChanged = status !== order.status;
    }
  }

  let sellerPayableReleasedGbp = 0;
  let alreadyReleased = false;
  if (PARCEL_DELIVERY_RELEASE_EVENTS.has(input.eventType)) {
    if (order.status !== 'paid' && order.status !== 'shipped' && order.status !== 'delivered') {
      throw createApiError('ORDER_INVALID_STATE', `Order cannot be delivered from status '${order.status}'`, {
        orderId: input.orderId,
        status: order.status,
      });
    }

    if (await ledgerTablesAvailable(client)) {
      const release = await releaseCommerceOrderEscrowToSeller(client, {
        orderId: order.id,
        sellerId: order.seller_id,
        subtotalGbp: Number(order.subtotal_gbp),
        parcelProvider: input.provider,
        parcelEventType: input.eventType,
        trackingId: input.trackingId,
        providerEventId: input.providerEventId,
      });

      sellerPayableReleasedGbp = release.released ? Number(order.subtotal_gbp) : 0;
      alreadyReleased = release.alreadyReleased;
    }
  }

  const sellerEscrowHeldGbp = Number(order.subtotal_gbp);
  const platformChargeGbp = Number(order.buyer_protection_fee_gbp);
  const postageFeeGbp = Number(order.postage_fee_gbp);
  const idempotent =
    !statusChanged
    && !sellerPayableReleasedGbp
    && (alreadyReleased || parcelEventDuplicate);

  return {
    idempotent,
    parcelEvent: {
      provider: input.provider,
      eventType: input.eventType,
      providerEventId: input.providerEventId ?? null,
      trackingId: input.trackingId ?? null,
      occurredAt: input.occurredAt ?? null,
      recorded: parcelEventRecorded,
      duplicate: parcelEventDuplicate,
    },
    order: {
      id: order.id,
      buyerId: order.buyer_id,
      sellerId: order.seller_id,
      listingId: order.listing_id,
      subtotalGbp: sellerEscrowHeldGbp,
      buyerProtectionFeeGbp: platformChargeGbp,
      platformChargeGbp,
      postageFeeGbp,
      totalGbp: Number(order.total_gbp),
      status,
      addressId: order.address_id,
      paymentMethodId: order.payment_method_id,
      shippingCarrierId,
      shippingProvider,
      trackingNumber,
      shippingLabelUrl,
      shippingQuoteGbp,
      shippedAt,
      deliveredAt,
      createdAt: order.created_at,
      updatedAt,
    },
    settlement: {
      releasePolicy: 'parcel_delivery_confirmation',
      sellerEscrowHeldGbp,
      sellerPayableReleasedGbp,
      sellerCashoutEligible: status === 'delivered',
      alreadyReleased,
    },
  };
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
  if (channel === 'co-own') {
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
    sellerEscrowHeldGbp: number;
    sellerCashoutEligible: boolean;
    platformCommissionCreditedGbp: number;
    platformChargeCreditedGbp: number;
    postageFeeCreditedGbp: number;
    shipment?: {
      provisioned: boolean;
      reason?: string;
      trackingNumber?: string | null;
      shippingProvider?: string | null;
      shippingLabelUrl?: string | null;
      shippingQuoteGbp?: number | null;
    };
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
        coOwn_order_id,
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
        coOwn_order_id,
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
        sellerEscrowHeldGbp: number;
        sellerCashoutEligible: boolean;
        platformCommissionCreditedGbp: number;
        platformChargeCreditedGbp: number;
        postageFeeCreditedGbp: number;
        shipment?: {
          provisioned: boolean;
          reason?: string;
          trackingNumber?: string | null;
          shippingProvider?: string | null;
          shippingLabelUrl?: string | null;
          shippingQuoteGbp?: number | null;
        };
      }
    | undefined;

  if (nextStatus === 'succeeded' && updatedIntent.channel === 'commerce' && updatedIntent.order_id) {
    const paidOrderResult = await client.query<{
      id: string;
      buyer_id: string;
      seller_id: string;
      listing_id: string;
      address_id: number | null;
      subtotal_gbp: number | string;
      buyer_protection_fee_gbp: number | string;
      postage_fee_gbp: number | string;
      total_gbp: number | string;
      shipping_carrier_id: string | null;
    }>(
      `
        UPDATE orders
        SET status = 'paid', updated_at = NOW()
        WHERE id = $1 AND status = 'created'
        RETURNING
          id,
          buyer_id,
          seller_id,
          listing_id,
          address_id,
          subtotal_gbp,
          buyer_protection_fee_gbp,
          postage_fee_gbp,
          total_gbp
          ,shipping_carrier_id
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
          postageFeeGbp: Number(paidOrder.postage_fee_gbp),
          totalGbp: Number(paidOrder.total_gbp),
        });
      }

      let shipment:
        | {
          provisioned: boolean;
          reason?: string;
          trackingNumber?: string | null;
          shippingProvider?: string | null;
          shippingLabelUrl?: string | null;
          shippingQuoteGbp?: number | null;
        }
        | undefined;

      try {
        const provisionedShipment = await provisionOrderShipmentIfMissing(client, {
          orderId: paidOrder.id,
          buyerId: paidOrder.buyer_id,
          sellerId: paidOrder.seller_id,
          addressId: paidOrder.address_id,
          listingId: paidOrder.listing_id,
          preferredCarrierId: paidOrder.shipping_carrier_id,
          postageFeeGbp: Number(paidOrder.postage_fee_gbp),
        });

        shipment = provisionedShipment.provisioned
          ? {
            provisioned: true,
            trackingNumber: provisionedShipment.trackingNumber,
            shippingProvider: provisionedShipment.shippingProvider,
            shippingLabelUrl: provisionedShipment.shippingLabelUrl,
            shippingQuoteGbp: provisionedShipment.quoteGbp,
          }
          : {
            provisioned: false,
            reason: provisionedShipment.reason,
            trackingNumber: provisionedShipment.trackingNumber,
            shippingProvider: provisionedShipment.shippingProvider,
            shippingLabelUrl: provisionedShipment.shippingLabelUrl,
            shippingQuoteGbp: provisionedShipment.quoteGbp,
          };
      } catch (shipmentError) {
        shipment = {
          provisioned: false,
          reason: 'shipment_provision_failed',
        };
        app.log.error(
          {
            err: shipmentError,
            orderId: paidOrder.id,
          },
          'Failed to provision shipment after payment settlement'
        );
      }

      const platformChargeCreditedGbp = Number(paidOrder.buyer_protection_fee_gbp);
      const postageFeeCreditedGbp = Number(paidOrder.postage_fee_gbp);
      orderSettlement = {
        orderId: paidOrder.id,
        buyerChargedGbp: Number(paidOrder.total_gbp),
        sellerPayableCreditedGbp: 0,
        sellerEscrowHeldGbp: Number(paidOrder.subtotal_gbp),
        sellerCashoutEligible: false,
        platformCommissionCreditedGbp: roundTo(platformChargeCreditedGbp + postageFeeCreditedGbp, 2),
        platformChargeCreditedGbp,
        postageFeeCreditedGbp,
        shipment,
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
        coOwn_order_id,
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
        coOwn_order_id,
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
        coOwn_order_id,
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

  const payoutMetadata = asObject(payoutRequest.metadata);
  const safeguardsMetadata = asObject(payoutMetadata.safeguards);
  const manualReviewRequired =
    payoutMetadata.manualReviewRequired === true
    || safeguardsMetadata.manualReviewRequired === true
    || payoutMetadata.nameMismatch === true;

  const isForwardSettlement = input.targetStatus === 'processing' || input.targetStatus === 'paid';
  const transitionSource = input.source ?? 'manual_status';

  if (isForwardSettlement) {
    if (
      manualReviewRequired
      && transitionSource !== 'admin_review'
      && transitionSource !== 'provider_webhook'
      && transitionSource !== 'mock_webhook'
    ) {
      throw createApiError(
        'PAYOUT_REVIEW_REQUIRED',
        'Payout request requires admin review before processing',
        {
          requestId: input.requestId,
          manualReviewRequired,
        }
      );
    }

    if (transitionSource !== 'provider_webhook' && transitionSource !== 'mock_webhook') {
      const pauseState = await getPayoutPauseState();
      if (pauseState.paused) {
        throw createApiError(
          'PAYOUTS_PAUSED',
          'Payouts are temporarily paused for reconciliation review',
          {
            reason: pauseState.reason,
            reconciliationRunId: pauseState.reconciliationRunId,
            mismatchGbp: pauseState.mismatchGbp,
          }
        );
      }
    }
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

function formatGbpAmount(amountGbp: number): string {
  return `£${roundTo(Math.max(0, amountGbp), 2).toFixed(2)}`;
}

async function queueCommercePaymentNotifications(input: {
  orderId: string;
  source: string;
}): Promise<void> {
  const orderResult = await db.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    shipping_label_url: string | null;
    tracking_number: string | null;
    listing_title: string | null;
  }>(
    `
      SELECT
        o.id,
        o.buyer_id,
        o.seller_id,
        o.shipping_label_url,
        o.tracking_number,
        l.title AS listing_title
      FROM orders o
      LEFT JOIN listings l ON l.id = o.listing_id
      WHERE o.id = $1
      LIMIT 1
    `,
    [input.orderId]
  );

  const order = orderResult.rows[0];
  if (!order) {
    return;
  }

  const listingTitle = order.listing_title?.trim() || 'your order';

  try {
    await queueUserNotification({
      userId: order.buyer_id,
      title: 'Payment confirmed',
      body: `Payment confirmed for ${listingTitle}`,
      payload: {
        event: 'order_payment_succeeded',
        orderId: order.id,
      },
      metadata: {
        source: input.source,
      },
    });
  } catch (error) {
    app.log.error({ err: error, orderId: order.id }, 'Failed to queue buyer payment-confirmed notification');
  }

  try {
    await queueUserNotification({
      userId: order.seller_id,
      title: 'New order',
      body: 'New order! Print the shipping label',
      payload: {
        event: 'order_payment_succeeded_seller',
        orderId: order.id,
        shippingLabelUrl: order.shipping_label_url,
      },
      metadata: {
        source: input.source,
      },
    });
  } catch (error) {
    app.log.error({ err: error, orderId: order.id }, 'Failed to queue seller new-order notification');
  }

  if (order.shipping_label_url || order.tracking_number) {
    try {
      await queueUserNotification({
        userId: order.buyer_id,
        title: 'Shipment created',
        body: 'Your order is on its way!',
        payload: {
          event: 'order_shipment_created',
          orderId: order.id,
          trackingNumber: order.tracking_number,
        },
        metadata: {
          source: input.source,
        },
      });
    } catch (error) {
      app.log.error({ err: error, orderId: order.id }, 'Failed to queue buyer shipment-created notification');
    }
  }
}

async function queueCommerceParcelSettlementNotifications(input: {
  orderId: string;
  buyerId: string;
  sellerId: string;
  orderStatus: string;
  sellerPayableReleasedGbp: number;
  source: string;
  provider: string;
  eventType: string;
}): Promise<void> {
  if (input.orderStatus === 'delivered') {
    try {
      await queueUserNotification({
        userId: input.buyerId,
        title: 'Order delivered',
        body: 'Your order has been delivered',
        payload: {
          event: 'order_delivered',
          orderId: input.orderId,
          provider: input.provider,
          eventType: input.eventType,
        },
        metadata: {
          source: input.source,
        },
      });
    } catch (error) {
      app.log.error({ err: error, orderId: input.orderId }, 'Failed to queue buyer delivered notification');
    }
  }

  if (input.sellerPayableReleasedGbp > 0) {
    try {
      await queueUserNotification({
        userId: input.sellerId,
        title: 'Escrow released',
        body: `${formatGbpAmount(input.sellerPayableReleasedGbp)} released to your balance`,
        payload: {
          event: 'order_escrow_released',
          orderId: input.orderId,
          amountGbp: roundTo(input.sellerPayableReleasedGbp, 2),
          provider: input.provider,
          eventType: input.eventType,
        },
        metadata: {
          source: input.source,
        },
      });
    } catch (error) {
      app.log.error({ err: error, orderId: input.orderId }, 'Failed to queue seller escrow-released notification');
    }
  }
}

async function queuePayoutProcessedNotification(input: {
  payoutRequest: ReturnType<typeof toPayoutRequestPayload>;
  source: string;
}): Promise<void> {
  if (input.payoutRequest.status !== 'paid') {
    return;
  }

  try {
    await queueUserNotification({
      userId: input.payoutRequest.userId,
      title: 'Payout processed',
      body: `${formatGbpAmount(input.payoutRequest.amountGbp)} sent to your bank`,
      payload: {
        event: 'payout_processed',
        payoutRequestId: input.payoutRequest.id,
        amountGbp: input.payoutRequest.amountGbp,
      },
      metadata: {
        source: input.source,
      },
    });
  } catch (error) {
    app.log.error(
      { err: error, payoutRequestId: input.payoutRequest.id },
      'Failed to queue payout-processed notification'
    );
  }
}

async function queueRefundCompletedNotification(input: {
  userId: string;
  amountGbp: number;
  orderId?: string | null;
  source: string;
}): Promise<void> {
  try {
    await queueUserNotification({
      userId: input.userId,
      title: 'Refund completed',
      body: `${formatGbpAmount(input.amountGbp)} refunded`,
      payload: {
        event: 'refund_completed',
        amountGbp: roundTo(input.amountGbp, 2),
        orderId: input.orderId ?? null,
      },
      metadata: {
        source: input.source,
      },
    });
  } catch (error) {
    app.log.error({ err: error, orderId: input.orderId }, 'Failed to queue refund-completed notification');
  }
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

let onezeReconcileTimer: NodeJS.Timeout | null = null;
let onezeDailyAttestationTimer: NodeJS.Timeout | null = null;
let onezeFxSyncTimer: NodeJS.Timeout | null = null;
let onezeAutoAdjustTimer: NodeJS.Timeout | null = null;
let reconciliationSchedulerDelayTimer: NodeJS.Timeout | null = null;
let reconciliationSchedulerIntervalTimer: NodeJS.Timeout | null = null;
let opsAlertingTimer: NodeJS.Timeout | null = null;
let platformRevenueSweepTimer: NodeJS.Timeout | null = null;

type PlatformRevenueSweepReason = 'startup' | 'interval' | 'manual';
type OnezeFxSyncReason = 'startup' | 'interval' | 'manual';
type OnezeAutoAdjustReason = 'startup' | 'interval' | 'manual';
type PlatformRevenueSweepGateway = 'wise' | 'wise_global';

interface PlatformRevenueSweepExternalTransfer {
  attempted: boolean;
  executed: boolean;
  gatewayId: 'wise_global' | null;
  status: 'executed' | 'skipped';
  reason: string | null;
  providerTransferRef: string | null;
  providerQuoteRef: string | null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

function resolvePlatformRevenueSweepGateway(): PlatformRevenueSweepGateway | null {
  const configuredGateway = config.platformRevenueSweepGateway;
  if (!configuredGateway) {
    return null;
  }

  if (configuredGateway === 'wise' || configuredGateway === 'wise_global') {
    return configuredGateway;
  }

  return null;
}

async function executeWisePlatformRevenueSweepTransfer(input: {
  amountGbp: number;
  sourceId: string;
  reason: PlatformRevenueSweepReason;
}): Promise<PlatformRevenueSweepExternalTransfer> {
  if (!config.wiseApiKey) {
    return {
      attempted: false,
      executed: false,
      gatewayId: 'wise_global',
      status: 'skipped',
      reason: 'wise_api_key_missing',
      providerTransferRef: null,
      providerQuoteRef: null,
    };
  }

  const profileId = Number(config.wisePlatformProfileId);
  const recipientAccountId = Number(config.wisePlatformRecipientAccountId);
  if (!Number.isFinite(profileId) || profileId <= 0 || !Number.isFinite(recipientAccountId) || recipientAccountId <= 0) {
    return {
      attempted: false,
      executed: false,
      gatewayId: 'wise_global',
      status: 'skipped',
      reason: 'wise_corporate_recipient_config_missing',
      providerTransferRef: null,
      providerQuoteRef: null,
    };
  }

  const wiseApiBaseUrl = config.wiseApiBaseUrl.replace(/\/$/, '');
  const quoteResponse = await fetch(`${wiseApiBaseUrl}/v3/quotes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.wiseApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      profile: Math.round(profileId),
      sourceCurrency: 'GBP',
      targetCurrency: 'GBP',
      sourceAmount: roundTo(input.amountGbp, 2),
      targetAccount: Math.round(recipientAccountId),
      payOut: 'BANK_TRANSFER',
    }),
  });

  const quotePayload = asObject(await quoteResponse.json().catch(() => ({})));
  if (!quoteResponse.ok) {
    throw createApiError(
      'PLATFORM_SWEEP_EXTERNAL_TRANSFER_FAILED',
      'Unable to create Wise quote for platform revenue sweep transfer',
      {
        provider: 'wise',
        stage: 'quote',
        status: quoteResponse.status,
        payload: quotePayload,
      }
    );
  }

  const quoteId = stringValue(quotePayload.id) ?? stringValue(quotePayload.quoteUuid);
  if (!quoteId) {
    throw createApiError(
      'PLATFORM_SWEEP_EXTERNAL_TRANSFER_FAILED',
      'Wise quote response did not include a quote id',
      {
        provider: 'wise',
        stage: 'quote',
        payload: quotePayload,
      }
    );
  }

  const transferReference = `${config.wisePlatformTransferReferencePrefix}-${input.sourceId}`.slice(0, 35);
  const transferResponse = await fetch(`${wiseApiBaseUrl}/v1/transfers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.wiseApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      targetAccount: Math.round(recipientAccountId),
      quoteUuid: quoteId,
      customerTransactionId: input.sourceId,
      details: {
        reference: transferReference,
      },
    }),
  });

  const transferPayload = asObject(await transferResponse.json().catch(() => ({})));
  if (!transferResponse.ok) {
    throw createApiError(
      'PLATFORM_SWEEP_EXTERNAL_TRANSFER_FAILED',
      'Unable to create Wise transfer for platform revenue sweep',
      {
        provider: 'wise',
        stage: 'transfer',
        status: transferResponse.status,
        payload: transferPayload,
      }
    );
  }

  const providerTransferRef =
    stringValue(transferPayload.id)
    ?? stringValue(transferPayload.transferId)
    ?? stringValue(asObject(transferPayload.data).id);

  if (!providerTransferRef) {
    throw createApiError(
      'PLATFORM_SWEEP_EXTERNAL_TRANSFER_FAILED',
      'Wise transfer response did not include a transfer reference',
      {
        provider: 'wise',
        stage: 'transfer',
        payload: transferPayload,
      }
    );
  }

  return {
    attempted: true,
    executed: true,
    gatewayId: 'wise_global',
    status: 'executed',
    reason: null,
    providerTransferRef,
    providerQuoteRef: quoteId,
  };
}

async function listActiveOnezePricingCurrencies(client: DbQueryable): Promise<string[]> {
  const result = await client.query<{ currency: string }>(
    `
      SELECT DISTINCT currency
      FROM oneze_country_pricing_profiles
      WHERE is_active = TRUE
      ORDER BY currency ASC
    `
  );

  return result.rows
    .map((row) => row.currency.trim().toUpperCase())
    .filter((currency) => currency.length === 3);
}

async function fetchOnezeFxProviderRates(
  baseCurrency: string,
  quoteCurrencies: string[]
): Promise<Record<string, number>> {
  if (quoteCurrencies.length === 0) {
    return {};
  }

  const url = new URL(config.onezeFxProviderUrl);
  url.searchParams.set('base', baseCurrency);
  url.searchParams.set('symbols', quoteCurrencies.join(','));

  const headers: Record<string, string> = {
    accept: 'application/json',
  };

  if (config.onezeFxProviderApiKey) {
    headers.authorization = `Bearer ${config.onezeFxProviderApiKey}`;
    headers['x-api-key'] = config.onezeFxProviderApiKey;
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(`FX provider responded ${response.status}`);
  }

  const payload = asObject(await response.json());
  const rates = asObject(payload.rates);
  const mapped: Record<string, number> = {};

  for (const quoteCurrency of quoteCurrencies) {
    const rate = asFiniteNumber(rates[quoteCurrency]);
    if (rate === null || rate <= 0) {
      continue;
    }

    mapped[quoteCurrency] = rate;
  }

  if (Object.keys(mapped).length === 0) {
    throw new Error('FX provider returned no valid rates for active pricing currencies');
  }

  return mapped;
}

async function syncOnezeInternalFxRatesFromProvider(
  reason: OnezeFxSyncReason
): Promise<{
  baseCurrency: string;
  quotedCurrencies: number;
  updatedPairs: number;
  fetchedAt: string;
}> {
  if (!(await onezePricingTablesAvailable(db))) {
    throw new Error('1ze controlled pricing tables are unavailable. Run migrations first.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const configuredBaseCurrency = config.onezeFxProviderBaseCurrency.trim().toUpperCase();
    const baseCurrency = configuredBaseCurrency.length === 3 ? configuredBaseCurrency : 'INR';

    const activeCurrencies = await listActiveOnezePricingCurrencies(client);
    const quoteCurrencies = Array.from(
      new Set(
        activeCurrencies
          .map((currency) => currency.trim().toUpperCase())
          .filter((currency) => currency !== baseCurrency)
      )
    );

    if (quoteCurrencies.length === 0) {
      await client.query('COMMIT');
      return {
        baseCurrency,
        quotedCurrencies: 0,
        updatedPairs: 0,
        fetchedAt: new Date().toISOString(),
      };
    }

    const rates = await fetchOnezeFxProviderRates(baseCurrency, quoteCurrencies);
    let updatedPairs = 0;

    for (const quoteCurrency of quoteCurrencies) {
      const directRate = rates[quoteCurrency];
      if (!Number.isFinite(directRate) || directRate <= 0) {
        continue;
      }

      const inverseRate = Number((1 / directRate).toFixed(8));

      await setInternalFxRate(client, {
        baseCurrency,
        quoteCurrency,
        rate: directRate,
        source: 'external_fx_provider',
        metadata: {
          reason,
          providerUrl: config.onezeFxProviderUrl,
        },
      });

      await setInternalFxRate(client, {
        baseCurrency: quoteCurrency,
        quoteCurrency: baseCurrency,
        rate: inverseRate,
        source: 'external_fx_provider_inverse',
        metadata: {
          reason,
          providerUrl: config.onezeFxProviderUrl,
        },
      });

      updatedPairs += 2;
    }

    await client.query('COMMIT');

    return {
      baseCurrency,
      quotedCurrencies: quoteCurrencies.length,
      updatedPairs,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

type OnezeAutoAdjustDirection = 'tighten' | 'relax';

function applyAutoAdjustStep(
  current: number,
  direction: OnezeAutoAdjustDirection,
  stepBps: number,
  bounds: { min: number; max: number }
): number {
  const shifted = direction === 'tighten' ? current + stepBps : current - stepBps;
  return clampNumber(shifted, bounds.min, bounds.max);
}

function resolveAutoAdjustDirection(input: {
  metrics: OnezeRiskDashboardMetrics;
  violationCount: number;
}): { direction: OnezeAutoAdjustDirection | null; triggers: string[] } {
  const triggers: string[] = [];
  const highStress = input.metrics.liquidity.stressSignal >= config.onezeAutoAdjustHighStressThreshold;
  const lowStress = input.metrics.liquidity.stressSignal <= config.onezeAutoAdjustLowStressThreshold;
  const redemptionRate = input.metrics.redemption.redemptionRate;
  const highRedemption =
    redemptionRate !== null && redemptionRate >= config.onezeAutoAdjustHighRedemptionRate;
  const lowRedemption =
    redemptionRate === null
      ? input.metrics.redemption.burnedIze === 0
      : redemptionRate <= config.onezeAutoAdjustLowRedemptionRate;

  if (input.violationCount > 0) {
    triggers.push('arbitrage_violation');
  }

  if (!input.metrics.reservePolicy.withinPolicy) {
    triggers.push('reserve_policy_violation');
  }

  if (highStress) {
    triggers.push('liquidity_stress_high');
  }

  if (highRedemption) {
    triggers.push('redemption_rate_high');
  }

  if (triggers.length > 0) {
    return {
      direction: 'tighten',
      triggers,
    };
  }

  if (lowStress && lowRedemption && input.violationCount === 0) {
    return {
      direction: 'relax',
      triggers: ['liquidity_stress_low', 'redemption_rate_low'],
    };
  }

  return {
    direction: null,
    triggers: ['no_trigger'],
  };
}

async function runOnezeAutomaticSpreadAdjustment(
  reason: OnezeAutoAdjustReason,
  options?: { ignoreEnabled?: boolean }
): Promise<{
  executed: boolean;
  mode: 'tighten' | 'relax' | 'hold' | 'disabled';
  reason: OnezeAutoAdjustReason;
  triggerSignals: string[];
  lookbackHours: number;
  stepBps: number;
  matrixSizeBefore: number;
  matrixSizeAfter: number;
  violationCountBefore: number;
  violationCountAfter: number;
  adjustments: Array<{
    country: string;
    before: {
      markupBps: number;
      markdownBps: number;
      crossBorderFeeBps: number;
    };
    after: {
      markupBps: number;
      markdownBps: number;
      crossBorderFeeBps: number;
    };
  }>;
  evaluatedAt: string;
}> {
  if (!config.onezeAutoAdjustEnabled && !options?.ignoreEnabled) {
    return {
      executed: false,
      mode: 'disabled',
      reason,
      triggerSignals: ['auto_adjust_disabled'],
      lookbackHours: clampNumber(Math.round(config.onezeAutoAdjustLookbackHours), 1, 24 * 30),
      stepBps: clampNumber(toSafeInteger(config.onezeAutoAdjustStepBps), 1, 500),
      matrixSizeBefore: 0,
      matrixSizeAfter: 0,
      violationCountBefore: 0,
      violationCountAfter: 0,
      adjustments: [],
      evaluatedAt: new Date().toISOString(),
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    throw new Error('1ze controlled pricing tables are unavailable. Run migrations first.');
  }

  const safeLookbackHours = clampNumber(Math.round(config.onezeAutoAdjustLookbackHours), 1, 24 * 30);
  const stepBps = clampNumber(toSafeInteger(config.onezeAutoAdjustStepBps), 1, 500);
  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const metrics = await collectOnezeRiskDashboardMetrics(client, safeLookbackHours);
    const quotesBefore = await listCountryPricingQuotes(client);
    const violationsBefore = findPricingArbitrageViolations(quotesBefore);
    const decision = resolveAutoAdjustDirection({
      metrics,
      violationCount: violationsBefore.length,
    });

    if (!decision.direction) {
      await client.query('COMMIT');
      return {
        executed: false,
        mode: 'hold',
        reason,
        triggerSignals: decision.triggers,
        lookbackHours: safeLookbackHours,
        stepBps,
        matrixSizeBefore: quotesBefore.length,
        matrixSizeAfter: quotesBefore.length,
        violationCountBefore: violationsBefore.length,
        violationCountAfter: violationsBefore.length,
        adjustments: [],
        evaluatedAt: metrics.evaluatedAt,
      };
    }

    const adjustments: Array<{
      country: string;
      before: {
        markupBps: number;
        markdownBps: number;
        crossBorderFeeBps: number;
      };
      after: {
        markupBps: number;
        markdownBps: number;
        crossBorderFeeBps: number;
      };
    }> = [];

    for (const quote of quotesBefore) {
      const profile = await getCountryPricingProfile(client, quote.countryCode);
      if (!profile || !profile.isActive) {
        continue;
      }

      const nextMarkupBps = applyAutoAdjustStep(
        profile.markupBps,
        decision.direction,
        stepBps,
        PRICING_PARAMETER_BOUNDS.markupBps
      );
      const nextMarkdownBps = applyAutoAdjustStep(
        profile.markdownBps,
        decision.direction,
        stepBps,
        PRICING_PARAMETER_BOUNDS.markdownBps
      );
      const nextCrossBorderFeeBps = applyAutoAdjustStep(
        profile.crossBorderFeeBps,
        decision.direction,
        stepBps,
        PRICING_PARAMETER_BOUNDS.crossBorderFeeBps
      );

      if (
        nextMarkupBps === profile.markupBps
        && nextMarkdownBps === profile.markdownBps
        && nextCrossBorderFeeBps === profile.crossBorderFeeBps
      ) {
        continue;
      }

      validatePricingProfileInput({
        markupBps: nextMarkupBps,
        markdownBps: nextMarkdownBps,
        crossBorderFeeBps: nextCrossBorderFeeBps,
        pppFactor: profile.pppFactor,
      });

      await upsertCountryPricingProfile(client, {
        countryCode: profile.countryCode,
        currency: profile.currency,
        markupBps: nextMarkupBps,
        markdownBps: nextMarkdownBps,
        crossBorderFeeBps: nextCrossBorderFeeBps,
        pppFactor: profile.pppFactor,
        withdrawalLockHours: profile.withdrawalLockHours,
        dailyRedeemLimitIze: profile.dailyRedeemLimitIze,
        weeklyRedeemLimitIze: profile.weeklyRedeemLimitIze,
        isActive: profile.isActive,
        metadata: {
          autoAdjust: {
            reason,
            direction: decision.direction,
            stepBps,
            triggerSignals: decision.triggers,
            evaluatedAt: metrics.evaluatedAt,
          },
        },
      });

      adjustments.push({
        country: profile.countryCode,
        before: {
          markupBps: profile.markupBps,
          markdownBps: profile.markdownBps,
          crossBorderFeeBps: profile.crossBorderFeeBps,
        },
        after: {
          markupBps: nextMarkupBps,
          markdownBps: nextMarkdownBps,
          crossBorderFeeBps: nextCrossBorderFeeBps,
        },
      });
    }

    const quotesAfter = await listCountryPricingQuotes(client);
    const violationsAfter = findPricingArbitrageViolations(quotesAfter);
    if (violationsAfter.length > 0) {
      throw createApiError(
        'PRICING_ARBITRAGE_VIOLATION',
        'Automatic spread adjustment introduces guaranteed arbitrage',
        {
          reason,
          triggers: decision.triggers,
          violations: violationsAfter.slice(0, 10),
        }
      );
    }

    await client.query('COMMIT');

    return {
      executed: adjustments.length > 0,
      mode: decision.direction,
      reason,
      triggerSignals: decision.triggers,
      lookbackHours: safeLookbackHours,
      stepBps,
      matrixSizeBefore: quotesBefore.length,
      matrixSizeAfter: quotesAfter.length,
      violationCountBefore: violationsBefore.length,
      violationCountAfter: violationsAfter.length,
      adjustments,
      evaluatedAt: metrics.evaluatedAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function processMintOperationPaymentWebhook(
  client: DbQueryable,
  input: {
    paymentIntentId: string;
    paymentStatus: ProviderPaymentStatus;
    provider: string;
    eventType: string;
    providerEventId: string;
  }
): Promise<{
  mintOperation: ReturnType<typeof toMintOperationPayload> | null;
  enqueueReserveAllocation: boolean;
}> {
  const operation = await loadMintOperationByPaymentIntentId(client, input.paymentIntentId, {
    forUpdate: true,
  });

  if (!operation) {
    return {
      mintOperation: null,
      enqueueReserveAllocation: false,
    };
  }

  const metadataPatch = {
    paymentWebhook: {
      provider: input.provider,
      eventType: input.eventType,
      providerEventId: input.providerEventId,
      paymentStatus: input.paymentStatus,
      processedAt: new Date().toISOString(),
    },
  };

  if (input.paymentStatus === 'succeeded') {
    if (operation.state === 'PAYMENT_CONFIRMED') {
      return {
        mintOperation: toMintOperationPayload(operation),
        enqueueReserveAllocation: true,
      };
    }

    if (
      operation.state === 'RESERVE_PURCHASING'
      || operation.state === 'RESERVE_ALLOCATED'
      || operation.state === 'WALLET_CREDITED'
      || operation.state === 'SETTLED'
    ) {
      return {
        mintOperation: toMintOperationPayload(operation),
        enqueueReserveAllocation: false,
      };
    }

    if (!canTransitionMintOperationState(operation.state, 'PAYMENT_CONFIRMED')) {
      return {
        mintOperation: toMintOperationPayload(operation),
        enqueueReserveAllocation: false,
      };
    }

    const expiryAtMs = Date.parse(operation.rate_expires_at);
    const maxAcceptedMs = Number.isFinite(expiryAtMs)
      ? expiryAtMs + config.onezeMintPaymentGraceSeconds * 1_000
      : Number.POSITIVE_INFINITY;

    if (Date.now() > maxAcceptedMs) {
      const refundedResult = await client.query<MintOperationRow>(
        `
          UPDATE mint_operations
          SET
            state = 'PAYMENT_REFUNDED',
            last_error = 'mint_quote_expired_before_payment_confirmation',
            metadata = metadata || $2::jsonb,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            user_id,
            state,
            fiat_amount_minor::text,
            fiat_currency,
            net_fiat_amount_minor::text,
            platform_fee_minor::text,
            ize_amount_mg::text,
            rate_per_gram::text,
            rate_source,
            rate_locked_at::text,
            rate_expires_at::text,
            payment_intent_id,
            lot_id,
            custodian_ref,
            escrow_ledger_tx_id,
            wallet_credit_tx_id,
            purchase_attempted_at::text,
            settled_at::text,
            last_error,
            metadata,
            created_at::text,
            updated_at::text
        `,
        [
          operation.id,
          toJsonString({
            ...metadataPatch,
            paymentRefundReason: 'rate_lock_expired',
          }),
        ]
      );

      return {
        mintOperation: toMintOperationPayload(refundedResult.rows[0]),
        enqueueReserveAllocation: false,
      };
    }

    const confirmedResult = await client.query<MintOperationRow>(
      `
        UPDATE mint_operations
        SET
          state = 'PAYMENT_CONFIRMED',
          metadata = metadata || $2::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          user_id,
          state,
          fiat_amount_minor::text,
          fiat_currency,
          net_fiat_amount_minor::text,
          platform_fee_minor::text,
          ize_amount_mg::text,
          rate_per_gram::text,
          rate_source,
          rate_locked_at::text,
          rate_expires_at::text,
          payment_intent_id,
          lot_id,
          custodian_ref,
          escrow_ledger_tx_id,
          wallet_credit_tx_id,
          purchase_attempted_at::text,
          settled_at::text,
          last_error,
          metadata,
          created_at::text,
          updated_at::text
      `,
      [operation.id, toJsonString(metadataPatch)]
    );

    return {
      mintOperation: toMintOperationPayload(confirmedResult.rows[0]),
      enqueueReserveAllocation: true,
    };
  }

  if (input.paymentStatus === 'failed' || input.paymentStatus === 'cancelled') {
    if (MINT_OPERATION_TERMINAL_STATES.has(operation.state)) {
      return {
        mintOperation: toMintOperationPayload(operation),
        enqueueReserveAllocation: false,
      };
    }

    if (!canTransitionMintOperationState(operation.state, 'PAYMENT_FAILED')) {
      return {
        mintOperation: toMintOperationPayload(operation),
        enqueueReserveAllocation: false,
      };
    }

    const failedResult = await client.query<MintOperationRow>(
      `
        UPDATE mint_operations
        SET
          state = 'PAYMENT_FAILED',
          last_error = $2,
          metadata = metadata || $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          user_id,
          state,
          fiat_amount_minor::text,
          fiat_currency,
          net_fiat_amount_minor::text,
          platform_fee_minor::text,
          ize_amount_mg::text,
          rate_per_gram::text,
          rate_source,
          rate_locked_at::text,
          rate_expires_at::text,
          payment_intent_id,
          lot_id,
          custodian_ref,
          escrow_ledger_tx_id,
          wallet_credit_tx_id,
          purchase_attempted_at::text,
          settled_at::text,
          last_error,
          metadata,
          created_at::text,
          updated_at::text
      `,
      [operation.id, `payment_${input.paymentStatus}`, toJsonString(metadataPatch)]
    );

    return {
      mintOperation: toMintOperationPayload(failedResult.rows[0]),
      enqueueReserveAllocation: false,
    };
  }

  return {
    mintOperation: toMintOperationPayload(operation),
    enqueueReserveAllocation: false,
  };
}

async function processQueuedOnezeMintReserveAllocation(input: {
  mintOperationId: string;
  initiatedBy: string;
  reason: 'webhook_confirmed' | 'manual_retry';
}): Promise<void> {
  if (!(await onezeMintFlowTablesAvailable(db))) {
    app.log.warn(
      {
        mintOperationId: input.mintOperationId,
      },
      'Skipped queued 1ze mint allocation because mint flow tables are unavailable'
    );
    return;
  }

  if (!(await onezePricingTablesAvailable(db))) {
    app.log.warn(
      {
        mintOperationId: input.mintOperationId,
      },
      'Skipped queued 1ze mint allocation because controlled pricing tables are unavailable'
    );
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const operation = await loadMintOperationById(client, input.mintOperationId, {
      forUpdate: true,
    });

    if (!operation) {
      throw createApiError('MINT_OPERATION_NOT_FOUND', 'Mint operation not found', {
        mintOperationId: input.mintOperationId,
      });
    }

    if (MINT_OPERATION_TERMINAL_STATES.has(operation.state) && operation.state !== 'WALLET_CREDITED') {
      await client.query('COMMIT');
      return;
    }

    if (
      operation.state !== 'PAYMENT_CONFIRMED'
      && operation.state !== 'RESERVE_PURCHASING'
      && operation.state !== 'RESERVE_ALLOCATED'
      && operation.state !== 'WALLET_CREDITED'
      && operation.state !== 'SETTLED'
    ) {
      throw createApiError('MINT_OPERATION_STATE_INVALID', 'Mint operation is not ready for allocation', {
        mintOperationId: input.mintOperationId,
        state: operation.state,
      });
    }

    let mutableOperation = operation;

    if (mutableOperation.state === 'PAYMENT_CONFIRMED') {
      const purchasingResult = await client.query<MintOperationRow>(
        `
          UPDATE mint_operations
          SET
            state = 'RESERVE_PURCHASING',
            purchase_attempted_at = NOW(),
            metadata = metadata || $2::jsonb,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            user_id,
            state,
            fiat_amount_minor::text,
            fiat_currency,
            net_fiat_amount_minor::text,
            platform_fee_minor::text,
            ize_amount_mg::text,
            rate_per_gram::text,
            rate_source,
            rate_locked_at::text,
            rate_expires_at::text,
            payment_intent_id,
            lot_id,
            custodian_ref,
            escrow_ledger_tx_id,
            wallet_credit_tx_id,
            purchase_attempted_at::text,
            settled_at::text,
            last_error,
            metadata,
            created_at::text,
            updated_at::text
        `,
        [
          mutableOperation.id,
          toJsonString({
            reserveWorker: {
              initiatedBy: input.initiatedBy,
              reason: input.reason,
              startedAt: new Date().toISOString(),
            },
          }),
        ]
      );

      mutableOperation = purchasingResult.rows[0];
    }

    if (mutableOperation.state === 'PAYMENT_CONFIRMED' || mutableOperation.state === 'RESERVE_PURCHASING') {
      const allocationTxId = mutableOperation.escrow_ledger_tx_id ?? createRuntimeId('mintalloc');

      const allocatedResult = await client.query<MintOperationRow>(
        `
          UPDATE mint_operations
          SET
            state = 'RESERVE_ALLOCATED',
            escrow_ledger_tx_id = COALESCE(escrow_ledger_tx_id, $2),
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            user_id,
            state,
            fiat_amount_minor::text,
            fiat_currency,
            net_fiat_amount_minor::text,
            platform_fee_minor::text,
            ize_amount_mg::text,
            rate_per_gram::text,
            rate_source,
            rate_locked_at::text,
            rate_expires_at::text,
            payment_intent_id,
            lot_id,
            custodian_ref,
            escrow_ledger_tx_id,
            wallet_credit_tx_id,
            purchase_attempted_at::text,
            settled_at::text,
            last_error,
            metadata,
            created_at::text,
            updated_at::text
        `,
        [
          mutableOperation.id,
          allocationTxId,
          toJsonString({
            allocationMode: 'closed_loop_no_custody',
            allocationRecordedAt: new Date().toISOString(),
            allocationTxId,
          }),
        ]
      );

      mutableOperation = allocatedResult.rows[0];
    }

    if (!mutableOperation.wallet_credit_tx_id) {
      const wallet = await ensureWallet(client, mutableOperation.user_id, mutableOperation.fiat_currency);
      const walletCreditTxId = createRuntimeId('mintcred');
      const amountMg = Number(mutableOperation.ize_amount_mg);
      const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, mutableOperation.fiat_currency);

      await applyWalletLedgerDelta(client, {
        walletId: wallet.id,
        txId: walletCreditTxId,
        asset: '1ZE',
        amount: amountMg,
        kind: 'MINT',
        refType: 'mint_operation',
        refId: mutableOperation.id,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          mintOperationId: mutableOperation.id,
          paymentIntentId: mutableOperation.payment_intent_id,
          allocationMode: 'closed_loop_no_custody',
          initiatedBy: input.initiatedBy,
          pricingSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        },
      });

      await creditWalletSegmentBalance(client, {
        wallet,
        txId: walletCreditTxId,
        purchasedCreditMg: amountMg,
        originCountry: normalizeOnezeCountryTag(
          typeof mutableOperation.metadata?.originCountry === 'string'
            ? mutableOperation.metadata.originCountry
            : null
        ),
        metadata: {
          mintOperationId: mutableOperation.id,
          source: 'mint_queue_credit',
        },
      });

      const creditedResult = await client.query<MintOperationRow>(
        `
          UPDATE mint_operations
          SET
            state = 'WALLET_CREDITED',
            wallet_credit_tx_id = $2,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            user_id,
            state,
            fiat_amount_minor::text,
            fiat_currency,
            net_fiat_amount_minor::text,
            platform_fee_minor::text,
            ize_amount_mg::text,
            rate_per_gram::text,
            rate_source,
            rate_locked_at::text,
            rate_expires_at::text,
            payment_intent_id,
            lot_id,
            custodian_ref,
            escrow_ledger_tx_id,
            wallet_credit_tx_id,
            purchase_attempted_at::text,
            settled_at::text,
            last_error,
            metadata,
            created_at::text,
            updated_at::text
        `,
        [
          mutableOperation.id,
          walletCreditTxId,
          toJsonString({
            walletCreditedAt: new Date().toISOString(),
            walletCreditTxId,
          }),
        ]
      );

      mutableOperation = creditedResult.rows[0];
    }

    if (mutableOperation.state !== 'SETTLED') {
      await client.query(
        `
          UPDATE mint_operations
          SET
            state = 'SETTLED',
            settled_at = NOW(),
            metadata = metadata || $2::jsonb,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          mutableOperation.id,
          toJsonString({
            settledAt: new Date().toISOString(),
            settlementMode: 'closed_loop_credit_issue',
          }),
        ]
      );
    }

    await client.query('COMMIT');

    app.log.info(
      {
        mintOperationId: input.mintOperationId,
        initiatedBy: input.initiatedBy,
        reason: input.reason,
      },
      'Processed queued 1ze mint allocation'
    );
  } catch (error) {
    await client.query('ROLLBACK');
    app.log.error(
      {
        err: error,
        mintOperationId: input.mintOperationId,
        reason: input.reason,
      },
      'Failed queued 1ze mint allocation'
    );
    throw error;
  } finally {
    client.release();
  }
}

async function processQueuedOnezeWithdrawalExecution(input: {
  withdrawalId: string;
  initiatedBy: string;
  reason: 'threshold_queue' | 'manual_queue';
}): Promise<void> {
  if (!(await onezeArchitectureTablesAvailable(db))) {
    app.log.warn(
      {
        withdrawalId: input.withdrawalId,
      },
      'Skipped queued 1ze withdrawal execution because architecture tables are unavailable'
    );
    return;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const execution = await executeReservedWithdrawal(client, {
      withdrawalId: input.withdrawalId,
      metadata: {
        source: 'queue_worker',
        initiatedBy: input.initiatedBy,
        queueReason: input.reason,
      },
    });

    await client.query('COMMIT');

    app.log.info(
      {
        withdrawalId: input.withdrawalId,
        alreadySettled: execution.alreadySettled,
        queueReason: input.reason,
      },
      'Processed queued 1ze withdrawal execution'
    );
  } catch (error) {
    await client.query('ROLLBACK');
    app.log.error(
      {
        err: error,
        withdrawalId: input.withdrawalId,
        queueReason: input.reason,
      },
      'Failed queued 1ze withdrawal execution'
    );
    throw error;
  } finally {
    client.release();
  }
}

async function runOnezeReconciliation(reason: 'startup' | 'interval' | 'manual'): Promise<{
  id: string;
  circulatingMg: number;
  reserveActiveMg: number;
  withinInvariant: boolean;
  withinSupplyInvariant: boolean;
  withinReservePolicy: boolean;
  invariantHash: string;
  supplyDeltaMg: number;
  toleranceMg: number;
  operationalLiquidityMg: number;
  configuredOperationalReserveMg: number;
  reservedWithdrawalMg: number;
  configuredReserveRatio: number | null;
  effectiveReserveRatio: number | null;
  createdAt: string;
} | null> {
  if (!(await onezeArchitectureTablesAvailable(db))) {
    return null;
  }

  const snapshot = await captureOnezeReconciliationSnapshot(db, reason, {
    reason,
  });

  if (!snapshot.withinInvariant) {
    const haltReason = snapshot.withinSupplyInvariant
      ? 'reconciliation_reserve_policy_violation'
      : 'reconciliation_supply_mismatch';

    await setOnezeMintBurnHaltState({
      halted: true,
      reason: haltReason,
      reconciliationId: snapshot.id,
    });

    if (await onezeMintFlowTablesAvailable(db)) {
      await db.query(
        `
          UPDATE mint_operations
          SET
            state = 'RECONCILIATION_HOLD',
            last_error = $2,
            metadata = metadata || $1::jsonb,
            updated_at = NOW()
          WHERE state IN ('PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'RESERVE_PURCHASING', 'RESERVE_ALLOCATED')
        `,
        [
          toJsonString({
            reconciliationHoldAt: new Date().toISOString(),
            reconciliationId: snapshot.id,
            reason,
            haltReason,
          }),
          haltReason,
        ]
      );
    }

    app.log.error(
      {
        reconciliationId: snapshot.id,
        circulatingMg: snapshot.circulatingMg,
        referenceSupplyMg: snapshot.reserveActiveMg,
        supplyDeltaMg: snapshot.supplyDeltaMg,
        toleranceMg: snapshot.toleranceMg,
        operationalLiquidityMg: snapshot.operationalLiquidityMg,
        configuredOperationalReserveMg: snapshot.configuredOperationalReserveMg,
        reservedWithdrawalMg: snapshot.reservedWithdrawalMg,
        effectiveReserveRatio: snapshot.effectiveReserveRatio,
        reservePolicyViolation: !snapshot.withinReservePolicy,
        haltReason,
      },
      '1ze reconciliation detected an invariant policy violation'
    );
  } else {
    await setOnezeMintBurnHaltState({
      halted: false,
      reason: 'reconciliation_supply_restored',
      reconciliationId: snapshot.id,
    });
  }

  return snapshot;
}

async function runOnezeDailyAttestation(reason: 'startup' | 'interval' | 'manual'): Promise<{
  snapshotId: string;
  objectKey: string;
  publicUrl: string;
  signature: string;
  withinInvariant: boolean;
  createdAt: string;
} | null> {
  if (!(await onezeArchitectureTablesAvailable(db))) {
    return null;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const snapshot = await captureOnezeReconciliationSnapshot(client, `daily_attestation_${reason}`, {
      reason,
      exporter: 'api_service',
    });

    const generatedAt = new Date().toISOString();
    const [year, month, day] = generatedAt.slice(0, 10).split('-');
    const objectKey = `attestations/oneze/${year}/${month}/${day}/snapshot_${snapshot.id}.json`;

    const payload = {
      schemaVersion: 1,
      service: 'thryftverse-api',
      generatedAt,
      reason,
      reconciliation: {
        id: snapshot.id,
        circulatingMg: snapshot.circulatingMg,
        referenceSupplyMg: snapshot.reserveActiveMg,
        reserveActiveMg: snapshot.reserveActiveMg,
        supplyDeltaMg: snapshot.supplyDeltaMg,
        toleranceMg: snapshot.toleranceMg,
        operationalLiquidityMg: snapshot.operationalLiquidityMg,
        configuredOperationalReserveMg: snapshot.configuredOperationalReserveMg,
        reservedWithdrawalMg: snapshot.reservedWithdrawalMg,
        configuredReserveRatio: snapshot.configuredReserveRatio,
        effectiveReserveRatio: snapshot.effectiveReserveRatio,
        withinReservePolicy: snapshot.withinReservePolicy,
        withinSupplyTolerance: snapshot.withinSupplyInvariant,
        withinSupplyInvariant: snapshot.withinSupplyInvariant,
        withinInvariant: snapshot.withinInvariant,
        invariantHash: snapshot.invariantHash,
        createdAt: snapshot.createdAt,
      },
    };

    const signature = crypto
      .createHmac('sha256', config.onezeAttestationSigningSecret)
      .update(toJsonString(payload))
      .digest('hex');

    const uploaded = await putJsonObject(
      objectKey,
      {
        ...payload,
        signature: {
          algorithm: 'hmac-sha256',
          value: signature,
        },
      },
      {
        metadata: {
          snapshotid: snapshot.id,
          invarianthash: snapshot.invariantHash,
          signature,
        },
      }
    );

    await client.query(
      `
        UPDATE oneze_reconciliation_snapshots
        SET metadata = metadata || $2::jsonb
        WHERE id = $1
      `,
      [
        snapshot.id,
        toJsonString({
          attestationObjectKey: uploaded.key,
          attestationPublicUrl: uploaded.publicUrl,
          attestationSignature: signature,
          attestedAt: generatedAt,
          attestationReason: reason,
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      snapshotId: snapshot.id,
      objectKey: uploaded.key,
      publicUrl: uploaded.publicUrl,
      signature,
      withinInvariant: snapshot.withinInvariant,
      createdAt: snapshot.createdAt,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startOnezeReconciliationScheduler(): void {
  if (onezeReconcileTimer) {
    return;
  }

  void runOnezeReconciliation('startup').catch((error) => {
    app.log.error({ err: error }, 'Failed startup 1ze reconciliation');
  });

  onezeReconcileTimer = setInterval(() => {
    void runOnezeReconciliation('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval 1ze reconciliation');
    });
  }, config.onezeReconcileIntervalMs);

  onezeReconcileTimer.unref?.();
}

function stopOnezeReconciliationScheduler(): void {
  if (!onezeReconcileTimer) {
    return;
  }

  clearInterval(onezeReconcileTimer);
  onezeReconcileTimer = null;
}

function startOnezeDailyAttestationScheduler(): void {
  if (onezeDailyAttestationTimer) {
    return;
  }

  void runOnezeDailyAttestation('startup').catch((error) => {
    app.log.error({ err: error }, 'Failed startup 1ze daily attestation export');
  });

  onezeDailyAttestationTimer = setInterval(() => {
    void runOnezeDailyAttestation('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval 1ze daily attestation export');
    });
  }, config.onezeDailyAttestationIntervalMs);

  onezeDailyAttestationTimer.unref?.();
}

function stopOnezeDailyAttestationScheduler(): void {
  if (!onezeDailyAttestationTimer) {
    return;
  }

  clearInterval(onezeDailyAttestationTimer);
  onezeDailyAttestationTimer = null;
}

function startOnezeFxSyncScheduler(): void {
  if (onezeFxSyncTimer || !config.onezeFxSyncEnabled) {
    return;
  }

  void syncOnezeInternalFxRatesFromProvider('startup').catch((error) => {
    app.log.error({ err: error }, 'Failed startup 1ze FX sync');
  });

  onezeFxSyncTimer = setInterval(() => {
    void syncOnezeInternalFxRatesFromProvider('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval 1ze FX sync');
    });
  }, config.onezeFxSyncIntervalMs);

  onezeFxSyncTimer.unref?.();
}

function stopOnezeFxSyncScheduler(): void {
  if (!onezeFxSyncTimer) {
    return;
  }

  clearInterval(onezeFxSyncTimer);
  onezeFxSyncTimer = null;
}

function startOnezeAutoAdjustScheduler(): void {
  if (onezeAutoAdjustTimer || !config.onezeAutoAdjustEnabled) {
    return;
  }

  void runOnezeAutomaticSpreadAdjustment('startup').catch((error) => {
    app.log.error({ err: error }, 'Failed startup 1ze automatic spread adjustment');
  });

  onezeAutoAdjustTimer = setInterval(() => {
    void runOnezeAutomaticSpreadAdjustment('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval 1ze automatic spread adjustment');
    });
  }, config.onezeAutoAdjustIntervalMs);

  onezeAutoAdjustTimer.unref?.();
}

function stopOnezeAutoAdjustScheduler(): void {
  if (!onezeAutoAdjustTimer) {
    return;
  }

  clearInterval(onezeAutoAdjustTimer);
  onezeAutoAdjustTimer = null;
}

function millisecondsUntilNextUtcHour(targetHourUtc: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(targetHourUtc, 0, 0, 0);

  if (next.getTime() <= now.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return Math.max(1_000, next.getTime() - now.getTime());
}

async function listAdminAlertRecipients(): Promise<string[]> {
  const configuredIds = config.alertingAdminUserIds
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  try {
    const result = await db.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE role = 'admin'
        ORDER BY created_at ASC
        LIMIT 200
      `
    );

    const roleIds = result.rows.map((row) => row.id).filter((entry) => entry.trim().length > 0);
    const uniqueIds = new Set<string>([...configuredIds, ...roleIds]);
    return Array.from(uniqueIds);
  } catch {
    return configuredIds;
  }
}

async function dispatchOpsAlert(alert: OpsAlert): Promise<void> {
  const dedupeBucket = Math.floor(Date.now() / (5 * 60 * 1000));
  const dedupeKey = `${ALERT_DEDUP_REDIS_PREFIX}${alert.code}:${dedupeBucket}`;
  const shouldSend = await redis.set(dedupeKey, '1', 'EX', 5 * 60, 'NX');

  if (!shouldSend) {
    return;
  }

  if (alert.severity === 'critical' && config.sentryDsn) {
    Sentry.captureMessage(`Operational alert: ${alert.message}`, {
      level: 'error',
      tags: {
        alert_code: alert.code,
      },
      extra: {
        metricValue: alert.metricValue,
        threshold: alert.threshold,
        metadata: alert.metadata,
      },
    });
  }

  if (config.alertingWebhookUrls.length > 0) {
    await Promise.all(
      config.alertingWebhookUrls.map(async (webhookUrl) => {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: toJsonString({
              text: `[${alert.severity.toUpperCase()}] ${alert.message}`,
              alert,
            }),
          });
        } catch (error) {
          app.log.error({ err: error, webhookUrl, code: alert.code }, 'Failed sending ops alert webhook');
        }
      })
    );
  }

  const adminRecipients = await listAdminAlertRecipients();
  await Promise.all(
    adminRecipients.map(async (userId) => {
      try {
        await queueUserNotification({
          userId,
          title: alert.severity === 'critical' ? 'Critical Ops Alert' : 'Ops Alert',
          body: alert.message,
          payload: {
            event: 'ops_alert',
            code: alert.code,
            severity: alert.severity,
            metricValue: alert.metricValue,
            threshold: alert.threshold,
          },
          metadata: {
            source: 'ops_alerting_scheduler',
            ...alert.metadata,
          },
        });
      } catch (error) {
        app.log.error({ err: error, userId, code: alert.code }, 'Failed queueing ops alert notification');
      }
    })
  );
}

async function runOpsAlerting(reason: 'interval' | 'manual'): Promise<{
  reason: 'interval' | 'manual';
  checkedAt: string;
  alertCount: number;
  alerts: OpsAlert[];
}> {
  const checkedAt = new Date().toISOString();
  const alerts = await collectOperationalAlerts(db, checkedAt);

  for (const alert of alerts) {
    await dispatchOpsAlert(alert);
  }

  return {
    reason,
    checkedAt,
    alertCount: alerts.length,
    alerts,
  };
}

async function runPlatformReconciliation(
  reason: 'scheduled' | 'manual',
  explicitRunDate?: string
): Promise<DailyReconciliationRun> {
  const runDate = parseRunDateOrToday(explicitRunDate);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    if (!(await reconciliationTableAvailable(client))) {
      throw createApiError(
        'RECONCILIATION_TABLES_UNAVAILABLE',
        'Reconciliation tables are unavailable. Run migrations first.'
      );
    }

    const run = await runDailyReconciliation(client, {
      runDate,
      reason,
      mismatchThresholdGbp: config.reconciliationMismatchThresholdGbp,
      criticalMismatchThresholdGbp: config.reconciliationCriticalMismatchThresholdGbp,
    });

    if (run.status === 'critical') {
      await setPayoutPauseState({
        paused: true,
        reason: 'critical_reconciliation_mismatch',
        reconciliationRunId: run.id,
        mismatchGbp: run.mismatchGbp,
      });
    } else {
      await setPayoutPauseState({
        paused: false,
        reason: 'reconciliation_ok',
      });
    }

    await client.query('COMMIT');

    if (run.status === 'critical' && config.sentryDsn) {
      Sentry.captureMessage(
        `Critical reconciliation mismatch for ${run.runDate}: GBP ${run.mismatchGbp.toFixed(2)}`,
        {
          level: 'error',
          tags: {
            reconciliation_status: run.status,
          },
          extra: {
            run,
            reason,
          },
        }
      );
    }

    return run;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runPlatformRevenueSweep(
  reason: PlatformRevenueSweepReason
): Promise<{
  reason: PlatformRevenueSweepReason;
  executedAt: string;
  sweepAmountGbp: number;
  transferRecorded: boolean;
  externalTransfer: PlatformRevenueSweepExternalTransfer;
  balances: {
    platformRevenueBeforeGbp: number;
    platformRevenueAfterGbp: number;
    platformOperatingBeforeGbp: number;
    platformOperatingAfterGbp: number;
  };
}> {
  const executedAt = new Date().toISOString();

  if (!(await ledgerTablesAvailable(db))) {
    throw createApiError(
      'LEDGER_TABLES_UNAVAILABLE',
      'Payment settlement ledger tables are unavailable. Run migrations first.'
    );
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const platformRevenueAccountId = await ensureLedgerAccount(
      client,
      'platform',
      'platform',
      'platform_revenue'
    );
    const platformOperatingAccountId = await ensureLedgerAccount(
      client,
      'platform',
      'platform',
      'platform_operating'
    );

    const platformRevenueBeforeGbp = await getLedgerAccountBalance(
      client,
      'platform',
      'platform',
      'platform_revenue'
    );
    const platformOperatingBeforeGbp = await getLedgerAccountBalance(
      client,
      'platform',
      'platform',
      'platform_operating'
    );

    const sweepAmountGbp = Math.max(0, roundTo(platformRevenueBeforeGbp, 6));
    let transferRecorded = false;
    let externalTransfer: PlatformRevenueSweepExternalTransfer = {
      attempted: false,
      executed: false,
      gatewayId: null,
      status: 'skipped',
      reason: 'no_sweep_amount',
      providerTransferRef: null,
      providerQuoteRef: null,
    };

    if (sweepAmountGbp > 0) {
      const sourceId = createRuntimeId('platform_revenue_sweep');
      const sweepGateway = resolvePlatformRevenueSweepGateway();

      if (sweepGateway === 'wise' || sweepGateway === 'wise_global') {
        externalTransfer = await executeWisePlatformRevenueSweepTransfer({
          amountGbp: sweepAmountGbp,
          sourceId,
          reason,
        });
      } else if (config.platformRevenueSweepGateway) {
        externalTransfer = {
          attempted: false,
          executed: false,
          gatewayId: null,
          status: 'skipped',
          reason: `unsupported_gateway_${config.platformRevenueSweepGateway}`,
          providerTransferRef: null,
          providerQuoteRef: null,
        };
      } else {
        externalTransfer = {
          attempted: false,
          executed: false,
          gatewayId: null,
          status: 'skipped',
          reason: 'gateway_not_configured',
          providerTransferRef: null,
          providerQuoteRef: null,
        };
      }

      if (config.platformRevenueSweepRequireExternalTransfer && !externalTransfer.executed) {
        throw createApiError(
          'PLATFORM_SWEEP_EXTERNAL_TRANSFER_REQUIRED',
          'Platform revenue sweep requires an external transfer but no transfer was executed',
          {
            gateway: config.platformRevenueSweepGateway,
            reason: externalTransfer.reason,
          }
        );
      }

      await appendLedgerEntry(client, {
        accountId: platformRevenueAccountId,
        counterpartyAccountId: platformOperatingAccountId,
        direction: 'debit',
        amountGbp: sweepAmountGbp,
        sourceType: 'adjustment',
        sourceId,
        lineType: 'platform_revenue_sweep_out',
        metadata: {
          reason,
          externalTransfer,
        },
      });

      await appendLedgerEntry(client, {
        accountId: platformOperatingAccountId,
        counterpartyAccountId: platformRevenueAccountId,
        direction: 'credit',
        amountGbp: sweepAmountGbp,
        sourceType: 'adjustment',
        sourceId,
        lineType: 'platform_revenue_sweep_in',
        metadata: {
          reason,
          externalTransfer,
        },
      });

      transferRecorded = true;
    }

    const platformRevenueAfterGbp = await getLedgerAccountBalance(
      client,
      'platform',
      'platform',
      'platform_revenue'
    );
    const platformOperatingAfterGbp = await getLedgerAccountBalance(
      client,
      'platform',
      'platform',
      'platform_operating'
    );

    await client.query('COMMIT');

    return {
      reason,
      executedAt,
      sweepAmountGbp: roundTo(sweepAmountGbp, 6),
      transferRecorded,
      externalTransfer,
      balances: {
        platformRevenueBeforeGbp: roundTo(platformRevenueBeforeGbp, 6),
        platformRevenueAfterGbp: roundTo(platformRevenueAfterGbp, 6),
        platformOperatingBeforeGbp: roundTo(platformOperatingBeforeGbp, 6),
        platformOperatingAfterGbp: roundTo(platformOperatingAfterGbp, 6),
      },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function startPlatformReconciliationScheduler(): void {
  if (reconciliationSchedulerDelayTimer || reconciliationSchedulerIntervalTimer) {
    return;
  }

  const targetHour = Math.min(23, Math.max(0, Math.round(config.reconciliationScheduleUtcHour)));
  const enqueueScheduledReconciliation = () => {
    void enqueueReconciliationJob({ reason: 'scheduled' }).catch((error) => {
      app.log.error({ err: error }, 'Failed scheduling reconciliation job');
    });
  };

  const scheduleDailyRun = () => {
    reconciliationSchedulerIntervalTimer = setInterval(() => {
      enqueueScheduledReconciliation();
    }, 24 * 60 * 60 * 1000);

    reconciliationSchedulerIntervalTimer.unref?.();
  };

  reconciliationSchedulerDelayTimer = setTimeout(() => {
    reconciliationSchedulerDelayTimer = null;

    enqueueScheduledReconciliation();

    scheduleDailyRun();
  }, millisecondsUntilNextUtcHour(targetHour));

  reconciliationSchedulerDelayTimer.unref?.();
}

function stopPlatformReconciliationScheduler(): void {
  if (reconciliationSchedulerDelayTimer) {
    clearTimeout(reconciliationSchedulerDelayTimer);
    reconciliationSchedulerDelayTimer = null;
  }

  if (reconciliationSchedulerIntervalTimer) {
    clearInterval(reconciliationSchedulerIntervalTimer);
    reconciliationSchedulerIntervalTimer = null;
  }
}

function startPlatformRevenueSweepScheduler(): void {
  if (platformRevenueSweepTimer) {
    return;
  }

  void runPlatformRevenueSweep('startup').catch((error) => {
    app.log.error({ err: error }, 'Failed startup platform revenue sweep run');
  });

  const intervalMs = Math.max(60_000, config.platformRevenueSweepIntervalMs);
  platformRevenueSweepTimer = setInterval(() => {
    void runPlatformRevenueSweep('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval platform revenue sweep run');
    });
  }, intervalMs);

  platformRevenueSweepTimer.unref?.();
}

function stopPlatformRevenueSweepScheduler(): void {
  if (!platformRevenueSweepTimer) {
    return;
  }

  clearInterval(platformRevenueSweepTimer);
  platformRevenueSweepTimer = null;
}

function startOpsAlertingScheduler(): void {
  if (opsAlertingTimer) {
    return;
  }

  void runOpsAlerting('interval').catch((error) => {
    app.log.error({ err: error }, 'Failed startup ops alerting run');
  });

  const intervalMs = Math.max(15_000, config.opsAlertIntervalMs);
  opsAlertingTimer = setInterval(() => {
    void runOpsAlerting('interval').catch((error) => {
      app.log.error({ err: error }, 'Failed interval ops alerting run');
    });
  }, intervalMs);

  opsAlertingTimer.unref?.();
}

function stopOpsAlertingScheduler(): void {
  if (!opsAlertingTimer) {
    return;
  }

  clearInterval(opsAlertingTimer);
  opsAlertingTimer = null;
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

app.post('/ops/reconciliation/run', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const bodySchema = z.object({
    runDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});

  if (!(await paymentTablesAvailable(db)) || !(await ledgerTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement or ledger tables are unavailable. Run migrations first.',
    };
  }

  try {
    const run = await runPlatformReconciliation('manual', payload.runDate);
    const pauseState = await getPayoutPauseState();

    return {
      ok: true,
      run,
      payouts: {
        paused: pauseState.paused,
        reason: pauseState.reason ?? null,
        reconciliationRunId: pauseState.reconciliationRunId ?? null,
      },
    };
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError?.code === 'RECONCILIATION_TABLES_UNAVAILABLE') {
      reply.code(503);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    request.log.error({ err: error, runDate: payload.runDate }, 'Failed manual reconciliation run');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to run reconciliation',
    };
  }
});

app.get('/ops/reconciliation/latest', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const latest = await getLatestReconciliationRun(db);
  const pauseState = await getPayoutPauseState();

  return {
    ok: true,
    latest,
    payouts: {
      paused: pauseState.paused,
      reason: pauseState.reason ?? null,
      reconciliationRunId: pauseState.reconciliationRunId ?? null,
      mismatchGbp: pauseState.mismatchGbp ?? null,
    },
  };
});

app.post('/ops/platform-revenue/sweep', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  try {
    const result = await runPlatformRevenueSweep('manual');
    return {
      ok: true,
      result,
    };
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError?.code === 'LEDGER_TABLES_UNAVAILABLE') {
      reply.code(503);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'PLATFORM_SWEEP_EXTERNAL_TRANSFER_REQUIRED') {
      reply.code(503);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    if (apiError?.code === 'PLATFORM_SWEEP_EXTERNAL_TRANSFER_FAILED') {
      reply.code(502);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error }, 'Failed manual platform revenue sweep run');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to run platform revenue sweep',
    };
  }
});

app.post('/ops/alerts/run', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  try {
    const result = await runOpsAlerting('manual');
    return {
      ok: true,
      result,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Failed manual ops alerting run');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to run ops alerting checks',
    };
  }
});

app.get('/ops/payouts/pause', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const pauseState = await getPayoutPauseState();
  return {
    ok: true,
    payouts: {
      paused: pauseState.paused,
      reason: pauseState.reason ?? null,
      reconciliationRunId: pauseState.reconciliationRunId ?? null,
      mismatchGbp: pauseState.mismatchGbp ?? null,
    },
  };
});

app.post('/ops/oneze/reconcile', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const snapshot = await runOnezeReconciliation('manual');
  return {
    ok: true,
    snapshot,
  };
});

app.post('/ops/oneze/attest', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const attestation = await runOnezeDailyAttestation('manual');
  return {
    ok: true,
    attestation,
  };
});

app.post('/ops/oneze/fx-sync', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    const result = await syncOnezeInternalFxRatesFromProvider('manual');
    return {
      ok: true,
      sync: result,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Failed manual 1ze FX sync');
    reply.code(502);
    return {
      ok: false,
      error: 'Unable to sync FX rates from provider',
    };
  }
});

app.post('/ops/oneze/auto-adjust', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    const result = await runOnezeAutomaticSpreadAdjustment('manual', {
      ignoreEnabled: true,
    });

    return {
      ok: true,
      adjustment: result,
    };
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error }, 'Failed manual 1ze automatic spread adjustment');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to execute automatic spread adjustment',
    };
  }
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

  const paymentClusters = getConfiguredClusters();
  const resultWithClusters = {
    ...result,
    paymentClusters,
  };

  if (resultWithClusters.ok) {
    delete resultWithClusters.details;
    return resultWithClusters;
  }

  if (config.nodeEnv === 'production') {
    delete resultWithClusters.details;
  }

  reply.code(503);
  return resultWithClusters;
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

const complianceMarketSchema = z.enum(['co-own', 'auctions', 'wallet', 'p2p']);
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

app.get('/users/:userId/capabilities', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const { userId } = paramsSchema.parse(request.params);

  const actorUserId = resolveAuthenticatedUserId(request, userId);
  await ensureUserExists(actorUserId);

  const profile = await getOrCreateComplianceProfile(db, actorUserId);
  const capabilities = resolveCountryCapabilities({
    countryCode: profile.countryCode,
    residencyCountryCode: profile.residencyCountryCode,
  });

  return {
    ok: true,
    userId: actorUserId,
    profile: {
      countryCode: profile.countryCode,
      residencyCountryCode: profile.residencyCountryCode,
      kycStatus: profile.kycStatus,
    },
    capabilities,
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
    eventType: z.enum(['trade', 'bid', 'deposit', 'withdrawal', 'transfer', 'manual']).default('manual'),
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
      coOwnOrders,
      coOwnHoldings,
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
      client.query('SELECT * FROM coOwn_orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
      client.query('SELECT * FROM coOwn_holdings WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1000', [userId]),
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
      coOwnOrders: coOwnOrders.rows,
      coOwnHoldings: coOwnHoldings.rows,
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
            coOwnOrders: coOwnOrders.rowCount ?? 0,
            coOwnHoldings: coOwnHoldings.rowCount ?? 0,
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
    memberIds: z.array(z.string().trim().min(2)).max(48).default([]),
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

  const conversation = await ensureGroupManagementAccess(db, conversationId, actorUserId, request.authUser?.role);

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

app.post('/chat/conversations/:conversationId/invite-links', async (request, reply) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });
  const bodySchema = z.object({
    expiresInHours: z.coerce.number().int().min(1).max(24 * 30).default(72),
    maxUses: z.coerce.number().int().min(0).max(10_000).default(0),
    metadata: z.record(z.unknown()).optional(),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  const conversation = await ensureGroupManagementAccess(db, conversationId, actorUserId, request.authUser?.role);

  const inviteId = createRuntimeId('chatinv');
  const inviteToken = createPublicToken('ginv');
  const tokenHash = hashOpaqueValue(inviteToken);
  const tokenPrefix = inviteToken.slice(0, 14);
  const expiresAt = new Date(Date.now() + payload.expiresInHours * 60 * 60 * 1000).toISOString();

  await db.query(
    `
      INSERT INTO chat_group_invites (
        id,
        conversation_id,
        token_hash,
        token_prefix,
        created_by,
        max_uses,
        expires_at,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      inviteId,
      conversationId,
      tokenHash,
      tokenPrefix,
      actorUserId,
      payload.maxUses,
      expiresAt,
      toJsonString(payload.metadata ?? {}),
    ]
  );

  publishRealtimeEvent({
    topic: `chat.conversation:${conversationId}`,
    type: 'chat.invite.created',
    payload: {
      conversationId,
      inviteId,
      actorUserId,
    },
  });

  reply.code(201);
  return {
    ok: true,
    conversationId,
    invite: {
      id: inviteId,
      inviteLink: buildGroupInviteLink(inviteToken),
      tokenPreview: `${tokenPrefix}...`,
      createdBy: actorUserId,
      ownerId: conversation.owner_id,
      expiresAt,
      maxUses: payload.maxUses,
      useCount: 0,
    },
  };
});

app.get('/chat/conversations/:conversationId/invite-links', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
  });
  const querySchema = z.object({
    includeRevoked: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId } = paramsSchema.parse(request.params);
  const { includeRevoked, limit } = querySchema.parse(request.query ?? {});

  await ensureGroupManagementAccess(db, conversationId, actorUserId, request.authUser?.role);

  const result = includeRevoked
    ? await db.query<{
      id: string;
      token_prefix: string;
      created_by: string;
      max_uses: number | string;
      use_count: number | string;
      expires_at: string;
      revoked_at: string | null;
      created_at: string;
      updated_at: string;
      last_used_at: string | null;
      last_used_by: string | null;
    }>(
      `
        SELECT
          id,
          token_prefix,
          created_by,
          max_uses,
          use_count,
          expires_at::text,
          revoked_at::text,
          created_at::text,
          updated_at::text,
          last_used_at::text,
          last_used_by
        FROM chat_group_invites
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [conversationId, limit]
    )
    : await db.query<{
      id: string;
      token_prefix: string;
      created_by: string;
      max_uses: number | string;
      use_count: number | string;
      expires_at: string;
      revoked_at: string | null;
      created_at: string;
      updated_at: string;
      last_used_at: string | null;
      last_used_by: string | null;
    }>(
      `
        SELECT
          id,
          token_prefix,
          created_by,
          max_uses,
          use_count,
          expires_at::text,
          revoked_at::text,
          created_at::text,
          updated_at::text,
          last_used_at::text,
          last_used_by
        FROM chat_group_invites
        WHERE conversation_id = $1
          AND revoked_at IS NULL
        ORDER BY created_at DESC
        LIMIT $2
      `,
      [conversationId, limit]
    );

  const now = Date.now();

  return {
    ok: true,
    conversationId,
    items: result.rows.map((row) => {
      const maxUses = Number(row.max_uses);
      const useCount = Number(row.use_count);
      const isExpired = new Date(row.expires_at).getTime() <= now;
      const remainingUses = maxUses > 0 ? Math.max(0, maxUses - useCount) : null;

      return {
        id: row.id,
        tokenPreview: `${row.token_prefix}...`,
        createdBy: row.created_by,
        maxUses,
        useCount,
        remainingUses,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastUsedAt: row.last_used_at,
        lastUsedBy: row.last_used_by,
        isExpired,
        isRevoked: Boolean(row.revoked_at),
      };
    }),
  };
});

app.delete('/chat/conversations/:conversationId/invite-links/:inviteId', async (request) => {
  const paramsSchema = z.object({
    conversationId: z.string().min(2).max(120),
    inviteId: z.string().min(2).max(120),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const { conversationId, inviteId } = paramsSchema.parse(request.params);
  await ensureGroupManagementAccess(db, conversationId, actorUserId, request.authUser?.role);

  const client = await db.connect();
  let revoked = false;
  let updateMessage: { id: string; createdAt: string } | null = null;

  try {
    await client.query('BEGIN');

    const revokeResult = await client.query<{ id: string }>(
      `
        UPDATE chat_group_invites
        SET revoked_at = NOW(), updated_at = NOW()
        WHERE conversation_id = $1
          AND id = $2
          AND revoked_at IS NULL
        RETURNING id
      `,
      [conversationId, inviteId]
    );

    revoked = Boolean(revokeResult.rowCount);
    if (revoked) {
      updateMessage = await appendSystemChatMessage(client, {
        conversationId,
        text: 'An invite link was revoked.',
        metadata: {
          event: 'group_invite_revoked',
          actorUserId,
          inviteId,
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
      type: 'chat.invite.revoked',
      payload: {
        conversationId,
        inviteId,
        actorUserId,
        messageId: updateMessage.id,
      },
    });
  }

  return {
    ok: true,
    conversationId,
    inviteId,
    revoked,
  };
});

app.post('/chat/groups/join', async (request, reply) => {
  const bodySchema = z.object({
    inviteToken: z.string().trim().min(6).max(260),
  });

  const actorUserId = resolveAuthenticatedUserId(request);
  const payload = bodySchema.parse(request.body ?? {});
  const inviteTokenHash = hashOpaqueValue(payload.inviteToken);

  await ensureUserExists(actorUserId);

  const client = await db.connect();
  let joined = false;
  let conversationId = '';
  let conversationTitle: string | null = null;
  let ownerId = '';
  let itemId: string | null = null;
  let participantIds: string[] = [];
  let botIds: string[] = [];
  let inviteId = '';
  let maxUses = 0;
  let useCount = 0;
  let expiresAt = '';
  let joinMessage: { id: string; createdAt: string } | null = null;
  let lastMessage = '';
  let lastMessageTime = '';

  try {
    await client.query('BEGIN');

    const inviteResult = await client.query<{
      id: string;
      conversation_id: string;
      conversation_type: ChatConversationType;
      title: string | null;
      owner_id: string;
      item_id: string | null;
      max_uses: number | string;
      use_count: number | string;
      expires_at: string;
      revoked_at: string | null;
    }>(
      `
        SELECT
          cgi.id,
          cgi.conversation_id,
          c.type AS conversation_type,
          c.title,
          c.owner_id,
          c.item_id,
          cgi.max_uses,
          cgi.use_count,
          cgi.expires_at::text,
          cgi.revoked_at::text
        FROM chat_group_invites cgi
        INNER JOIN chat_conversations c
          ON c.id = cgi.conversation_id
        WHERE cgi.token_hash = $1
        LIMIT 1
        FOR UPDATE
      `,
      [inviteTokenHash]
    );

    if (!inviteResult.rowCount) {
      throw createApiError('CHAT_GROUP_INVITE_INVALID', 'Invite link is invalid or unavailable');
    }

    const invite = inviteResult.rows[0];
    if (invite.conversation_type !== 'group') {
      throw createApiError('CHAT_GROUP_INVITE_INVALID', 'Invite link is invalid for this conversation type', {
        conversationId: invite.conversation_id,
        conversationType: invite.conversation_type,
      });
    }

    if (invite.revoked_at) {
      throw createApiError('CHAT_GROUP_INVITE_INVALID', 'Invite link has been revoked', {
        inviteId: invite.id,
      });
    }

    const inviteExpiryMs = new Date(invite.expires_at).getTime();
    if (inviteExpiryMs <= Date.now()) {
      throw createApiError('CHAT_GROUP_INVITE_INVALID', 'Invite link has expired', {
        inviteId: invite.id,
        expiresAt: invite.expires_at,
      });
    }

    maxUses = Number(invite.max_uses);
    useCount = Number(invite.use_count);
    if (maxUses > 0 && useCount >= maxUses) {
      throw createApiError('CHAT_GROUP_INVITE_INVALID', 'Invite link has reached its usage limit', {
        inviteId: invite.id,
        maxUses,
        useCount,
      });
    }

    conversationId = invite.conversation_id;
    conversationTitle = invite.title;
    ownerId = invite.owner_id;
    itemId = invite.item_id;
    inviteId = invite.id;
    expiresAt = invite.expires_at;

    const memberInsertResult = await client.query<{ user_id: string }>(
      `
        INSERT INTO chat_members (conversation_id, user_id, role)
        VALUES ($1, $2, 'member')
        ON CONFLICT (conversation_id, user_id) DO NOTHING
        RETURNING user_id
      `,
      [conversationId, actorUserId]
    );

    joined = Boolean(memberInsertResult.rowCount);

    if (joined) {
      const usageResult = await client.query<{ use_count: number | string }>(
        `
          UPDATE chat_group_invites
          SET
            use_count = use_count + 1,
            last_used_at = NOW(),
            last_used_by = $2,
            updated_at = NOW()
          WHERE id = $1
          RETURNING use_count
        `,
        [inviteId, actorUserId]
      );

      useCount = Number(usageResult.rows[0]?.use_count ?? useCount + 1);

      joinMessage = await appendSystemChatMessage(client, {
        conversationId,
        text: 'A new member joined via invite link.',
        metadata: {
          event: 'group_invite_joined',
          actorUserId,
          inviteId,
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
    botIds = await listChatBotIds(client, conversationId);

    const latestMessageResult = await client.query<{ body: string; created_at: string }>(
      `
        SELECT body, created_at::text
        FROM chat_messages
        WHERE conversation_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [conversationId]
    );

    if (latestMessageResult.rowCount) {
      lastMessage = latestMessageResult.rows[0].body;
      lastMessageTime = latestMessageResult.rows[0].created_at;
    } else {
      lastMessage = `${conversationTitle ?? 'Group'} created.`;
      lastMessageTime = new Date().toISOString();
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  if (joinMessage) {
    publishRealtimeEvent({
      topic: `chat.conversation:${conversationId}`,
      type: 'chat.member.joined_via_invite',
      payload: {
        conversationId,
        actorUserId,
        inviteId,
        messageId: joinMessage.id,
      },
    });
  }

  reply.code(joined ? 201 : 200);
  return {
    ok: true,
    joined,
    conversation: {
      id: conversationId,
      type: 'group' as const,
      title: conversationTitle,
      ownerId,
      itemId,
      participantIds,
      botIds,
      lastMessage,
      lastMessageTime,
      unread: false,
    },
    invite: {
      id: inviteId,
      maxUses,
      useCount,
      expiresAt,
      remainingUses: maxUses > 0 ? Math.max(0, maxUses - useCount) : null,
    },
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

app.get('/oracle/gold/latest', async (_request, reply) => {
  reply.code(410);
  return {
    ok: false,
    error: 'Gold oracle endpoint has been decommissioned for 1ze controlled pricing.',
    code: 'GOLD_ORACLE_DECOMMISSIONED',
  };
});

app.post('/oracle/gold/override', async (_request, reply) => {
  reply.code(410);
  return {
    ok: false,
    error: 'Gold rate overrides are disabled. Use /update-anchor and /update-pricing controls instead.',
    code: 'GOLD_ORACLE_DECOMMISSIONED',
  };
});

app.get('/price', async (request, reply) => {
  const querySchema = z.object({
    country: z.string().min(2).max(3).default('IN'),
  });

  const payload = querySchema.parse(request.query);

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    const quote = await resolveCountryPricingQuote(db, payload.country);
    return {
      ok: true,
      quote: {
        country: quote.countryCode,
        currency: quote.currency,
        buyPrice: quote.buyPrice,
        sellPrice: quote.sellPrice,
        crossBorderPrice: quote.crossBorderSellPrice,
        markupBps: quote.markupBps,
        markdownBps: quote.markdownBps,
        crossBorderFeeBps: quote.crossBorderFeeBps,
        pppFactor: quote.pppFactor,
        source: quote.source,
      },
    };
  } catch (error) {
    request.log.error({ err: error, payload }, 'Failed to resolve controlled 1ze price');
    reply.code(404);
    return {
      ok: false,
      error: 'Unable to resolve 1ze price for requested country',
    };
  }
});

app.get('/wallet/1ze/quote', async (request, reply) => {
  const querySchema = z.object({
    country: z.string().min(2).max(3).optional(),
    originCountry: z.string().min(2).max(3).optional(),
    redeemCountry: z.string().min(2).max(3).optional(),
    fiatCurrency: z.string().length(3).default('GBP'),
    fiatAmount: z.coerce.number().positive().optional(),
    izeAmount: z.coerce.number().positive().optional(),
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

  if (!(await onezeTablesAvailable(db)) || !(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    const direction = payload.fiatAmount !== undefined ? 'mint' : 'burn';
    const fiatCurrency = payload.fiatCurrency.toUpperCase();
    const countryQuote = payload.country
      ? await resolveCountryPricingQuote(db, payload.country)
      : await resolveCountryPricingQuoteByCurrency(db, fiatCurrency);

    let fiatAmount: number;
    let izeAmount: number;
    let netFiatAmount: number;
    let platformFeeAmount = 0;
    let platformFeeRate = 0;
    let effectiveRate = countryQuote.buyPrice;
    let effectiveRateMode: 'buy' | 'sell' | 'cross_border_sell' = 'buy';

    if (direction === 'mint') {
      const feeBreakdown = calculateWalletTopupFeeBreakdown(payload.fiatAmount ?? 0);
      fiatAmount = feeBreakdown.grossFiatAmount;
      netFiatAmount = feeBreakdown.netFiatAmount;
      platformFeeAmount = feeBreakdown.platformFeeAmount;
      platformFeeRate = feeBreakdown.platformFeeRate;

      if (!Number.isFinite(netFiatAmount) || netFiatAmount <= 0) {
        throw createApiError('IZE_MINT_INVALID', 'Top-up amount is too low after platform fee');
      }

      effectiveRate = countryQuote.buyPrice;
      effectiveRateMode = 'buy';
      izeAmount = Number((netFiatAmount / effectiveRate).toFixed(6));
    } else {
      const isCrossBorder =
        Boolean(payload.originCountry)
        && Boolean(payload.redeemCountry)
        && payload.originCountry?.toUpperCase() !== payload.redeemCountry?.toUpperCase();

      effectiveRate = isCrossBorder ? countryQuote.crossBorderSellPrice : countryQuote.sellPrice;
      effectiveRateMode = isCrossBorder ? 'cross_border_sell' : 'sell';
      fiatAmount = Number(((payload.izeAmount ?? 0) * effectiveRate).toFixed(6));
      netFiatAmount = fiatAmount;
      izeAmount = Number((payload.izeAmount ?? 0).toFixed(6));
    }

    return {
      ok: true,
      quote: {
        direction,
        country: countryQuote.countryCode,
        fiatCurrency,
        fiatAmount,
        netFiatAmount,
        izeAmount,
        platformFeeRate,
        platformFeeAmount,
        ratePerGram: effectiveRate,
        rateSource: `internal_pricing:${countryQuote.countryCode}:${effectiveRateMode}`,
        buyPrice: countryQuote.buyPrice,
        sellPrice: countryQuote.sellPrice,
        crossBorderPrice: countryQuote.crossBorderSellPrice,
      },
    };
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

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
  });

  const payload = querySchema.parse(request.query);

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  const fromCurrency = payload.fromCurrency.toUpperCase();
  const toCurrency = payload.toCurrency.toUpperCase();

  try {
    const fx = await resolveInternalFxRate(db, fromCurrency, toCurrency);
    const convertedAmount = Number((payload.amount * fx.rate).toFixed(6));

    return {
      ok: true,
      quote: {
        fromCurrency,
        toCurrency,
        inputAmount: Number(payload.amount.toFixed(6)),
        fxRate: fx.rate,
        convertedAmount,
        source: fx.source,
        usedInverse: fx.usedInverse,
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

app.post('/update-pricing', async (request, reply) => {
  const bodySchema = z.object({
    country: z.string().min(2).max(3),
    currency: z.string().length(3),
    markupBps: z.number().int(),
    markdownBps: z.number().int(),
    crossBorderFeeBps: z.number().int(),
    pppFactor: z.number().positive(),
    withdrawalLockHours: z.number().int().min(0).max(336).optional(),
    dailyRedeemLimitIze: z.number().positive().optional(),
    weeklyRedeemLimitIze: z.number().positive().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});

  try {
    validatePricingProfileInput({
      markupBps: payload.markupBps,
      markdownBps: payload.markdownBps,
      crossBorderFeeBps: payload.crossBorderFeeBps,
      pppFactor: payload.pppFactor,
    });
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const profile = await upsertCountryPricingProfile(client, {
      countryCode: payload.country,
      currency: payload.currency,
      markupBps: payload.markupBps,
      markdownBps: payload.markdownBps,
      crossBorderFeeBps: payload.crossBorderFeeBps,
      pppFactor: payload.pppFactor,
      withdrawalLockHours: payload.withdrawalLockHours,
      dailyRedeemLimitIze: payload.dailyRedeemLimitIze,
      weeklyRedeemLimitIze: payload.weeklyRedeemLimitIze,
      isActive: payload.isActive,
      metadata: {
        ...(payload.metadata ?? {}),
        reason: payload.reason ?? null,
        updatedBy: request.authUser?.userId ?? 'operator',
      },
    });

    const quotes = await listCountryPricingQuotes(client);
    const violations = findPricingArbitrageViolations(quotes);
    if (violations.length > 0) {
      throw createApiError('PRICING_ARBITRAGE_VIOLATION', 'Pricing update introduces guaranteed arbitrage', {
        violations: violations.slice(0, 10),
      });
    }

    const quote = quotes.find((entry) => entry.countryCode === profile.countryCode)
      ?? await resolveCountryPricingQuote(client, profile.countryCode);

    await client.query('COMMIT');
    return {
      ok: true,
      profile,
      quote,
      matrixSize: quotes.length,
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

    request.log.error({ err: error, payload }, 'Failed to update country pricing profile');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to update pricing profile',
    };
  } finally {
    client.release();
  }
});

app.post('/update-anchor', async (request, reply) => {
  const bodySchema = z.object({
    anchorValueInInr: z.number().positive(),
    reason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const anchor = await setOnezeAnchorConfig(client, {
      anchorValue: payload.anchorValueInInr,
      notes: payload.reason,
      metadata: {
        ...(payload.metadata ?? {}),
        updatedBy: request.authUser?.userId ?? 'operator',
      },
    });

    const quotes = await listCountryPricingQuotes(client);
    const violations = findPricingArbitrageViolations(quotes);
    if (violations.length > 0) {
      throw createApiError('PRICING_ARBITRAGE_VIOLATION', 'Anchor update introduces guaranteed arbitrage', {
        violations: violations.slice(0, 10),
      });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      anchor,
      matrixSize: quotes.length,
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

    request.log.error({ err: error, payload }, 'Failed to update 1ze anchor');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to update 1ze anchor',
    };
  } finally {
    client.release();
  }
});

app.post('/admin/1ze/fx-rate', async (request, reply) => {
  const bodySchema = z.object({
    baseCurrency: z.string().length(3),
    quoteCurrency: z.string().length(3),
    rate: z.number().positive(),
    reason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await setInternalFxRate(client, {
      baseCurrency: payload.baseCurrency,
      quoteCurrency: payload.quoteCurrency,
      rate: payload.rate,
      source: 'operator',
      metadata: {
        ...(payload.metadata ?? {}),
        reason: payload.reason ?? null,
        updatedBy: request.authUser?.userId ?? 'operator',
      },
    });

    const quotes = await listCountryPricingQuotes(client);
    const violations = findPricingArbitrageViolations(quotes);
    if (violations.length > 0) {
      throw createApiError('PRICING_ARBITRAGE_VIOLATION', 'FX update introduces guaranteed arbitrage', {
        violations: violations.slice(0, 10),
      });
    }

    await client.query('COMMIT');
    return {
      ok: true,
      fx: {
        baseCurrency: payload.baseCurrency.toUpperCase(),
        quoteCurrency: payload.quoteCurrency.toUpperCase(),
        rate: Number(payload.rate.toFixed(8)),
      },
      matrixSize: quotes.length,
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

    request.log.error({ err: error, payload }, 'Failed to update internal FX rate');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to update internal FX rate',
    };
  } finally {
    client.release();
  }
});

app.post('/adjust-spread', async (request, reply) => {
  const bodySchema = z.object({
    country: z.string().min(2).max(3),
    markupBps: z.number().int().optional(),
    markdownBps: z.number().int().optional(),
    crossBorderFeeBps: z.number().int().optional(),
    reason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});

  if (
    payload.markupBps === undefined
    && payload.markdownBps === undefined
    && payload.crossBorderFeeBps === undefined
  ) {
    reply.code(400);
    return {
      ok: false,
      error: 'Provide at least one spread field to adjust',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const current = await getCountryPricingProfile(client, payload.country);
    if (!current) {
      reply.code(404);
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'Country pricing profile not found',
      };
    }

    const nextMarkupBps = payload.markupBps ?? current.markupBps;
    const nextMarkdownBps = payload.markdownBps ?? current.markdownBps;
    const nextCrossBorderFeeBps = payload.crossBorderFeeBps ?? current.crossBorderFeeBps;

    try {
      validatePricingProfileInput({
        markupBps: nextMarkupBps,
        markdownBps: nextMarkdownBps,
        crossBorderFeeBps: nextCrossBorderFeeBps,
        pppFactor: current.pppFactor,
      });
    } catch (error) {
      throw createApiError('PRICING_PROFILE_INVALID', (error as Error).message);
    }

    const profile = await upsertCountryPricingProfile(client, {
      countryCode: current.countryCode,
      currency: current.currency,
      markupBps: nextMarkupBps,
      markdownBps: nextMarkdownBps,
      crossBorderFeeBps: nextCrossBorderFeeBps,
      pppFactor: current.pppFactor,
      withdrawalLockHours: current.withdrawalLockHours,
      dailyRedeemLimitIze: current.dailyRedeemLimitIze,
      weeklyRedeemLimitIze: current.weeklyRedeemLimitIze,
      isActive: current.isActive,
      metadata: {
        ...(payload.metadata ?? {}),
        reason: payload.reason ?? null,
        updatedBy: request.authUser?.userId ?? 'operator',
      },
    });

    const quotes = await listCountryPricingQuotes(client);
    const violations = findPricingArbitrageViolations(quotes);
    if (violations.length > 0) {
      throw createApiError('PRICING_ARBITRAGE_VIOLATION', 'Spread adjustment introduces guaranteed arbitrage', {
        violations: violations.slice(0, 10),
      });
    }

    const quote = quotes.find((entry) => entry.countryCode === profile.countryCode)
      ?? await resolveCountryPricingQuote(client, profile.countryCode);

    await client.query('COMMIT');
    return {
      ok: true,
      profile,
      quote,
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

    request.log.error({ err: error, payload }, 'Failed to adjust country spread');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to adjust pricing spread',
    };
  } finally {
    client.release();
  }
});

app.get('/admin/1ze/pricing-health', async (request, reply) => {
  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    const quotes = await listCountryPricingQuotes(db);
    const violations = findPricingArbitrageViolations(quotes);

    return {
      ok: true,
      matrixSize: quotes.length,
      violationCount: violations.length,
      violations,
      quotes,
    };
  } catch (error) {
    request.log.error({ err: error }, 'Failed to evaluate 1ze pricing health');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to evaluate pricing health',
    };
  }
});

app.get('/admin/1ze/risk-dashboard', async (request, reply) => {
  const querySchema = z.object({
    lookbackHours: z.coerce.number().int().min(1).max(24 * 30).default(24),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (
    !(await onezePricingTablesAvailable(db))
    || !(await onezeArchitectureTablesAvailable(db))
    || !(await onezeTablesAvailable(db))
  ) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze risk dashboard dependencies are unavailable. Run migrations first.',
    };
  }

  const payload = querySchema.parse(request.query);

  try {
    const metrics = await collectOnezeRiskDashboardMetrics(db, payload.lookbackHours);

    return {
      ok: true,
      dashboard: {
        evaluatedAt: metrics.evaluatedAt,
        lookbackHours: metrics.lookbackHours,
        countryFlows: metrics.countryFlows,
        totals: metrics.totals,
        redemption: metrics.redemption,
        crossBorder: metrics.crossBorder,
        liquidity: {
          pendingWithdrawalMg: metrics.liquidity.pendingWithdrawalMg,
          operationalLiquidityMg: metrics.liquidity.operationalLiquidityMg,
          stressIndex: metrics.liquidity.stressIndex,
          stressLevel: metrics.liquidity.stressLevel,
        },
        reservePolicy: metrics.reservePolicy,
        exposure: metrics.exposure,
      },
    };
  } catch (error) {
    request.log.error({ err: error, payload }, 'Failed to evaluate 1ze risk dashboard');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to evaluate 1ze risk dashboard',
    };
  }
});

app.post('/wallet/1ze/mint/quote', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    fiatAmount: z.number().positive(),
    fiatCurrency: z.string().length(3).default('INR'),
    gatewayId: z.string().min(2).max(80).optional(),
    instrumentId: z.coerce.number().int().positive().optional(),
    returnUrl: z.string().url().optional(),
    webhookUrl: z.string().url().optional(),
    forceRefresh: z.coerce.boolean().default(false),
    idempotencyKey: z.string().min(8).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (!(await onezeMintFlowTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze mint flow tables are unavailable. Run migrations first.',
    };
  }

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    await assertOnezeMintBurnNotHalted();
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    const fiatCurrency = payload.fiatCurrency.toUpperCase();
    const feeBreakdown = calculateWalletTopupFeeBreakdown(payload.fiatAmount);
    if (feeBreakdown.netFiatAmount <= 0) {
      throw createApiError('IZE_MINT_INVALID', 'Top-up amount is too low after platform fee');
    }

    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
          userId: actorUserId,
          fiatAmount: Number(payload.fiatAmount.toFixed(6)),
          fiatCurrency,
          gatewayId: payload.gatewayId ?? null,
          instrumentId: payload.instrumentId ?? null,
          metadata: payload.metadata ?? {},
        })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'mint_quote',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, fiatCurrency);
    const mintUnitPrice = pricingQuote.buyPrice;

    const amountMg = onezeAmountToMg(
      Number((feeBreakdown.netFiatAmount / mintUnitPrice).toFixed(6))
    );

    const gatewayId = payload.gatewayId ?? resolveDefaultGatewayForChannel('wallet_topup');
    const gateway = await client.query<{ id: string }>(
      'SELECT id FROM payment_gateways WHERE id = $1 AND is_active = TRUE LIMIT 1',
      [gatewayId]
    );

    if (!gateway.rowCount) {
      throw createApiError('PAYMENT_GATEWAY_INVALID', 'Gateway is not available for wallet top-up minting', {
        gatewayId,
      });
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
        throw createApiError('PAYMENT_INSTRUMENT_INVALID', 'Instrument does not belong to this user');
      }
    }

    const mintOperationId = createRuntimeId('mintop');
    const rateLockedAt = new Date();
    const rateExpiresAt = new Date(rateLockedAt.getTime() + config.onezeMintQuoteTtlSeconds * 1_000);

    await client.query(
      `
        INSERT INTO mint_operations (
          id,
          user_id,
          state,
          fiat_amount_minor,
          fiat_currency,
          net_fiat_amount_minor,
          platform_fee_minor,
          ize_amount_mg,
          rate_per_gram,
          rate_source,
          rate_locked_at,
          rate_expires_at,
          payment_intent_id,
          metadata
        )
        VALUES (
          $1,
          $2,
          'INITIATED',
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          NULL,
          $12::jsonb
        )
      `,
      [
        mintOperationId,
        actorUserId,
        toFiatMinor(feeBreakdown.grossFiatAmount, fiatCurrency),
        fiatCurrency,
        toFiatMinor(feeBreakdown.netFiatAmount, fiatCurrency),
        toFiatMinor(feeBreakdown.platformFeeAmount, fiatCurrency),
        amountMg,
        mintUnitPrice,
        `internal_pricing:${pricingQuote.countryCode}:buy`,
        rateLockedAt.toISOString(),
        rateExpiresAt.toISOString(),
        toJsonString({
          quoteRequestedAt: rateLockedAt.toISOString(),
          quoteValidForSeconds: config.onezeMintQuoteTtlSeconds,
          feeBreakdown,
          pricingCountry: pricingQuote.countryCode,
          pricingCurrency: pricingQuote.currency,
          pricingModel: 'controlled_anchor',
          ...(payload.metadata ?? {}),
        }),
      ]
    );

    const paymentIntentId = createRuntimeId('pi');
    const gatewayIntent = await createGatewayPaymentIntent({
      gatewayId,
      intentId: paymentIntentId,
      channel: 'wallet_topup',
      amountGbp: roundTo(feeBreakdown.grossFiatAmount, 2),
      amountCurrency: fiatCurrency,
      returnUrl: payload.returnUrl,
      webhookUrl: payload.webhookUrl,
      metadata: {
        userId: actorUserId,
        mintOperationId,
        ...(payload.metadata ?? {}),
      },
    });

    const paymentIntentResult = await client.query<PaymentIntentRow>(
      `
        INSERT INTO payment_intents (
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          coOwn_order_id,
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
        VALUES ($1, $2, $3, 'wallet_topup', NULL, NULL, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13::jsonb)
        RETURNING
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          coOwn_order_id,
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
        paymentIntentId,
        actorUserId,
        gatewayId,
        payload.instrumentId ?? null,
        roundTo(feeBreakdown.grossFiatAmount, 2),
        fiatCurrency,
        gatewayIntent.initialStatus,
        gatewayIntent.providerIntentRef,
        gatewayIntent.clientSecret,
        gatewayIntent.providerStatus ?? null,
        gatewayIntent.nextActionUrl ?? null,
        gatewayIntent.scaExpiresAt ?? null,
        toJsonString({
          mintOperationId,
          quoteRateSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
          ...(payload.metadata ?? {}),
        }),
      ]
    );

    const operationResult = await client.query<MintOperationRow>(
      `
        UPDATE mint_operations
        SET
          state = 'PAYMENT_PENDING',
          payment_intent_id = $2,
          metadata = metadata || $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id,
          user_id,
          state,
          fiat_amount_minor::text,
          fiat_currency,
          net_fiat_amount_minor::text,
          platform_fee_minor::text,
          ize_amount_mg::text,
          rate_per_gram::text,
          rate_source,
          rate_locked_at::text,
          rate_expires_at::text,
          payment_intent_id,
          lot_id,
          custodian_ref,
          escrow_ledger_tx_id,
          wallet_credit_tx_id,
          purchase_attempted_at::text,
          settled_at::text,
          last_error,
          metadata,
          created_at::text,
          updated_at::text
      `,
      [
        mintOperationId,
        paymentIntentId,
        toJsonString({
          paymentIntentCreatedAt: new Date().toISOString(),
          paymentIntentId,
          gatewayId,
        }),
      ]
    );

    const operation = toMintOperationPayload(operationResult.rows[0]);
    const intent = toPaymentIntentPayload(paymentIntentResult.rows[0]);
    const responsePayload: Record<string, unknown> = {
      ok: true,
      operation,
      intent,
      quote: {
        validForSeconds: config.onezeMintQuoteTtlSeconds,
        expiresAt: operation.rateExpiresAt,
      },
    };

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'mint_quote',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    await client.query('COMMIT');
    reply.code(201);
    return responsePayload;
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

    request.log.error({ err: error, userId: actorUserId }, 'Failed to create 1ze mint quote operation');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to create 1ze mint quote operation',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/mint/:operationId', async (request, reply) => {
  const paramsSchema = z.object({
    operationId: z.string().min(3),
  });

  const { operationId } = paramsSchema.parse(request.params);

  if (!(await onezeMintFlowTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze mint flow tables are unavailable. Run migrations first.',
    };
  }

  const operationResult = await db.query<MintOperationRow>(
    `
      SELECT
        id,
        user_id,
        state,
        fiat_amount_minor::text,
        fiat_currency,
        net_fiat_amount_minor::text,
        platform_fee_minor::text,
        ize_amount_mg::text,
        rate_per_gram::text,
        rate_source,
        rate_locked_at::text,
        rate_expires_at::text,
        payment_intent_id,
        lot_id,
        custodian_ref,
        escrow_ledger_tx_id,
        wallet_credit_tx_id,
        purchase_attempted_at::text,
        settled_at::text,
        last_error,
        metadata,
        created_at::text,
        updated_at::text
      FROM mint_operations
      WHERE id = $1
      LIMIT 1
    `,
    [operationId]
  );

  const row = operationResult.rows[0];
  if (!row) {
    reply.code(404);
    return {
      ok: false,
      error: 'Mint operation not found',
    };
  }

  if (!request.authUser || (request.authUser.role !== 'admin' && request.authUser.userId !== row.user_id)) {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: mint operation access denied',
    };
  }

  let intent: ReturnType<typeof toPaymentIntentPayload> | null = null;
  if (row.payment_intent_id) {
    const intentResult = await db.query<PaymentIntentRow>(
      `
        SELECT
          id,
          user_id,
          gateway_id,
          channel,
          order_id,
          coOwn_order_id,
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
      [row.payment_intent_id]
    );

    if (intentResult.rowCount) {
      intent = toPaymentIntentPayload(intentResult.rows[0]);
    }
  }

  const operation = toMintOperationPayload(row);
  const expiresAtMs = Date.parse(operation.rateExpiresAt);
  const remainingSeconds = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1_000))
    : null;

  return {
    ok: true,
    operation,
    intent,
    quote: {
      expiresInSeconds: remainingSeconds,
      expired: remainingSeconds !== null ? remainingSeconds <= 0 : null,
    },
  };
});

app.post('/ops/oneze/mint/:operationId/retry', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const paramsSchema = z.object({
    operationId: z.string().min(3),
  });

  const { operationId } = paramsSchema.parse(request.params);

  if (!(await onezeMintFlowTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze mint flow tables are unavailable. Run migrations first.',
    };
  }

  const operation = await loadMintOperationById(db, operationId, {
    forUpdate: false,
  });

  if (!operation) {
    reply.code(404);
    return {
      ok: false,
      error: 'Mint operation not found',
    };
  }

  await enqueueOnezeMintReserveJob({
    mintOperationId: operation.id,
    initiatedBy: request.authUser?.userId ?? 'security_admin',
    reason: 'manual_retry',
  });

  return {
    ok: true,
    enqueued: true,
    operation: toMintOperationPayload(operation),
  };
});

app.post('/wallet/1ze/mint', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    fiatAmount: z.number().positive(),
    fiatCurrency: z.string().length(3).default('GBP'),
    paymentIntentId: z.string().min(4).max(120).optional(),
    idempotencyKey: z.string().min(8).max(140).optional(),
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

  if (!(await onezePricingTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze controlled pricing tables are unavailable. Run migrations first.',
    };
  }

  try {
    await assertOnezeMintBurnNotHalted();
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
          userId: actorUserId,
          fiatAmount: Number(payload.fiatAmount.toFixed(6)),
          fiatCurrency: payload.fiatCurrency.toUpperCase(),
          paymentIntentId: payload.paymentIntentId ?? null,
          metadata: payload.metadata ?? {},
        })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'mint',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    if (feeBreakdown.netFiatAmount <= 0) {
      throw createApiError('IZE_MINT_INVALID', 'Top-up amount is too low after platform fee');
    }

    if (config.nodeEnv === 'production' && !payload.paymentIntentId) {
      throw createApiError(
        'IZE_MINT_PAYMENT_REQUIRED',
        'A settled wallet_topup paymentIntentId is required to credit 1ze in production'
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

    const fiatCurrency = payload.fiatCurrency.toUpperCase();
    const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, fiatCurrency);
    const mintUnitPrice = pricingQuote.buyPrice;
    const izeAmount = Number((feeBreakdown.netFiatAmount / mintUnitPrice).toFixed(6));

    if (!Number.isFinite(izeAmount) || izeAmount <= 0) {
      throw createApiError('IZE_MINT_INVALID', 'Unable to derive a valid 1ze mint amount');
    }

    const operationId = createRuntimeId('ize_mint');
    await recordIzeMint(client, {
      operationId,
      userId: actorUserId,
      fiatAmount: feeBreakdown.netFiatAmount,
      fiatCurrency,
      izeAmount,
      ratePerGram: mintUnitPrice,
      paymentIntentId: payload.paymentIntentId,
      metadata: {
        ...(payload.metadata ?? {}),
        pricingCountry: pricingQuote.countryCode,
        pricingModel: 'controlled_anchor',
        pricingSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        walletTopup: {
          grossFiatAmount: feeBreakdown.grossFiatAmount,
          netFiatAmount: feeBreakdown.netFiatAmount,
          platformFeeRate: feeBreakdown.platformFeeRate,
          platformFeeAmount: feeBreakdown.platformFeeAmount,
        },
      },
    });

    const architectureEnabled = await onezeArchitectureTablesAvailable(client);
    let architectureWalletId: string | null = null;
    let architectureWalletBalanceMg: number | null = null;

    if (architectureEnabled) {
      const amountMg = onezeAmountToMg(izeAmount);
      const wallet = await ensureWallet(client, actorUserId, fiatCurrency);
      const walletTxId = createRuntimeId('wtx');

      architectureWalletId = wallet.id;
      architectureWalletBalanceMg = await applyWalletLedgerDelta(client, {
        walletId: wallet.id,
        txId: walletTxId,
        asset: '1ZE',
        amount: amountMg,
        kind: 'MINT',
        refType: 'wallet_ize_operation',
        refId: operationId,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          operationId,
          userId: actorUserId,
          paymentIntentId: payload.paymentIntentId ?? null,
          fiatAmount: feeBreakdown.netFiatAmount,
          fiatCurrency,
          pricingReferenceSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
          ...(payload.metadata ?? {}),
        },
      });

      await creditWalletSegmentBalance(client, {
        wallet,
        txId: walletTxId,
        purchasedCreditMg: amountMg,
        originCountry: normalizeOnezeCountryTag(
          typeof payload.metadata?.originCountry === 'string'
            ? payload.metadata.originCountry
            : null
        ),
        metadata: {
          operationId,
          source: 'wallet_mint',
        },
      });
    }

    const [walletBalanceIze, reserveSnapshot] = await Promise.all([
      getLedgerAccountBalance(client, 'user', actorUserId, 'ize_wallet', 'IZE'),
      getPlatformIzeReserveSnapshot(client),
    ]);

    const responsePayload: Record<string, unknown> = {
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
        fiatCurrency,
        izeAmount,
        ratePerGram: mintUnitPrice,
        rateSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        fundingGatewayId,
      },
      balances: {
        userIze: walletBalanceIze,
        outstandingIze: reserveSnapshot.outstandingIze,
        circulatingIze: reserveSnapshot.circulatingIze,
        supplyDeltaIze: reserveSnapshot.supplyDeltaIze,
        supplyParityRatio: reserveSnapshot.supplyParityRatio,
        liquidityBufferIze: reserveSnapshot.liquidityBufferIze,
      },
      architecture: architectureEnabled
        ? {
            walletId: architectureWalletId,
            walletBalanceMg: architectureWalletBalanceMg,
            walletBalanceOneze:
              architectureWalletBalanceMg === null
                ? null
                : mgToOnezeAmount(architectureWalletBalanceMg),
          }
        : null,
    };

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'mint',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    await client.query('COMMIT');
    reply.code(201);
    return responsePayload;
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
    idempotencyKey: z.string().min(8).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze burn withdrawals are permanently unavailable in closed-loop mode. Use payout requests funded by completed sale proceeds.',
      code: 'ONEZE_BURN_DISABLED',
      details: {
        actorUserId,
        fiatCurrency: payload.fiatCurrency.toUpperCase(),
      },
    };
  }

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

    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
          userId: actorUserId,
          izeAmount: Number(payload.izeAmount.toFixed(6)),
          fiatCurrency: payload.fiatCurrency.toUpperCase(),
          payoutRequestId: payload.payoutRequestId ?? null,
          metadata: payload.metadata ?? {},
        })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'burn',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    if (config.nodeEnv === 'production' && !payload.payoutRequestId) {
      throw createApiError(
        'IZE_WITHDRAWAL_PAYOUT_REQUIRED',
        'A requested/processing/paid payoutRequestId is required to settle a sale-proceeds withdrawal in production'
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

    const fiatCurrency = payload.fiatCurrency.toUpperCase();
    const normalizedIzeAmount = Number(payload.izeAmount.toFixed(6));
    const amountMg = onezeAmountToMg(normalizedIzeAmount);
    const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, fiatCurrency);
    const pricingProfile = await getCountryPricingProfile(client, pricingQuote.countryCode);

    if (!pricingProfile) {
      throw createApiError('PRICING_PROFILE_NOT_FOUND', 'Country pricing profile is unavailable for burn execution', {
        fiatCurrency,
      });
    }

    const redeemCountry = normalizeOnezeCountryTag(
      typeof payload.metadata?.redeemCountry === 'string'
        ? payload.metadata.redeemCountry
        : pricingQuote.countryCode
    );
    const originCountry = normalizeOnezeCountryTag(
      typeof payload.metadata?.originCountry === 'string'
        ? payload.metadata.originCountry
        : redeemCountry
    );
    const isCrossBorder = originCountry !== redeemCountry;
    const redemptionUnitPrice = isCrossBorder
      ? pricingQuote.crossBorderSellPrice
      : pricingQuote.sellPrice;
    const fiatAmount = Number((normalizedIzeAmount * redemptionUnitPrice).toFixed(6));

    const [dailyBurnedIze, weeklyBurnedIze] = await Promise.all([
      getCommittedBurnIzeInWindow(client, actorUserId, 24),
      getCommittedBurnIzeInWindow(client, actorUserId, 7 * 24),
    ]);

    if (dailyBurnedIze + normalizedIzeAmount > pricingProfile.dailyRedeemLimitIze) {
      throw createApiError('DAILY_REDEEM_LIMIT_EXCEEDED', 'Daily redemption cap exceeded for this country profile', {
        dailyRedeemLimitIze: pricingProfile.dailyRedeemLimitIze,
        dailyBurnedIze,
        requestedIze: normalizedIzeAmount,
      });
    }

    if (weeklyBurnedIze + normalizedIzeAmount > pricingProfile.weeklyRedeemLimitIze) {
      throw createApiError('WEEKLY_REDEEM_LIMIT_EXCEEDED', 'Weekly redemption cap exceeded for this country profile', {
        weeklyRedeemLimitIze: pricingProfile.weeklyRedeemLimitIze,
        weeklyBurnedIze,
        requestedIze: normalizedIzeAmount,
      });
    }

    if (payoutAmountCurrency && payoutAmountCurrency !== fiatCurrency) {
      throw createApiError(
        'PAYOUT_REQUEST_CURRENCY_MISMATCH',
        'Payout request currency does not match requested 1ze burn currency',
        {
          payoutRequestId: payload.payoutRequestId,
          payoutAmountCurrency,
          burnCurrency: fiatCurrency,
        }
      );
    }

    if (payoutAmountGbp !== null) {
      let redemptionAmountGbp = fiatAmount;
      if (fiatCurrency !== 'GBP') {
        const gbpFx = await resolveInternalFxRate(client, fiatCurrency, 'GBP');
        redemptionAmountGbp = Number((fiatAmount * gbpFx.rate).toFixed(6));
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

    const architectureEnabled = await onezeArchitectureTablesAvailable(client);
    let architectureWalletId: string | null = null;
    let architectureWalletBalanceMg: number | null = null;
    let segmentDebitResult:
      | {
          purchasedDebitedMg: number;
          earnedDebitedMg: number;
          lockedPurchasedMg: number;
          redeemableMg: number;
          purchasedBalanceMg: number;
          earnedBalanceMg: number;
        }
      | null = null;

    if (architectureEnabled) {
      const wallet = await ensureWallet(client, actorUserId, fiatCurrency);
      segmentDebitResult = await debitWalletSegmentBalance(client, {
        wallet,
        txId: `seg_${createRuntimeId('ize_burn')}`,
        amountMg,
        originCountry,
        lockHours: pricingProfile.withdrawalLockHours,
        metadata: {
          operation: 'burn',
          redeemCountry,
          isCrossBorder,
          payoutRequestId: payload.payoutRequestId ?? null,
        },
      });

      architectureWalletId = wallet.id;
    }

    const operationId = createRuntimeId('ize_burn');
    await recordIzeBurn(client, {
      operationId,
      userId: actorUserId,
      fiatAmount,
      fiatCurrency,
      izeAmount: normalizedIzeAmount,
      ratePerGram: redemptionUnitPrice,
      payoutRequestId: payload.payoutRequestId,
      metadata: {
        ...(payload.metadata ?? {}),
        country: pricingQuote.countryCode,
        originCountry,
        redeemCountry,
        isCrossBorder,
      },
    });

    if (architectureEnabled) {
      const wallet = await ensureWallet(client, actorUserId, fiatCurrency);
      const walletTxId = createRuntimeId('wtx');

      architectureWalletBalanceMg = await applyWalletLedgerDelta(client, {
        walletId: wallet.id,
        txId: walletTxId,
        asset: '1ZE',
        amount: -amountMg,
        kind: 'BURN',
        refType: 'wallet_ize_operation',
        refId: operationId,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          operationId,
          userId: actorUserId,
          payoutRequestId: payload.payoutRequestId ?? null,
          fiatAmount,
          fiatCurrency,
          pricingReferenceSource: `internal_pricing:${pricingQuote.countryCode}:${isCrossBorder ? 'cross_border_sell' : 'sell'}`,
          ...(payload.metadata ?? {}),
        },
      });
    }

    const [walletBalanceIze, reserveSnapshot] = await Promise.all([
      getLedgerAccountBalance(client, 'user', actorUserId, 'ize_wallet', 'IZE'),
      getPlatformIzeReserveSnapshot(client),
    ]);

    const responsePayload: Record<string, unknown> = {
      ok: true,
      operation: {
        id: operationId,
        type: 'burn',
        userId: actorUserId,
        fiatAmount,
        fiatCurrency,
        izeAmount: normalizedIzeAmount,
        ratePerGram: redemptionUnitPrice,
        rateSource: `internal_pricing:${pricingQuote.countryCode}:${isCrossBorder ? 'cross_border_sell' : 'sell'}`,
        country: pricingQuote.countryCode,
        originCountry,
        redeemCountry,
        isCrossBorder,
        payoutGatewayId,
        payoutStatus,
        payoutAmountCurrency,
        payoutAmountGbp,
        dailyRedeemLimitIze: pricingProfile.dailyRedeemLimitIze,
        weeklyRedeemLimitIze: pricingProfile.weeklyRedeemLimitIze,
      },
      balances: {
        userIze: walletBalanceIze,
        outstandingIze: reserveSnapshot.outstandingIze,
        circulatingIze: reserveSnapshot.circulatingIze,
        supplyDeltaIze: reserveSnapshot.supplyDeltaIze,
        supplyParityRatio: reserveSnapshot.supplyParityRatio,
        liquidityBufferIze: reserveSnapshot.liquidityBufferIze,
      },
      architecture: architectureEnabled
        ? {
            walletId: architectureWalletId,
            walletBalanceMg: architectureWalletBalanceMg,
            walletBalanceOneze:
              architectureWalletBalanceMg === null
                ? null
                : mgToOnezeAmount(architectureWalletBalanceMg),
            segmentDebit: segmentDebitResult,
          }
        : null,
    };

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'burn',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    await client.query('COMMIT');
    reply.code(201);
    return responsePayload;
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

app.post('/wallet/1ze/transfer', async (request, reply) => {
  const bodySchema = z.object({
    senderUserId: z.string().min(2).optional(),
    recipientUserId: z.string().min(2),
    izeAmount: z.number().positive(),
    fiatCurrency: z.string().length(3).default('GBP'),
    contextType: z.enum(['marketplace_sale', 'coOwn_trade', 'platform_reward']),
    contextId: z.string().min(2).max(140),
    note: z.string().max(280).optional(),
    idempotencyKey: z.string().min(8).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const senderUserId = resolveAuthenticatedUserId(request, payload.senderUserId);
  const recipientUserId = payload.recipientUserId;

  if (senderUserId === recipientUserId) {
    reply.code(400);
    return {
      ok: false,
      error: 'Sender and recipient must be different users',
    };
  }

  if (
    !(await onezeTablesAvailable(db))
    || !(await onezeP2pTablesAvailable(db))
    || !(await onezeArchitectureTablesAvailable(db))
  ) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze P2P transfer architecture tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await ensureUserExists(senderUserId);
    await ensureUserExists(recipientUserId);

    const normalizedIzeAmount = Number(payload.izeAmount.toFixed(6));
    if (!Number.isFinite(normalizedIzeAmount) || normalizedIzeAmount <= 0) {
      throw createApiError('P2P_TRANSFER_INVALID', 'Unable to derive a valid 1ze amount for transfer');
    }

    const amountMg = onezeAmountToMg(normalizedIzeAmount);

    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
        senderUserId,
        recipientUserId,
        amountMg,
        fiatCurrency: payload.fiatCurrency.toUpperCase(),
        contextType: payload.contextType ?? null,
        contextId: payload.contextId ?? null,
        note: payload.note ?? null,
      })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: senderUserId,
        operation: 'p2p_transfer',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    const fiatCurrency = payload.fiatCurrency.toUpperCase();
    const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, fiatCurrency);
    const fxToGbp = await resolveInternalFxRate(client, fiatCurrency, 'GBP');

    const onezeAmountFromMg = mgToOnezeAmount(amountMg);
    const fiatAmount = Number((onezeAmountFromMg * pricingQuote.buyPrice).toFixed(6));
    const amountGbp = Number((fiatAmount * fxToGbp.rate).toFixed(6));
    const eligibilityAmountGbp = roundTo(amountGbp, 2);

    const policyDecision = await evaluateP2pPolicyEligibility(client, {
      senderUserId,
      recipientUserId,
      amountMg,
      contextType: payload.contextType,
      contextId: payload.contextId,
    });

    const [senderEligibility, recipientEligibility] = await Promise.all([
      evaluateMarketEligibility(client, {
        userId: senderUserId,
        market: 'p2p',
        orderNotionalGbp: eligibilityAmountGbp,
      }),
      evaluateMarketEligibility(client, {
        userId: recipientUserId,
        market: 'p2p',
        orderNotionalGbp: eligibilityAmountGbp,
      }),
    ]);

    if (!senderEligibility.allowed) {
      throw createApiError('P2P_TRANSFER_SENDER_BLOCKED', senderEligibility.message, {
        senderDecision: senderEligibility,
      });
    }

    if (!recipientEligibility.allowed) {
      throw createApiError('P2P_TRANSFER_RECIPIENT_BLOCKED', recipientEligibility.message, {
        recipientDecision: recipientEligibility,
      });
    }

    const transferId = createRuntimeId('ize_transfer');
    const amlAssessment = await evaluateAmlRisk(client, {
      userId: senderUserId,
      market: 'p2p',
      amountGbp: eligibilityAmountGbp,
      counterpartyUserId: recipientUserId,
    });

    let amlAlert: { alertId: string; status: string } | null = null;
    if (amlAssessment.shouldCreateAlert) {
      amlAlert = await createAmlAlert(client, {
        userId: senderUserId,
        relatedUserId: recipientUserId,
        market: 'p2p',
        eventType: 'transfer',
        amountGbp: eligibilityAmountGbp,
        referenceId: transferId,
        ruleCode: 'P2P_TRANSFER',
        notes: payload.note,
        context: {
          senderUserId,
          recipientUserId,
          izeAmount: normalizedIzeAmount,
          fiatAmount,
          fiatCurrency,
          ratePerGram: pricingQuote.buyPrice,
        },
        assessment: amlAssessment,
      });
    }

    if (amlAssessment.shouldBlock) {
      throw createApiError('P2P_TRANSFER_AML_BLOCKED', 'P2P transfer blocked by AML controls', {
        riskScore: amlAssessment.riskScore,
        riskLevel: amlAssessment.riskLevel,
        reasons: amlAssessment.reasons,
        alertId: amlAlert?.alertId ?? null,
      });
    }

    await recordIzeTransfer(client, {
      transferId,
      senderUserId,
      recipientUserId,
      izeAmount: normalizedIzeAmount,
      fiatAmount,
      fiatCurrency,
      ratePerGram: pricingQuote.buyPrice,
      eligibilityCode: 'ALLOWED',
      amlRiskScore: amlAssessment.riskScore,
      amlRiskLevel: amlAssessment.riskLevel,
      amlAlertId: amlAlert?.alertId ?? null,
      senderCountry: policyDecision.senderCountry,
      recipientCountry: policyDecision.recipientCountry,
      travelRulePayload: policyDecision.requiresTravelRule
        ? {
          thresholdMg: config.onezeTravelRuleThresholdMg,
          originator: {
            userId: senderUserId,
            country: policyDecision.senderCountry,
          },
          beneficiary: {
            userId: recipientUserId,
            country: policyDecision.recipientCountry,
          },
          contextType: payload.contextType ?? null,
          contextId: payload.contextId ?? null,
        }
        : {},
      metadata: {
        note: payload.note,
        contextType: payload.contextType ?? null,
        contextId: payload.contextId ?? null,
        amountMg,
        ...(payload.metadata ?? {}),
      },
    });

    const senderWallet = await ensureWallet(client, senderUserId, fiatCurrency);
    const recipientWallet = await ensureWallet(client, recipientUserId, fiatCurrency);
    const walletTxId = createRuntimeId('wtx');

    const [senderBalanceAfterMg, recipientBalanceAfterMg] = await Promise.all([
      applyWalletLedgerDelta(client, {
        walletId: senderWallet.id,
        txId: walletTxId,
        asset: '1ZE',
        amount: -amountMg,
        kind: 'TRANSFER_SEND',
        refType: payload.contextType ?? 'p2p_transfer',
        refId: payload.contextId ?? transferId,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          transferId,
          counterpartyUserId: recipientUserId,
          note: payload.note ?? null,
          pricingSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        },
      }),
      applyWalletLedgerDelta(client, {
        walletId: recipientWallet.id,
        txId: walletTxId,
        asset: '1ZE',
        amount: amountMg,
        kind: 'TRANSFER_RECEIVE',
        refType: payload.contextType ?? 'p2p_transfer',
        refId: payload.contextId ?? transferId,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          transferId,
          counterpartyUserId: senderUserId,
          note: payload.note ?? null,
          pricingSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        },
      }),
    ]);

    await debitWalletSegmentBalance(client, {
      wallet: senderWallet,
      txId: walletTxId,
      amountMg,
      originCountry: policyDecision.senderCountry,
      metadata: {
        operation: 'transfer_send',
        transferId,
        counterpartyUserId: recipientUserId,
      },
    });

    await creditWalletSegmentBalance(client, {
      wallet: recipientWallet,
      txId: walletTxId,
      earnedCreditMg: amountMg,
      originCountry: policyDecision.senderCountry,
      metadata: {
        operation: 'transfer_receive',
        transferId,
        counterpartyUserId: senderUserId,
      },
    });

    const [senderIzeBalance, recipientIzeBalance] = await Promise.all([
      getLedgerAccountBalance(client, 'user', senderUserId, 'ize_wallet', 'IZE'),
      getLedgerAccountBalance(client, 'user', recipientUserId, 'ize_wallet', 'IZE'),
    ]);

    const responsePayload: Record<string, unknown> = {
      ok: true,
      transfer: {
        id: transferId,
        senderUserId,
        recipientUserId,
        amountMg,
        izeAmount: onezeAmountFromMg,
        fiatAmount,
        fiatCurrency,
        amountGbp: eligibilityAmountGbp,
        ratePerGram: pricingQuote.buyPrice,
        rateSource: `internal_pricing:${pricingQuote.countryCode}:buy`,
        fxRateToGbp: fxToGbp.rate,
        fxSourceToGbp: fxToGbp.source,
        senderEligibilityCode: senderEligibility.code,
        recipientEligibilityCode: recipientEligibility.code,
        senderCountry: policyDecision.senderCountry,
        recipientCountry: policyDecision.recipientCountry,
        isCrossBorder: policyDecision.senderCountry !== policyDecision.recipientCountry,
        travelRuleApplied: policyDecision.requiresTravelRule,
        amlRiskScore: amlAssessment.riskScore,
        amlRiskLevel: amlAssessment.riskLevel,
        amlAlertId: amlAlert?.alertId ?? null,
      },
      balances: {
        senderIze: senderIzeBalance,
        recipientIze: recipientIzeBalance,
        senderWalletMg: senderBalanceAfterMg,
        senderWalletOneze: mgToOnezeAmount(senderBalanceAfterMg),
        recipientWalletMg: recipientBalanceAfterMg,
        recipientWalletOneze: mgToOnezeAmount(recipientBalanceAfterMg),
      },
    };

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: senderUserId,
        operation: 'p2p_transfer',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    await client.query('COMMIT');

    await appendComplianceAuditSafe(request, {
      eventType: 'wallet.ize.transfer.committed',
      subjectUserId: senderUserId,
      payload: {
        transferId,
        senderUserId,
        recipientUserId,
        izeAmount: normalizedIzeAmount,
        fiatAmount,
        fiatCurrency,
        amountGbp: eligibilityAmountGbp,
        amountMg,
        senderCountry: policyDecision.senderCountry,
        recipientCountry: policyDecision.recipientCountry,
        contextType: payload.contextType ?? null,
        contextId: payload.contextId ?? null,
        amlRiskScore: amlAssessment.riskScore,
        amlRiskLevel: amlAssessment.riskLevel,
        amlAlertId: amlAlert?.alertId ?? null,
      },
    });

    reply.code(201);
    return responsePayload;
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

    request.log.error({ err: error, senderUserId, recipientUserId }, 'Failed to execute P2P 1ze transfer');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to execute P2P 1ze transfer',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/withdrawals/quote', async (request, reply) => {
  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    amountMg: z.number().int().positive().optional(),
    amountOneze: z.number().positive().optional(),
    targetCurrency: z.string().length(3).default('INR'),
    payoutDestination: z.record(z.unknown()).optional(),
    forceRefresh: z.coerce.boolean().default(false),
    idempotencyKey: z.string().min(8).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze withdrawal quotes are permanently unavailable in closed-loop mode. Withdrawals must be created from completed sale proceeds via payout requests.',
      code: 'ONEZE_WITHDRAWAL_DISABLED',
      details: {
        actorUserId,
      },
    };
  }

  const providedAmountCount = Number(payload.amountMg !== undefined) + Number(payload.amountOneze !== undefined);
  if (providedAmountCount !== 1) {
    reply.code(400);
    return {
      ok: false,
      error: 'Provide exactly one of amountMg or amountOneze',
    };
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  try {
    await assertOnezeMintBurnNotHalted();
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(actorUserId);

    const amountMg = payload.amountMg ?? onezeAmountToMg(Number((payload.amountOneze ?? 0).toFixed(6)));
    if (!Number.isSafeInteger(amountMg) || amountMg <= 0) {
      throw createApiError('WITHDRAWAL_AMOUNT_INVALID', 'Withdrawal amount cannot be represented safely in mg');
    }

    const targetCurrency = payload.targetCurrency.toUpperCase();
    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
          userId: actorUserId,
          amountMg,
          targetCurrency,
          payoutDestination: payload.payoutDestination ?? {},
        })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'withdraw_quote',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    const corridor = await resolvePayoutCorridor(client, targetCurrency);
    if (!corridor || !corridor.enabled) {
      throw createApiError('WITHDRAWAL_CORRIDOR_UNAVAILABLE', 'Target payout corridor is unavailable', {
        targetCurrency,
      });
    }

    const fxRate = await resolveOnezeFiatFxRate(client, targetCurrency, {
      forceRefresh: payload.forceRefresh,
    });

    const amountOneze = mgToOnezeAmount(amountMg);
    const grossMinor = toFiatMinor(amountOneze * fxRate.rate, targetCurrency);
    const spreadMinor = Math.round((grossMinor * Number(corridor.spread_bps)) / 10_000);
    const networkFeeMinor = Number(corridor.network_fee_minor);
    const netMinor = grossMinor - spreadMinor - networkFeeMinor;
    const minAmountMinor = Number(corridor.min_amount_minor);
    const maxAmountMinor = Number(corridor.max_amount_minor);

    if (grossMinor < minAmountMinor || grossMinor > maxAmountMinor) {
      throw createApiError(
        'WITHDRAWAL_AMOUNT_OUT_OF_RANGE',
        'Withdrawal amount is outside corridor limits',
        {
          targetCurrency,
          minAmountMinor,
          maxAmountMinor,
          requestedGrossMinor: grossMinor,
        }
      );
    }

    if (netMinor <= 0) {
      throw createApiError('WITHDRAWAL_NET_AMOUNT_INVALID', 'Withdrawal net payout must be positive', {
        targetCurrency,
        grossMinor,
        spreadMinor,
        networkFeeMinor,
        netMinor,
      });
    }

    const withdrawalId = createRuntimeId('wdq');
    const rateExpiresAt = new Date(Date.now() + config.onezeWithdrawalQuoteTtlSeconds * 1_000).toISOString();
    const withdrawalResult = await client.query<WithdrawalRow>(
      `
        INSERT INTO withdrawals (
          id,
          user_id,
          burn_tx_id,
          amount_mg,
          target_currency,
          gross_minor,
          spread_minor,
          network_fee_minor,
          net_minor,
          rate_locked,
          rate_expires_at,
          rail,
          rail_ref,
          status,
          payout_destination,
          metadata
        )
        VALUES (
          $1,
          $2,
          NULL,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          NULL,
          'QUOTED',
          $12::jsonb,
          $13::jsonb
        )
        RETURNING
          id,
          user_id,
          burn_tx_id,
          amount_mg::text,
          target_currency,
          gross_minor::text,
          spread_minor::text,
          network_fee_minor::text,
          net_minor::text,
          rate_locked::text,
          rate_expires_at::text,
          rail,
          rail_ref,
          status,
          payout_destination,
          metadata,
          created_at::text,
          completed_at::text
      `,
      [
        withdrawalId,
        actorUserId,
        amountMg,
        targetCurrency,
        grossMinor,
        spreadMinor,
        networkFeeMinor,
        netMinor,
        fxRate.rate,
        rateExpiresAt,
        corridor.rail,
        toJsonString(payload.payoutDestination ?? {}),
        toJsonString({
          quoteSource: fxRate.source,
          quoteObservedAt: fxRate.observedAt,
          quoteValidForSeconds: config.onezeWithdrawalQuoteTtlSeconds,
          corridor: {
            currency: targetCurrency,
            rail: corridor.rail,
            spreadBps: corridor.spread_bps,
            settlementSlaHours: corridor.settlement_sla_hours,
          },
          ...(payload.metadata ?? {}),
        }),
      ]
    );

    const withdrawal = toWithdrawalPayload(withdrawalResult.rows[0]);
    const responsePayload: Record<string, unknown> = {
      ok: true,
      withdrawal,
      quote: {
        validForSeconds: config.onezeWithdrawalQuoteTtlSeconds,
        expiresAt: withdrawal.rateExpiresAt,
        source: fxRate.source,
      },
      corridor: {
        currency: targetCurrency,
        rail: corridor.rail,
        spreadBps: corridor.spread_bps,
        networkFeeMinor,
        minAmountMinor,
        maxAmountMinor,
      },
    };

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'withdraw_quote',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    await client.query('COMMIT');
    reply.code(201);
    return responsePayload;
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

    request.log.error({ err: error, userId: actorUserId }, 'Failed to quote 1ze withdrawal');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to quote 1ze withdrawal',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/withdrawals/:withdrawalId/accept', async (request, reply) => {
  const paramsSchema = z.object({
    withdrawalId: z.string().min(3),
  });

  const bodySchema = z.object({
    userId: z.string().min(2).optional(),
    idempotencyKey: z.string().min(8).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { withdrawalId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});
  const actorUserId = resolveAuthenticatedUserId(request, payload.userId);

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze withdrawal accepts are permanently unavailable in closed-loop mode. Withdrawals must be created from completed sale proceeds via payout requests.',
      code: 'ONEZE_WITHDRAWAL_DISABLED',
      details: {
        actorUserId,
        withdrawalId,
      },
    };
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  try {
    await assertOnezeMintBurnNotHalted();
  } catch (error) {
    const apiError = getApiError(error);
    if (apiError) {
      reply.code(statusCodeForApiError(apiError.code));
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    throw error;
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const idempotencyRequestHash = payload.idempotencyKey
      ? hashWalletIdempotencyPayload({
          actorUserId,
          withdrawalId,
        })
      : null;

    if (payload.idempotencyKey && idempotencyRequestHash) {
      const idempotentResponse = await getWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'withdraw_accept',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
      });

      if (idempotentResponse) {
        await client.query('COMMIT');
        return idempotentResponse;
      }
    }

    const withdrawal = await loadWithdrawalById(client, withdrawalId, { forUpdate: true });
    if (!withdrawal) {
      throw createApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal quote not found', { withdrawalId });
    }

    if (request.authUser?.role !== 'admin' && withdrawal.user_id !== actorUserId) {
      throw createApiError('FORBIDDEN_USER_CONTEXT', 'Forbidden: withdrawal does not belong to user context', {
        authUserId: actorUserId,
        withdrawalUserId: withdrawal.user_id,
      });
    }

    if (withdrawal.status === 'RESERVED' || withdrawal.status === 'PAID_OUT') {
      const wallet = await ensureWallet(client, withdrawal.user_id, withdrawal.target_currency);
      const responsePayload: Record<string, unknown> = {
        ok: true,
        alreadyReserved: true,
        withdrawal: toWithdrawalPayload(withdrawal),
        wallet: toWalletPayload(wallet),
      };

      if (payload.idempotencyKey && idempotencyRequestHash) {
        await saveWalletIdempotentResponse(client, {
          userId: actorUserId,
          operation: 'withdraw_accept',
          idempotencyKey: payload.idempotencyKey,
          requestHash: idempotencyRequestHash,
          responsePayload,
        });
      }

      await client.query('COMMIT');
      return responsePayload;
    }

    if (!canTransitionWithdrawalStatus(withdrawal.status, 'RESERVED')) {
      throw createApiError('WITHDRAWAL_STATE_INVALID', 'Withdrawal cannot be reserved from current status', {
        withdrawalId,
        status: withdrawal.status,
      });
    }

    const expiresAtMs = Date.parse(withdrawal.rate_expires_at);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      throw createApiError('WITHDRAWAL_QUOTE_EXPIRED', 'Withdrawal quote has expired', {
        withdrawalId,
        rateExpiresAt: withdrawal.rate_expires_at,
      });
    }

    const amountMg = Number(withdrawal.amount_mg);
    const requiresQueuedExecution = amountMg > config.onezeWithdrawalInstantLimitMg;
    const wallet = await ensureWallet(client, withdrawal.user_id, withdrawal.target_currency);
    const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, withdrawal.target_currency);
    const burnTxId = withdrawal.burn_tx_id ?? createRuntimeId('wdburn');

    const walletBalanceAfterMg = await applyWalletLedgerDelta(client, {
      walletId: wallet.id,
      txId: burnTxId,
      asset: '1ZE',
      amount: -amountMg,
      kind: 'WITHDRAWAL_RESERVED',
      refType: 'withdrawal',
      refId: withdrawal.id,
      anchorValueInInr: pricingQuote.anchorValueInInr,
      metadata: {
        withdrawalId: withdrawal.id,
        actorUserId,
        targetCurrency: withdrawal.target_currency,
        pricingSource: `internal_pricing:${pricingQuote.countryCode}:sell`,
        ...(payload.metadata ?? {}),
      },
    });

    const updatedResult = await client.query<WithdrawalRow>(
      `
        UPDATE withdrawals
        SET
          burn_tx_id = $2,
          status = 'RESERVED',
          metadata = metadata || $3::jsonb
        WHERE id = $1
        RETURNING
          id,
          user_id,
          burn_tx_id,
          amount_mg::text,
          target_currency,
          gross_minor::text,
          spread_minor::text,
          network_fee_minor::text,
          net_minor::text,
          rate_locked::text,
          rate_expires_at::text,
          rail,
          rail_ref,
          status,
          payout_destination,
          metadata,
          created_at::text,
          completed_at::text
      `,
      [
        withdrawal.id,
        burnTxId,
        toJsonString({
          acceptedAt: new Date().toISOString(),
          acceptedBy: actorUserId,
          ...(payload.metadata ?? {}),
        }),
      ]
    );

    const updatedWithdrawal = updatedResult.rows[0];
    const responsePayload: Record<string, unknown> = {
      ok: true,
      withdrawal: toWithdrawalPayload(updatedWithdrawal),
      wallet: {
        walletId: wallet.id,
        onezeBalanceMg: walletBalanceAfterMg,
        onezeBalance: mgToOnezeAmount(walletBalanceAfterMg),
      },
      execution: {
        mode: requiresQueuedExecution ? 'queued' : 'manual',
        queued: requiresQueuedExecution,
        instantLimitMg: config.onezeWithdrawalInstantLimitMg,
      },
    };

    await client.query('COMMIT');

    if (requiresQueuedExecution) {
      try {
        await enqueueOnezeWithdrawalExecuteJob({
          withdrawalId: updatedWithdrawal.id,
          initiatedBy: actorUserId,
          reason: 'threshold_queue',
        });
      } catch (queueError) {
        request.log.error(
          { err: queueError, withdrawalId: updatedWithdrawal.id },
          'Failed to enqueue threshold-based 1ze withdrawal execution'
        );

        const execution = responsePayload.execution as Record<string, unknown>;
        execution.queued = false;
        execution.queueError = 'queue_enqueue_failed';
      }
    }

    if (payload.idempotencyKey && idempotencyRequestHash) {
      await saveWalletIdempotentResponse(client, {
        userId: actorUserId,
        operation: 'withdraw_accept',
        idempotencyKey: payload.idempotencyKey,
        requestHash: idempotencyRequestHash,
        responsePayload,
      });
    }

    return responsePayload;
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

    request.log.error({ err: error, withdrawalId, userId: actorUserId }, 'Failed to accept 1ze withdrawal');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to accept 1ze withdrawal',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/withdrawals/:withdrawalId/execute', async (request, reply) => {
  const paramsSchema = z.object({
    withdrawalId: z.string().min(3),
  });

  const bodySchema = z.object({
    railRef: z.string().min(4).max(180).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const { withdrawalId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze withdrawal execution is permanently unavailable in closed-loop mode. Withdrawals must be created from completed sale proceeds via payout requests.',
      code: 'ONEZE_WITHDRAWAL_DISABLED',
      details: {
        withdrawalId,
        railRef: payload.railRef ?? null,
      },
    };
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const execution = await executeReservedWithdrawal(client, {
      withdrawalId,
      railRef: payload.railRef,
      metadata: {
        ...(payload.metadata ?? {}),
        source: 'admin_execute_endpoint',
      },
    });

    await client.query('COMMIT');

    if (execution.alreadySettled) {
      return {
        ok: true,
        alreadySettled: true,
        withdrawal: execution.withdrawal,
      };
    }

    return {
      ok: true,
      withdrawal: execution.withdrawal,
      settlement: execution.settlement,
      wallet: execution.wallet,
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

    request.log.error({ err: error, withdrawalId }, 'Failed to execute 1ze withdrawal');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to execute 1ze withdrawal',
    };
  } finally {
    client.release();
  }
});

app.post('/wallet/1ze/withdrawals/:withdrawalId/fail', async (request, reply) => {
  const paramsSchema = z.object({
    withdrawalId: z.string().min(3),
  });

  const bodySchema = z.object({
    reason: z.string().min(3).max(280).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    return securityAdminError;
  }

  const { withdrawalId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze withdrawal failure/reversal is permanently unavailable in closed-loop mode. Withdrawals must be created from completed sale proceeds via payout requests.',
      code: 'ONEZE_WITHDRAWAL_DISABLED',
      details: {
        withdrawalId,
        reason: payload.reason ?? null,
      },
    };
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const withdrawal = await loadWithdrawalById(client, withdrawalId, { forUpdate: true });
    if (!withdrawal) {
      throw createApiError('WITHDRAWAL_NOT_FOUND', 'Withdrawal not found', { withdrawalId });
    }

    if (withdrawal.status === 'FAILED' || withdrawal.status === 'REVERSED') {
      await client.query('COMMIT');
      return {
        ok: true,
        alreadyFailed: true,
        withdrawal: toWithdrawalPayload(withdrawal),
      };
    }

    if (!canTransitionWithdrawalStatus(withdrawal.status, 'FAILED')) {
      throw createApiError('WITHDRAWAL_STATE_INVALID', 'Withdrawal cannot be failed from current status', {
        withdrawalId,
        status: withdrawal.status,
      });
    }

    const amountMg = Number(withdrawal.amount_mg);
    let walletInfo: { walletId: string; onezeBalanceMg: number; onezeBalance: number } | null = null;

    if (withdrawal.status === 'RESERVED') {
      const pricingQuote = await resolveCountryPricingQuoteByCurrency(client, withdrawal.target_currency);

      const wallet = await ensureWallet(client, withdrawal.user_id, withdrawal.target_currency);
      const walletBalanceAfterMg = await applyWalletLedgerDelta(client, {
        walletId: wallet.id,
        txId: withdrawal.burn_tx_id ?? createRuntimeId('wdburn'),
        asset: '1ZE',
        amount: amountMg,
        kind: 'WITHDRAWAL_REVERSED',
        refType: 'withdrawal',
        refId: withdrawal.id,
        anchorValueInInr: pricingQuote.anchorValueInInr,
        metadata: {
          withdrawalId,
          reason: payload.reason ?? 'execution_failed',
          pricingSource: `internal_pricing:${pricingQuote.countryCode}:sell`,
          ...(payload.metadata ?? {}),
        },
      });

      walletInfo = {
        walletId: wallet.id,
        onezeBalanceMg: walletBalanceAfterMg,
        onezeBalance: mgToOnezeAmount(walletBalanceAfterMg),
      };
    }

    const updatedResult = await client.query<WithdrawalRow>(
      `
        UPDATE withdrawals
        SET
          status = 'FAILED',
          completed_at = NOW(),
          metadata = metadata || $2::jsonb
        WHERE id = $1
        RETURNING
          id,
          user_id,
          burn_tx_id,
          amount_mg::text,
          target_currency,
          gross_minor::text,
          spread_minor::text,
          network_fee_minor::text,
          net_minor::text,
          rate_locked::text,
          rate_expires_at::text,
          rail,
          rail_ref,
          status,
          payout_destination,
          metadata,
          created_at::text,
          completed_at::text
      `,
      [
        withdrawal.id,
        toJsonString({
          failedAt: new Date().toISOString(),
          reason: payload.reason ?? 'execution_failed',
          ...(payload.metadata ?? {}),
        }),
      ]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      withdrawal: toWithdrawalPayload(updatedResult.rows[0]),
      wallet: walletInfo,
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

    request.log.error({ err: error, withdrawalId }, 'Failed to fail/reverse 1ze withdrawal');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to fail/reverse 1ze withdrawal',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/:userId/withdrawals', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
  });

  const querySchema = z.object({
    status: z
      .enum(['all', 'QUOTED', 'ACCEPTED', 'RESERVED', 'PAID_OUT', 'FAILED', 'REVERSED'])
      .default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { status, limit } = querySchema.parse(request.query);
  resolveAuthenticatedUserId(request, userId);

  if (directOnezeWithdrawalRoutesDisabled()) {
    reply.code(410);
    return {
      ok: false,
      error:
        'Direct 1ze withdrawal history is permanently unavailable in closed-loop mode. Use payout request history for sale-proceeds withdrawals.',
      code: 'ONEZE_WITHDRAWAL_DISABLED',
      details: {
        userId,
        status,
        limit,
      },
    };
  }

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<WithdrawalRow>(
    `
      SELECT
        id,
        user_id,
        burn_tx_id,
        amount_mg::text,
        target_currency,
        gross_minor::text,
        spread_minor::text,
        network_fee_minor::text,
        net_minor::text,
        rate_locked::text,
        rate_expires_at::text,
        rail,
        rail_ref,
        status,
        payout_destination,
        metadata,
        created_at::text,
        completed_at::text
      FROM withdrawals
      WHERE user_id = $1
        AND ($2 = 'all' OR status = $2)
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [userId, status, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => toWithdrawalPayload(row)),
  };
});

app.get('/wallet/1ze/:userId/balance', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
  });

  const querySchema = z.object({
    fiatCurrency: z.string().length(3).optional(),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { fiatCurrency } = querySchema.parse(request.query);
  resolveAuthenticatedUserId(request, userId);

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(userId);

    const wallet = await ensureWallet(client, userId, fiatCurrency?.toUpperCase() ?? DEFAULT_WALLET_FIAT_CURRENCY);
    const [legacyIzeBalance, latestReconciliation] = await Promise.all([
      (await ledgerTablesAvailable(client))
        ? getLedgerAccountBalance(client, 'user', userId, 'ize_wallet', 'IZE')
        : Promise.resolve(0),
      client.query<{
        id: string;
        circulating_mg: string;
        reserve_active_mg: string;
        within_invariant: boolean;
        metadata: Record<string, unknown>;
        created_at: string;
      }>(
        `
          SELECT id, circulating_mg::text, reserve_active_mg::text, within_invariant, metadata, created_at::text
          FROM oneze_reconciliation_snapshots
          ORDER BY created_at DESC
          LIMIT 1
        `
      ),
    ]);

    await client.query('COMMIT');

    const latestSnapshot = latestReconciliation.rows[0];
    const latestSnapshotMetadata = asObject(latestSnapshot?.metadata);
    const computedSupplyDeltaMg =
      latestSnapshot
        ? Number(latestSnapshot.circulating_mg) - Number(latestSnapshot.reserve_active_mg)
        : null;
    return {
      ok: true,
      userId,
      wallet: toWalletPayload(wallet),
      legacyLedgerIzeBalance: legacyIzeBalance,
      reconciliation: latestSnapshot
        ? {
            id: latestSnapshot.id,
            circulatingMg: Number(latestSnapshot.circulating_mg),
            referenceSupplyMg: Number(latestSnapshot.reserve_active_mg),
            supplyDeltaMg:
              asFiniteNumber(latestSnapshotMetadata.supplyDeltaMg)
              ?? computedSupplyDeltaMg,
            toleranceMg: asFiniteNumber(latestSnapshotMetadata.toleranceMg),
            operationalLiquidityMg: asFiniteNumber(latestSnapshotMetadata.operationalLiquidityMg),
            configuredOperationalReserveMg: asFiniteNumber(
              asObject(latestSnapshotMetadata.reservePolicy).configuredOperationalReserveMg
            ),
            reservedWithdrawalMg: asFiniteNumber(
              asObject(latestSnapshotMetadata.reservePolicy).reservedWithdrawalMg
            ),
            configuredReserveRatio: asFiniteNumber(
              asObject(latestSnapshotMetadata.reservePolicy).configuredReserveRatio
            ),
            effectiveReserveRatio: asFiniteNumber(
              asObject(latestSnapshotMetadata.reservePolicy).effectiveReserveRatio
            ),
            withinReservePolicy:
              typeof asObject(latestSnapshotMetadata.reservePolicy).withinPolicy === 'boolean'
                ? (asObject(latestSnapshotMetadata.reservePolicy).withinPolicy as boolean)
                : null,
            withinSupplyTolerance:
              typeof latestSnapshotMetadata.withinSupplyInvariant === 'boolean'
                ? (latestSnapshotMetadata.withinSupplyInvariant as boolean)
                : latestSnapshot.within_invariant,
            withinSupplyInvariant:
              typeof latestSnapshotMetadata.withinSupplyInvariant === 'boolean'
                ? (latestSnapshotMetadata.withinSupplyInvariant as boolean)
                : latestSnapshot.within_invariant,
            reserveActiveMg: Number(latestSnapshot.reserve_active_mg),
            withinInvariant: latestSnapshot.within_invariant,
            createdAt: latestSnapshot.created_at,
          }
        : null,
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

    request.log.error({ err: error, userId }, 'Failed to load 1ze wallet balance');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to load 1ze wallet balance',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/:userId/ledger', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
  });

  const querySchema = z.object({
    asset: z.enum(['ALL', '1ZE', 'FIAT']).default('ALL'),
    limit: z.coerce.number().int().min(1).max(300).default(100),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { asset, limit } = querySchema.parse(request.query);
  resolveAuthenticatedUserId(request, userId);

  if (!(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze wallet architecture tables are unavailable. Run migrations first.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await ensureUserExists(userId);
    const wallet = await ensureWallet(client, userId);

    const result = await client.query<WalletLedgerRow>(
      `
        SELECT
          id,
          wallet_id,
          tx_id,
          asset,
          amount::text,
          balance_after::text,
          kind,
          ref_type,
          ref_id,
            anchor_value_in_inr::text,
          metadata,
          created_at::text
        FROM wallet_ledger
        WHERE wallet_id = $1
          AND ($2 = 'ALL' OR asset = $2)
        ORDER BY id DESC
        LIMIT $3
      `,
      [wallet.id, asset, limit]
    );

    await client.query('COMMIT');
    return {
      ok: true,
      wallet: toWalletPayload(wallet),
      items: result.rows.map((row) => toWalletLedgerPayload(row)),
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

    request.log.error({ err: error, userId }, 'Failed to load 1ze wallet ledger');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to load 1ze wallet ledger',
    };
  } finally {
    client.release();
  }
});

app.get('/wallet/1ze/:userId/transfers', async (request, reply) => {
  const paramsSchema = z.object({
    userId: z.string().min(2),
  });
  const querySchema = z.object({
    direction: z.enum(['all', 'inbound', 'outbound']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { userId } = paramsSchema.parse(request.params);
  const { direction, limit } = querySchema.parse(request.query);
  resolveAuthenticatedUserId(request, userId);

  if (!(await onezeTablesAvailable(db)) || !(await onezeP2pTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze P2P transfer tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<WalletIzeTransferRow>(
    `
      SELECT
        id,
        sender_user_id,
        recipient_user_id,
        ize_amount::text,
        fiat_amount::text,
        fiat_currency,
        rate_per_gram::text,
        status,
        eligibility_code,
        aml_risk_score::text,
        aml_risk_level,
        aml_alert_id,
        metadata,
        created_at::text,
        committed_at::text
      FROM wallet_ize_transfers
      WHERE (
        ($2 = 'all' AND (sender_user_id = $1 OR recipient_user_id = $1))
        OR ($2 = 'outbound' AND sender_user_id = $1)
        OR ($2 = 'inbound' AND recipient_user_id = $1)
      )
      ORDER BY created_at DESC
      LIMIT $3
    `,
    [userId, direction, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => {
      const payload = toWalletIzeTransferPayload(row);
      const transferDirection = payload.senderUserId === userId ? 'outbound' : 'inbound';

      return {
        ...payload,
        direction: transferDirection,
      };
    }),
  };
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

  const [pricingQuote, userIze, reserveSnapshot] = await Promise.all([
    resolveCountryPricingQuoteByCurrency(db, fiatCurrency),
    getLedgerAccountBalance(db, 'user', userId, 'ize_wallet', 'IZE'),
    getPlatformIzeReserveSnapshot(db),
  ]);

  const quote = {
    currency: pricingQuote.currency,
    ratePerGram: pricingQuote.sellPrice,
    source: `internal_pricing:${pricingQuote.countryCode}:sell`,
    fetchedAt: new Date().toISOString(),
    expiresAt: null,
    isFallback: false,
    isOverride: false,
    country: pricingQuote.countryCode,
    model: 'controlled_anchor',
  };

  return {
    ok: true,
    userId,
    rate: quote,
    balances: {
      userIze,
      userFiatValue: Number((userIze * pricingQuote.sellPrice).toFixed(2)),
      outstandingIze: reserveSnapshot.outstandingIze,
      circulatingIze: reserveSnapshot.circulatingIze,
      supplyDeltaIze: reserveSnapshot.supplyDeltaIze,
      supplyParityRatio: reserveSnapshot.supplyParityRatio,
      liquidityBufferIze: reserveSnapshot.liquidityBufferIze,
    },
  };
});

app.post('/wallet/1ze/reconcile', async (request, reply) => {
  const bodySchema = z.object({
    metadata: z.record(z.unknown()).optional(),
  });

  try {
    const operatorToken = request.headers['x-platform-operator-token'] as string | undefined;
    assertOnezeOperatorToken(operatorToken);
  } catch {
    reply.code(401);
    return {
      ok: false,
      error: 'Missing or invalid operator token',
    };
  }

  if (!(await onezeTablesAvailable(db)) || !(await onezeArchitectureTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: '1ze reconciliation tables are unavailable. Run migrations first.',
    };
  }

  const payload = bodySchema.parse(request.body ?? {});
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const snapshot = await captureOnezeReconciliationSnapshot(client, 'operator_manual', {
      source: 'wallet_reconcile_endpoint',
      ...(payload.metadata ?? {}),
    });

    const attestation = await createOnezeReconciliationAttestation(client, {
      attestedBy: 'operator',
      metadata: {
        source: 'wallet_reconcile_endpoint',
        snapshotId: snapshot.id,
        ...(payload.metadata ?? {}),
      },
      thresholdIze: config.onezeSupplyDriftThresholdIze,
    });

    const warnings: string[] = [];
    if (!snapshot.withinSupplyInvariant) {
      warnings.push('supply_invariant_violation');
    }
    if (!snapshot.withinReservePolicy) {
      warnings.push('reserve_policy_violation');
    }

    await client.query('COMMIT');
    return {
      ok: true,
      snapshot,
      attestation,
      warnings,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error }, 'Failed to reconcile 1ze closed-loop supply');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to reconcile 1ze closed-loop supply',
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
    liquidity_buffer_ize: string;
    outstanding_ize: string;
    supply_delta_ize: string;
    within_threshold: boolean;
    attested_by: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  }>(
    `
      SELECT
        id,
        liquidity_buffer_ize::text,
        outstanding_ize::text,
        supply_delta_ize::text,
        within_threshold,
        attested_by,
        metadata,
        created_at::text
      FROM ize_reconciliation_snapshots
      ORDER BY created_at DESC
      LIMIT $1
    `,
    [limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => {
      const metadata = asObject(row.metadata);
      const supplyDeltaIze = asFiniteNumber(metadata.supplyDeltaIze) ?? Number(row.supply_delta_ize);

      return {
        id: row.id,
        liquidityBufferIze: Number(row.liquidity_buffer_ize),
        outstandingIze: Number(row.outstanding_ize),
        supplyDeltaIze,
        driftIze: Number(row.supply_delta_ize),
        withinSupplyTolerance: row.within_threshold,
        withinThreshold: row.within_threshold,
        attestedBy: row.attested_by,
        metadata: row.metadata,
        createdAt: row.created_at,
      };
    }),
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

  const complianceProfile = await getOrCreateComplianceProfile(db, userId);
  const capabilities = resolveCountryCapabilities({
    countryCode: complianceProfile.countryCode,
    residencyCountryCode: complianceProfile.residencyCountryCode,
  });

  if (!isPaymentMethodTypeAllowed(capabilities, payload.type)) {
    reply.code(400);
    return {
      ok: false,
      error: `Payment method type '${payload.type}' is unavailable for this country policy`,
    };
  }

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

app.get('/payments/gateways', async (request) => {
  const querySchema = z.object({
    userId: z.string().min(2).optional(),
    channel: z.enum(['commerce', 'co-own', 'wallet_topup', 'wallet_withdrawal']).optional(),
  });
  const { userId, channel } = querySchema.parse(request.query ?? {});

  let allowedGatewayIds: string[] | null = null;
  if (userId) {
    const actorUserId = resolveAuthenticatedUserId(request, userId);
    await ensureUserExists(actorUserId);

    const complianceProfile = await getOrCreateComplianceProfile(db, actorUserId);
    const capabilities = resolveCountryCapabilities({
      countryCode: complianceProfile.countryCode,
      residencyCountryCode: complianceProfile.residencyCountryCode,
    });

    allowedGatewayIds = getAllowedGatewayIds(capabilities, channel);
  }

  const tableCheck = await db.query<{ exists: boolean }>(
    `SELECT to_regclass('public.payment_gateways') IS NOT NULL AS exists`
  );

  if (!tableCheck.rows[0]?.exists) {
    const fallbackItems = [
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
      {
        id: 'wise_global',
        displayName: 'Wise Global',
        type: 'fiat',
        isActive: true,
      },
    ];

    const filteredFallbackItems = allowedGatewayIds === null
      ? fallbackItems
      : fallbackItems.filter((item) => allowedGatewayIds?.includes(item.id));

    return {
      ok: true,
      items: filteredFallbackItems,
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
        AND ($1::text[] IS NULL OR id = ANY($1))
      ORDER BY id ASC
    `,
    [allowedGatewayIds]
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
        platformOperatingGbp: 0,
        escrowLiabilityGbp: 0,
      },
    };
  }

  const [platformRevenueGbp, platformOperatingGbp, escrowLiabilityGbp] = await Promise.all([
    getLedgerAccountBalance(db, 'platform', 'platform', 'platform_revenue'),
    getLedgerAccountBalance(db, 'platform', 'platform', 'platform_operating'),
    getLedgerAccountBalance(db, 'platform', 'platform', 'escrow_liability'),
  ]);

  return {
    ok: true,
    balances: {
      platformRevenueGbp,
      platformOperatingGbp,
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
    gatewayId: z.string().min(2).max(80).optional(),
    providerAccountRef: z.string().min(3).max(140).optional(),
    countryCode: z.string().min(2).max(3).optional(),
    currency: z.string().length(3).optional(),
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

  const complianceProfile = await getOrCreateComplianceProfile(db, userId);
  const capabilities = resolveCountryCapabilities({
    countryCode: complianceProfile.countryCode,
    residencyCountryCode: complianceProfile.residencyCountryCode,
  });

  const payoutDefaults = resolvePayoutPolicyDefaults(capabilities, {
    gatewayId: payload.gatewayId,
    currency: payload.currency,
    countryCode: payload.countryCode,
    fallbackGatewayId: 'stripe_americas',
  });
  const resolvedCurrency = payoutDefaults.currency;
  const resolvedGatewayId = payoutDefaults.gatewayId;
  const resolvedCountryCode = payoutDefaults.countryCode;

  if (!isPayoutCurrencyAllowed(capabilities, resolvedCurrency)) {
    reply.code(400);
    return {
      ok: false,
      error: `Payout currency '${resolvedCurrency}' is unavailable for this country policy`,
    };
  }

  if (!isPayoutGatewayAllowed(capabilities, resolvedGatewayId)) {
    reply.code(400);
    return {
      ok: false,
      error: `Gateway '${resolvedGatewayId}' is unavailable for this country policy`,
    };
  }

  const gateway = await db.query<{ id: string }>(
    'SELECT id FROM payment_gateways WHERE id = $1 AND is_active = TRUE LIMIT 1',
    [resolvedGatewayId]
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
      resolvedGatewayId,
      providerAccountRef,
      resolvedCountryCode,
      resolvedCurrency,
      payload.status,
      toJsonString({
        ...(payload.metadata ?? {}),
        countryCluster: capabilities.countryCluster,
        capabilityPolicyVersion: capabilities.policyVersion,
      }),
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
    amountCurrency: z.string().length(3).optional(),
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

  const payoutPauseState = await getPayoutPauseState();
  if (payoutPauseState.paused) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payouts temporarily paused for reconciliation review.',
      pause: {
        reason: payoutPauseState.reason ?? null,
        reconciliationRunId: payoutPauseState.reconciliationRunId ?? null,
        mismatchGbp: payoutPauseState.mismatchGbp ?? null,
      },
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
      metadata: Record<string, unknown>;
    }>(
      `
        SELECT id, user_id, gateway_id, status, currency, metadata
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

    const payoutCurrency = (payload.amountCurrency ?? payoutAccountRow.currency).toUpperCase();
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
      if (!(await onezePricingTablesAvailable(client))) {
        await client.query('ROLLBACK');
        reply.code(503);
        return {
          ok: false,
          error: '1ze controlled pricing tables are unavailable for payout currency conversion. Run migrations first.',
        };
      }

      const fx = await resolveInternalFxRate(client, payoutCurrency, 'GBP');
      conversionFxRate = Number(fx.rate.toFixed(8));
      amountGbp = roundTo(requestedAmount * fx.rate, 2);
    }

    if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
      await client.query('ROLLBACK');
      reply.code(400);
      return {
        ok: false,
        error: 'Unable to derive a valid GBP amount for payout request',
      };
    }

    const todayVelocityResult = await client.query<{ total: string }>(
      `
        SELECT COALESCE(SUM(amount_gbp), 0)::text AS total
        FROM payout_requests
        WHERE user_id = $1
          AND created_at::date = CURRENT_DATE
          AND status IN ('requested', 'processing', 'paid')
      `,
      [userId]
    );

    const velocityUsedTodayGbp = Number(todayVelocityResult.rows[0]?.total ?? '0');
    const projectedVelocityGbp = roundTo(velocityUsedTodayGbp + amountGbp, 2);
    if (projectedVelocityGbp > config.dailyPayoutVelocityLimitGbp + 1e-6) {
      await client.query('ROLLBACK');
      reply.code(429);
      return {
        ok: false,
        error: 'Daily payout velocity limit exceeded',
        limits: {
          dailyLimitGbp: config.dailyPayoutVelocityLimitGbp,
          usedTodayGbp: velocityUsedTodayGbp,
          attemptedGbp: amountGbp,
          projectedGbp: projectedVelocityGbp,
        },
      };
    }

    const manualReviewRequired = amountGbp > config.payoutManualReviewThresholdGbp;

    const payoutAccountMetadata = asObject(payoutAccountRow.metadata);
    const accountHolderName =
      (typeof payoutAccountMetadata.accountHolderName === 'string' && payoutAccountMetadata.accountHolderName.trim())
      || (typeof payoutAccountMetadata.account_holder_name === 'string' && payoutAccountMetadata.account_holder_name.trim())
      || (typeof payoutAccountMetadata.beneficiaryName === 'string' && payoutAccountMetadata.beneficiaryName.trim())
      || null;

    let legalName: string | null = null;
    try {
      if (await onezeP2pTablesAvailable(client)) {
        const profileName = await client.query<{ legal_name: string | null }>(
          `
            SELECT legal_name
            FROM user_compliance_profiles
            WHERE user_id = $1
            LIMIT 1
          `,
          [userId]
        );
        legalName = profileName.rows[0]?.legal_name ?? null;
      }
    } catch {
      legalName = null;
    }

    const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nameMismatch = Boolean(
      legalName
      && accountHolderName
      && normalizeName(legalName) !== normalizeName(accountHolderName)
    );

    if (nameMismatch) {
      request.log.warn(
        {
          userId,
          payoutAccountId: payload.payoutAccountId,
          legalName,
          accountHolderName,
        },
        'Payout account holder name mismatch with compliance profile legal name'
      );
    }

    const payoutRequestMetadata = {
      ...(payload.metadata ?? {}),
      amountSource: payload.amountGbp !== undefined ? 'amount_gbp' : 'amount_currency',
      requestedAmount,
      requestedAmountCurrency: payoutCurrency,
      conversionFxRate,
      safeguards: {
        manualReviewRequired,
        nameMismatch,
        dailyVelocityLimitGbp: config.dailyPayoutVelocityLimitGbp,
        usedTodayGbp: velocityUsedTodayGbp,
        projectedTodayGbp: projectedVelocityGbp,
      },
      manualReviewRequired,
      nameMismatch,
      legalNameReference: legalName,
      accountHolderNameReference: accountHolderName,
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
      safeguards: {
        payoutsPaused: false,
        manualReviewRequired,
        nameMismatch,
        payoutManualReviewThresholdGbp: config.payoutManualReviewThresholdGbp,
        dailyVelocityLimitGbp: config.dailyPayoutVelocityLimitGbp,
        usedTodayGbp: velocityUsedTodayGbp,
        projectedTodayGbp: projectedVelocityGbp,
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

    if (!settled.idempotent && settled.payoutRequest.status === 'paid') {
      try {
        await queuePayoutProcessedNotification({
          payoutRequest: settled.payoutRequest,
          source: 'manual_status',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            requestId,
            userId,
          },
          'Failed to queue payout notification after manual status update'
        );
      }
    }

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

    if (apiError?.code === 'PAYOUT_REVIEW_REQUIRED') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    if (apiError?.code === 'PAYOUTS_PAUSED') {
      reply.code(503);
      return {
        ok: false,
        error: apiError.message,
        pause: apiError.details,
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

app.get('/admin/payouts/pending-review', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(100),
  });
  const { limit } = querySchema.parse(request.query);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const result = await db.query<{
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
    gateway_id: string;
  }>(
    `
      SELECT
        pr.id,
        pr.user_id,
        pr.payout_account_id,
        pr.amount_gbp,
        pr.amount_currency,
        pr.status,
        pr.provider_payout_ref,
        pr.failure_reason,
        pr.metadata,
        pr.created_at::text,
        pr.updated_at::text,
        pa.gateway_id
      FROM payout_requests pr
      INNER JOIN payout_accounts pa ON pa.id = pr.payout_account_id
      WHERE pr.status = 'requested'
        AND (
          pr.amount_gbp > $1
          OR pr.metadata @> '{"manualReviewRequired": true}'::jsonb
          OR pr.metadata @> '{"nameMismatch": true}'::jsonb
        )
      ORDER BY pr.created_at ASC
      LIMIT $2
    `,
    [config.payoutManualReviewThresholdGbp, limit]
  );

  return {
    ok: true,
    items: result.rows.map((row) => ({
      ...toPayoutRequestPayload(row),
      gatewayId: row.gateway_id,
      flags: {
        manualReviewRequired: Boolean(asObject(row.metadata).manualReviewRequired),
        nameMismatch: Boolean(asObject(row.metadata).nameMismatch),
      },
    })),
  };
});

app.get('/admin/reconciliation/report', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const [latest, pauseState] = await Promise.all([
    getLatestReconciliationRun(db),
    getPayoutPauseState(),
  ]);
  const clusters = getConfiguredClusters();
  const activeClusters = clusters.filter((cluster) => cluster.configured);

  const client = await db.connect();
  let strandedEscrowCount = 0;
  let lostDisputesCount = 0;
  let parcelEventsAvailable = false;
  let disputesTableAvailable = false;

  try {
    [parcelEventsAvailable, disputesTableAvailable] = await Promise.all([
      orderParcelEventsTableAvailable(client),
      paymentDisputesTableAvailable(client),
    ]);

    const strandedResult = parcelEventsAvailable
      ? await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM orders o
          WHERE o.status IN ('paid', 'shipped')
            AND COALESCE(o.shipped_at, o.updated_at, o.created_at) <= NOW() - INTERVAL '30 days'
            AND NOT EXISTS (
              SELECT 1
              FROM order_parcel_events ope
              WHERE ope.order_id = o.id
                AND ope.event_type IN ('delivered', 'collection_confirmed')
            )
        `
      )
      : await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM orders o
          WHERE o.status IN ('paid', 'shipped')
            AND COALESCE(o.shipped_at, o.updated_at, o.created_at) <= NOW() - INTERVAL '30 days'
        `
      );

    strandedEscrowCount = Number(strandedResult.rows[0]?.count ?? '0');

    if (disputesTableAvailable) {
      const disputesResult = await client.query<{ count: string }>(
        `
          SELECT COUNT(*)::text AS count
          FROM payment_disputes
          WHERE status = 'lost'
        `
      );

      lostDisputesCount = Number(disputesResult.rows[0]?.count ?? '0');
    }
  } finally {
    client.release();
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    latest,
    payouts: {
      paused: pauseState.paused,
      reason: pauseState.reason ?? null,
      reconciliationRunId: pauseState.reconciliationRunId ?? null,
      mismatchGbp: pauseState.mismatchGbp ?? null,
    },
    clusters: {
      active: activeClusters,
      all: clusters,
    },
    operational: {
      strandedEscrow: {
        thresholdDays: 30,
        count: strandedEscrowCount,
        source: parcelEventsAvailable ? 'orders_with_parcel_events' : 'orders_status_age_only',
      },
      disputes: {
        lostCount: lostDisputesCount,
        tableAvailable: disputesTableAvailable,
      },
    },
  };
});

app.post('/admin/payouts/:requestId/review', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const paramsSchema = z.object({
    requestId: z.string().min(4).max(140),
  });
  const bodySchema = z.object({
    status: z.enum(['processing', 'paid', 'failed', 'cancelled']),
    note: z.string().max(400).optional(),
    providerPayoutRef: z.string().min(4).max(140).optional(),
    failureReason: z.string().max(240).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { requestId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const lookup = await db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM payout_requests WHERE id = $1 LIMIT 1',
    [requestId]
  );

  if (!lookup.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payout request not found',
    };
  }

  if ((payload.status === 'processing' || payload.status === 'paid')) {
    const pauseState = await getPayoutPauseState();
    if (pauseState.paused) {
      reply.code(409);
      return {
        ok: false,
        error: 'Payouts are temporarily paused for reconciliation review.',
        pause: {
          reason: pauseState.reason ?? null,
          reconciliationRunId: pauseState.reconciliationRunId ?? null,
          mismatchGbp: pauseState.mismatchGbp ?? null,
        },
      };
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const settled = await settlePayoutRequest(client, {
      userId: lookup.rows[0].user_id,
      requestId,
      targetStatus: payload.status,
      providerPayoutRef: payload.providerPayoutRef,
      failureReason: payload.failureReason,
      metadata: {
        ...(payload.metadata ?? {}),
        review: {
          note: payload.note ?? null,
          reviewedAt: new Date().toISOString(),
          reviewedBy: request.authUser?.userId ?? 'admin_token',
        },
      },
      source: 'admin_review',
    });

    await client.query('COMMIT');

    if (!settled.idempotent && settled.payoutRequest.status === 'paid') {
      try {
        await queuePayoutProcessedNotification({
          payoutRequest: settled.payoutRequest,
          source: 'admin_review',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            requestId,
            userId: lookup.rows[0].user_id,
          },
          'Failed to queue payout notification after admin payout review update'
        );
      }
    }

    return {
      ok: true,
      idempotent: settled.idempotent,
      payoutRequest: settled.payoutRequest,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (
      apiError?.code === 'PAYOUT_INVALID_TRANSITION'
      || apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT'
      || apiError?.code === 'PAYOUT_REVIEW_REQUIRED'
      || apiError?.code === 'PAYOUTS_PAUSED'
    ) {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, requestId }, 'Unable to review payout request');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to review payout request',
    };
  } finally {
    client.release();
  }
});

app.post('/admin/payouts/:requestId/approve', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const paramsSchema = z.object({
    requestId: z.string().min(4).max(140),
  });
  const bodySchema = z.object({
    note: z.string().max(400).optional(),
    providerPayoutRef: z.string().min(4).max(140).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { requestId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const lookup = await db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM payout_requests WHERE id = $1 LIMIT 1',
    [requestId]
  );

  if (!lookup.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payout request not found',
    };
  }

  const pauseState = await getPayoutPauseState();
  if (pauseState.paused) {
    reply.code(409);
    return {
      ok: false,
      error: 'Payouts are temporarily paused for reconciliation review.',
      pause: {
        reason: pauseState.reason ?? null,
        reconciliationRunId: pauseState.reconciliationRunId ?? null,
        mismatchGbp: pauseState.mismatchGbp ?? null,
      },
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const settled = await settlePayoutRequest(client, {
      userId: lookup.rows[0].user_id,
      requestId,
      targetStatus: 'paid',
      providerPayoutRef: payload.providerPayoutRef,
      metadata: {
        ...(payload.metadata ?? {}),
        review: {
          action: 'approve',
          note: payload.note ?? null,
          reviewedAt: new Date().toISOString(),
          reviewedBy: request.authUser?.userId ?? 'admin_token',
        },
      },
      source: 'admin_review',
    });

    await client.query('COMMIT');

    if (!settled.idempotent && settled.payoutRequest.status === 'paid') {
      try {
        await queuePayoutProcessedNotification({
          payoutRequest: settled.payoutRequest,
          source: 'admin_review',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            requestId,
            userId: lookup.rows[0].user_id,
          },
          'Failed to queue payout notification after admin payout approval'
        );
      }
    }

    return {
      ok: true,
      idempotent: settled.idempotent,
      payoutRequest: settled.payoutRequest,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (
      apiError?.code === 'PAYOUT_INVALID_TRANSITION'
      || apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT'
      || apiError?.code === 'PAYOUT_REVIEW_REQUIRED'
      || apiError?.code === 'PAYOUTS_PAUSED'
    ) {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, requestId }, 'Unable to approve payout request');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to approve payout request',
    };
  } finally {
    client.release();
  }
});

app.post('/admin/payouts/:requestId/reject', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const paramsSchema = z.object({
    requestId: z.string().min(4).max(140),
  });
  const bodySchema = z.object({
    reason: z.string().min(2).max(240),
    note: z.string().max(400).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { requestId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  if (!(await paymentTablesAvailable(db))) {
    reply.code(503);
    return {
      ok: false,
      error: 'Payment settlement tables are unavailable. Run migrations first.',
    };
  }

  const lookup = await db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM payout_requests WHERE id = $1 LIMIT 1',
    [requestId]
  );

  if (!lookup.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Payout request not found',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const settled = await settlePayoutRequest(client, {
      userId: lookup.rows[0].user_id,
      requestId,
      targetStatus: 'failed',
      failureReason: payload.reason,
      metadata: {
        ...(payload.metadata ?? {}),
        review: {
          action: 'reject',
          note: payload.note ?? null,
          reason: payload.reason,
          reviewedAt: new Date().toISOString(),
          reviewedBy: request.authUser?.userId ?? 'admin_token',
        },
      },
      source: 'admin_review',
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
    if (
      apiError?.code === 'PAYOUT_INVALID_TRANSITION'
      || apiError?.code === 'PAYOUT_PENDING_INSUFFICIENT'
      || apiError?.code === 'PAYOUT_REVIEW_REQUIRED'
      || apiError?.code === 'PAYOUTS_PAUSED'
    ) {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, requestId }, 'Unable to reject payout request');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to reject payout request',
    };
  } finally {
    client.release();
  }
});

app.post('/admin/orders/:orderId/force-status', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const paramsSchema = z.object({
    orderId: z.string().min(4).max(64),
  });
  const bodySchema = z.object({
    status: z.enum(COMMERCE_ORDER_STATUSES),
    note: z.string().max(400).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  const { orderId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body ?? {});

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string; status: CommerceOrderStatus }>(
      'SELECT id, status FROM orders WHERE id = $1 LIMIT 1 FOR UPDATE',
      [orderId]
    );

    if (!existing.rowCount) {
      await client.query('ROLLBACK');
      reply.code(404);
      return {
        ok: false,
        error: 'Order not found',
      };
    }

    const previousStatus = existing.rows[0].status;
    const updated = await client.query<{
      id: string;
      status: CommerceOrderStatus;
      updated_at: string;
    }>(
      `
        UPDATE orders
        SET
          status = $2,
          shipped_at = CASE
            WHEN $2 = 'shipped' THEN COALESCE(shipped_at, NOW())
            ELSE shipped_at
          END,
          delivered_at = CASE
            WHEN $2 = 'delivered' THEN COALESCE(delivered_at, NOW())
            ELSE delivered_at
          END,
          shipping_metadata = COALESCE(shipping_metadata, '{}'::jsonb) || $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
        RETURNING id, status, updated_at::text
      `,
      [
        orderId,
        payload.status,
        toJsonString({
          forceStatus: {
            previousStatus,
            nextStatus: payload.status,
            note: payload.note ?? null,
            actedBy: request.authUser?.userId ?? 'admin_token',
            actedAt: new Date().toISOString(),
            ...(payload.metadata ?? {}),
          },
        }),
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      id: updated.rows[0].id,
      previousStatus,
      status: updated.rows[0].status,
      forced: previousStatus !== updated.rows[0].status,
      updatedAt: updated.rows[0].updated_at,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    request.log.error({ err: error, orderId }, 'Unable to force order status transition');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to force order status transition',
    };
  } finally {
    client.release();
  }
});

app.get('/admin/orders/stuck', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const querySchema = z.object({
    paidOlderHours: z.coerce.number().int().min(1).max(240).default(24),
    limit: z.coerce.number().int().min(1).max(400).default(200),
  });
  const { paidOlderHours, limit } = querySchema.parse(request.query);

  const client = await db.connect();
  try {
    const parcelEventsAvailable = await orderParcelEventsTableAvailable(client);
    const result = parcelEventsAvailable
      ? await client.query<{
        id: string;
        buyer_id: string;
        seller_id: string;
        listing_id: string;
        status: string;
        total_gbp: number | string;
        tracking_number: string | null;
        created_at: string;
        updated_at: string;
        shipped_at: string | null;
        latest_parcel_event_type: string | null;
        latest_parcel_event_at: string | null;
        age_hours: string;
      }>(
        `
          WITH latest_parcel_event AS (
            SELECT DISTINCT ON (ope.order_id)
              ope.order_id,
              ope.event_type,
              COALESCE(ope.occurred_at, ope.created_at) AS event_at
            FROM order_parcel_events ope
            ORDER BY ope.order_id, COALESCE(ope.occurred_at, ope.created_at) DESC
          )
          SELECT
            o.id,
            o.buyer_id,
            o.seller_id,
            o.listing_id,
            o.status,
            o.total_gbp,
            o.tracking_number,
            o.created_at::text,
            o.updated_at::text,
            o.shipped_at::text,
            lpe.event_type AS latest_parcel_event_type,
            lpe.event_at::text AS latest_parcel_event_at,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(o.shipped_at, o.updated_at))) / 3600 AS age_hours
          FROM orders o
          LEFT JOIN latest_parcel_event lpe ON lpe.order_id = o.id
          WHERE
            (o.status = 'created' AND o.created_at <= NOW() - INTERVAL '2 hours')
            OR (
              o.status = 'paid'
              AND (
                o.updated_at <= NOW() - make_interval(hours => $1::int)
                OR COALESCE(lpe.event_type, '') IN (
                  'picked_up',
                  'in_transit',
                  'out_for_delivery',
                  'delivered',
                  'collection_confirmed'
                )
              )
            )
            OR (
              o.status = 'shipped'
              AND (
                COALESCE(o.shipped_at, o.updated_at) <= NOW() - INTERVAL '7 days'
                OR COALESCE(lpe.event_type, '') IN ('delivered', 'collection_confirmed')
              )
            )
          ORDER BY o.updated_at ASC
          LIMIT $2
        `,
        [paidOlderHours, limit]
      )
      : await client.query<{
        id: string;
        buyer_id: string;
        seller_id: string;
        listing_id: string;
        status: string;
        total_gbp: number | string;
        tracking_number: string | null;
        created_at: string;
        updated_at: string;
        shipped_at: string | null;
        latest_parcel_event_type: string | null;
        latest_parcel_event_at: string | null;
        age_hours: string;
      }>(
        `
          SELECT
            o.id,
            o.buyer_id,
            o.seller_id,
            o.listing_id,
            o.status,
            o.total_gbp,
            o.tracking_number,
            o.created_at::text,
            o.updated_at::text,
            o.shipped_at::text,
            NULL::text AS latest_parcel_event_type,
            NULL::text AS latest_parcel_event_at,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(o.shipped_at, o.updated_at))) / 3600 AS age_hours
          FROM orders o
          WHERE
            (o.status = 'created' AND o.created_at <= NOW() - INTERVAL '2 hours')
            OR (o.status = 'paid' AND o.updated_at <= NOW() - make_interval(hours => $1::int))
            OR (o.status = 'shipped' AND COALESCE(o.shipped_at, o.updated_at) <= NOW() - INTERVAL '7 days')
          ORDER BY o.updated_at ASC
          LIMIT $2
        `,
        [paidOlderHours, limit]
      );

    return {
      ok: true,
      items: result.rows.map((row) => ({
        id: row.id,
        buyerId: row.buyer_id,
        sellerId: row.seller_id,
        listingId: row.listing_id,
        status: row.status,
        totalGbp: Number(row.total_gbp),
        trackingNumber: row.tracking_number,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        shippedAt: row.shipped_at,
        latestParcelEventType: row.latest_parcel_event_type,
        latestParcelEventAt: row.latest_parcel_event_at,
        ageHours: roundTo(Number(row.age_hours), 2),
      })),
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
    coOwnOrderId: z.coerce.number().int().positive().optional(),
    channel: z.enum(['commerce', 'co-own', 'wallet_topup', 'wallet_withdrawal']).optional(),
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

  if (payload.orderId && payload.coOwnOrderId) {
    reply.code(400);
    return {
      ok: false,
      error: 'Provide either orderId or coOwnOrderId, not both',
    };
  }

  if (!payload.orderId && !payload.coOwnOrderId && !payload.channel) {
    reply.code(400);
    return {
      ok: false,
      error: 'A payment intent source is required (orderId, coOwnOrderId, or channel)',
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
          coOwn_order_id,
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

    const actorProfile = await getOrCreateComplianceProfile(client, actorUserId);
    const actorCapabilities = resolveCountryCapabilities({
      countryCode: actorProfile.countryCode,
      residencyCountryCode: actorProfile.residencyCountryCode,
    });
    const defaultGatewayForChannel = (
      intentChannel: PaymentIntentChannel,
      requestedGatewayId?: string
    ): string => resolveChannelGateway(
      actorCapabilities,
      intentChannel,
      requestedGatewayId,
      resolveDefaultGatewayForChannel(intentChannel)
    );

    let channel: PaymentIntentChannel;
    let amountGbp: number;
    let gatewayId = defaultGatewayForChannel('commerce', payload.gatewayId);
    let orderId: string | null = null;
    let coOwnOrderId: number | null = null;

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
      gatewayId = defaultGatewayForChannel(channel, payload.gatewayId);
    } else if (payload.coOwnOrderId) {
      const coOwnOrder = await client.query<{
        id: number;
        user_id: string;
        total_gbp: number | string;
      }>(
        'SELECT id, user_id, total_gbp FROM coOwn_orders WHERE id = $1 LIMIT 1',
        [payload.coOwnOrderId]
      );

      const coOwnOrderRow = coOwnOrder.rows[0];
      if (!coOwnOrderRow) {
        await client.query('ROLLBACK');
        reply.code(404);
        return {
          ok: false,
          error: 'Co-Own order not found',
        };
      }

      if (coOwnOrderRow.user_id !== actorUserId) {
        await client.query('ROLLBACK');
        reply.code(400);
        return {
          ok: false,
          error: 'Co-Own order does not belong to this user',
        };
      }

      channel = 'co-own';
      amountGbp = Number(coOwnOrderRow.total_gbp);
      coOwnOrderId = coOwnOrderRow.id;
      gatewayId = defaultGatewayForChannel(channel, payload.gatewayId);
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
      gatewayId = defaultGatewayForChannel(channel, payload.gatewayId);
    }

    if (!isGatewayAllowedForChannel(actorCapabilities, channel, gatewayId)) {
      await client.query('ROLLBACK');
      reply.code(403);
      return {
        ok: false,
        error: 'Gateway is unavailable in your country policy for this payment channel',
      };
    }

    if (!isGatewayConfigured(gatewayId)) {
      await client.query('ROLLBACK');
      reply.code(503);
      return {
        ok: false,
        error: 'Payment gateway for your region is not yet available. Contact support.',
        gatewayId,
      };
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
        coOwnOrderId,
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
          coOwn_order_id,
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
          coOwn_order_id,
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
        coOwnOrderId,
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
        coOwn_order_id,
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

    if (!settled.alreadyFinal && payload.simulateStatus === 'succeeded' && settled.orderSettlement?.orderId) {
      try {
        await queueCommercePaymentNotifications({
          orderId: settled.orderSettlement.orderId,
          source: 'manual_confirm',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            orderId: settled.orderSettlement.orderId,
          },
          'Failed to queue payment notifications after manual payment confirm'
        );
      }
    }

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
          coOwn_order_id,
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

    if (refundStatus === 'succeeded') {
      try {
        await queueRefundCompletedNotification({
          userId: intent.user_id,
          amountGbp: amount,
          orderId: intent.order_id,
          source: 'manual_refund_request',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            intentId,
            orderId: intent.order_id,
          },
          'Failed to queue refund notifications after manual refund request'
        );
      }
    }

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
  if (config.nodeEnv === 'production') {
    reply.code(404);
    return {
      ok: false,
      error: 'Mock endpoints are disabled in production',
    };
  }

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
  if (config.nodeEnv === 'production') {
    reply.code(404);
    return {
      ok: false,
      error: 'Mock endpoints are disabled in production',
    };
  }

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
            coOwn_order_id,
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
    let settledPayoutIdempotent = false;
    let settledCommerceOrderId: string | null = null;
    let refundCompletedUserId: string | null = null;
    let refundCompletedAmountGbp: number | null = null;
    let refundCompletedOrderId: string | null = null;
    let mintOperation: ReturnType<typeof toMintOperationPayload> | undefined;
    let mintReserveEnqueueOperationId: string | null = null;

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
        settledCommerceOrderId = settled.orderSettlement?.orderId ?? settledCommerceOrderId;
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

      if (intentRow.channel === 'wallet_topup') {
        const mintTransition = await processMintOperationPaymentWebhook(client, {
          paymentIntentId: intentRow.id,
          paymentStatus: event.paymentStatus,
          provider,
          eventType: event.eventType,
          providerEventId: event.providerEventId,
        });

        if (mintTransition.mintOperation) {
          mintOperation = mintTransition.mintOperation;
        }

        if (mintTransition.enqueueReserveAllocation && mintTransition.mintOperation?.id) {
          mintReserveEnqueueOperationId = mintTransition.mintOperation.id;
        }
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

      if (event.refund.status === 'succeeded' && intentRow.order_id && (await ledgerTablesAvailable(client))) {
        await postCommerceOrderRefundLedgerReversal(
          client,
          intentRow.order_id,
          intentRow.user_id,
          Number(intentRow.amount_gbp)
        );
      }

      if (event.refund.status === 'succeeded') {
        refundCompletedUserId = intentRow.user_id;
        refundCompletedOrderId = intentRow.order_id;
        const refundCurrency = (event.refund.currency ?? '').toUpperCase();
        const refundAmount =
          typeof event.refund.amount === 'number'
            ? event.refund.amount
            : Number(intentRow.amount_gbp);
        if (refundCurrency === 'GBP') {
          refundCompletedAmountGbp = roundTo(refundAmount, 2);
        } else {
          refundCompletedAmountGbp = roundTo(Number(intentRow.amount_gbp), 2);
        }
      }
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

      if (event.dispute.status === 'lost' && intentRow?.order_id && (await ledgerTablesAvailable(client))) {
        await postCommerceOrderRefundLedgerReversal(
          client,
          intentRow.order_id,
          intentRow.user_id,
          Number(intentRow.amount_gbp)
        );

        await client.query(
          `
            UPDATE orders
            SET
              shipping_metadata = COALESCE(shipping_metadata, '{}'::jsonb) || $2::jsonb,
              updated_at = NOW()
            WHERE id = $1
          `,
          [
            intentRow.order_id,
            toJsonString({
              paymentDispute: {
                status: 'lost',
                reviewRequired: true,
                provider,
                providerDisputeRef: event.dispute.providerDisputeRef,
                eventType: event.eventType,
                flaggedAt: new Date().toISOString(),
              },
            }),
          ]
        );
      }
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
        settledPayoutIdempotent = payoutSettled.idempotent;
      }
    }

    await client.query('UPDATE payment_webhook_events SET processed_at = NOW() WHERE id = $1', [
      webhookInsert.rows[0].id,
    ]);

    await client.query('COMMIT');

    if (mintReserveEnqueueOperationId) {
      try {
        await enqueueOnezeMintReserveJob({
          mintOperationId: mintReserveEnqueueOperationId,
          initiatedBy: 'provider_webhook',
          reason: 'webhook_confirmed',
        });
      } catch (queueError) {
        request.log.error(
          {
            err: queueError,
            mintOperationId: mintReserveEnqueueOperationId,
          },
          'Failed to enqueue mint reserve allocation after payment webhook confirmation'
        );
      }
    }

    if (settledCommerceOrderId) {
      try {
        await queueCommercePaymentNotifications({
          orderId: settledCommerceOrderId,
          source: 'provider_webhook',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            orderId: settledCommerceOrderId,
          },
          'Failed to queue payment notifications after provider webhook settlement'
        );
      }
    }

    if (settledPayout && settledPayout.status === 'paid' && !settledPayoutIdempotent) {
      try {
        await queuePayoutProcessedNotification({
          payoutRequest: settledPayout,
          source: 'provider_webhook',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            payoutRequestId: settledPayout.id,
          },
          'Failed to queue payout notification after provider webhook settlement'
        );
      }
    }

    if (refundCompletedUserId && refundCompletedAmountGbp !== null) {
      try {
        await queueRefundCompletedNotification({
          userId: refundCompletedUserId,
          amountGbp: refundCompletedAmountGbp,
          orderId: refundCompletedOrderId,
          source: 'provider_webhook',
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            userId: refundCompletedUserId,
            orderId: refundCompletedOrderId,
          },
          'Failed to queue refund notification after provider webhook settlement'
        );
      }
    }

    return {
      ok: true,
      duplicate: false,
      unresolved: !intentRow && !event.payoutRequestId,
      intent: settledIntent,
      mintOperation,
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

app.post('/shipping/serviceability', async (request, reply) => {
  const bodySchema = z.object({
    buyerId: z.string().min(2).optional(),
    fromPostcode: z.string().min(2).max(24).optional(),
    toPostcode: z.string().min(2).max(24).optional(),
    countryCode: z.string().length(2).optional(),
    residencyCountryCode: z.string().length(2).nullable().optional(),
  });

  const payload = bodySchema.parse(request.body);
  const authUser = request.authUser;
  if (!authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  if (payload.buyerId && authUser.role !== 'admin' && authUser.userId !== payload.buyerId) {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: user context mismatch',
    };
  }

  const actorUserId = payload.buyerId ?? authUser.userId;

  let capabilities = resolveCountryCapabilities({
    countryCode: payload.countryCode ?? 'GB',
    residencyCountryCode: payload.residencyCountryCode,
  });

  if (actorUserId) {
    try {
      if (await onezeP2pTablesAvailable(db)) {
        const profile = await getOrCreateComplianceProfile(db, actorUserId);
        capabilities = resolveCountryCapabilities({
          countryCode: profile.countryCode,
          residencyCountryCode: profile.residencyCountryCode,
        });
      }
    } catch {
      // Falls back to countryCode/default policy.
    }
  }

  const carriers = capabilities.postage.carriers.map((carrier) => ({
    id: carrier.id,
    label: carrier.label,
    priceFromGbp: carrier.priceFromGbp,
    etaMinDays: carrier.etaMinDays,
    etaMaxDays: carrier.etaMaxDays,
    tracking: carrier.tracking,
    liveConfigured: isCarrierLiveConfigured(carrier.id),
  }));

  const fromPostcode = payload.fromPostcode ? normalizePostcode(payload.fromPostcode) : null;
  const toPostcode = payload.toPostcode ? normalizePostcode(payload.toPostcode) : null;
  const serviceable = true;

  return {
    ok: true,
    capabilities: {
      countryCluster: capabilities.countryCluster,
      countryCode: capabilities.countryCode,
      effectiveCountryCode: capabilities.effectiveCountryCode,
      policyVersion: capabilities.policyVersion,
    },
    serviceability: {
      fromPostcode,
      toPostcode,
      serviceable,
    },
    carriers,
  };
});

app.post('/shipping/quote', async (request, reply) => {
  const bodySchema = z.object({
    buyerId: z.string().min(2).optional(),
    listingId: z.string().min(2).optional(),
    sellerId: z.string().min(2).optional(),
    addressId: z.coerce.number().int().positive().optional(),
    originPostcode: z.string().min(2).max(24).optional(),
    destinationPostcode: z.string().min(2).max(24).optional(),
    preferredCarrierId: z.string().min(2).max(80).optional(),
    parcelWeightKg: z.number().positive().max(40).optional(),
    declaredValueGbp: z.number().positive().max(20000).optional(),
  });

  const payload = bodySchema.parse(request.body);

  const authUser = request.authUser;
  if (!authUser) {
    reply.code(401);
    return {
      ok: false,
      error: 'Unauthorized',
    };
  }

  if (payload.buyerId && authUser.role !== 'admin' && authUser.userId !== payload.buyerId) {
    reply.code(403);
    return {
      ok: false,
      error: 'Forbidden: user context mismatch',
    };
  }

  const actorUserId = payload.buyerId ?? authUser.userId;

  await ensureUserExists(actorUserId);

  let sellerId = payload.sellerId ?? null;
  if (!sellerId && payload.listingId) {
    const listing = await db.query<{ seller_id: string }>(
      'SELECT seller_id FROM listings WHERE id = $1 LIMIT 1',
      [payload.listingId]
    );
    sellerId = listing.rows[0]?.seller_id ?? null;
  }

  if (!sellerId && !payload.originPostcode) {
    reply.code(400);
    return {
      ok: false,
      error: 'Seller context is required (sellerId, listingId, or originPostcode)',
    };
  }

  let destinationPostcode = payload.destinationPostcode
    ? normalizePostcode(payload.destinationPostcode)
    : null;

  if (!destinationPostcode && payload.addressId) {
    const address = await db.query<{ postcode: string }>(
      'SELECT postcode FROM user_addresses WHERE id = $1 AND user_id = $2 LIMIT 1',
      [payload.addressId, actorUserId]
    );
    destinationPostcode = address.rows[0]?.postcode ? normalizePostcode(address.rows[0].postcode) : null;
  }

  if (!destinationPostcode) {
    destinationPostcode = await resolveUserPrimaryPostcode(db, actorUserId);
    destinationPostcode = destinationPostcode ? normalizePostcode(destinationPostcode) : null;
  }

  let originPostcode = payload.originPostcode
    ? normalizePostcode(payload.originPostcode)
    : null;

  if (!originPostcode && sellerId) {
    const sellerPostcode = await resolveUserPrimaryPostcode(db, sellerId);
    originPostcode = sellerPostcode ? normalizePostcode(sellerPostcode) : null;
  }

  if (!originPostcode || !destinationPostcode) {
    reply.code(422);
    return {
      ok: false,
      error: 'Unable to resolve origin and destination postcodes for shipping quote',
    };
  }

  let capabilities = resolveCountryCapabilities({
    countryCode: 'GB',
  });

  try {
    if (await onezeP2pTablesAvailable(db)) {
      const profile = await getOrCreateComplianceProfile(db, actorUserId);
      capabilities = resolveCountryCapabilities({
        countryCode: profile.countryCode,
        residencyCountryCode: profile.residencyCountryCode,
      });
    }
  } catch {
    // Falls back to GB capability profile.
  }

  const carriers = [...capabilities.postage.carriers];

  if (carriers.length === 0) {
    return {
      ok: true,
      source: 'fallback',
      originPostcode,
      destinationPostcode,
      recommendedQuote: null,
      quotes: [],
      unavailableReason: 'Shipping quote not available for your region',
    };
  }

  if (payload.preferredCarrierId) {
    carriers.sort((left, right) => {
      if (left.id === payload.preferredCarrierId) {
        return -1;
      }
      if (right.id === payload.preferredCarrierId) {
        return 1;
      }
      return 0;
    });
  }

  const quoteResult = await getShippingQuotes({
    preferredCarriers: carriers.slice(0, 5),
    originPostcode,
    destinationPostcode,
    parcelWeightKg: payload.parcelWeightKg,
    declaredValueGbp: payload.declaredValueGbp,
  });

  const quotes = quoteResult.quotes.map((quote) => ({
    carrierId: quote.carrierId,
    label: quote.carrierLabel,
    priceFromGbp: quote.priceGbp,
    etaMinDays: quote.etaMinDays,
    etaMaxDays: quote.etaMaxDays,
    tracking: quote.tracking,
    live: quote.live,
    source: quote.source,
    metadata: quote.metadata,
  }));

  const recommendedQuote = quotes[0] ?? null;

  return {
    ok: true,
    source: quoteResult.source,
    originPostcode,
    destinationPostcode,
    recommendedQuote,
    quotes,
  };
});

const handleShippingWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
  const paramsSchema = z.object({
    carrier: z.string().min(2).max(40),
  });

  const { carrier } = paramsSchema.parse(request.params);

  const rawBody =
    typeof request.rawBody === 'string'
      ? request.rawBody
      : Buffer.isBuffer(request.rawBody)
        ? request.rawBody.toString('utf8')
        : toJsonString(request.body ?? {});

  const verification = await normalizeAndVerifyShippingWebhook(
    carrier,
    request.headers as Record<string, unknown>,
    rawBody,
    request.body
  );

  if (!verification.verified || !verification.event) {
    reply.code(401);
    return {
      ok: false,
      error: verification.reason ?? 'Invalid shipping webhook payload',
    };
  }

  const event = verification.event;

  let orderId = event.orderId;
  if (!orderId && event.trackingNumber) {
    const orderByTracking = await db.query<{ id: string }>(
      `
        SELECT id
        FROM orders
        WHERE tracking_number = $1
        LIMIT 1
      `,
      [event.trackingNumber]
    );
    orderId = orderByTracking.rows[0]?.id ?? null;
  }

  if (!orderId) {
    return {
      ok: true,
      accepted: true,
      unresolved: true,
      reason: 'No order linked to shipping webhook payload',
      event: {
        provider: event.provider,
        providerEventId: event.providerEventId,
        trackingNumber: event.trackingNumber,
      },
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const applied = await applyOrderParcelEvent(client, {
      orderId,
      provider: event.provider,
      eventType: event.eventType,
      providerEventId: event.providerEventId,
      trackingId: event.trackingNumber ?? undefined,
      occurredAt: event.occurredAt,
      payload: {
        ...event.metadata,
        source: 'shipping_webhook',
        carrier: event.provider,
      },
      source: 'shipping_webhook',
    });

    await client.query('COMMIT');

    if (!applied.idempotent) {
      try {
        await queueCommerceParcelSettlementNotifications({
          orderId: applied.order.id,
          buyerId: applied.order.buyerId,
          sellerId: applied.order.sellerId,
          orderStatus: applied.order.status,
          sellerPayableReleasedGbp: applied.settlement.sellerPayableReleasedGbp,
          source: 'shipping_webhook',
          provider: event.provider,
          eventType: event.eventType,
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            orderId: applied.order.id,
            provider: event.provider,
            eventType: event.eventType,
          },
          'Failed to queue parcel settlement notifications from shipping webhook'
        );
      }
    }

    return {
      ok: true,
      accepted: true,
      unresolved: false,
      idempotent: applied.idempotent,
      order: applied.order,
      parcelEvent: applied.parcelEvent,
      settlement: applied.settlement,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'ORDER_NOT_FOUND') {
      reply.code(202);
      return {
        ok: true,
        accepted: true,
        unresolved: true,
        reason: apiError.message,
      };
    }

    if (apiError?.code === 'ORDER_NOT_READY' || apiError?.code === 'ORDER_INVALID_STATE') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'ESCROW_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, carrier, orderId }, 'Unable to process shipping webhook');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to process shipping webhook',
    };
  } finally {
    client.release();
  }
};

app.post('/webhooks/shipping/:carrier', async (request, reply) => handleShippingWebhook(request, reply));
app.post('/shipping/webhooks/:carrier', async (request, reply) => handleShippingWebhook(request, reply));

app.post('/orders', async (request, reply) => {
  const bodySchema = z.object({
    orderId: z.string().min(4).max(64).optional(),
    buyerId: z.string().min(2),
    listingId: z.string().min(2),
    addressId: z.coerce.number().int().positive().optional(),
    paymentMethodId: z.coerce.number().int().positive().optional(),
    platformChargeGbp: z.number().min(0).optional(),
    buyerProtectionFeeGbp: z.number().min(0).optional(),
    postageFeeGbp: z.number().min(0).optional(),
    shippingCarrierId: z.string().min(2).max(80).optional(),
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

  if (await listingsStatusColumnAvailable(db)) {
    const listingStatusResult = await db.query<{ status: string | null }>(
      'SELECT status FROM listings WHERE id = $1 LIMIT 1',
      [payload.listingId]
    );
    const listingStatus = (listingStatusResult.rows[0]?.status ?? '').toLowerCase();
    if (['sold', 'cancelled', 'draft'].includes(listingStatus)) {
      reply.code(409);
      return {
        ok: false,
        error: `Listing cannot be purchased from status '${listingStatus}'`,
      };
    }
  }

  const existingOrderForListing = await db.query<{ id: string }>(
    `
      SELECT id
      FROM orders
      WHERE listing_id = $1
        AND status NOT IN ('cancelled')
      LIMIT 1
    `,
    [payload.listingId]
  );

  if (existingOrderForListing.rowCount) {
    reply.code(409);
    return {
      ok: false,
      error: 'This listing has already been purchased',
    };
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
  const postageFeeGbp = roundTo(Math.max(0, payload.postageFeeGbp ?? 0), 2);
  const totalGbp = roundTo(subtotalGbp + platformChargeGbp + postageFeeGbp, 2);

  const orderId = payload.orderId ?? `ord_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  const insertResult = await db.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    listing_id: string;
    subtotal_gbp: number | string;
    buyer_protection_fee_gbp: number | string;
    postage_fee_gbp: number | string;
    total_gbp: number | string;
    status: string;
    address_id: number | null;
    payment_method_id: number | null;
    shipping_carrier_id: string | null;
    shipping_provider: string | null;
    tracking_number: string | null;
    shipping_label_url: string | null;
    shipping_quote_gbp: number | string | null;
    shipped_at: string | null;
    delivered_at: string | null;
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
        postage_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        shipping_carrier_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'created', $9, $10, $11)
      RETURNING
        id,
        buyer_id,
        seller_id,
        listing_id,
        subtotal_gbp,
        buyer_protection_fee_gbp,
        postage_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        shipping_carrier_id,
        shipping_provider,
        tracking_number,
        shipping_label_url,
        shipping_quote_gbp,
        shipped_at::text,
        delivered_at::text,
        created_at::text,
        updated_at::text
    `,
    [
      orderId,
      payload.buyerId,
      listing.seller_id,
      payload.listingId,
      subtotalGbp,
      platformChargeGbp,
      postageFeeGbp,
      totalGbp,
      payload.addressId ?? null,
      payload.paymentMethodId ?? null,
      payload.shippingCarrierId ?? null,
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
      postageFeeGbp: Number(insertResult.rows[0].postage_fee_gbp),
      totalGbp: Number(insertResult.rows[0].total_gbp),
      status: insertResult.rows[0].status,
      addressId: insertResult.rows[0].address_id,
      paymentMethodId: insertResult.rows[0].payment_method_id,
      shippingCarrierId: insertResult.rows[0].shipping_carrier_id,
      shippingProvider: insertResult.rows[0].shipping_provider,
      trackingNumber: insertResult.rows[0].tracking_number,
      shippingLabelUrl: insertResult.rows[0].shipping_label_url,
      shippingQuoteGbp: insertResult.rows[0].shipping_quote_gbp === null ? null : Number(insertResult.rows[0].shipping_quote_gbp),
      shippedAt: insertResult.rows[0].shipped_at,
      deliveredAt: insertResult.rows[0].delivered_at,
      createdAt: insertResult.rows[0].created_at,
      updatedAt: insertResult.rows[0].updated_at,
    },
  };
});

app.post('/orders/:orderId/pay', async (request, reply) => {
  const securityAdminError = ensureSecurityAdminAccess(request, reply);
  if (securityAdminError) {
    reply.code(403);
    return {
      ok: false,
      error: 'Orders are settled via payment confirmation. Use /payments/intents to initiate payment.',
    };
  }

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
      listing_id: string;
      address_id: number | null;
      subtotal_gbp: number | string;
      buyer_protection_fee_gbp: number | string;
      postage_fee_gbp: number | string;
      total_gbp: number | string;
      shipping_carrier_id: string | null;
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
          listing_id,
          address_id,
          subtotal_gbp,
          buyer_protection_fee_gbp,
          postage_fee_gbp,
          total_gbp,
          shipping_carrier_id
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
        postageFeeGbp: Number(paidRow.postage_fee_gbp),
        totalGbp: Number(paidRow.total_gbp),
      });
    }

    let shipment:
      | {
        provisioned: boolean;
        reason?: string;
        trackingNumber?: string | null;
        shippingProvider?: string | null;
        shippingLabelUrl?: string | null;
        shippingQuoteGbp?: number | null;
      }
      | undefined;

    try {
      const provisionedShipment = await provisionOrderShipmentIfMissing(client, {
        orderId: paidRow.id,
        buyerId: paidRow.buyer_id,
        sellerId: paidRow.seller_id,
        addressId: paidRow.address_id,
        listingId: paidRow.listing_id,
        preferredCarrierId: paidRow.shipping_carrier_id,
        postageFeeGbp: Number(paidRow.postage_fee_gbp),
      });

      shipment = provisionedShipment.provisioned
        ? {
          provisioned: true,
          trackingNumber: provisionedShipment.trackingNumber,
          shippingProvider: provisionedShipment.shippingProvider,
          shippingLabelUrl: provisionedShipment.shippingLabelUrl,
          shippingQuoteGbp: provisionedShipment.quoteGbp,
        }
        : {
          provisioned: false,
          reason: provisionedShipment.reason,
          trackingNumber: provisionedShipment.trackingNumber,
          shippingProvider: provisionedShipment.shippingProvider,
          shippingLabelUrl: provisionedShipment.shippingLabelUrl,
          shippingQuoteGbp: provisionedShipment.quoteGbp,
        };
    } catch (shipmentError) {
      shipment = {
        provisioned: false,
        reason: 'shipment_provision_failed',
      };
      app.log.error(
        {
          err: shipmentError,
          orderId: paidRow.id,
        },
        'Failed to provision shipment for manual order payment'
      );
    }

    await client.query('COMMIT');

    try {
      await queueCommercePaymentNotifications({
        orderId: paidRow.id,
        source: 'admin_manual_order_pay',
      });
    } catch (notificationError) {
      request.log.error(
        {
          err: notificationError,
          orderId: paidRow.id,
        },
        'Failed to queue payment notifications after manual order pay'
      );
    }

    const platformChargeCreditedGbp = Number(paidRow.buyer_protection_fee_gbp);
    const postageFeeCreditedGbp = Number(paidRow.postage_fee_gbp);

    return {
      ok: true,
      id: paidRow.id,
      status: paidRow.status,
      updatedAt: paidRow.updated_at,
      settlement: {
        buyerChargedGbp: Number(paidRow.total_gbp),
        sellerPayableCreditedGbp: 0,
        sellerEscrowHeldGbp: Number(paidRow.subtotal_gbp),
        sellerCashoutEligible: false,
        platformCommissionCreditedGbp: roundTo(platformChargeCreditedGbp + postageFeeCreditedGbp, 2),
        platformChargeCreditedGbp,
        postageFeeCreditedGbp,
        shipment,
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

app.post('/orders/:orderId/parcel/events', async (request, reply) => {
  const securityError = ensureSecurityAdminAccess(request, reply);
  if (securityError) {
    return securityError;
  }

  const paramsSchema = z.object({ orderId: z.string().min(4).max(64) });
  const bodySchema = z.object({
    provider: z.string().min(2).max(80),
    eventType: z.enum(PARCEL_EVENT_TYPES),
    providerEventId: z.string().min(3).max(180).optional(),
    trackingId: z.string().min(3).max(180).optional(),
    occurredAt: z.string().datetime().optional(),
    payload: z.record(z.unknown()).optional(),
  });

  const { orderId } = paramsSchema.parse(request.params);
  const payload = bodySchema.parse(request.body);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const applied = await applyOrderParcelEvent(client, {
      orderId,
      provider: payload.provider,
      eventType: payload.eventType,
      providerEventId: payload.providerEventId,
      trackingId: payload.trackingId,
      occurredAt: payload.occurredAt,
      payload: payload.payload,
      source: 'admin',
    });

    await client.query('COMMIT');

    if (!applied.idempotent) {
      try {
        await queueCommerceParcelSettlementNotifications({
          orderId: applied.order.id,
          buyerId: applied.order.buyerId,
          sellerId: applied.order.sellerId,
          orderStatus: applied.order.status,
          sellerPayableReleasedGbp: applied.settlement.sellerPayableReleasedGbp,
          source: 'admin_parcel_event',
          provider: payload.provider,
          eventType: payload.eventType,
        });
      } catch (notificationError) {
        request.log.error(
          {
            err: notificationError,
            orderId: applied.order.id,
            provider: payload.provider,
            eventType: payload.eventType,
          },
          'Failed to queue parcel settlement notifications from admin parcel event'
        );
      }
    }

    return {
      ok: true,
      idempotent: applied.idempotent,
      parcelEvent: applied.parcelEvent,
      order: applied.order,
      settlement: applied.settlement,
    };
  } catch (error) {
    await client.query('ROLLBACK');

    const apiError = getApiError(error);
    if (apiError?.code === 'ORDER_NOT_FOUND') {
      reply.code(404);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'ORDER_NOT_READY' || apiError?.code === 'ORDER_INVALID_STATE') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
      };
    }

    if (apiError?.code === 'ESCROW_INSUFFICIENT') {
      reply.code(409);
      return {
        ok: false,
        error: apiError.message,
        details: apiError.details,
      };
    }

    request.log.error({ err: error, orderId }, 'Unable to process parcel event for order');
    reply.code(500);
    return {
      ok: false,
      error: 'Unable to process parcel event for order',
    };
  } finally {
    client.release();
  }
});

app.get('/orders/:orderId/parcel/events', async (request, reply) => {
  const paramsSchema = z.object({ orderId: z.string().min(4).max(64) });
  const { orderId } = paramsSchema.parse(request.params);

  const orderResult = await db.query<{
    id: string;
    status: string;
    tracking_number: string | null;
    shipping_provider: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
  }>(
    `
      SELECT
        id,
        status,
        tracking_number,
        shipping_provider,
        shipped_at::text,
        delivered_at::text
      FROM orders
      WHERE id = $1
      LIMIT 1
    `,
    [orderId]
  );

  if (!orderResult.rowCount) {
    reply.code(404);
    return {
      ok: false,
      error: 'Order not found',
    };
  }

  const order = orderResult.rows[0];
  const parcelEventsAvailable = await orderParcelEventsTableAvailable(db);

  if (!parcelEventsAvailable) {
    return {
      ok: true,
      source: 'orders_status_only',
      order: {
        id: order.id,
        status: order.status,
        trackingNumber: order.tracking_number,
        shippingProvider: order.shipping_provider,
        shippedAt: order.shipped_at,
        deliveredAt: order.delivered_at,
      },
      items: [],
    };
  }

  const eventsResult = await db.query<{
    id: number;
    provider: string;
    event_type: ParcelEventType;
    provider_event_id: string | null;
    tracking_id: string | null;
    occurred_at: string | null;
    received_at: string;
    payload: Record<string, unknown>;
  }>(
    `
      SELECT
        id,
        provider,
        event_type,
        provider_event_id,
        tracking_id,
        occurred_at::text,
        received_at::text,
        payload
      FROM order_parcel_events
      WHERE order_id = $1
      ORDER BY COALESCE(occurred_at, received_at) ASC, id ASC
    `,
    [orderId]
  );

  return {
    ok: true,
    source: 'orders_with_parcel_events',
    order: {
      id: order.id,
      status: order.status,
      trackingNumber: order.tracking_number,
      shippingProvider: order.shipping_provider,
      shippedAt: order.shipped_at,
      deliveredAt: order.delivered_at,
    },
    items: eventsResult.rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      eventType: row.event_type,
      providerEventId: row.provider_event_id,
      trackingId: row.tracking_id,
      occurredAt: row.occurred_at,
      receivedAt: row.received_at,
      payload: row.payload,
    })),
  };
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
      WHERE le.source_type IN ('order_payment', 'order_delivery')
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
    postage_fee_gbp: number | string;
    total_gbp: number | string;
    status: string;
    address_id: number | null;
    payment_method_id: number | null;
    shipping_carrier_id: string | null;
    shipping_provider: string | null;
    tracking_number: string | null;
    shipping_label_url: string | null;
    shipping_quote_gbp: number | string | null;
    shipped_at: string | null;
    delivered_at: string | null;
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
        postage_fee_gbp,
        total_gbp,
        status,
        address_id,
        payment_method_id,
        shipping_carrier_id,
        shipping_provider,
        tracking_number,
        shipping_label_url,
        shipping_quote_gbp,
        shipped_at::text,
        delivered_at::text,
        created_at::text,
        updated_at::text
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
      postageFeeGbp: Number(row.postage_fee_gbp),
      totalGbp: Number(row.total_gbp),
      status: row.status,
      addressId: row.address_id,
      paymentMethodId: row.payment_method_id,
      shippingCarrierId: row.shipping_carrier_id,
      shippingProvider: row.shipping_provider,
      trackingNumber: row.tracking_number,
      shippingLabelUrl: row.shipping_label_url,
      shippingQuoteGbp: row.shipping_quote_gbp === null ? null : Number(row.shipping_quote_gbp),
      shippedAt: row.shipped_at,
      deliveredAt: row.delivered_at,
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
    postage_fee_gbp: number | string;
    total_gbp: number | string;
    tracking_number: string | null;
    shipping_provider: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
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
        o.postage_fee_gbp,
        o.total_gbp,
        o.tracking_number,
        o.shipping_provider,
        o.shipped_at::text,
        o.delivered_at::text,
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
      postageFeeGbp: Number(row.postage_fee_gbp),
      totalGbp: Number(row.total_gbp),
      trackingNumber: row.tracking_number,
      shippingProvider: row.shipping_provider,
      shippedAt: row.shipped_at,
      deliveredAt: row.delivered_at,
      createdAt: row.created_at,
    })),
  };
});

app.get('/users/:userId/market-history', async (request, reply) => {
  const paramsSchema = z.object({ userId: z.string().min(2) });
  const querySchema = z.object({
    channel: z.enum(['all', 'auction', 'co-own']).default('all'),
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
    channel: 'auction' | 'co-own';
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
          ('coOwn_order_' || so.id::text) AS entry_id,
          'co-own'::text AS channel,
          CASE WHEN so.side = 'buy' THEN 'buy-units' ELSE 'sell-units' END AS action,
          so.asset_id AS reference_id,
          so.total_gbp AS amount_gbp,
          so.units AS units,
          so.unit_price_gbp AS unit_price_gbp,
          so.fee_gbp AS fee_gbp,
          so.status::text AS status,
          sa.title AS note,
          so.created_at AS timestamp
        FROM coOwn_orders so
        INNER JOIN coOwn_assets sa ON sa.id = so.asset_id
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
    sellerId: z.string().min(2).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });
  const { status, sellerId, limit } = querySchema.parse(request.query);

  const whereConditions: string[] = [];
  const whereParams: Array<string | number> = [];

  if (sellerId) {
    whereParams.push(sellerId);
    whereConditions.push(`a.seller_id = $${whereParams.length}`);
  }

  whereParams.push(limit);
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  const limitPlaceholder = `$${whereParams.length}`;

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
      ${whereClause}
      ORDER BY a.starts_at DESC
      LIMIT ${limitPlaceholder}
    `,
    whereParams
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

app.get('/co-own/assets', async (request) => {
  const querySchema = z.object({
    openOnly: z.union([z.string(), z.boolean()]).optional(),
    issuerId: z.string().min(2).max(128).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(80),
  });
  const parsedQuery = querySchema.parse(request.query);
  const openOnly = parseQueryBoolean(parsedQuery.openOnly, false);
  const { limit, issuerId } = parsedQuery;

  const whereConditions: string[] = [];
  const whereParams: Array<string | number> = [];

  if (openOnly) {
    whereConditions.push('sa.is_open = TRUE');
  }

  if (issuerId) {
    whereParams.push(issuerId);
    whereConditions.push(`sa.issuer_id = $${whereParams.length}`);
  }

  whereParams.push(limit);
  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
  const limitPlaceholder = `$${whereParams.length}`;

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
      FROM coOwn_assets sa
      ${whereClause}
      ORDER BY sa.volume_24h_gbp DESC, sa.created_at DESC
      LIMIT ${limitPlaceholder}
    `,
    whereParams
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

app.post('/co-own/assets', async (request, reply) => {
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
      INSERT INTO coOwn_assets (
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

type CoOwnOrderStatus = 'open' | 'partially_filled' | 'filled' | 'cancelled' | 'rejected';
type CoOwnOrderType = 'market' | 'limit';

interface CoOwnHoldingRow {
  user_id: string;
  asset_id: string;
  units_owned: number;
  avg_entry_price_gbp: number | string;
  realized_pnl_gbp: number | string;
}

async function getCoOwnHoldingForUpdate(
  client: PoolClient,
  userId: string,
  assetId: string
): Promise<CoOwnHoldingRow | null> {
  const result = await client.query<CoOwnHoldingRow>(
    `
      SELECT
        user_id,
        asset_id,
        units_owned,
        avg_entry_price_gbp,
        realized_pnl_gbp
      FROM coOwn_holdings
      WHERE user_id = $1
        AND asset_id = $2
      LIMIT 1
      FOR UPDATE
    `,
    [userId, assetId]
  );

  return result.rows[0] ?? null;
}

async function saveCoOwnHolding(
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
      INSERT INTO coOwn_holdings (
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

async function applyCoOwnTransfer(
  client: PoolClient,
  input: {
    assetId: string;
    buyerId: string;
    sellerId: string;
    units: number;
    unitPriceGbp: number;
    feeGbp: number;
    sourceType: 'coOwn_trade' | 'buyout';
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

  const buyerHolding = await getCoOwnHoldingForUpdate(client, input.buyerId, input.assetId);
  const sellerHolding = await getCoOwnHoldingForUpdate(client, input.sellerId, input.assetId);

  if (input.enforceSellerHolding) {
    const sellerUnits = sellerHolding?.units_owned ?? 0;
    if (sellerUnits < units) {
      throw createApiError('CO_OWN_SELLER_UNITS_INSUFFICIENT', 'Seller does not have enough units', {
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

  await saveCoOwnHolding(client, {
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

    await saveCoOwnHolding(client, {
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
      INSERT INTO coOwn_trades (
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

async function recalcCoOwnHolders(client: PoolClient, assetId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM coOwn_holdings
      WHERE asset_id = $1
        AND units_owned > 0
    `,
    [assetId]
  );

  return Number(result.rows[0]?.count ?? '0');
}

app.get('/co-own/assets/:assetId/orders', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    status: z.enum(['open', 'partially_filled', 'filled', 'cancelled', 'rejected']).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(60),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { status, limit } = querySchema.parse(request.query);

  const assetExists = await db.query('SELECT id FROM coOwn_assets WHERE id = $1 LIMIT 1', [assetId]);
  if (!assetExists.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Co-Own asset not found' };
  }

  const result = await db.query<{
    id: number;
    asset_id: string;
    user_id: string;
    side: 'buy' | 'sell';
    order_type: CoOwnOrderType;
    limit_price_gbp: number | string | null;
    units: number;
    remaining_units: number;
    filled_units: number;
    unit_price_gbp: number | string;
    fee_gbp: number | string;
    total_gbp: number | string;
    status: CoOwnOrderStatus;
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
      FROM coOwn_orders
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

app.get('/co-own/assets/:assetId/orderbook', async (request, reply) => {
  const paramsSchema = z.object({ assetId: z.string().min(2) });
  const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(40),
  });

  const { assetId } = paramsSchema.parse(request.params);
  const { limit } = querySchema.parse(request.query);

  const assetExists = await db.query('SELECT id FROM coOwn_assets WHERE id = $1 LIMIT 1', [assetId]);
  if (!assetExists.rowCount) {
    reply.code(404);
    return { ok: false, error: 'Co-Own asset not found' };
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
      FROM coOwn_orders
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

app.get('/co-own/assets/:assetId/holdings', async (request, reply) => {
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
      FROM coOwn_holdings
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

app.post('/co-own/assets/:assetId/orders', async (request, reply) => {
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
        FROM coOwn_assets
        WHERE id = $1
        FOR UPDATE
      `,
      [assetId]
    );

    const asset = assetResult.rows[0];
    if (!asset) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { ok: false, error: 'Co-Own asset not found' };
    }

    if (!asset.is_open) {
      await client.query('ROLLBACK');
      reply.code(409);
      return { ok: false, error: 'Co-Own asset is closed for trading' };
    }

    const referencePriceGbp = Number(asset.unit_price_gbp);
    const proposedUnitPrice =
      payload.orderType === 'limit'
        ? roundTo(payload.limitPriceGbp ?? referencePriceGbp, 4)
        : referencePriceGbp;
    const proposedNotionalGbp = roundTo(Math.max(0, payload.units) * proposedUnitPrice, 2);

    const eligibility = await evaluateMarketEligibility(client, {
      userId: payload.userId,
      market: 'co-own',
      orderNotionalGbp: proposedNotionalGbp,
    });

    if (!eligibility.allowed) {
      await client.query('ROLLBACK');

      await appendComplianceAuditSafe(request, {
        eventType: 'co-own.order.blocked.eligibility',
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
      market: 'co-own',
      amountGbp: proposedNotionalGbp,
      counterpartyUserId: asset.issuer_id,
    });

    if (preTradeAml.shouldBlock) {
      await client.query('ROLLBACK');

      if (preTradeAml.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.userId,
          relatedUserId: asset.issuer_id,
          market: 'co-own',
          eventType: 'trade',
          amountGbp: proposedNotionalGbp,
          referenceId: `${assetId}:pretrade`,
          ruleCode: 'AML_PRE_TRADE_BLOCK',
          notes: 'Co-Own order blocked by AML pre-trade evaluation',
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
        eventType: 'co-own.order.blocked.aml',
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
      const sellerHolding = await getCoOwnHoldingForUpdate(client, payload.userId, assetId);
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
        INSERT INTO coOwn_orders (
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
        FROM coOwn_orders
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
      const tradeFee = roundTo(tradeNotional * CO_OWN_TRADE_FEE_RATE, 4);

      if (payload.side === 'buy') {
        await applyCoOwnTransfer(client, {
          assetId,
          buyerId: payload.userId,
          sellerId: resting.user_id,
          units: fillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'coOwn_trade',
          buyOrderId: incomingOrderId,
          sellOrderId: resting.id,
          enforceSellerHolding: true,
        });
      } else {
        await applyCoOwnTransfer(client, {
          assetId,
          buyerId: resting.user_id,
          sellerId: payload.userId,
          units: fillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'coOwn_trade',
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
      const restingStatus: CoOwnOrderStatus =
        restingRemainingAfter <= 0 ? 'filled' : 'partially_filled';
      const restingTradeNet =
        resting.side === 'buy'
          ? roundTo(tradeNotional + tradeFee, 4)
          : roundTo(Math.max(0, tradeNotional - tradeFee), 4);
      const restingTotalAfter = roundTo(Number(resting.total_gbp) + restingTradeNet, 4);
      const restingFeeAfter = roundTo(Number(resting.fee_gbp) + tradeFee, 4);

      await client.query(
        `
          UPDATE coOwn_orders
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
        const tradeFee = roundTo(tradeNotional * CO_OWN_TRADE_FEE_RATE, 4);

        await applyCoOwnTransfer(client, {
          assetId,
          buyerId: payload.userId,
          sellerId: asset.issuer_id,
          units: primaryFillUnits,
          unitPriceGbp: tradePrice,
          feeGbp: tradeFee,
          sourceType: 'coOwn_trade',
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

    let orderStatus: CoOwnOrderStatus;
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
      status: CoOwnOrderStatus;
      remaining_units: number;
      filled_units: number;
    }>(
      `
        UPDATE coOwn_orders
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
    const nextHolders = await recalcCoOwnHolders(client, assetId);

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
        UPDATE coOwn_assets
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
        market: 'co-own',
        eventType: 'trade',
        amountGbp: monitoredAmount,
        referenceId: String(incomingOrder.rows[0].id),
        ruleCode: 'AML_POST_TRADE_MONITOR',
        notes: 'Co-Own order generated elevated AML risk score',
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
      eventType: 'co-own.order.created',
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
    if (apiError?.code === 'CO_OWN_SELLER_UNITS_INSUFFICIENT') {
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
      error: `Unable to place co-own order: ${(error as Error).message}`,
    };
  } finally {
    client.release();
  }
});

app.get('/co-own/assets/:assetId/buyout-offers', async (request, reply) => {
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
      FROM coOwn_buyout_offers
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

app.post('/co-own/assets/:assetId/buyout-offers', async (request, reply) => {
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
        FROM coOwn_assets
        WHERE id = $1
        FOR UPDATE
      `,
      [assetId]
    );

    const asset = assetResult.rows[0];
    if (!asset) {
      await client.query('ROLLBACK');
      reply.code(404);
      return { ok: false, error: 'Co-Own asset not found' };
    }

    if (!asset.is_open) {
      await client.query('ROLLBACK');
      reply.code(409);
      return { ok: false, error: 'Co-Own asset is closed for buyout offers' };
    }

    const bidderHolding = await getCoOwnHoldingForUpdate(client, payload.bidderUserId, assetId);
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
      market: 'co-own',
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
      market: 'co-own',
      amountGbp: offerNotionalGbp,
    });

    if (amlAssessment.shouldBlock) {
      await client.query('ROLLBACK');

      if (amlAssessment.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.bidderUserId,
          market: 'co-own',
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
        INSERT INTO coOwn_buyout_offers (
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
        market: 'co-own',
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
      topic: `co-own.asset:${assetId}`,
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

app.post('/co-own/buyout-offers/:offerId/accept', async (request, reply) => {
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
        FROM coOwn_buyout_offers bo
        INNER JOIN coOwn_assets sa ON sa.id = bo.asset_id
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
          UPDATE coOwn_buyout_offers
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
      market: 'co-own',
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
      market: 'co-own',
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
      market: 'co-own',
      amountGbp: acceptanceNotionalGbp,
      counterpartyUserId: offer.bidder_user_id,
    });

    if (amlAssessment.shouldBlock) {
      await client.query('ROLLBACK');

      if (amlAssessment.shouldCreateAlert) {
        amlAlert = await createAmlAlert(db, {
          userId: payload.holderUserId,
          relatedUserId: offer.bidder_user_id,
          market: 'co-own',
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

    await applyCoOwnTransfer(client, {
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
        INSERT INTO coOwn_buyout_acceptances (
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
            metadata = coOwn_buyout_acceptances.metadata || EXCLUDED.metadata
      `,
      [offerId, payload.holderUserId, acceptedUnits, toJsonString(payload.metadata ?? {})]
    );

    const nextAcceptedUnits = offer.accepted_units + acceptedUnits;
    const nextStatus = nextAcceptedUnits >= offer.target_units ? 'settled' : 'accepted';

    await client.query(
      `
        UPDATE coOwn_buyout_offers
        SET
          accepted_units = $2,
          status = $3,
          updated_at = NOW()
        WHERE id = $1
      `,
      [offerId, nextAcceptedUnits, nextStatus]
    );

    const bidderHolding = await getCoOwnHoldingForUpdate(client, offer.bidder_user_id, offer.asset_id);
    const bidderUnits = bidderHolding?.units_owned ?? 0;
    if (nextStatus === 'settled' && bidderUnits >= offer.total_units) {
      await client.query(
        `
          UPDATE coOwn_assets
          SET is_open = FALSE, updated_at = NOW()
          WHERE id = $1
        `,
        [offer.asset_id]
      );
    }

    const nextHolders = await recalcCoOwnHolders(client, offer.asset_id);
    await client.query(
      `
        UPDATE coOwn_assets
        SET holders = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [offer.asset_id, nextHolders]
    );

    if (amlAssessment.shouldCreateAlert) {
      amlAlert = await createAmlAlert(client, {
        userId: payload.holderUserId,
        relatedUserId: offer.bidder_user_id,
        market: 'co-own',
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
      topic: `co-own.asset:${offer.asset_id}`,
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
    if (apiError?.code === 'CO_OWN_SELLER_UNITS_INSUFFICIENT') {
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
      handleReconciliationJob: async ({ reason, runDate }) => {
        await runPlatformReconciliation(reason, runDate);
      },
      handleOnezeMintReserveJob: async ({ mintOperationId, initiatedBy, reason }) => {
        await processQueuedOnezeMintReserveAllocation({
          mintOperationId,
          initiatedBy,
          reason,
        });
      },
      handleOnezeWithdrawalExecuteJob: async ({ withdrawalId, initiatedBy, reason }) => {
        await processQueuedOnezeWithdrawalExecution({
          withdrawalId,
          initiatedBy,
          reason,
        });
      },
    });

    startAuctionSweepScheduler();
    startPlatformReconciliationScheduler();
    startPlatformRevenueSweepScheduler();
    startOpsAlertingScheduler();
    startOnezeReconciliationScheduler();
    startOnezeDailyAttestationScheduler();
    startOnezeFxSyncScheduler();
    startOnezeAutoAdjustScheduler();

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
  stopPlatformReconciliationScheduler();
  stopPlatformRevenueSweepScheduler();
  stopOpsAlertingScheduler();
  stopOnezeReconciliationScheduler();
  stopOnezeDailyAttestationScheduler();
  stopOnezeFxSyncScheduler();
  stopOnezeAutoAdjustScheduler();

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
