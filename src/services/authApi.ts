import { ApiRequestError, clearAuthSession, fetchJson, getAuthSession, setAuthSession } from '../lib/apiClient';

export interface AuthUser {
  id: string;
  username: string;
  email: string | null;
  role: 'user' | 'seller' | 'moderator' | 'admin';
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

interface AuthSuccessResponse {
  ok: true;
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: string;
}

interface AuthFailureResponse {
  ok: false;
  error: string;
}

interface LoginFailureResponse extends AuthFailureResponse {
  code?: string;
  attemptsRemaining?: number;
}

interface MagicLinkRequestSuccessResponse {
  ok: true;
  message: string;
  developmentMagicLink?: string;
  developmentToken?: string;
}

interface OtpRequestSuccessResponse {
  ok: true;
  challengeId: string;
  expiresInSeconds: number;
  developmentCode?: string;
}

interface OtpFailureResponse extends AuthFailureResponse {
  code?: string;
  attemptsRemaining?: number;
}

export interface MagicLinkRequestResult {
  message: string;
  developmentMagicLink?: string;
  developmentToken?: string;
}

export interface OtpRequestResult {
  challengeId: string;
  expiresInSeconds: number;
  developmentCode?: string;
}

export interface OtpVerificationError extends Error {
  code?: string;
  attemptsRemaining?: number;
}

export interface LoginWithPasswordError extends Error {
  code?: string;
  attemptsRemaining?: number;
}

interface TwoFactorEnrollResponse {
  ok: true;
  issuer: string;
  accountName: string;
  secret: string;
  otpauthUrl: string;
}

interface TwoFactorVerifyResponse {
  ok: true;
  message: string;
  recoveryCodes: string[];
}

interface TwoFactorDisableResponse {
  ok: true;
  message: string;
}

export interface TwoFactorEnrollmentResult {
  issuer: string;
  accountName: string;
  secret: string;
  otpauthUrl: string;
}

export interface TwoFactorVerificationResult {
  message: string;
  recoveryCodes: string[];
}

export interface DisableTwoFactorInput {
  code?: string;
  recoveryCode?: string;
}

interface AuthSessionPayload {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds: number;
  refreshTokenExpiresAt: string;
}

function toFriendlyError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError) {
    const details = error.details;
    if (
      details &&
      typeof details === 'object' &&
      'error' in details &&
      typeof (details as { error?: unknown }).error === 'string'
    ) {
      return (details as { error: string }).error;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

async function persistAuthSession(payload: AuthSessionPayload) {
  await setAuthSession({
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessTokenExpiresInSeconds: payload.accessTokenExpiresInSeconds,
    refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
  });
}

function toStoreUser(user: AuthUser) {
  return {
    id: user.id,
    username: user.username,
    avatar: `https://picsum.photos/seed/${encodeURIComponent(user.id)}/200/200`,
  };
}

function isAuthSuccess(payload: AuthSuccessResponse | AuthFailureResponse): payload is AuthSuccessResponse {
  return payload.ok === true;
}

function toOtpVerificationError(error: unknown, fallback: string): OtpVerificationError {
  if (error instanceof ApiRequestError) {
    const details = error.details;

    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const message =
        typeof (details as { error?: unknown }).error === 'string'
          ? (details as { error: string }).error
          : fallback;
      const otpError = new Error(message) as OtpVerificationError;
      otpError.code =
        typeof (details as { code?: unknown }).code === 'string'
          ? (details as { code: string }).code
          : undefined;
      otpError.attemptsRemaining =
        typeof (details as { attemptsRemaining?: unknown }).attemptsRemaining === 'number'
          ? (details as { attemptsRemaining: number }).attemptsRemaining
          : undefined;

      return otpError;
    }
  }

  return new Error(toFriendlyError(error, fallback)) as OtpVerificationError;
}

function toLoginError(error: unknown, fallback: string): LoginWithPasswordError {
  if (error instanceof ApiRequestError) {
    const details = error.details;
    if (details && typeof details === 'object' && !Array.isArray(details)) {
      const loginError = new Error(
        typeof (details as { error?: unknown }).error === 'string'
          ? (details as { error: string }).error
          : fallback
      ) as LoginWithPasswordError;
      loginError.code =
        typeof (details as { code?: unknown }).code === 'string'
          ? (details as { code: string }).code
          : undefined;
      loginError.attemptsRemaining =
        typeof (details as { attemptsRemaining?: unknown }).attemptsRemaining === 'number'
          ? (details as { attemptsRemaining: number }).attemptsRemaining
          : undefined;
      return loginError;
    }
  }

  return new Error(toFriendlyError(error, fallback)) as LoginWithPasswordError;
}

export async function loginWithPassword(input: {
  email: string;
  password: string;
  twoFactorCode?: string;
  recoveryCode?: string;
}) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | LoginFailureResponse>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!isAuthSuccess(payload)) {
      const loginError = new Error(payload.error) as LoginWithPasswordError;
      loginError.code = payload.code;
      loginError.attemptsRemaining = payload.attemptsRemaining;
      throw loginError;
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw toLoginError(error, 'Unable to log in right now.');
  }
}

export async function signupWithPassword(input: { username: string; email: string; password: string }) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!isAuthSuccess(payload)) {
      throw new Error('Unable to create account');
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to create account right now.'));
  }
}

export async function requestPasswordReset(email: string) {
  try {
    await fetchJson('/auth/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to start password reset right now.'));
  }
}

export async function loginWithGoogleIdToken(idToken: string) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/oauth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });

    if (!isAuthSuccess(payload)) {
      throw new Error('Google sign-in failed');
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to sign in with Google right now.'));
  }
}

export async function loginWithAppleIdentityToken(identityToken: string) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/oauth/apple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityToken }),
    });

    if (!isAuthSuccess(payload)) {
      throw new Error('Apple sign-in failed');
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to sign in with Apple right now.'));
  }
}

export async function requestMagicLink(email: string): Promise<MagicLinkRequestResult> {
  try {
    const payload = await fetchJson<MagicLinkRequestSuccessResponse | AuthFailureResponse>('/auth/magic-link/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if ('ok' in payload && payload.ok === true) {
      return {
        message: payload.message,
        developmentMagicLink: payload.developmentMagicLink,
        developmentToken: payload.developmentToken,
      };
    }

    throw new Error('Unable to request magic link');
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to send magic link right now.'));
  }
}

export async function consumeMagicLink(input: { token: string; email?: string }) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/magic-link/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!isAuthSuccess(payload)) {
      throw new Error('Magic-link sign-in failed');
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to sign in with magic link right now.'));
  }
}

export async function requestEmailOtp(email: string): Promise<OtpRequestResult> {
  try {
    const payload = await fetchJson<OtpRequestSuccessResponse | AuthFailureResponse>('/auth/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if ('ok' in payload && payload.ok === true) {
      return {
        challengeId: payload.challengeId,
        expiresInSeconds: payload.expiresInSeconds,
        developmentCode: payload.developmentCode,
      };
    }

    throw new Error('Unable to request OTP');
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to send OTP right now.'));
  }
}

export async function verifyEmailOtp(input: { challengeId: string; code: string }) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | OtpFailureResponse>('/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!isAuthSuccess(payload)) {
      const otpError = new Error(payload.error) as OtpVerificationError;
      otpError.code = payload.code;
      otpError.attemptsRemaining = payload.attemptsRemaining;
      throw otpError;
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw toOtpVerificationError(error, 'Unable to verify OTP right now.');
  }
}

export async function restoreAuthSession() {
  const session = await getAuthSession();
  if (!session?.refreshToken) {
    return null;
  }

  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: session.refreshToken,
      }),
    });

    if (!isAuthSuccess(payload)) {
      await clearAuthSession();
      return null;
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) {
      await clearAuthSession();
    }
    return null;
  }
}

export async function logoutFromSession() {
  try {
    const session = await getAuthSession();
    await fetchJson('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: session?.refreshToken,
      }),
    });
  } catch {
    // Ignore logout network errors and always clear local session.
  }

  await clearAuthSession();
}

export async function requestTwoFactorEnrollment(): Promise<TwoFactorEnrollmentResult> {
  try {
    const payload = await fetchJson<TwoFactorEnrollResponse>('/auth/2fa/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    return {
      issuer: payload.issuer,
      accountName: payload.accountName,
      secret: payload.secret,
      otpauthUrl: payload.otpauthUrl,
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to start two-factor setup right now.'));
  }
}

export async function verifyTwoFactorEnrollment(code: string): Promise<TwoFactorVerificationResult> {
  try {
    const payload = await fetchJson<TwoFactorVerifyResponse | AuthFailureResponse>('/auth/2fa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    if ('ok' in payload && payload.ok === true) {
      return {
        message: payload.message,
        recoveryCodes: payload.recoveryCodes,
      };
    }

    throw new Error(payload.error);
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to verify two-factor setup right now.'));
  }
}

export async function disableTwoFactor(input: DisableTwoFactorInput): Promise<void> {
  if (!input.code && !input.recoveryCode) {
    throw new Error('Two-factor code or recovery code is required.');
  }

  try {
    await fetchJson<TwoFactorDisableResponse>('/auth/2fa/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to disable two-factor authentication right now.'));
  }
}
