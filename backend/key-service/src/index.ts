import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { config } from './config.js';

type KeyVersionState = {
  version: number;
};

type ParsedCiphertext = {
  keyName: string;
  keyVersion: number;
  iv: Buffer;
  encrypted: Buffer;
  tag: Buffer;
};

const app = Fastify({ logger: true });

const keyState = new Map<string, KeyVersionState>(
  config.allowedKeys.map((name) => [name, { version: config.defaultKeyVersion }])
);

function toB64Url(value: Buffer): string {
  return value.toString('base64url');
}

function fromB64(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function fromB64Url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

function getStateForKey(keyName: string): KeyVersionState {
  const state = keyState.get(keyName);
  if (!state) {
    throw new Error(`Unknown key name: ${keyName}`);
  }
  return state;
}

function parseCiphertext(ciphertext: string): ParsedCiphertext {
  const segments = ciphertext.split('.');

  if (segments.length !== 6 || segments[0] !== 'tv1') {
    throw new Error('Invalid ciphertext format');
  }

  const [, keyName, versionStr, ivStr, encryptedStr, tagStr] = segments;
  const keyVersion = Number(versionStr);
  if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
    throw new Error('Invalid key version in ciphertext');
  }

  return {
    keyName,
    keyVersion,
    iv: fromB64Url(ivStr),
    encrypted: fromB64Url(encryptedStr),
    tag: fromB64Url(tagStr),
  };
}

function encryptWithVersion(
  keyName: string,
  keyVersion: number,
  plaintext: Buffer,
  aad: Buffer
): { ciphertext: string; algorithm: 'aes-256-gcm' } {
  const key = deriveKey(keyName, keyVersion);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  if (aad.length > 0) {
    cipher.setAAD(aad);
  }

  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  const ciphertext = [
    'tv1',
    keyName,
    String(keyVersion),
    toB64Url(iv),
    toB64Url(encrypted),
    toB64Url(tag),
  ].join('.');

  return {
    ciphertext,
    algorithm: 'aes-256-gcm',
  };
}

function decryptWithVersion(parsed: ParsedCiphertext, aad: Buffer): Buffer {
  const key = deriveKey(parsed.keyName, parsed.keyVersion);
  const decipher = createDecipheriv('aes-256-gcm', key, parsed.iv);
  if (aad.length > 0) {
    decipher.setAAD(aad);
  }
  decipher.setAuthTag(parsed.tag);

  return Buffer.concat([decipher.update(parsed.encrypted), decipher.final()]);
}

function deriveKey(keyName: string, keyVersion: number): Buffer {
  const info = Buffer.from(`thryftverse-key:${keyName}:v${keyVersion}`, 'utf8');
  const salt = Buffer.from('thryftverse-key-service-hkdf', 'utf8');
  const derived = hkdfSync('sha256', config.masterKey, salt, info, 32);
  return Buffer.isBuffer(derived) ? derived : Buffer.from(derived);
}

function ensureAdminToken(headerToken: string | undefined) {
  if (!config.adminToken) {
    return;
  }

  if (!headerToken || headerToken !== config.adminToken) {
    throw new Error('Missing or invalid admin token');
  }
}

const encryptSchema = z.object({
  keyName: z.string().min(1),
  plaintextB64: z.string().min(1),
  aadB64: z.string().optional(),
});

const decryptSchema = z.object({
  ciphertext: z.string().min(1),
  aadB64: z.string().optional(),
});

const rewrapSchema = z.object({
  ciphertext: z.string().min(1),
  aadB64: z.string().optional(),
  targetKeyVersion: z.number().int().positive().optional(),
});

app.get('/health', async () => {
  return {
    ok: true,
    service: 'thryftverse-key-service',
    region: config.region,
    country: config.country,
    keys: Array.from(keyState.entries()).map(([name, state]) => ({
      name,
      currentVersion: state.version,
    })),
  };
});

app.post('/encrypt', async (request, reply) => {
  const payload = encryptSchema.parse(request.body);

  let state: KeyVersionState;
  try {
    state = getStateForKey(payload.keyName);
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  const plaintext = fromB64(payload.plaintextB64);
  const aad = payload.aadB64 ? fromB64(payload.aadB64) : Buffer.alloc(0);

  const encryptedPayload = encryptWithVersion(payload.keyName, state.version, plaintext, aad);

  return {
    ok: true,
    keyName: payload.keyName,
    keyVersion: state.version,
    algorithm: encryptedPayload.algorithm,
    ciphertext: encryptedPayload.ciphertext,
  };
});

app.post('/decrypt', async (request, reply) => {
  const payload = decryptSchema.parse(request.body);
  let parsed: ParsedCiphertext;

  try {
    parsed = parseCiphertext(payload.ciphertext);
  } catch (error) {
    reply.code(400);
    return { ok: false, error: (error as Error).message };
  }

  try {
    getStateForKey(parsed.keyName);
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  const aad = payload.aadB64 ? fromB64(payload.aadB64) : Buffer.alloc(0);

  try {
    const plaintext = decryptWithVersion(parsed, aad);

    return {
      ok: true,
      keyName: parsed.keyName,
      keyVersion: parsed.keyVersion,
      plaintextB64: plaintext.toString('base64'),
    };
  } catch {
    reply.code(400);
    return {
      ok: false,
      error: 'Ciphertext authentication failed',
    };
  }
});

app.post('/rewrap', async (request, reply) => {
  const payload = rewrapSchema.parse(request.body);

  let parsed: ParsedCiphertext;
  try {
    parsed = parseCiphertext(payload.ciphertext);
  } catch (error) {
    reply.code(400);
    return { ok: false, error: (error as Error).message };
  }

  let state: KeyVersionState;
  try {
    ensureAdminToken(request.headers['x-admin-token'] as string | undefined);
    state = getStateForKey(parsed.keyName);
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }

  const targetKeyVersion = payload.targetKeyVersion ?? state.version;
  if (targetKeyVersion > state.version) {
    reply.code(400);
    return {
      ok: false,
      error: `targetKeyVersion cannot exceed current version (${state.version})`,
    };
  }

  const aad = payload.aadB64 ? fromB64(payload.aadB64) : Buffer.alloc(0);

  try {
    const plaintext = decryptWithVersion(parsed, aad);
    const rewrapped = encryptWithVersion(parsed.keyName, targetKeyVersion, plaintext, aad);

    return {
      ok: true,
      keyName: parsed.keyName,
      fromVersion: parsed.keyVersion,
      toVersion: targetKeyVersion,
      algorithm: rewrapped.algorithm,
      ciphertext: rewrapped.ciphertext,
    };
  } catch {
    reply.code(400);
    return {
      ok: false,
      error: 'Ciphertext rewrap failed',
    };
  }
});

app.post('/keys/:keyName/rotate', async (request, reply) => {
  const schema = z.object({
    keyName: z.string().min(1),
  });

  const { keyName } = schema.parse(request.params);

  try {
    ensureAdminToken(request.headers['x-admin-token'] as string | undefined);
    const state = getStateForKey(keyName);
    state.version += 1;

    return {
      ok: true,
      keyName,
      keyVersion: state.version,
    };
  } catch (error) {
    reply.code(400);
    return {
      ok: false,
      error: (error as Error).message,
    };
  }
});

const start = async () => {
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    app.log.info(`Key service running on :${config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

void start();
