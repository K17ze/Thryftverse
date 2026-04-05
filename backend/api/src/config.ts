import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === 'true';
}

function asNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function requiredSecret(name: string, developmentFallback: string): string {
  const raw = process.env[name]?.trim();
  if (raw) {
    return raw;
  }

  if (nodeEnv !== 'production') {
    return developmentFallback;
  }

  throw new Error(`Missing required secret environment variable: ${name}`);
}

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? '4000'),
  databaseUrl: required('DATABASE_URL'),
  databaseReplicaUrl: process.env.DATABASE_REPLICA_URL?.trim() || undefined,
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),
  keyServiceUrl: required('KEY_SERVICE_URL', 'http://localhost:4100'),
  keyServiceClientToken: requiredSecret('KEY_SERVICE_CLIENT_TOKEN', 'local-key-client-token'),
  keyServiceAdminToken: requiredSecret('KEY_SERVICE_ADMIN_TOKEN', 'local-key-admin-token'),
  s3Endpoint: required('S3_ENDPOINT', 'http://localhost:9000'),
  s3PublicEndpoint: required('S3_PUBLIC_ENDPOINT', process.env.S3_ENDPOINT ?? 'http://localhost:9000'),
  s3Region: required('S3_REGION', 'us-east-1'),
  s3AccessKey: required('S3_ACCESS_KEY', 'minioadmin'),
  s3SecretKey: required('S3_SECRET_KEY', 'minioadmin'),
  s3Bucket: required('S3_BUCKET', 'thryftverse-media'),
  s3ForcePathStyle: asBoolean(process.env.S3_FORCE_PATH_STYLE, true),
  mlServiceUrl: required('ML_SERVICE_URL', 'http://localhost:8000'),
  authAccessTokenSecret: requiredSecret('AUTH_ACCESS_TOKEN_SECRET', 'dev-only-access-secret-change-me'),
  authRefreshTokenSecret: requiredSecret('AUTH_REFRESH_TOKEN_SECRET', 'dev-only-refresh-secret-change-me'),
  authAccessTokenTtlSeconds: asNumber(process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS, 15 * 60),
  authRefreshTokenTtlSeconds: asNumber(process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60),
  authPasswordHashCost: asNumber(process.env.AUTH_PASSWORD_HASH_COST, 12),
  authPasswordResetTokenTtlSeconds: asNumber(process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_SECONDS, 20 * 60),
  apiSecurityAdminToken: requiredSecret('API_SECURITY_ADMIN_TOKEN', 'local-security-admin-token'),
  apiEnableMockWebhooks: asBoolean(process.env.API_ENABLE_MOCK_WEBHOOKS, nodeEnv !== 'production'),
  apiRateLimitMax: asNumber(process.env.API_RATE_LIMIT_MAX, 140),
  apiRateLimitWindow: process.env.API_RATE_LIMIT_WINDOW ?? '1 minute',
  paymentWebhookToleranceSeconds: asNumber(process.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS, 300),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  mollieApiKey: process.env.MOLLIE_API_KEY,
  mollieWebhookSecret: process.env.MOLLIE_WEBHOOK_SECRET,
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY,
  flutterwaveWebhookSecret: process.env.FLUTTERWAVE_WEBHOOK_SECRET,
  tapSecretKey: process.env.TAP_SECRET_KEY,
  tapWebhookSecret: process.env.TAP_WEBHOOK_SECRET,
  goldOracleApiUrl: process.env.GOLD_ORACLE_API_URL ?? 'https://api.metals.dev/v1/latest',
  goldOracleApiKey: process.env.GOLD_ORACLE_API_KEY,
  goldOracleTtlSeconds: asNumber(process.env.GOLD_ORACLE_TTL_SECONDS, 300),
  goldReserveDriftThresholdGrams: asNumber(process.env.GOLD_RESERVE_DRIFT_THRESHOLD_GRAMS, 10),
  goldOperatorToken: process.env.GOLD_OPERATOR_TOKEN,
  expoPushApiUrl: process.env.EXPO_PUSH_API_URL ?? 'https://exp.host/--/api/v2/push/send',
  pushDefaultChannel: process.env.PUSH_DEFAULT_CHANNEL ?? 'default',
  sentryDsn: process.env.SENTRY_DSN,
  sentryTracesSampleRate: asNumber(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.15),
  otelEnabled: asBoolean(process.env.OTEL_ENABLED, true),
  otelExporterOtlpHttpUrl:
    process.env.OTEL_EXPORTER_OTLP_HTTP_URL ?? 'http://localhost:4318/v1/traces',
  auctionSweepIntervalMs: asNumber(process.env.AUCTION_SWEEP_INTERVAL_MS, 30_000),
};
