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

export async function loginWithPassword(input: { email: string; password: string }) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!('ok' in payload) || payload.ok !== true) {
      throw new Error('Invalid credentials');
    }

    await persistAuthSession(payload);

    return {
      user: payload.user,
      storeUser: toStoreUser(payload.user),
    };
  } catch (error) {
    throw new Error(toFriendlyError(error, 'Unable to log in right now.'));
  }
}

export async function signupWithPassword(input: { username: string; email: string; password: string }) {
  try {
    const payload = await fetchJson<AuthSuccessResponse | AuthFailureResponse>('/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!('ok' in payload) || payload.ok !== true) {
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
