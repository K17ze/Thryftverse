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

export interface NotificationEvent {
  id: string;
  userId: string;
  channel: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  status: 'queued' | 'sent' | 'failed';
  providerMessageId: string | null;
  providerError: string | null;
  createdAt: string;
  sentAt: string | null;
}

interface ListNotificationEventsResponse {
  ok: true;
  items: NotificationEvent[];
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

export async function listNotificationEvents(userId: string, limit = 30): Promise<NotificationEvent[]> {
  const payload = await fetchJson<ListNotificationEventsResponse>(
    `/notifications/events?userId=${encodeURIComponent(userId)}&limit=${limit}`
  );

  return payload.items;
}
