import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETTINGS_PREF_STORAGE_KEY = 'thryftverse:settings-pref:v1';
export const PUSH_NOTIF_PREF_STORAGE_KEY = 'thryftverse:push-notif-pref:v1';

export const LANGUAGE_OPTIONS = ['English (EN)', 'Spanish (ES)', 'French (FR)', 'German (DE)'] as const;
export type SupportedLanguageOption = (typeof LANGUAGE_OPTIONS)[number];

export interface SettingsPreferences {
  language: SupportedLanguageOption;
  emailNotificationsEnabled: boolean;
}

export interface PushNotificationDefinition {
  key: string;
  label: string;
  subtitle: string;
}

export const PUSH_NOTIFICATION_DEFINITIONS: PushNotificationDefinition[] = [
  { key: 'messages', label: 'New messages', subtitle: 'When someone sends you a message' },
  { key: 'offers', label: 'Offers received', subtitle: 'When buyers make an offer on your item' },
  { key: 'wishlist', label: 'Wishlist activity', subtitle: 'When someone likes your item' },
  { key: 'followers', label: 'New followers', subtitle: 'When someone starts following you' },
  { key: 'orderUpdates', label: 'Order updates', subtitle: 'Shipping and delivery status changes' },
  { key: 'priceDrops', label: 'Price drops', subtitle: 'For items on your wishlist' },
  { key: 'news', label: 'Thryftverse news', subtitle: 'Promotions, features and announcements' },
];

export type PushNotificationToggles = Record<string, boolean>;

export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = {
  language: 'English (EN)',
  emailNotificationsEnabled: true,
};

export function buildDefaultPushNotificationToggles(keys: readonly string[]): PushNotificationToggles {
  return Object.fromEntries(keys.map((key) => [key, true])) as PushNotificationToggles;
}

export function countEnabledPushNotificationToggles(toggles: PushNotificationToggles): number {
  return Object.values(toggles).filter(Boolean).length;
}

function isSupportedLanguage(value: unknown): value is SupportedLanguageOption {
  return typeof value === 'string' && LANGUAGE_OPTIONS.includes(value as SupportedLanguageOption);
}

export async function getStoredSettingsPreferences(): Promise<SettingsPreferences> {
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_PREF_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS_PREFERENCES;
    }

    const parsed = JSON.parse(raw) as Partial<SettingsPreferences>;

    return {
      language: isSupportedLanguage(parsed.language)
        ? parsed.language
        : DEFAULT_SETTINGS_PREFERENCES.language,
      emailNotificationsEnabled:
        typeof parsed.emailNotificationsEnabled === 'boolean'
          ? parsed.emailNotificationsEnabled
          : DEFAULT_SETTINGS_PREFERENCES.emailNotificationsEnabled,
    };
  } catch {
    return DEFAULT_SETTINGS_PREFERENCES;
  }
}

export async function setStoredSettingsPreferences(preferences: SettingsPreferences): Promise<void> {
  await AsyncStorage.setItem(SETTINGS_PREF_STORAGE_KEY, JSON.stringify(preferences));
}

export async function getStoredPushNotificationToggles(
  defaultToggles: PushNotificationToggles
): Promise<PushNotificationToggles> {
  try {
    const raw = await AsyncStorage.getItem(PUSH_NOTIF_PREF_STORAGE_KEY);
    if (!raw) {
      return defaultToggles;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const merged: PushNotificationToggles = { ...defaultToggles };

    Object.keys(defaultToggles).forEach((key) => {
      if (typeof parsed[key] === 'boolean') {
        merged[key] = parsed[key] as boolean;
      }
    });

    return merged;
  } catch {
    return defaultToggles;
  }
}

export async function setStoredPushNotificationToggles(
  toggles: PushNotificationToggles
): Promise<void> {
  await AsyncStorage.setItem(PUSH_NOTIF_PREF_STORAGE_KEY, JSON.stringify(toggles));
}
