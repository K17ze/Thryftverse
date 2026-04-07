import { fetchJson } from '../lib/apiClient';

export type PushProvider = 'expo';
export type PushPlatform = 'ios' | 'android' | 'web';

interface RegisterNotificationDeviceResponse {
  ok: true;
  device: {
    id: number;
    userId: string;
    provider: PushProvider;
    platform: PushPlatform;
    token: string;
    isActive: boolean;
    appVersion: string | null;
    createdAt: string;
    lastSeenAt: string;
  };
}

interface ListNotificationEventsResponse {
  ok: true;
  items: Array<{
    id: string;
    userId: string;
    channel: string;
    title: string;
    body: string;
    status: 'queued' | 'sent' | 'failed';
    createdAt: string;
    sentAt: string | null;
  }>;
}

export interface RegisterNotificationDeviceInput {
  userId: string;
  token: string;
  provider?: PushProvider;
  platform: PushPlatform;
  appVersion?: string;
  metadata?: Record<string, unknown>;
}

export async function registerNotificationDevice(input: RegisterNotificationDeviceInput) {
  const payload = await fetchJson<RegisterNotificationDeviceResponse>('/notifications/devices/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: 'expo',
      ...input,
    }),
  });

  return payload.device;
}

export async function deactivateNotificationDevice(token: string): Promise<void> {
  await fetchJson<{ ok: true }>(`/notifications/devices/${encodeURIComponent(token)}`, {
    method: 'DELETE',
  });
}

export async function listNotificationEvents(userId: string, limit = 30) {
  const payload = await fetchJson<ListNotificationEventsResponse>(
    `/notifications/events?userId=${encodeURIComponent(userId)}&limit=${limit}`
  );

  return payload.items;
}
