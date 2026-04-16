import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { ActiveTheme, Colors } from '../../constants/colors';

export type AppCardVariant = 'default' | 'soft' | 'tint';

interface AppCardProps {
  children: React.ReactNode;
  variant?: AppCardVariant;
  style?: StyleProp<ViewStyle>;
  elevated?: boolean;
}

const IS_LIGHT = ActiveTheme === 'light';

function resolveCardTone(variant: AppCardVariant) {
  switch (variant) {
    case 'soft':
      return {
        backgroundColor: IS_LIGHT ? '#f7f4ef' : '#161616',
        borderColor: Colors.border,
      };
    case 'tint':
      return {
        backgroundColor: IS_LIGHT ? '#ece4d8' : '#1b1712',
        borderColor: IS_LIGHT ? '#d0c3af' : '#4f4638',
      };
    case 'default':
    default:
      return {
        backgroundColor: Colors.card,
        borderColor: Colors.border,
      };
  }
}

export function AppCard({ children, variant = 'default', style, elevated }: AppCardProps) {
  const tone = resolveCardTone(variant);

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
        },
        elevated && styles.elevated,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  elevated: {
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
});
