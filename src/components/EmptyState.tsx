import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from './AnimatedPressable';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
  iconColor?: string;
}

export function EmptyState({ icon, title, subtitle, ctaLabel, onCtaPress, iconColor = '#e8dcc8' }: Props) {
  return (
    <Reanimated.View entering={FadeIn.duration(600)} style={styles.container}>
      <View style={[styles.iconRing, { borderColor: iconColor + '30' }]}>
        <Ionicons name={icon} size={40} color={iconColor} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
      {ctaLabel && onCtaPress && (
        <AnimatedPressable style={styles.cta} onPress={onCtaPress} activeOpacity={0.8}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </AnimatedPressable>
      )}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
    gap: 12,
  },
  iconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: Typography.family.semibold,
    letterSpacing: -0.2,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Typography.family.regular,
    letterSpacing: 0.1,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
  },
  cta: {
    marginTop: 12,
    backgroundColor: '#e8dcc8',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 30,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
    color: '#0a0a0a',
  },
});
