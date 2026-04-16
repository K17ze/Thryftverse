import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { ActiveTheme, Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { AnimatedPressable } from '../AnimatedPressable';

export type AppButtonVariant = 'primary' | 'secondary' | 'gold' | 'contrast';
export type AppButtonSize = 'sm' | 'md' | 'lg' | 'xl';
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

const IS_LIGHT = ActiveTheme === 'light';

function resolveVariantTokens(variant: AppButtonVariant): VariantTokens {
  switch (variant) {
    case 'secondary':
      return {
        backgroundColor: Colors.cardAlt,
        borderColor: Colors.border,
        titleColor: Colors.textPrimary,
        subtitleColor: Colors.textMuted,
        iconBackgroundColor: IS_LIGHT ? 'rgba(34,31,27,0.08)' : 'rgba(255,255,255,0.06)',
      };
    case 'gold':
      return {
        backgroundColor: Colors.accentGold,
        borderColor: IS_LIGHT ? 'rgba(124,95,30,0.28)' : 'rgba(255,207,138,0.2)',
        titleColor: Colors.textInverse,
        subtitleColor: IS_LIGHT ? 'rgba(246,242,234,0.84)' : 'rgba(246,242,234,0.76)',
        iconBackgroundColor: IS_LIGHT ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.3)',
      };
    case 'contrast':
      return {
        backgroundColor: Colors.textPrimary,
        borderColor: IS_LIGHT ? 'rgba(34,31,27,0.2)' : 'rgba(255,255,255,0.14)',
        titleColor: Colors.textInverse,
        subtitleColor: IS_LIGHT ? 'rgba(246,242,234,0.84)' : 'rgba(246,242,234,0.76)',
        iconBackgroundColor: IS_LIGHT ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.3)',
      };
    case 'primary':
    default:
      return {
        backgroundColor: Colors.accent,
        borderColor: IS_LIGHT ? 'rgba(47,37,27,0.2)' : 'rgba(255,255,255,0.14)',
        titleColor: Colors.textInverse,
        subtitleColor: IS_LIGHT ? 'rgba(246,242,234,0.84)' : 'rgba(246,242,234,0.76)',
        iconBackgroundColor: IS_LIGHT ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.3)',
      };
  }
}

function resolveSizeStyle(size: AppButtonSize): ViewStyle {
  switch (size) {
    case 'sm':
      return styles.sizeSm;
    case 'lg':
      return styles.sizeLg;
    case 'xl':
      return styles.sizeXl;
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
  sizeXl: {
    minHeight: 68,
    borderRadius: 20,
    paddingHorizontal: 14,
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
    fontSize: Typography.size.bodyLarge,
    fontFamily: Typography.family.bold,
    letterSpacing: -0.1,
  },
  subtitle: {
    marginTop: 1,
    fontSize: Typography.size.caption,
    fontFamily: Typography.family.medium,
    letterSpacing: 0.2,
  },
});
