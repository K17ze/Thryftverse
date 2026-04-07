import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function padLeft(value: string, targetLength: number): string {
  if (value.length >= targetLength) {
    return value;
  }

  return '0'.repeat(targetLength - value.length) + value;
}

export function generateTotpSecret(size = 20): string {
  const random = crypto.randomBytes(size);
  let bits = '';

  for (const byte of random) {
    bits += byte.toString(2).padStart(8, '0');
  }

  let output = '';
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5);
    if (chunk.length < 5) {
      output += BASE32_ALPHABET[parseInt(chunk.padEnd(5, '0'), 2)];
      break;
    }

    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }

  return output;
}

function decodeBase32(base32: string): Buffer {
  const normalized = base32.replace(/\s+/g, '').replace(/=+$/g, '').toUpperCase();
  let bits = '';

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error('Invalid base32 secret');
    }

    bits += index.toString(2).padStart(5, '0');
  }

  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(parseInt(bits.slice(offset, offset + 8), 2));
  }

  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = decodeBase32(secret);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binaryCode = (
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff)
  );

  const otp = binaryCode % (10 ** digits);
  return padLeft(String(otp), digits);
}

export function totp(secret: string, options?: { stepSeconds?: number; digits?: number; timestampMs?: number }): string {
  const stepSeconds = options?.stepSeconds ?? 30;
  const digits = options?.digits ?? 6;
  const timestampMs = options?.timestampMs ?? Date.now();
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);

  return hotp(secret, counter, digits);
}

export function verifyTotp(
  secret: string,
  token: string,
  options?: {
    stepSeconds?: number;
    digits?: number;
    timestampMs?: number;
    window?: number;
  }
): boolean {
  const normalizedToken = token.replace(/\s+/g, '');
  const stepSeconds = options?.stepSeconds ?? 30;
  const digits = options?.digits ?? 6;
  const timestampMs = options?.timestampMs ?? Date.now();
  const window = options?.window ?? 1;
  const currentCounter = Math.floor(timestampMs / 1000 / stepSeconds);

  for (let drift = -window; drift <= window; drift += 1) {
    const expected = hotp(secret, currentCounter + drift, digits);
    if (expected === normalizedToken) {
      return true;
    }
  }

  return false;
}

export function createOtpauthUrl(input: {
  secret: string;
  issuer: string;
  accountName: string;
  digits?: number;
  period?: number;
}): string {
  const digits = input.digits ?? 6;
  const period = input.period ?? 30;
  const label = `${input.issuer}:${input.accountName}`;

  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(
    input.secret
  )}&issuer=${encodeURIComponent(input.issuer)}&algorithm=SHA1&digits=${digits}&period=${period}`;
}

export function generateRecoveryCodes(count = 8): string[] {
  const codes: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }

  return codes;
}
