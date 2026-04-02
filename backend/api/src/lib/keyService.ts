import { Buffer } from 'node:buffer';
import { z } from 'zod';
import { config } from '../config.js';

const encryptResponseSchema = z.object({
  ok: z.literal(true),
  ciphertext: z.string().min(1),
  keyVersion: z.number().int().positive(),
  algorithm: z.string().min(1),
});

const decryptResponseSchema = z.object({
  ok: z.literal(true),
  plaintextB64: z.string().min(1),
  keyVersion: z.number().int().positive(),
});

const rotateResponseSchema = z.object({
  ok: z.literal(true),
  keyName: z.string().min(1),
  keyVersion: z.number().int().positive(),
});

const rewrapResponseSchema = z.object({
  ok: z.literal(true),
  keyName: z.string().min(1),
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  ciphertext: z.string().min(1),
});

function toUtf8Base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload?.error) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and return fallback below.
  }

  return `${response.status} ${response.statusText}`;
}

async function postKeyService<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${config.keyServiceUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Key service request failed: ${await parseErrorMessage(response)}`);
  }

  return (await response.json()) as T;
}

async function postKeyServiceWithAdmin<T>(path: string, body: object): Promise<T> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (config.keyServiceAdminToken) {
    headers['x-admin-token'] = config.keyServiceAdminToken;
  }

  const response = await fetch(`${config.keyServiceUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Key service request failed: ${await parseErrorMessage(response)}`);
  }

  return (await response.json()) as T;
}

export async function encryptJsonPayload(
  keyName: 'profile' | 'message' | 'wallet',
  payload: unknown,
  aad: string
): Promise<{ ciphertext: string; keyVersion: number; algorithm: string }> {
  const payloadJson = JSON.stringify(payload);

  const response = encryptResponseSchema.parse(
    await postKeyService('/encrypt', {
      keyName,
      plaintextB64: toUtf8Base64(payloadJson),
      aadB64: toUtf8Base64(aad),
    })
  );

  return {
    ciphertext: response.ciphertext,
    keyVersion: response.keyVersion,
    algorithm: response.algorithm,
  };
}

export async function decryptJsonPayload<T>(ciphertext: string, aad: string): Promise<T> {
  const response = decryptResponseSchema.parse(
    await postKeyService('/decrypt', {
      ciphertext,
      aadB64: toUtf8Base64(aad),
    })
  );

  const decoded = Buffer.from(response.plaintextB64, 'base64').toString('utf8');
  return JSON.parse(decoded) as T;
}

export async function assertKeyServiceConnectivity(): Promise<void> {
  const response = await fetch(`${config.keyServiceUrl}/health`);
  if (!response.ok) {
    throw new Error(`Key service responded ${response.status}`);
  }

  const payload = (await response.json()) as { ok?: boolean };
  if (!payload.ok) {
    throw new Error('Key service health did not return ok=true');
  }
}

export async function rotateKeyVersion(
  keyName: 'profile' | 'message' | 'wallet'
): Promise<{ keyName: string; keyVersion: number }> {
  const response = rotateResponseSchema.parse(
    await postKeyServiceWithAdmin(`/keys/${keyName}/rotate`, {})
  );

  return {
    keyName: response.keyName,
    keyVersion: response.keyVersion,
  };
}

export async function rewrapCiphertext(
  ciphertext: string,
  aad: string,
  targetKeyVersion?: number
): Promise<{ ciphertext: string; fromVersion: number; toVersion: number }> {
  const response = rewrapResponseSchema.parse(
    await postKeyServiceWithAdmin('/rewrap', {
      ciphertext,
      aadB64: toUtf8Base64(aad),
      targetKeyVersion,
    })
  );

  return {
    ciphertext: response.ciphertext,
    fromVersion: response.fromVersion,
    toVersion: response.toVersion,
  };
}
