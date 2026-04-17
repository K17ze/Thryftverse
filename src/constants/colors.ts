import { Appearance } from 'react-native';

export type ThemeMode = 'dark' | 'light';

const THEME_OVERRIDE_GLOBAL_KEY = '__THRYFTVERSE_THEME_OVERRIDE__';

const DARK_COLORS = {
  // Backgrounds
  background: '#0c0b09',
  surface: '#151311',
  card: '#1b1814',
  cardAlt: '#24201b',

  // Borders
  border: '#3a3126',
  borderLight: '#4a3e30',

  // Accent / CTAs
  accent: '#e2d5c2',
  accentPress: '#cfc0aa',

  // Financial accent (CO-OWN + 1ze only)
  accentGold: '#d5ac64',
  accentGoldPress: '#b8914f',
  accentGoldMuted: '#3d3018',

  // Text
  textPrimary: '#f6f0e5',
  textSecondary: '#c8bcaa',
  textMuted: '#9a8f7d',
  textInverse: '#0b0907',
  textEmphasis: '#ffffff',

  // Status
  sold: '#ffffff',
  danger: '#ff4d4d',
  success: '#4caf50',
  star: '#ffc107',

  // Tab bar
  tabActive: '#e2d5c2',
  tabInactive: '#8e816d',

  // Transparent overlays
  overlay: 'rgba(0,0,0,0.6)',
  overlayLight: 'rgba(0,0,0,0.4)',

  // Glass / blur surfaces
  glass: 'rgba(24,21,18,0.74)',
  glassBorder: 'rgba(236,225,207,0.12)',
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

  // Financial accent (CO-OWN + 1ze only)
  accentGold: '#9c7a28',
  accentGoldPress: '#7c5f1e',
  accentGoldMuted: '#f0e4c8',

  // Text
  textPrimary: '#1f1b17',
  textSecondary: '#5f5850',
  textMuted: '#8a8278',
  textInverse: '#f6f2ea',
  textEmphasis: '#0a0907',

  // Status
  sold: '#221f1b',
  danger: '#b64242',
  success: '#3d7a52',
  star: '#b18e2a',

  // Tab bar
  tabActive: '#221f1b',
  tabInactive: '#8e867b',

  // Transparent overlays
  overlay: 'rgba(255,255,255,0.62)',
  overlayLight: 'rgba(255,255,255,0.42)',

  // Glass / blur surfaces
  glass: 'rgba(255,255,255,0.82)',
  glassBorder: 'rgba(0,0,0,0.06)',
} as const;

// Accent usage rules (enforce in PR review):
// - accent: social surfaces (likes, follows, comments, verified badges, saved looks)
// - accentGold: financial surfaces only (1ze, CO-OWN, trade CTAs, peg cards, buyout)
// - success: transient confirmations only (not price-up states)
// - danger: errors, destructive actions, and price-down states

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
