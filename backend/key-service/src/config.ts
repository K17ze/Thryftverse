import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseCsv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('KEY_SERVICE_DEFAULT_KEY_VERSION must be a positive integer');
  }
  return parsed;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const hasExplicitMasterKey = Boolean(process.env.KEY_SERVICE_MASTER_KEY_B64?.trim());

if (nodeEnv === 'production' && !hasExplicitMasterKey) {
  throw new Error('KEY_SERVICE_MASTER_KEY_B64 must be explicitly set in production');
}

const masterKeyB64 = required(
  'KEY_SERVICE_MASTER_KEY_B64',
  'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='
);

const masterKey = Buffer.from(masterKeyB64, 'base64');
if (masterKey.length !== 32) {
  throw new Error('KEY_SERVICE_MASTER_KEY_B64 must decode to exactly 32 bytes');
}

const allowedKeys = parseCsv(process.env.KEY_SERVICE_ALLOWED_KEYS ?? 'profile,message,wallet');
if (allowedKeys.length === 0) {
  throw new Error('KEY_SERVICE_ALLOWED_KEYS must include at least one key name');
}

export const config = {
  nodeEnv,
  port: Number(process.env.PORT ?? '4100'),
  defaultKeyVersion: parsePositiveInt(process.env.KEY_SERVICE_DEFAULT_KEY_VERSION, 1),
  allowedKeys,
  region: process.env.KEY_SERVICE_REGION ?? 'local-edge',
  country: process.env.KEY_SERVICE_COUNTRY ?? 'dev-local',
  adminToken: process.env.KEY_SERVICE_ADMIN_TOKEN,
  masterKey,
};
