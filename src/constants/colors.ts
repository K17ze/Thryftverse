import { Appearance } from 'react-native';

export type ThemeMode = 'dark' | 'light';

const THEME_OVERRIDE_GLOBAL_KEY = '__THRYFTVERSE_THEME_OVERRIDE__';

// ============================================================================
// CONSOLIDATED 5-CORE COLOR PALETTE
// Based on luxury e-commerce reference designs (Farfetch/SSENSE aesthetic)
// Principle: Restraint - use sparingly, let content breathe
// ============================================================================

const DARK_COLORS = {
  // 1. BACKGROUND - Deep neutral (was background)
  background: '#0A0A0A',
  
  // 2. SURFACE - Slightly elevated (was card)
  surface: '#141414',
  
  // 3. BRAND/PRIMARY - Gold accent (use sparingly for CTAs only)
  brand: '#D4A853',
  brandPressed: '#B8944F',
  
  // 4. TEXT - Three levels of hierarchy only
  textPrimary: '#FFFFFF',
  textSecondary: '#A3A3A3',
  textMuted: '#666666',
  
  // 5. BORDERS - Subtle separators
  border: '#262626',
  borderLight: '#333333',
  
  // Status (minimal set)
  danger: '#DC2626',
  success: '#16A34A',
} as const;

const LIGHT_COLORS = {
  // 1. BACKGROUND - Clean white
  background: '#FFFFFF',
  
  // 2. SURFACE - Light grey for cards
  surface: '#F5F5F5',
  
  // 3. BRAND/PRIMARY - Gold accent (use sparingly for CTAs only)
  brand: '#C9A227',
  brandPressed: '#A68B4B',
  
  // 4. TEXT - Three levels of hierarchy only
  textPrimary: '#000000',
  textSecondary: '#666666',
  textMuted: '#999999',
  
  // 5. BORDERS - Subtle separators
  border: '#E5E5E5',
  borderLight: '#F0F0F0',
  
  // Status (minimal set)
  danger: '#DC2626',
  success: '#16A34A',
} as const;

// ============================================================================
// USAGE GUIDELINES (simplified from previous complex rules)
// ============================================================================
// - background: Screen backgrounds only
// - surface: Cards, sheets, elevated content
// - brand: Primary CTAs only (buy buttons, main actions)
// - textPrimary: Headlines, body text, important labels
// - textSecondary: Subtitles, metadata, captions
// - textMuted: Placeholders, disabled states, hints
// - border: Subtle dividers (0.5-1px)
// - danger: Errors, destructive actions
// - success: Confirmations, positive states
//
// REMOVED (to reduce visual noise):
// - Multiple card variants (cardAlt, cardElevated, etc.)
// - accent, accentPress (replaced with brand only)
// - accentGold, accentGoldPress, accentGoldMuted (consolidated)
// - Multiple border variants
// - Overlay colors (use opacity on backgrounds instead)
// - Glass/blur surface colors
// - Tab bar specific colors (use text hierarchy)
// - sold, star colors (use text or brand)

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
