import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';

export type AppStatusTone = 'neutral' | 'accent' | 'positive' | 'negative' | 'warning';
export type AppStatusSize = 'sm' | 'md';

interface AppStatusPillProps {
  label: string;
  tone?: AppStatusTone;
  size?: AppStatusSize;
  iconName?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

const IS_LIGHT = ActiveTheme === 'light';

type ToneTokens = {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
};

function resolveTone(tone: AppStatusTone): ToneTokens {
  switch (tone) {
    case 'accent':
      return {
        backgroundColor: IS_LIGHT ? '#ece4d8' : '#17302b',
        borderColor: IS_LIGHT ? '#d0c3af' : '#35574d',
        textColor: IS_LIGHT ? '#7c5f1e' : '#d7b98f',
      };
    case 'positive':
      return {
        backgroundColor: IS_LIGHT ? '#efe7d6' : '#142420',
        borderColor: IS_LIGHT ? '#d9c6a2' : '#2d4a45',
        textColor: IS_LIGHT ? '#7c5f1e' : '#d7b98f',
      };
    case 'negative':
      return {
        backgroundColor: IS_LIGHT ? '#f6e6e6' : '#231616',
        borderColor: IS_LIGHT ? '#ddb0b0' : '#4b2c2c',
        textColor: IS_LIGHT ? '#b64242' : '#ff9d9d',
      };
    case 'warning':
      return {
        backgroundColor: IS_LIGHT ? '#f7ecdb' : '#231f16',
        borderColor: IS_LIGHT ? '#dfc9a5' : '#4a3f2f',
        textColor: IS_LIGHT ? '#7c5f1e' : '#ffcf8a',
      };
    case 'neutral':
    default:
      return {
        backgroundColor: Colors.cardAlt,
        borderColor: Colors.border,
        textColor: Colors.textSecondary,
      };
  }
}

export function AppStatusPill({
  label,
  tone = 'neutral',
  size = 'sm',
  iconName,
  style,
  textStyle,
}: AppStatusPillProps) {
  const tokens = resolveTone(tone);
  const iconSize = size === 'sm' ? 12 : 14;

  return (
    <View
      style={[
        styles.base,
        size === 'md' ? styles.sizeMd : styles.sizeSm,
        {
          backgroundColor: tokens.backgroundColor,
          borderColor: tokens.borderColor,
        },
        style,
      ]}
    >
      {iconName ? <Ionicons name={iconName} size={iconSize} color={tokens.textColor} /> : null}
      <Text style={[styles.text, size === 'md' && styles.textMd, { color: tokens.textColor }, textStyle]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sizeSm: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  sizeMd: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  text: {
    fontSize: Typography.size.micro + 1,
    fontFamily: Typography.family.bold,
    letterSpacing: 0.25,
  },
  textMd: {
    fontSize: Typography.size.caption,
  },
});
