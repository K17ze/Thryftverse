import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, DevSettings } from 'react-native';
import { refreshThemeFromRuntime } from '../constants/colors';

let reloadWithExpoUpdates: (() => Promise<void>) | null = null;

try {
  const Updates = require('expo-updates');
  if (typeof Updates?.reloadAsync === 'function') {
    reloadWithExpoUpdates = Updates.reloadAsync;
  }
} catch {
  reloadWithExpoUpdates = null;
}

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_OVERRIDE_GLOBAL_KEY = '__THRYFTVERSE_THEME_OVERRIDE__';

export const THEME_PREF_STORAGE_KEY = 'thryftverse:theme-pref:v1';

const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';
const VALID_THEME_PREFERENCES: ThemePreference[] = ['system', 'light', 'dark'];
const themePreferenceSubscribers = new Set<(preference: ThemePreference) => void>();

function parseThemePreference(rawValue: string | null): ThemePreference {
  if (!rawValue) {
    return DEFAULT_THEME_PREFERENCE;
  }

  const normalized = rawValue.trim().toLowerCase();
  return VALID_THEME_PREFERENCES.includes(normalized as ThemePreference)
    ? (normalized as ThemePreference)
    : DEFAULT_THEME_PREFERENCE;
}

export async function getStoredThemePreference(): Promise<ThemePreference> {
  try {
    const raw = await AsyncStorage.getItem(THEME_PREF_STORAGE_KEY);
    return parseThemePreference(raw);
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export async function setStoredThemePreference(preference: ThemePreference): Promise<void> {
  await AsyncStorage.setItem(THEME_PREF_STORAGE_KEY, preference);
}

export function subscribeThemePreferenceChange(
  subscriber: (preference: ThemePreference) => void
): () => void {
  themePreferenceSubscribers.add(subscriber);
  return () => {
    themePreferenceSubscribers.delete(subscriber);
  };
}

function notifyThemePreferenceChange(preference: ThemePreference): void {
  themePreferenceSubscribers.forEach((subscriber) => {
    try {
      subscriber(preference);
    } catch {
      // Ignore subscriber failures to keep theme updates resilient.
    }
  });
}

export function applyThemePreference(preference: ThemePreference): void {
  (globalThis as any)[THEME_OVERRIDE_GLOBAL_KEY] = preference === 'system' ? null : preference;

  const nextScheme = preference === 'system' ? null : preference;
  const setColorScheme = (Appearance as any).setColorScheme as
    | ((scheme: 'light' | 'dark' | null) => void)
    | undefined;

  if (typeof setColorScheme === 'function') {
    setColorScheme(nextScheme);
  }

  refreshThemeFromRuntime();
  notifyThemePreferenceChange(preference);
}

export function getThemePreferenceLabel(preference: ThemePreference): string {
  if (preference === 'light') {
    return 'Light';
  }

  if (preference === 'dark') {
    return 'Dark';
  }

  return 'System';
}

export async function updateThemePreference(
  preference: ThemePreference,
  options?: { reloadApp?: boolean }
): Promise<boolean> {
  await setStoredThemePreference(preference);
  applyThemePreference(preference);

  if (!options?.reloadApp) {
    return false;
  }

  try {
    DevSettings.reload();
    return true;
  } catch {
    // Fall through to Expo Updates reload when DevSettings is unavailable.
  }

  if (reloadWithExpoUpdates) {
    try {
      await reloadWithExpoUpdates();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}
