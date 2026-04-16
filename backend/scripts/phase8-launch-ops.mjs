import { spawn } from 'node:child_process';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ORDER_PREFIXES = ['ord_smoke_%', 'ord_shipops_%'];
const LISTING_PREFIXES = ['l_smoke_%', 'lst_shipops_%'];
const AUCTION_PREFIXES = ['a_smoke_%'];
const ASSET_PREFIXES = ['s_smoke_%'];
const SHIP_EVENT_PREFIXES = ['ship_evt_%'];
const TARGET_USERNAME_PREFIXES = ['smoke_%', 'shipops_%', 'docker_smoke_%'];

function printUsage() {
  console.log([
    'Usage: node backend/scripts/phase8-launch-ops.mjs [options]',
    '',
    'Options:',
    '  --env <file>               Environment file to load (default: .env.production)',
    '  --strict                   Treat warnings as failures',
    '  --run-rehearsal            Run staging shipping + ops rehearsal script',
    '  --api-base-url <url>       Override API_BASE_URL during rehearsal execution',
    '  --verify-url <url>         Add extra HTTPS endpoint for DNS/TLS verification (repeatable)',
    '  --cleanup-db               Execute DB cleanup logic in dry-run mode',
    '  --confirm-db-cleanup       Apply DB cleanup changes (requires --cleanup-db)',
    '  --skip-env                 Skip environment validation',
    '  --skip-ssl                 Skip DNS/TLS verification checks',
    '  --json                     Print machine-readable JSON summary',
    '  --help                     Show this help message',
    '',
    'Examples:',
    '  node backend/scripts/phase8-launch-ops.mjs --strict',
    '  node backend/scripts/phase8-launch-ops.mjs --strict --run-rehearsal',
    '  node backend/scripts/phase8-launch-ops.mjs --cleanup-db',
    '  node backend/scripts/phase8-launch-ops.mjs --cleanup-db --confirm-db-cleanup',
  ].join('\n'));
}

function parseArgs(argv) {
  const options = {
    envFile: '.env.production',
    strict: false,
    runRehearsal: false,
    apiBaseUrl: undefined,
    verifyUrls: [],
    cleanupDb: false,
    confirmDbCleanup: false,
    skipEnv: false,
    skipSsl: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    switch (arg) {
      case '--env': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('Missing value for --env');
        }
        options.envFile = value;
        i += 1;
        break;
      }
      case '--strict':
        options.strict = true;
        break;
      case '--run-rehearsal':
        options.runRehearsal = true;
        break;
      case '--api-base-url': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('Missing value for --api-base-url');
        }
        options.apiBaseUrl = value;
        i += 1;
        break;
      }
      case '--verify-url': {
        const value = argv[i + 1];
        if (!value) {
          throw new Error('Missing value for --verify-url');
        }
        options.verifyUrls.push(value);
        i += 1;
        break;
      }
      case '--cleanup-db':
        options.cleanupDb = true;
        break;
      case '--confirm-db-cleanup':
        options.confirmDbCleanup = true;
        break;
      case '--skip-env':
        options.skipEnv = true;
        break;
      case '--skip-ssl':
        options.skipSsl = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }

  return true;
}

function isMissing(value) {
  return value === undefined || value === null || String(value).trim().length === 0;
}

function isTrue(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function isHttpsUrl(value) {
  if (isMissing(value)) {
    return false;
  }

  try {
    return new URL(String(value)).protocol === 'https:';
  } catch {
    return false;
  }
}

function maskSecret(value) {
  if (isMissing(value)) {
    return '<empty>';
  }

  const text = String(value);
  if (text.length <= 6) {
    return `${text.slice(0, 1)}***`;
  }

  return `${text.slice(0, 3)}***${text.slice(-2)}`;
}

function parseCsv(value) {
  if (isMissing(value)) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function validateEnvironment() {
  const errors = [];
  const warnings = [];

  const nodeEnv = String(process.env.NODE_ENV ?? '').trim().toLowerCase();
  if (nodeEnv !== 'production') {
    errors.push('NODE_ENV must be production for Phase 8 launch checks.');
  }

  if (isTrue(process.env.API_ENABLE_MOCK_WEBHOOKS)) {
    errors.push('API_ENABLE_MOCK_WEBHOOKS must be false for launch readiness.');
  }

  if (isTrue(process.env.EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS)) {
    errors.push('EXPO_PUBLIC_ENABLE_RUNTIME_MOCKS must be false for launch readiness.');
  }

  if (isMissing(process.env.API_SECURITY_ADMIN_TOKEN)) {
    errors.push('API_SECURITY_ADMIN_TOKEN is required.');
  }

  if (!isHttpsUrl(process.env.EXPO_PUBLIC_API_BASE_URL)) {
    errors.push('EXPO_PUBLIC_API_BASE_URL must be an https URL.');
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!isMissing(stripeKey) && !String(stripeKey).startsWith('sk_live_')) {
    errors.push(`STRIPE_SECRET_KEY does not look like a live key: ${maskSecret(stripeKey)}`);
  }

  const wiseKey = process.env.WISE_API_KEY;
  if (!isMissing(wiseKey) && /sandbox|test|example/i.test(String(wiseKey))) {
    errors.push(`WISE_API_KEY appears to be a test/sandbox value: ${maskSecret(wiseKey)}`);
  }

  const wiseBaseUrl = process.env.WISE_API_BASE_URL;
  if (!isMissing(wiseBaseUrl) && !isHttpsUrl(wiseBaseUrl)) {
    errors.push('WISE_API_BASE_URL must use https://');
  }

  const hasStripe = !isMissing(process.env.STRIPE_SECRET_KEY) && !isMissing(process.env.STRIPE_WEBHOOK_SECRET);
  const hasWise = !isMissing(process.env.WISE_API_KEY) && !isMissing(process.env.WISE_WEBHOOK_SECRET);
  const hasRazorpay =
    !isMissing(process.env.RAZORPAY_KEY_ID)
    && !isMissing(process.env.RAZORPAY_KEY_SECRET)
    && !isMissing(process.env.RAZORPAY_WEBHOOK_SECRET);

  if (!hasStripe && !hasWise && !hasRazorpay) {
    errors.push('At least one payment rail must be configured (Stripe, Wise, or Razorpay).');
  }

  const sweepGateway = String(process.env.PLATFORM_REVENUE_SWEEP_GATEWAY ?? '').trim().toLowerCase();
  const sweepExternalRequired = isTrue(process.env.PLATFORM_REVENUE_SWEEP_REQUIRE_EXTERNAL_TRANSFER);

  if (sweepGateway && sweepGateway !== 'wise') {
    errors.push(`Unsupported PLATFORM_REVENUE_SWEEP_GATEWAY value: ${sweepGateway}`);
  }

  if (sweepGateway === 'wise') {
    if (isMissing(process.env.WISE_PLATFORM_PROFILE_ID)) {
      errors.push('WISE_PLATFORM_PROFILE_ID is required when PLATFORM_REVENUE_SWEEP_GATEWAY=wise.');
    }
    if (isMissing(process.env.WISE_PLATFORM_RECIPIENT_ACCOUNT_ID)) {
      errors.push('WISE_PLATFORM_RECIPIENT_ACCOUNT_ID is required when PLATFORM_REVENUE_SWEEP_GATEWAY=wise.');
    }
  }

  if (sweepExternalRequired && sweepGateway !== 'wise') {
    errors.push('PLATFORM_REVENUE_SWEEP_REQUIRE_EXTERNAL_TRANSFER=true requires PLATFORM_REVENUE_SWEEP_GATEWAY=wise.');
  }

  const shippingProviders = [
    {
      id: 'evri',
      key: process.env.EVRI_API_KEY ?? process.env.SHIPPING_EVRI_API_KEY,
      baseUrl: process.env.EVRI_API_BASE_URL ?? process.env.SHIPPING_EVRI_API_URL,
    },
    {
      id: 'delhivery',
      key: process.env.DELHIVERY_API_KEY ?? process.env.SHIPPING_DELHIVERY_API_KEY,
      baseUrl: process.env.DELHIVERY_API_BASE_URL ?? process.env.SHIPPING_DELHIVERY_API_URL,
    },
    {
      id: 'dhl',
      key: process.env.DHL_API_KEY ?? process.env.SHIPPING_DHL_API_KEY,
      baseUrl: process.env.DHL_API_BASE_URL ?? process.env.SHIPPING_DHL_API_URL,
    },
    {
      id: 'aramex',
      key: process.env.ARAMEX_API_KEY ?? process.env.SHIPPING_ARAMEX_API_KEY,
      baseUrl: process.env.ARAMEX_API_BASE_URL ?? process.env.SHIPPING_ARAMEX_API_URL,
    },
    {
      id: 'easyship',
      key: process.env.EASYSHIP_API_KEY ?? process.env.SHIPPING_EASYSHIP_API_KEY,
      baseUrl: process.env.EASYSHIP_API_BASE_URL ?? process.env.SHIPPING_EASYSHIP_API_URL,
    },
  ];

  const configuredCarrierCount = shippingProviders.filter((provider) => !isMissing(provider.key)).length;
  if (configuredCarrierCount === 0) {
    warnings.push('No live carrier API keys detected. Shipping will run in fallback-rate mode.');
  }

  for (const provider of shippingProviders) {
    if (!isMissing(provider.key) && isMissing(provider.baseUrl)) {
      errors.push(`${provider.id.toUpperCase()}_API_BASE_URL is required when ${provider.id.toUpperCase()}_API_KEY is set.`);
    }

    if (!isMissing(provider.baseUrl)) {
      const normalized = String(provider.baseUrl).toLowerCase();
      if (normalized.includes('localhost') || normalized.includes('127.0.0.1') || normalized.includes('example')) {
        errors.push(`${provider.id.toUpperCase()}_API_BASE_URL appears non-production: ${provider.baseUrl}`);
      }
      if (!isHttpsUrl(provider.baseUrl)) {
        warnings.push(`${provider.id.toUpperCase()}_API_BASE_URL is not https: ${provider.baseUrl}`);
      }
    }
  }

  const kycVendor = String(process.env.KYC_DEFAULT_VENDOR ?? '').trim().toLowerCase();
  if (!isMissing(kycVendor) && kycVendor.includes('sandbox')) {
    errors.push('KYC_DEFAULT_VENDOR cannot be sandbox in production.');
  }

  if (isMissing(process.env.SENTRY_DSN)) {
    warnings.push('SENTRY_DSN is empty; production crash telemetry is not configured.');
  }

  if (!isMissing(process.env.SENTRY_DSN) && !isHttpsUrl(process.env.SENTRY_DSN)) {
    warnings.push('SENTRY_DSN should be https:// for secure transport.');
  }

  const alertHooks = parseCsv(process.env.ALERTING_WEBHOOK_URLS ?? process.env.ALERTING_WEBHOOK_URL);
  for (const hook of alertHooks) {
    if (!isHttpsUrl(hook)) {
      warnings.push(`Alerting webhook is not https: ${hook}`);
    }
  }

  return {
    errors,
    warnings,
    diagnostics: {
      paymentRails: {
        stripe: hasStripe,
        wise: hasWise,
        razorpay: hasRazorpay,
      },
      sweepGateway: sweepGateway || null,
      sweepExternalRequired,
      configuredCarrierCount,
    },
  };
}

function resolveVerificationUrls(extraUrls) {
  const discovered = [
    process.env.EXPO_PUBLIC_API_BASE_URL,
    process.env.S3_PUBLIC_ENDPOINT,
    process.env.KYC_VERIFICATION_BASE_URL,
    process.env.THRYFTVERSE_PUBLIC_BASE_URL,
    process.env.THRYFTVERSE_ADMIN_BASE_URL,
    ...extraUrls,
  ].filter((value) => !isMissing(value));

  const dedupe = new Set();
  const urls = [];
  for (const value of discovered) {
    const normalized = String(value).trim();
    if (dedupe.has(normalized)) {
      continue;
    }
    dedupe.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function probeHttps(url) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let peerCertificate = null;
    let tlsProtocol = null;

    const request = https.request(url, { method: 'GET', timeout: 10_000 }, (response) => {
      response.resume();
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? null,
          elapsedMs: Date.now() - startedAt,
          peerCertificate,
          tlsProtocol,
        });
      });
    });

    request.on('socket', (socket) => {
      socket.on('secureConnect', () => {
        peerCertificate = socket.getPeerCertificate();
        tlsProtocol = socket.getProtocol?.() ?? null;
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('HTTPS probe timeout after 10 seconds'));
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

async function verifyEndpoint(rawUrl) {
  const result = {
    url: rawUrl,
    host: null,
    protocol: null,
    dnsAddresses: [],
    statusCode: null,
    tlsProtocol: null,
    certificate: null,
    errors: [],
    warnings: [],
  };

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    result.errors.push('Invalid URL.');
    return result;
  }

  result.host = parsed.hostname;
  result.protocol = parsed.protocol;

  try {
    const addresses = await dns.lookup(parsed.hostname, { all: true });
    result.dnsAddresses = addresses.map((entry) => entry.address);
    if (result.dnsAddresses.length === 0) {
      result.errors.push('Host resolved with zero addresses.');
    }
  } catch (error) {
    result.errors.push(`DNS lookup failed: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }

  if (parsed.protocol !== 'https:') {
    result.warnings.push('Endpoint is not HTTPS. SSL handshake check skipped.');
    return result;
  }

  try {
    const probe = await probeHttps(parsed);
    result.statusCode = probe.statusCode;
    result.tlsProtocol = probe.tlsProtocol;

    if (probe.peerCertificate && Object.keys(probe.peerCertificate).length > 0) {
      const validFrom = probe.peerCertificate.valid_from;
      const validTo = probe.peerCertificate.valid_to;
      const subjectCn = probe.peerCertificate.subject?.CN ?? null;
      const issuerCn = probe.peerCertificate.issuer?.CN ?? null;

      result.certificate = {
        subjectCn,
        issuerCn,
        validFrom,
        validTo,
      };

      if (validTo) {
        const expiry = new Date(validTo);
        if (!Number.isNaN(expiry.getTime())) {
          const daysUntilExpiry = Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          if (daysUntilExpiry < 0) {
            result.errors.push(`Certificate is expired (${daysUntilExpiry} days).`);
          } else if (daysUntilExpiry < 14) {
            result.warnings.push(`Certificate expires soon (${daysUntilExpiry} days).`);
          }
        }
      }
    } else {
      result.warnings.push('TLS certificate metadata was unavailable.');
    }
  } catch (error) {
    result.errors.push(`HTTPS probe failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return result;
}

function runCommand(command, args, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...envOverrides,
      },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function tableExists(client, cache, tableName) {
  if (cache.has(tableName)) {
    return cache.get(tableName);
  }

  const query = await client.query('SELECT to_regclass($1) AS table_name', [`public.${tableName}`]);
  const exists = Boolean(query.rows[0]?.table_name);
  cache.set(tableName, exists);
  return exists;
}

async function maybeDelete({
  client,
  tableCache,
  table,
  sql,
  params,
  summary,
  label,
}) {
  if (!(await tableExists(client, tableCache, table))) {
    summary.skippedTables.push(table);
    return 0;
  }

  const result = await client.query(sql, params);
  summary.deletedRows[label] = (summary.deletedRows[label] ?? 0) + result.rowCount;
  return result.rowCount;
}

async function runDbCleanup({ apply }) {
  const { Client } = await importPgClient();

  if (isMissing(process.env.DATABASE_URL)) {
    throw new Error('DATABASE_URL is required for cleanup-db execution.');
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const summary = {
    apply,
    targetUsers: [],
    deletedRows: {},
    skippedTables: [],
  };

  const tableCache = new Map();

  try {
    const hasUsers = await tableExists(client, tableCache, 'users');
    if (!hasUsers) {
      throw new Error('users table not found; cannot run cleanup.');
    }

    const targetUserRows = await client.query(
      `
        SELECT id, email, username
        FROM users
        WHERE (email IS NOT NULL AND LOWER(email) LIKE '%@thryftverse.local')
          OR LOWER(username) LIKE ANY($1::text[])
      `,
      [TARGET_USERNAME_PREFIXES]
    );

    summary.targetUsers = targetUserRows.rows.map((row) => ({
      id: row.id,
      email: row.email,
      username: row.username,
    }));

    const targetUserIds = summary.targetUsers.map((row) => row.id);

    await client.query('BEGIN');

    await maybeDelete({
      client,
      tableCache,
      table: 'wallet_ize_transfers',
      sql: `
        DELETE FROM wallet_ize_transfers
        WHERE sender_user_id = ANY($1::text[])
           OR recipient_user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'wallet_ize_transfers',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_trades',
      sql: `
        DELETE FROM coOwn_trades
        WHERE buyer_id = ANY($1::text[])
           OR seller_id = ANY($1::text[])
           OR asset_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, ASSET_PREFIXES],
      summary,
      label: 'coown_trades',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_buyout_acceptances',
      sql: `
        DELETE FROM coOwn_buyout_acceptances
        WHERE holder_user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'coown_buyout_acceptances',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_buyout_offers',
      sql: `
        DELETE FROM coOwn_buyout_offers
        WHERE bidder_user_id = ANY($1::text[])
           OR asset_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, ASSET_PREFIXES],
      summary,
      label: 'coown_buyout_offers',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_holdings',
      sql: `
        DELETE FROM coOwn_holdings
        WHERE user_id = ANY($1::text[])
           OR asset_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, ASSET_PREFIXES],
      summary,
      label: 'coown_holdings',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_orders',
      sql: `
        DELETE FROM coOwn_orders
        WHERE user_id = ANY($1::text[])
           OR asset_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, ASSET_PREFIXES],
      summary,
      label: 'coown_orders',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'auction_bids',
      sql: `
        DELETE FROM auction_bids
        WHERE bidder_id = ANY($1::text[])
           OR auction_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, AUCTION_PREFIXES],
      summary,
      label: 'auction_bids',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'order_parcel_events',
      sql: `
        DELETE FROM order_parcel_events
        WHERE order_id LIKE ANY($1::text[])
           OR provider_event_id LIKE ANY($2::text[])
           OR COALESCE(payload->>'rehearsal', 'false') = 'true'
      `,
      params: [ORDER_PREFIXES, SHIP_EVENT_PREFIXES],
      summary,
      label: 'order_parcel_events',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_attempts',
      sql: `
        DELETE FROM payment_attempts
        WHERE intent_id IN (
          SELECT id
          FROM payment_intents
          WHERE user_id = ANY($1::text[])
             OR order_id LIKE ANY($2::text[])
        )
      `,
      params: [targetUserIds, ORDER_PREFIXES],
      summary,
      label: 'payment_attempts',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_refunds',
      sql: `
        DELETE FROM payment_refunds
        WHERE intent_id IN (
          SELECT id
          FROM payment_intents
          WHERE user_id = ANY($1::text[])
             OR order_id LIKE ANY($2::text[])
        )
      `,
      params: [targetUserIds, ORDER_PREFIXES],
      summary,
      label: 'payment_refunds',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_webhook_events',
      sql: `
        DELETE FROM payment_webhook_events
        WHERE provider_event_id LIKE ANY($1::text[])
           OR intent_id IN (
             SELECT id
             FROM payment_intents
             WHERE user_id = ANY($2::text[])
                OR order_id LIKE ANY($3::text[])
           )
      `,
      params: [SHIP_EVENT_PREFIXES, targetUserIds, ORDER_PREFIXES],
      summary,
      label: 'payment_webhook_events',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_intents',
      sql: `
        DELETE FROM payment_intents
        WHERE user_id = ANY($1::text[])
           OR order_id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, ORDER_PREFIXES],
      summary,
      label: 'payment_intents',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payout_requests',
      sql: `
        DELETE FROM payout_requests
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'payout_requests',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payout_accounts',
      sql: `
        DELETE FROM payout_accounts
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'payout_accounts',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'user_payment_methods',
      sql: `
        DELETE FROM user_payment_methods
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'user_payment_methods',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'user_addresses',
      sql: `
        DELETE FROM user_addresses
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'user_addresses',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'orders',
      sql: `
        DELETE FROM orders
        WHERE buyer_id = ANY($1::text[])
           OR seller_id = ANY($1::text[])
           OR id LIKE ANY($2::text[])
           OR listing_id LIKE ANY($3::text[])
      `,
      params: [targetUserIds, ORDER_PREFIXES, LISTING_PREFIXES],
      summary,
      label: 'orders',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'auctions',
      sql: `
        DELETE FROM auctions
        WHERE seller_id = ANY($1::text[])
           OR id LIKE ANY($2::text[])
           OR listing_id LIKE ANY($3::text[])
      `,
      params: [targetUserIds, AUCTION_PREFIXES, LISTING_PREFIXES],
      summary,
      label: 'auctions',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'coown_assets',
      sql: `
        DELETE FROM coOwn_assets
        WHERE issuer_id = ANY($1::text[])
           OR id LIKE ANY($2::text[])
           OR listing_id LIKE ANY($3::text[])
      `,
      params: [targetUserIds, ASSET_PREFIXES, LISTING_PREFIXES],
      summary,
      label: 'coown_assets',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'listings',
      sql: `
        DELETE FROM listings
        WHERE seller_id = ANY($1::text[])
           OR id LIKE ANY($2::text[])
      `,
      params: [targetUserIds, LISTING_PREFIXES],
      summary,
      label: 'listings',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'refresh_tokens',
      sql: `
        DELETE FROM refresh_tokens
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'refresh_tokens',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'user_sessions',
      sql: `
        DELETE FROM user_sessions
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'user_sessions',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'password_reset_tokens',
      sql: `
        DELETE FROM password_reset_tokens
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'password_reset_tokens',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'user_totp_factors',
      sql: `
        DELETE FROM user_totp_factors
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'user_totp_factors',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'user_recovery_codes',
      sql: `
        DELETE FROM user_recovery_codes
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'user_recovery_codes',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'auth_oauth_identities',
      sql: `
        DELETE FROM auth_oauth_identities
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'auth_oauth_identities',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'auth_magic_links',
      sql: `
        DELETE FROM auth_magic_links
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'auth_magic_links',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'auth_otp_challenges',
      sql: `
        DELETE FROM auth_otp_challenges
        WHERE user_id = ANY($1::text[])
      `,
      params: [targetUserIds],
      summary,
      label: 'auth_otp_challenges',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'users',
      sql: `
        DELETE FROM users
        WHERE id = ANY($1::text[])
           OR (email IS NOT NULL AND LOWER(email) LIKE '%@thryftverse.local')
      `,
      params: [targetUserIds],
      summary,
      label: 'users',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_intents',
      sql: `
        DELETE FROM payment_intents
        WHERE gateway_id LIKE 'mock_%'
          AND created_at < NOW() - INTERVAL '48 hours'
          AND order_id IS NULL
          AND coOwn_order_id IS NULL
          AND status IN ('requires_payment_method', 'failed', 'cancelled')
      `,
      params: [],
      summary,
      label: 'payment_intents_debug_older_than_48h',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'payment_webhook_events',
      sql: `
        DELETE FROM payment_webhook_events
        WHERE intent_id IS NOT NULL
          AND created_at < NOW() - INTERVAL '48 hours'
          AND NOT EXISTS (
            SELECT 1
            FROM payment_intents
            WHERE payment_intents.id = payment_webhook_events.intent_id
          )
      `,
      params: [],
      summary,
      label: 'payment_webhook_events_orphaned',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'ledger_entries',
      sql: `
        DELETE FROM ledger_entries
        WHERE source_id LIKE ANY($1::text[])
           OR COALESCE(metadata->>'rehearsal', 'false') = 'true'
           OR COALESCE(metadata->>'source', '') IN ('docker_smoke_check', 'staging_shipping_ops_rehearsal')
           OR (
             source_type IN ('order_payment', 'order_delivery')
             AND created_at < NOW() - INTERVAL '48 hours'
             AND NOT EXISTS (
               SELECT 1 FROM orders WHERE orders.id = ledger_entries.source_id
             )
           )
           OR (
             source_type = 'payout'
             AND created_at < NOW() - INTERVAL '48 hours'
             AND NOT EXISTS (
               SELECT 1 FROM payout_requests WHERE payout_requests.id = ledger_entries.source_id
             )
           )
      `,
      params: [ORDER_PREFIXES],
      summary,
      label: 'ledger_entries',
    });

    await maybeDelete({
      client,
      tableCache,
      table: 'daily_reconciliation_runs',
      sql: `
        DELETE FROM daily_reconciliation_runs
        WHERE COALESCE(metadata->>'rehearsal', 'false') = 'true'
      `,
      params: [],
      summary,
      label: 'daily_reconciliation_runs',
    });

    if (apply) {
      await client.query('COMMIT');
    } else {
      await client.query('ROLLBACK');
    }

    return summary;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function importPgClient() {
  try {
    return await import('pg');
  } catch {
    const thisFilePath = fileURLToPath(import.meta.url);
    const fallbackPath = path.resolve(path.dirname(thisFilePath), '..', 'api', 'node_modules', 'pg', 'lib', 'index.js');

    if (fs.existsSync(fallbackPath)) {
      return import(pathToFileURL(fallbackPath).href);
    }

    throw new Error(
      'Unable to load pg module. Install backend/api dependencies (cd backend/api; npm install) before using --cleanup-db.'
    );
  }
}

function hasFailure(report, strict) {
  const envErrors = report.environment?.errors ?? [];
  const envWarnings = report.environment?.warnings ?? [];

  if (envErrors.length > 0) {
    return true;
  }

  if (strict && envWarnings.length > 0) {
    return true;
  }

  for (const endpoint of report.dnsTls?.checks ?? []) {
    if ((endpoint.errors ?? []).length > 0) {
      return true;
    }
    if (strict && (endpoint.warnings ?? []).length > 0) {
      return true;
    }
  }

  if (report.rehearsal?.ok === false) {
    return true;
  }

  if (report.cleanup?.ok === false) {
    return true;
  }

  return false;
}

function logHeader(title) {
  console.log(`\n[phase8] ${title}`);
}

function logList(items, kind) {
  for (const item of items) {
    console.log(`  ${kind} ${item}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const currentWorkingDirectory = process.cwd();
  const envPath = path.isAbsolute(options.envFile)
    ? options.envFile
    : path.resolve(currentWorkingDirectory, options.envFile);

  const loadedEnvFile = loadEnvFile(envPath);

  const report = {
    envFile: envPath,
    envFileLoaded: loadedEnvFile,
    strict: options.strict,
    environment: null,
    dnsTls: {
      checks: [],
    },
    rehearsal: {
      attempted: options.runRehearsal,
      ok: true,
      error: null,
    },
    cleanup: {
      attempted: options.cleanupDb,
      apply: options.cleanupDb && options.confirmDbCleanup,
      ok: true,
      error: null,
      summary: null,
    },
  };

  logHeader('Starting Phase 8 launch operations check');
  console.log(`  env file: ${envPath}`);
  console.log(`  env loaded: ${loadedEnvFile ? 'yes' : 'no (using process environment only)'}`);

  if (!options.skipEnv) {
    report.environment = validateEnvironment();
    logHeader('Environment validation');

    if (report.environment.errors.length === 0 && report.environment.warnings.length === 0) {
      console.log('  ok no issues found');
    }

    if (report.environment.errors.length > 0) {
      logList(report.environment.errors, 'error');
    }

    if (report.environment.warnings.length > 0) {
      logList(report.environment.warnings, 'warn');
    }

    const diagnostics = report.environment.diagnostics;
    console.log(`  payment rails: stripe=${diagnostics.paymentRails.stripe} wise=${diagnostics.paymentRails.wise} razorpay=${diagnostics.paymentRails.razorpay}`);
    console.log(`  sweep gateway: ${diagnostics.sweepGateway ?? 'none'}`);
    console.log(`  sweep external required: ${diagnostics.sweepExternalRequired}`);
    console.log(`  configured carrier count: ${diagnostics.configuredCarrierCount}`);
  }

  if (!options.skipSsl) {
    const urls = resolveVerificationUrls(options.verifyUrls);
    logHeader('DNS and TLS verification');

    if (urls.length === 0) {
      console.log('  warn no URLs found for DNS/TLS checks');
    }

    for (const url of urls) {
      const check = await verifyEndpoint(url);
      report.dnsTls.checks.push(check);

      const addressSummary = check.dnsAddresses.length > 0 ? check.dnsAddresses.join(', ') : 'none';
      console.log(`  url: ${check.url}`);
      console.log(`    host: ${check.host ?? 'n/a'} protocol: ${check.protocol ?? 'n/a'} dns: ${addressSummary}`);
      if (check.statusCode !== null) {
        console.log(`    https status: ${check.statusCode} tls: ${check.tlsProtocol ?? 'unknown'}`);
      }
      if (check.certificate) {
        console.log(`    cert subject: ${check.certificate.subjectCn ?? 'n/a'} issuer: ${check.certificate.issuerCn ?? 'n/a'}`);
        console.log(`    cert valid: ${check.certificate.validFrom ?? 'n/a'} -> ${check.certificate.validTo ?? 'n/a'}`);
      }

      if ((check.errors ?? []).length > 0) {
        logList(check.errors, 'error');
      }
      if ((check.warnings ?? []).length > 0) {
        logList(check.warnings, 'warn');
      }
    }
  }

  if (options.runRehearsal) {
    logHeader('Running staging shipping + ops rehearsal');

    const thisFilePath = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(thisFilePath), '..', '..');
    const rehearsalScriptPath = path.join(repoRoot, 'backend', 'scripts', 'staging-shipping-ops-rehearsal.mjs');

    try {
      await runCommand(process.execPath, [rehearsalScriptPath], {
        ...(options.apiBaseUrl ? { API_BASE_URL: options.apiBaseUrl } : {}),
      });
      console.log('  ok rehearsal completed');
    } catch (error) {
      report.rehearsal.ok = false;
      report.rehearsal.error = error instanceof Error ? error.message : String(error);
      console.log(`  error rehearsal failed: ${report.rehearsal.error}`);
    }
  }

  if (options.cleanupDb) {
    logHeader('Running DB cleanup');
    if (!options.confirmDbCleanup) {
      console.log('  warn running in dry-run mode (no changes will be committed)');
      console.log('  note use --confirm-db-cleanup to apply deletions');
    }

    try {
      report.cleanup.summary = await runDbCleanup({
        apply: options.confirmDbCleanup,
      });

      console.log(`  target users matched: ${report.cleanup.summary.targetUsers.length}`);
      for (const user of report.cleanup.summary.targetUsers) {
        console.log(`    - ${user.id} (${user.username ?? 'n/a'} | ${user.email ?? 'n/a'})`);
      }

      const deleteEntries = Object.entries(report.cleanup.summary.deletedRows);
      if (deleteEntries.length === 0) {
        console.log('  no rows matched cleanup criteria');
      } else {
        for (const [label, rowCount] of deleteEntries) {
          console.log(`  ${label}: ${rowCount}`);
        }
      }

      if (report.cleanup.summary.skippedTables.length > 0) {
        console.log(`  skipped tables: ${report.cleanup.summary.skippedTables.join(', ')}`);
      }

      if (options.confirmDbCleanup) {
        console.log('  ok cleanup committed');
      } else {
        console.log('  ok cleanup dry-run completed and rolled back');
      }
    } catch (error) {
      report.cleanup.ok = false;
      report.cleanup.error = error instanceof Error ? error.message : String(error);
      console.log(`  error cleanup failed: ${report.cleanup.error}`);
    }
  }

  const failed = hasFailure(report, options.strict);

  logHeader('Phase 8 summary');
  console.log(`  strict mode: ${options.strict}`);
  console.log(`  status: ${failed ? 'failed' : 'passed'}`);

  if (options.json) {
    console.log('\n[phase8] JSON summary');
    console.log(JSON.stringify(report, null, 2));
  }

  if (failed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[phase8] fatal error');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
