import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';

// ============================================================================
// STANDARDIZED CARD COMPONENT (Phase 2 Cleanup)
// 3 variants only: surface | elevated | brand
// ============================================================================

export type AppCardVariant = 'surface' | 'elevated' | 'brand';

interface AppCardProps {
  children: React.ReactNode;
  variant?: AppCardVariant;
  style?: StyleProp<ViewStyle>;
  /** No border for cleaner look */
  noBorder?: boolean;
}

function resolveCardStyle(variant: AppCardVariant) {
  switch (variant) {
    case 'brand':
      return {
        backgroundColor: Colors.brand,
        borderColor: Colors.brand,
      };
    case 'elevated':
      return {
        backgroundColor: Colors.surface,
        borderColor: Colors.border,
      };
    case 'surface':
    default:
      return {
        backgroundColor: Colors.surface,
        borderColor: Colors.border,
      };
  }
}

export function AppCard({ 
  children, 
  variant = 'surface', 
  style, 
  noBorder = false 
}: AppCardProps) {
  const tone = resolveCardStyle(variant);
  const isElevated = variant === 'elevated';

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: noBorder ? 'transparent' : tone.borderColor,
        },
        isElevated && styles.elevated,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  elevated: {
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
});

// ============================================================================
// SIMPLIFIED CARD USAGE GUIDE
// ============================================================================
// - surface: Default cards, info panels, form sections
// - elevated: Product cards, featured items (subtle shadow)
// - brand: Primary CTAs, highlighted actions (gold background)
//
// MIGRATION NOTES:
// - Old 'default' → 'surface'
// - Old 'soft'/'tint' → 'surface' (simplified)
// - Custom card styles → migrate to AppCard with variant
