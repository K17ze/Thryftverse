import { Platform } from 'react-native';

function normalizeBaseUrl(url: string) {
  return url.replace(/\/$/, '');
}

export function getApiBaseUrl() {
  const configured = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (configured) {
    return normalizeBaseUrl(configured);
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

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    throw new ApiRequestError(`Network request failed for ${url}: ${(error as Error).message}`);
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new ApiRequestError(
      `Request failed (${response.status}) for ${url}`,
      response.status,
      payload
    );
  }

  return payload as T;
}
