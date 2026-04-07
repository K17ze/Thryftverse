import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config.js';

export type OAuthProvider = 'google' | 'apple';

export interface VerifiedSocialIdentity {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
}

interface GoogleTokenInfoPayload {
  sub?: string;
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const appleJwks = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asBooleanLike(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    return value.trim().toLowerCase() === 'true';
  }

  return false;
}

function assertGoogleAudience(audience: string) {
  if (!config.googleOAuthClientIds.length) {
    if (config.nodeEnv === 'production') {
      throw new Error('Google OAuth audience allowlist is not configured');
    }

    return;
  }

  if (!config.googleOAuthClientIds.includes(audience)) {
    throw new Error('Google identity token audience is not allowed');
  }
}

export async function verifyGoogleIdentityToken(idToken: string): Promise<VerifiedSocialIdentity> {
  if (!idToken || idToken.length < 20) {
    throw new Error('Invalid Google identity token');
  }

  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    {
      method: 'GET',
      signal: AbortSignal.timeout(7000),
    }
  );

  if (!response.ok) {
    throw new Error('Unable to verify Google identity token');
  }

  const payload = (await response.json()) as GoogleTokenInfoPayload;

  const providerUserId = asNonEmptyString(payload.sub);
  const audience = asNonEmptyString(payload.aud);
  const issuer = asNonEmptyString(payload.iss);

  if (!providerUserId || !audience || !issuer) {
    throw new Error('Google identity token payload is incomplete');
  }

  if (issuer !== 'accounts.google.com' && issuer !== 'https://accounts.google.com') {
    throw new Error('Google identity token issuer is invalid');
  }

  assertGoogleAudience(audience);

  return {
    provider: 'google',
    providerUserId,
    email: asNonEmptyString(payload.email),
    emailVerified: asBooleanLike(payload.email_verified),
  };
}

export async function verifyAppleIdentityToken(identityToken: string): Promise<VerifiedSocialIdentity> {
  if (!identityToken || identityToken.length < 20) {
    throw new Error('Invalid Apple identity token');
  }

  if (config.nodeEnv === 'production' && !config.appleOAuthAudience) {
    throw new Error('Apple OAuth audience is not configured');
  }

  const verificationOptions: {
    issuer: string;
    audience?: string;
  } = {
    issuer: APPLE_ISSUER,
  };

  if (config.appleOAuthAudience) {
    verificationOptions.audience = config.appleOAuthAudience;
  }

  const { payload } = await jwtVerify(identityToken, appleJwks, verificationOptions);

  const providerUserId = asNonEmptyString(payload.sub);
  if (!providerUserId) {
    throw new Error('Apple identity token payload is incomplete');
  }

  return {
    provider: 'apple',
    providerUserId,
    email: asNonEmptyString(payload.email),
    emailVerified: asBooleanLike(payload.email_verified),
  };
}
