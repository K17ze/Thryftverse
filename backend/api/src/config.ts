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

function asCsvList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
  authMagicLinkTtlSeconds: asNumber(process.env.AUTH_MAGIC_LINK_TTL_SECONDS, 15 * 60),
  authMagicLinkBaseUrl:
    process.env.AUTH_MAGIC_LINK_BASE_URL?.trim() || 'thryftverse://auth/magic-link',
  authOtpTtlSeconds: asNumber(process.env.AUTH_OTP_TTL_SECONDS, 5 * 60),
  authOtpMaxAttempts: asNumber(process.env.AUTH_OTP_MAX_ATTEMPTS, 5),
  authEmailProvider:
    process.env.AUTH_EMAIL_PROVIDER?.trim().toLowerCase()
    || (nodeEnv === 'production' ? 'resend' : 'log'),
  authExposeDevelopmentArtifacts: asBoolean(process.env.AUTH_EXPOSE_DEVELOPMENT_ARTIFACTS, false),
  authEmailFrom: process.env.AUTH_EMAIL_FROM?.trim() || null,
  resendApiKey: process.env.RESEND_API_KEY?.trim() || null,
  apiSecurityAdminToken: requiredSecret('API_SECURITY_ADMIN_TOKEN', 'local-security-admin-token'),
  apiEnableMockWebhooks: asBoolean(process.env.API_ENABLE_MOCK_WEBHOOKS, false),
  apiRateLimitMax: asNumber(process.env.API_RATE_LIMIT_MAX, 140),
  apiRateLimitWindow: process.env.API_RATE_LIMIT_WINDOW ?? '1 minute',
  kycDefaultVendor: required('KYC_DEFAULT_VENDOR', nodeEnv !== 'production' ? 'sandbox_kyc_vendor' : undefined),
  kycVerificationBaseUrl: required(
    'KYC_VERIFICATION_BASE_URL',
    nodeEnv !== 'production' ? 'https://verify.thryftverse.local/session' : undefined
  ),
  paymentWebhookToleranceSeconds: asNumber(process.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS, 300),
  googleOAuthClientIds: asCsvList(process.env.GOOGLE_OAUTH_CLIENT_IDS),
  appleOAuthAudience: process.env.APPLE_OAUTH_AUDIENCE?.trim() || null,
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
  wiseApiKey: process.env.WISE_API_KEY,
  wiseWebhookSecret: process.env.WISE_WEBHOOK_SECRET,
  wiseApiBaseUrl: process.env.WISE_API_BASE_URL?.trim() || 'https://api.wise.com',
  wisePlatformProfileId: process.env.WISE_PLATFORM_PROFILE_ID?.trim() || null,
  wisePlatformRecipientAccountId: process.env.WISE_PLATFORM_RECIPIENT_ACCOUNT_ID?.trim() || null,
  wisePlatformTransferReferencePrefix:
    process.env.WISE_PLATFORM_TRANSFER_REFERENCE_PREFIX?.trim() || 'THRYFTVERSE SWEEP',
  evriApiKey: process.env.EVRI_API_KEY?.trim() || process.env.SHIPPING_EVRI_API_KEY?.trim() || null,
  evriApiBaseUrl:
    process.env.EVRI_API_BASE_URL?.trim() || process.env.SHIPPING_EVRI_API_URL?.trim() || null,
  evriWebhookSecret:
    process.env.EVRI_WEBHOOK_SECRET?.trim() || process.env.SHIPPING_EVRI_WEBHOOK_SECRET?.trim() || null,
  delhiveryApiKey:
    process.env.DELHIVERY_API_KEY?.trim() || process.env.SHIPPING_DELHIVERY_API_KEY?.trim() || null,
  delhiveryApiBaseUrl:
    process.env.DELHIVERY_API_BASE_URL?.trim()
    || process.env.SHIPPING_DELHIVERY_API_URL?.trim()
    || null,
  delhiveryWebhookSecret:
    process.env.DELHIVERY_WEBHOOK_SECRET?.trim()
    || process.env.SHIPPING_DELHIVERY_WEBHOOK_SECRET?.trim()
    || null,
  dhlApiKey: process.env.DHL_API_KEY?.trim() || process.env.SHIPPING_DHL_API_KEY?.trim() || null,
  dhlApiBaseUrl:
    process.env.DHL_API_BASE_URL?.trim() || process.env.SHIPPING_DHL_API_URL?.trim() || null,
  dhlWebhookSecret:
    process.env.DHL_WEBHOOK_SECRET?.trim() || process.env.SHIPPING_DHL_WEBHOOK_SECRET?.trim() || null,
  aramexApiKey:
    process.env.ARAMEX_API_KEY?.trim() || process.env.SHIPPING_ARAMEX_API_KEY?.trim() || null,
  aramexApiBaseUrl:
    process.env.ARAMEX_API_BASE_URL?.trim() || process.env.SHIPPING_ARAMEX_API_URL?.trim() || null,
  aramexWebhookSecret:
    process.env.ARAMEX_WEBHOOK_SECRET?.trim() || process.env.SHIPPING_ARAMEX_WEBHOOK_SECRET?.trim() || null,
  easyshipApiKey:
    process.env.EASYSHIP_API_KEY?.trim() || process.env.SHIPPING_EASYSHIP_API_KEY?.trim() || null,
  easyshipApiBaseUrl:
    process.env.EASYSHIP_API_BASE_URL?.trim()
    || process.env.SHIPPING_EASYSHIP_API_URL?.trim()
    || 'https://public-api.easyship.com/2024-09',
  easyshipWebhookSecret:
    process.env.EASYSHIP_WEBHOOK_SECRET?.trim()
    || process.env.SHIPPING_EASYSHIP_WEBHOOK_SECRET?.trim()
    || null,
  shippingFallbackLabelBaseUrl:
    process.env.SHIPPING_FALLBACK_LABEL_BASE_URL?.trim() || 'https://thryftverse.app/mock-shipping',
  dailyPayoutVelocityLimitGbp: asNumber(process.env.DAILY_PAYOUT_VELOCITY_LIMIT_GBP, 2000),
  payoutManualReviewThresholdGbp: asNumber(process.env.PAYOUT_MANUAL_REVIEW_THRESHOLD_GBP, 500),
  reconciliationScheduleUtcHour: asNumber(process.env.RECONCILIATION_SCHEDULE_UTC_HOUR, 2),
  reconciliationMismatchThresholdGbp: asNumber(process.env.RECONCILIATION_MISMATCH_THRESHOLD_GBP, 1),
  reconciliationCriticalMismatchThresholdGbp: asNumber(
    process.env.RECONCILIATION_CRITICAL_MISMATCH_THRESHOLD_GBP,
    10
  ),
  platformRevenueSweepGateway: process.env.PLATFORM_REVENUE_SWEEP_GATEWAY?.trim().toLowerCase() || null,
  platformRevenueSweepRequireExternalTransfer: asBoolean(
    process.env.PLATFORM_REVENUE_SWEEP_REQUIRE_EXTERNAL_TRANSFER,
    false
  ),
  platformRevenueSweepIntervalMs: asNumber(process.env.PLATFORM_REVENUE_SWEEP_INTERVAL_MS, 6 * 60 * 60 * 1000),
  opsAlertIntervalMs: asNumber(process.env.OPS_ALERT_INTERVAL_MS, 60_000),
  alertingWebhookUrls: asCsvList(process.env.ALERTING_WEBHOOK_URLS ?? process.env.ALERTING_WEBHOOK_URL),
  alertingAdminUserIds: asCsvList(process.env.ALERTING_ADMIN_USER_IDS),
  onezeSupplyDriftThresholdIze: asNumber(process.env.ONEZE_SUPPLY_DRIFT_THRESHOLD_IZE, 10),
  onezeOperatorToken: process.env.ONEZE_OPERATOR_TOKEN,
  onezeReservePolicyEnabled: asBoolean(process.env.ONEZE_RESERVE_POLICY_ENABLED, false),
  onezeReserveRatioMin: asNumber(process.env.ONEZE_RESERVE_RATIO_MIN, 0.3),
  onezeReserveRatioMax: asNumber(process.env.ONEZE_RESERVE_RATIO_MAX, 0.6),
  onezeOperationalReserveMg: asNumber(process.env.ONEZE_OPERATIONAL_RESERVE_MG, 0),
  expoPushApiUrl: process.env.EXPO_PUSH_API_URL ?? 'https://exp.host/--/api/v2/push/send',
  pushDefaultChannel: process.env.PUSH_DEFAULT_CHANNEL ?? 'default',
  sentryDsn: process.env.SENTRY_DSN,
  sentryTracesSampleRate: asNumber(process.env.SENTRY_TRACES_SAMPLE_RATE, 0.15),
  otelEnabled: asBoolean(process.env.OTEL_ENABLED, true),
  otelExporterOtlpHttpUrl:
    process.env.OTEL_EXPORTER_OTLP_HTTP_URL ?? 'http://localhost:4318/v1/traces',
  auctionSweepIntervalMs: asNumber(process.env.AUCTION_SWEEP_INTERVAL_MS, 30_000),
  onezeReconcileIntervalMs: asNumber(process.env.ONEZE_RECONCILE_INTERVAL_MS, 60 * 60 * 1000),
  onezeFxSyncEnabled: asBoolean(process.env.ONEZE_FX_SYNC_ENABLED, false),
  onezeFxSyncIntervalMs: asNumber(process.env.ONEZE_FX_SYNC_INTERVAL_MS, 24 * 60 * 60 * 1000),
  onezeFxProviderUrl:
    process.env.ONEZE_FX_PROVIDER_URL?.trim() || 'https://api.exchangerate.host/latest',
  onezeFxProviderApiKey: process.env.ONEZE_FX_PROVIDER_API_KEY?.trim() || null,
  onezeFxProviderBaseCurrency: process.env.ONEZE_FX_PROVIDER_BASE_CURRENCY?.trim().toUpperCase() || 'INR',
  onezeAutoAdjustEnabled: asBoolean(process.env.ONEZE_AUTO_ADJUST_ENABLED, false),
  onezeAutoAdjustIntervalMs: asNumber(process.env.ONEZE_AUTO_ADJUST_INTERVAL_MS, 60 * 60 * 1000),
  onezeAutoAdjustStepBps: asNumber(process.env.ONEZE_AUTO_ADJUST_STEP_BPS, 50),
  onezeAutoAdjustLookbackHours: asNumber(process.env.ONEZE_AUTO_ADJUST_LOOKBACK_HOURS, 24),
  onezeAutoAdjustHighStressThreshold: asNumber(process.env.ONEZE_AUTO_ADJUST_HIGH_STRESS_THRESHOLD, 0.85),
  onezeAutoAdjustLowStressThreshold: asNumber(process.env.ONEZE_AUTO_ADJUST_LOW_STRESS_THRESHOLD, 0.35),
  onezeAutoAdjustHighRedemptionRate: asNumber(process.env.ONEZE_AUTO_ADJUST_HIGH_REDEMPTION_RATE, 0.8),
  onezeAutoAdjustLowRedemptionRate: asNumber(process.env.ONEZE_AUTO_ADJUST_LOW_REDEMPTION_RATE, 0.25),
  onezeEnableDirectRedemption: asBoolean(process.env.ONEZE_ENABLE_DIRECT_REDEMPTION, false),
  onezeMintQuoteTtlSeconds: asNumber(process.env.ONEZE_MINT_QUOTE_TTL_SECONDS, 60),
  onezeMintPaymentGraceSeconds: asNumber(process.env.ONEZE_MINT_PAYMENT_GRACE_SECONDS, 5 * 60),
  onezeWithdrawalQuoteTtlSeconds: asNumber(process.env.ONEZE_WITHDRAWAL_QUOTE_TTL_SECONDS, 60),
  onezeWithdrawalInstantLimitMg: asNumber(process.env.ONEZE_WITHDRAWAL_INSTANT_LIMIT_MG, 20_000),
  onezeTravelRuleThresholdMg: asNumber(process.env.ONEZE_TRAVEL_RULE_THRESHOLD_MG, 11_000),
  onezeDailyAttestationIntervalMs: asNumber(
    process.env.ONEZE_DAILY_ATTESTATION_INTERVAL_MS,
    24 * 60 * 60 * 1000
  ),
  onezeAttestationSigningSecret: requiredSecret(
    'ONEZE_ATTESTATION_SIGNING_SECRET',
    'dev-only-oneze-attestation-signing-secret'
  ),
};
