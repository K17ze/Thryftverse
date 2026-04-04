import { beforeEach, describe, expect, it, vi } from 'vitest';

const asyncStorageMock = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: asyncStorageMock,
}));

import {
  buildDefaultPushNotificationToggles,
  countEnabledPushNotificationToggles,
  DEFAULT_SETTINGS_PREFERENCES,
  getStoredPushNotificationToggles,
  getStoredSettingsPreferences,
  PUSH_NOTIF_PREF_STORAGE_KEY,
  SETTINGS_PREF_STORAGE_KEY,
  setStoredPushNotificationToggles,
  setStoredSettingsPreferences,
} from '../preferences/settingsPreferences';

describe('settings preference helpers', () => {
  it('builds a default push-toggle map with all keys enabled', () => {
    const toggles = buildDefaultPushNotificationToggles(['messages', 'offers', 'priceDrops']);

    expect(toggles).toEqual({
      messages: true,
      offers: true,
      priceDrops: true,
    });
  });

  it('counts only enabled push notification types', () => {
    const enabledCount = countEnabledPushNotificationToggles({
      messages: true,
      offers: false,
      wishlist: true,
      news: false,
    });

    expect(enabledCount).toBe(2);
  });

  it('handles empty push toggle sets', () => {
    expect(countEnabledPushNotificationToggles({})).toBe(0);
  });
});

describe('settings preference persistence', () => {
  beforeEach(() => {
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
  });

  it('reads stored settings preferences when payload is valid', async () => {
    asyncStorageMock.getItem.mockResolvedValueOnce(
      JSON.stringify({ language: 'French (FR)', emailNotificationsEnabled: false })
    );

    const preferences = await getStoredSettingsPreferences();

    expect(asyncStorageMock.getItem).toHaveBeenCalledWith(SETTINGS_PREF_STORAGE_KEY);
    expect(preferences).toEqual({
      language: 'French (FR)',
      emailNotificationsEnabled: false,
    });
  });

  it('falls back to defaults when stored settings payload is malformed', async () => {
    asyncStorageMock.getItem.mockResolvedValueOnce('not-json');

    const preferences = await getStoredSettingsPreferences();

    expect(preferences).toEqual(DEFAULT_SETTINGS_PREFERENCES);
  });

  it('writes settings preferences to storage', async () => {
    asyncStorageMock.setItem.mockResolvedValueOnce(undefined);

    await setStoredSettingsPreferences({
      language: 'Spanish (ES)',
      emailNotificationsEnabled: true,
    });

    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      SETTINGS_PREF_STORAGE_KEY,
      JSON.stringify({ language: 'Spanish (ES)', emailNotificationsEnabled: true })
    );
  });
});

describe('push notification toggle persistence', () => {
  const defaultToggles = {
    messages: true,
    offers: true,
    wishlist: true,
  };

  beforeEach(() => {
    asyncStorageMock.getItem.mockReset();
    asyncStorageMock.setItem.mockReset();
  });

  it('merges stored boolean toggle values onto defaults', async () => {
    asyncStorageMock.getItem.mockResolvedValueOnce(
      JSON.stringify({ messages: false, offers: true, wishlist: 'invalid', unknown: false })
    );

    const toggles = await getStoredPushNotificationToggles(defaultToggles);

    expect(asyncStorageMock.getItem).toHaveBeenCalledWith(PUSH_NOTIF_PREF_STORAGE_KEY);
    expect(toggles).toEqual({
      messages: false,
      offers: true,
      wishlist: true,
    });
  });

  it('falls back to defaults when reading push toggles throws', async () => {
    asyncStorageMock.getItem.mockRejectedValueOnce(new Error('storage unavailable'));

    const toggles = await getStoredPushNotificationToggles(defaultToggles);

    expect(toggles).toEqual(defaultToggles);
  });

  it('writes push toggles to storage', async () => {
    const nextToggles = {
      messages: false,
      offers: false,
      wishlist: true,
    };

    asyncStorageMock.setItem.mockResolvedValueOnce(undefined);
    await setStoredPushNotificationToggles(nextToggles);

    expect(asyncStorageMock.setItem).toHaveBeenCalledWith(
      PUSH_NOTIF_PREF_STORAGE_KEY,
      JSON.stringify(nextToggles)
    );
  });
});
