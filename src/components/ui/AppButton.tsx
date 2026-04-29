import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';
import { Type } from '../../theme/designTokens';
import { AnimatedPressable } from '../AnimatedPressable';

// ============================================================================
// SIMPLIFIED BUTTON COMPONENT (Phase 2 Cleanup)
// 2 variants only: primary | secondary
// Uses 5-core color palette
// ============================================================================

export type AppButtonVariant = 'primary' | 'secondary';
export type AppButtonSize = 'sm' | 'md' | 'lg';
type AppButtonHapticFeedback = 'none' | 'light' | 'medium' | 'heavy' | 'selection';

interface AppButtonProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  variant?: AppButtonVariant;
  size?: AppButtonSize;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  iconContainerStyle?: StyleProp<ViewStyle>;
  trailingIconContainerStyle?: StyleProp<ViewStyle>;
  align?: 'start' | 'center';
  activeOpacity?: number;
  hapticFeedback?: AppButtonHapticFeedback;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

type VariantTokens = {
  backgroundColor: string;
  borderColor: string;
  titleColor: string;
  subtitleColor: string;
  iconBackgroundColor: string;
};

function resolveVariantTokens(variant: AppButtonVariant): VariantTokens {
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: 'transparent',
        borderColor: Colors.border,
        titleColor: Colors.textPrimary,
        subtitleColor: Colors.textSecondary,
        iconBackgroundColor: 'transparent',
      };
    case 'primary':
    default:
      return {
        backgroundColor: Colors.brand,
        borderColor: Colors.brand,
        titleColor: Colors.background,
        subtitleColor: Colors.background,
        iconBackgroundColor: 'rgba(0,0,0,0.15)',
      };
  }
}

function resolveSizeStyle(size: AppButtonSize): ViewStyle {
  switch (size) {
    case 'sm':
      return styles.sizeSm;
    case 'lg':
      return styles.sizeLg;
    case 'md':
    default:
      return styles.sizeMd;
  }
}

export function AppButton({
  title,
  subtitle,
  icon,
  trailingIcon,
  onPress,
  disabled,
  variant = 'primary',
  size = 'md',
  style,
  contentStyle,
  titleStyle,
  subtitleStyle,
  iconContainerStyle,
  trailingIconContainerStyle,
  align,
  activeOpacity = 0.9,
  hapticFeedback = 'none',
  accessibilityLabel,
  accessibilityHint,
}: AppButtonProps) {
  const tokens = resolveVariantTokens(variant);
  const resolvedAlign = align ?? (subtitle ? 'start' : 'center');

  return (
    <AnimatedPressable
      style={[
        styles.base,
        resolveSizeStyle(size),
        {
          backgroundColor: tokens.backgroundColor,
          borderColor: tokens.borderColor,
        },
        resolvedAlign === 'start' && styles.alignStart,
        disabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={activeOpacity}
      disableAnimation={false}
      scaleValue={0.985}
      hapticFeedback={hapticFeedback}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
    >
      <View style={[styles.contentRow, resolvedAlign === 'center' && styles.contentCentered, contentStyle]}>
        {icon ? (
          <View
            style={[
              styles.iconWrap,
              {
                backgroundColor: tokens.iconBackgroundColor,
              },
              iconContainerStyle,
            ]}
          >
            {icon}
          </View>
        ) : null}
        <View style={[styles.textCol, resolvedAlign === 'center' && styles.textColCentered]}>
          <Text style={[styles.title, { color: tokens.titleColor }, titleStyle]}>{title}</Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: tokens.subtitleColor }, subtitleStyle]}>{subtitle}</Text>
          ) : null}
        </View>
        {trailingIcon ? (
          <View
            style={[
              styles.iconWrap,
              {
                backgroundColor: tokens.iconBackgroundColor,
              },
              trailingIconContainerStyle,
            ]}
          >
            {trailingIcon}
          </View>
        ) : null}
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  alignStart: {
    alignItems: 'flex-start',
  },
  disabled: {
    opacity: 0.52,
  },
  sizeSm: {
    minHeight: 44,
    borderRadius: 14,
    paddingHorizontal: 10,
  },
  sizeMd: {
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 16,
  },
  sizeLg: {
    minHeight: 64,
    borderRadius: 24,
    paddingHorizontal: 16,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  contentCentered: {
    justifyContent: 'center',
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    justifyContent: 'center',
  },
  textColCentered: {
    alignItems: 'center',
  },
  title: {
    fontSize: Type.body.size,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.1,
  },
  subtitle: {
    marginTop: 1,
    fontSize: Type.caption.size,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.2,
  },
});
