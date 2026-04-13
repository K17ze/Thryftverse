import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function isMissing(value) {
  return value === undefined || value === null || String(value).trim().length === 0;
}

function checkEnv() {
  const errors = [];
  const warnings = [];

  const required = [
    'NODE_ENV',
    'EXPO_PUBLIC_API_BASE_URL',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'MINIO_ROOT_USER',
    'MINIO_ROOT_PASSWORD',
    'S3_BUCKET',
    'S3_REGION',
    'S3_PUBLIC_ENDPOINT',
    'KEY_SERVICE_MASTER_KEY_B64',
    'KEY_SERVICE_CLIENT_TOKEN',
    'KEY_SERVICE_ADMIN_TOKEN',
    'API_SECURITY_ADMIN_TOKEN',
    'AUTH_ACCESS_TOKEN_SECRET',
    'AUTH_REFRESH_TOKEN_SECRET',
    'AUTH_EMAIL_FROM',
    'RESEND_API_KEY',
    'GOOGLE_OAUTH_CLIENT_IDS',
    'APPLE_OAUTH_AUDIENCE',
    'KYC_DEFAULT_VENDOR',
    'KYC_VERIFICATION_BASE_URL',
    'SENTRY_DSN',
    'ONEZE_ATTESTATION_SIGNING_SECRET',
  ];

  for (const key of required) {
    if (isMissing(process.env[key])) {
      errors.push(`Missing required variable: ${key}`);
    }
  }

  if ((process.env.NODE_ENV ?? '').trim().toLowerCase() !== 'production') {
    errors.push('NODE_ENV must be set to production.');
  }

  const disallowedDefaults = {
    POSTGRES_PASSWORD: 'thryftverse',
    MINIO_ROOT_USER: 'minioadmin',
    MINIO_ROOT_PASSWORD: 'minioadmin',
    KEY_SERVICE_CLIENT_TOKEN: 'local-key-client-token',
    KEY_SERVICE_ADMIN_TOKEN: 'local-key-admin-token',
    API_SECURITY_ADMIN_TOKEN: 'local-security-admin-token',
    AUTH_ACCESS_TOKEN_SECRET: 'dev-only-access-secret-change-me',
    AUTH_REFRESH_TOKEN_SECRET: 'dev-only-refresh-secret-change-me',
    ONEZE_ATTESTATION_SIGNING_SECRET: 'dev-only-oneze-attestation-signing-secret',
  };

  for (const [key, banned] of Object.entries(disallowedDefaults)) {
    if ((process.env[key] ?? '').trim() === banned) {
      errors.push(`${key} uses a development default and must be replaced.`);
    }
  }

  if ((process.env.API_ENABLE_MOCK_WEBHOOKS ?? '').trim().toLowerCase() === 'true') {
    errors.push('API_ENABLE_MOCK_WEBHOOKS must be false in production.');
  }

  if ((process.env.EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS ?? '').trim().toLowerCase() === 'true') {
    errors.push('EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS must be false in production.');
  }

  const publicApiBase = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim();
  if (publicApiBase && !publicApiBase.startsWith('https://')) {
    errors.push('EXPO_PUBLIC_API_BASE_URL must use https:// in production.');
  }

  const s3Public = (process.env.S3_PUBLIC_ENDPOINT ?? '').toLowerCase();
  if (s3Public.includes('localhost') || s3Public.includes('127.0.0.1')) {
    errors.push('S3_PUBLIC_ENDPOINT cannot point to localhost in production.');
  }

  const kycVendor = (process.env.KYC_DEFAULT_VENDOR ?? '').toLowerCase();
  if (kycVendor.includes('sandbox')) {
    errors.push('KYC_DEFAULT_VENDOR cannot be a sandbox vendor in production.');
  }

  const hasStripe = !isMissing(process.env.STRIPE_SECRET_KEY) && !isMissing(process.env.STRIPE_WEBHOOK_SECRET);
  const hasWise = !isMissing(process.env.WISE_API_KEY) && !isMissing(process.env.WISE_WEBHOOK_SECRET);
  const hasRazorpay =
    !isMissing(process.env.RAZORPAY_KEY_ID)
    && !isMissing(process.env.RAZORPAY_KEY_SECRET)
    && !isMissing(process.env.RAZORPAY_WEBHOOK_SECRET);

  if (!hasStripe && !hasWise && !hasRazorpay) {
    errors.push('Configure at least one payment provider set (Stripe, Wise, or Razorpay).');
  }

  if (isMissing(process.env.OTEL_EXPORTER_OTLP_HTTP_URL)) {
    warnings.push('OTEL_EXPORTER_OTLP_HTTP_URL is empty; traces will not be exported unless another exporter is configured.');
  }

  return { errors, warnings };
}

function main() {
  const target = process.argv[2] ?? '.env.production';
  const targetPath = path.isAbsolute(target) ? target : path.join(process.cwd(), target);
  loadEnvFile(targetPath);

  const { errors, warnings } = checkEnv();

  console.log(`Checked production env file: ${targetPath}`);

  if (warnings.length > 0) {
    console.log('\nWarnings:');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }

  if (errors.length > 0) {
    console.error('\nProduction env validation failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('\nProduction env validation passed.');
}

main();
