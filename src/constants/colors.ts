import { Appearance } from 'react-native';

export type ThemeMode = 'dark' | 'light';

const THEME_OVERRIDE_GLOBAL_KEY = '__THRYFTVERSE_THEME_OVERRIDE__';

const DARK_COLORS = {
  // Backgrounds
  background: '#090909',
  surface: '#121212',
  card: '#181818',
  cardAlt: '#1f1f1f',

  // Borders
  border: '#2d2923',
  borderLight: '#3a342d',

  // Accent / CTAs
  accent: '#e8dcc8',
  accentPress: '#d7c6ab',

  // Text
  textPrimary: '#f6f2ea',
  textSecondary: '#b7afa2',
  textMuted: '#857d71',
  textInverse: '#0b0907',

  // Status
  sold: '#ffffff',
  danger: '#ff4d4d',
  success: '#4caf50',
  star: '#ffc107',

  // Tab bar
  tabActive: '#e8dcc8',
  tabInactive: '#7c7469',

  // Transparent overlays
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(0,0,0,0.4)',
} as const;

const LIGHT_COLORS = {
  // Backgrounds
  background: '#eceae6',
  surface: '#f7f5f1',
  card: '#ffffff',
  cardAlt: '#f1ede6',

  // Borders
  border: '#d9d3c9',
  borderLight: '#c8c1b6',

  // Accent / CTAs
  accent: '#221f1b',
  accentPress: '#35302a',

  // Text
  textPrimary: '#1f1b17',
  textSecondary: '#5f5850',
  textMuted: '#8a8278',
  textInverse: '#f6f2ea',

  // Status
  sold: '#221f1b',
  danger: '#b64242',
  success: '#2f8a66',
  star: '#b18e2a',

  // Tab bar
  tabActive: '#221f1b',
  tabInactive: '#8e867b',

  // Transparent overlays
  overlay: 'rgba(255,255,255,0.62)',
  overlayLight: 'rgba(255,255,255,0.42)',
} as const;

type ThemeColors = { [Key in keyof typeof DARK_COLORS]: string };

function resolveActiveTheme(): ThemeMode {
  const runtimeThemeOverride = (globalThis as any)[THEME_OVERRIDE_GLOBAL_KEY] as
    | ThemeMode
    | null
    | undefined;

  if (runtimeThemeOverride === 'light' || runtimeThemeOverride === 'dark') {
    return runtimeThemeOverride;
  }

  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
}

export let ActiveTheme: ThemeMode = resolveActiveTheme();
export let Colors: ThemeColors = ActiveTheme === 'light' ? LIGHT_COLORS : DARK_COLORS;

export function refreshThemeFromRuntime(): ThemeMode {
  ActiveTheme = resolveActiveTheme();
  Colors = ActiveTheme === 'light' ? LIGHT_COLORS : DARK_COLORS;
  return ActiveTheme;
}
