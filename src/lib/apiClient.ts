import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTH_SESSION_STORAGE_KEY = 'thryftverse.auth.session.v1';

interface AuthSessionState {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresInSeconds?: number;
  refreshTokenExpiresAt?: string;
}

let authSessionState: AuthSessionState | null = null;
let authSessionLoaded = false;
let refreshInFlight: Promise<string | null> | null = null;

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

function extractHost(input: unknown) {
  if (typeof input !== 'string' || input.trim().length === 0) {
    return null;
  }

  const trimmed = input.trim();

  const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '');
  const withoutPath = withoutScheme.split('/')[0];
  const withoutPort = withoutPath.split(':')[0];

  if (!withoutPort || withoutPort === 'localhost' || withoutPort === '127.0.0.1') {
    return null;
  }

  return withoutPort;
}

function getExpoDevelopmentHost() {
  const fromExpoConfig = (Constants.expoConfig as { hostUri?: string } | null)?.hostUri;
  const fromManifest2 = (Constants as unknown as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } })
    .manifest2?.extra?.expoClient?.hostUri;
  const fromLegacyManifest = (Constants as unknown as { manifest?: { debuggerHost?: string } })
    .manifest?.debuggerHost;

  return extractHost(fromExpoConfig) ?? extractHost(fromManifest2) ?? extractHost(fromLegacyManifest);
}

export function getApiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
  }

  const developmentHost = getExpoDevelopmentHost();
  if (developmentHost) {
    return `http://${developmentHost}:4000`;
  }

  if (Platform.OS === 'android') {
    // Android emulator localhost bridge.
    return 'http://10.0.2.2:4000';
  }

  return 'http://localhost:4000';
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status?: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export interface ParsedApiError {
  message: string;
  code: string | null;
  status: number | undefined;
  isNetworkError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseApiError(error: unknown, fallback = 'Request failed'): ParsedApiError {
  if (error instanceof ApiRequestError) {
    const details = error.details;

    if (isRecord(details)) {
      const messageFromPayload = typeof details.error === 'string'
        ? details.error
        : typeof details.message === 'string'
          ? details.message
          : null;
      const codeFromPayload = typeof details.code === 'string' ? details.code : null;

      return {
        message: messageFromPayload ?? error.message ?? fallback,
        code: codeFromPayload,
        status: error.status,
        isNetworkError: error.status === undefined,
      };
    }

    if (typeof details === 'string' && details.trim().length > 0) {
      return {
        message: details,
        code: null,
        status: error.status,
        isNetworkError: error.status === undefined,
      };
    }

    return {
      message: error.message || fallback,
      code: null,
      status: error.status,
      isNetworkError: error.status === undefined,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message || fallback,
      code: null,
      status: undefined,
      isNetworkError: false,
    };
  }

  return {
    message: fallback,
    code: null,
    status: undefined,
    isNetworkError: false,
  };
}

function shouldSkipTokenRefresh(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return (
    normalized.startsWith('/auth/login') ||
    normalized.startsWith('/auth/signup') ||
    normalized.startsWith('/auth/refresh') ||
    normalized.startsWith('/auth/password-reset')
  );
}

async function hydrateAuthSession() {
  if (authSessionLoaded) {
    return;
  }

  authSessionLoaded = true;

  try {
    const raw = await AsyncStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) {
      authSessionState = null;
      return;
    }

    const parsed = JSON.parse(raw) as Partial<AuthSessionState>;
    if (
      typeof parsed.accessToken === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      parsed.accessToken.length > 0 &&
      parsed.refreshToken.length > 0
    ) {
      authSessionState = {
        accessToken: parsed.accessToken,
        refreshToken: parsed.refreshToken,
        accessTokenExpiresInSeconds:
          typeof parsed.accessTokenExpiresInSeconds === 'number'
            ? parsed.accessTokenExpiresInSeconds
            : undefined,
        refreshTokenExpiresAt:
          typeof parsed.refreshTokenExpiresAt === 'string' ? parsed.refreshTokenExpiresAt : undefined,
      };
      return;
    }

    authSessionState = null;
  } catch {
    authSessionState = null;
  }
}

export async function getAuthSession() {
  await hydrateAuthSession();
  return authSessionState;
}

export async function setAuthSession(nextSession: AuthSessionState) {
  authSessionState = nextSession;
  authSessionLoaded = true;
  await AsyncStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(nextSession));
}

export async function clearAuthSession() {
  authSessionState = null;
  authSessionLoaded = true;
  await AsyncStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

async function refreshAccessToken(baseUrl: string): Promise<string | null> {
  await hydrateAuthSession();

  if (!authSessionState?.refreshToken) {
    return null;
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: authSessionState?.refreshToken,
        }),
      });

      if (!response.ok) {
        await clearAuthSession();
        return null;
      }

      const payload = (await response.json()) as {
        ok?: boolean;
        accessToken?: string;
        refreshToken?: string;
        accessTokenExpiresInSeconds?: number;
        refreshTokenExpiresAt?: string;
      };

      if (
        payload.ok !== true ||
        typeof payload.accessToken !== 'string' ||
        typeof payload.refreshToken !== 'string'
      ) {
        await clearAuthSession();
        return null;
      }

      await setAuthSession({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        accessTokenExpiresInSeconds: payload.accessTokenExpiresInSeconds,
        refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
      });

      return payload.accessToken;
    } catch {
      await clearAuthSession();
      return null;
    }
  })();

  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

async function parsePayload(response: Response) {
  const text = await response.text();
  let payload: unknown = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  return payload;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  await hydrateAuthSession();

  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const execute = async (overrideAccessToken?: string) => {
    const headers = new Headers(init?.headers ?? {});
    const token = overrideAccessToken ?? authSessionState?.accessToken;

    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return fetch(url, {
      ...init,
      headers,
    });
  };

  let response: Response;
  try {
    response = await execute();
  } catch (error) {
    throw new ApiRequestError(`Network request failed for ${url}: ${(error as Error).message}`);
  }

  if (
    response.status === 401 &&
    !shouldSkipTokenRefresh(path) &&
    authSessionState?.refreshToken
  ) {
    const refreshedAccessToken = await refreshAccessToken(baseUrl);
    if (refreshedAccessToken) {
      try {
        response = await execute(refreshedAccessToken);
      } catch (error) {
        throw new ApiRequestError(`Network request failed for ${url}: ${(error as Error).message}`);
      }
    }
  }

  const payload = await parsePayload(response);

  if (!response.ok) {
    throw new ApiRequestError(
      `Request failed (${response.status}) for ${url}`,
      response.status,
      payload
    );
  }

  return payload as T;
}
