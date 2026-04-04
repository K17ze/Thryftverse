import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';

export type SyncStatusTone = 'live' | 'syncing' | 'offline';

interface SyncStatusPillProps {
  tone: SyncStatusTone;
  label: string;
  compact?: boolean;
}

const IS_LIGHT = ActiveTheme === 'light';

const TONE_STYLES: Record<
  SyncStatusTone,
  {
    icon: keyof typeof Ionicons.glyphMap;
    background: string;
    border: string;
    iconColor: string;
    textColor: string;
  }
> = {
  live: {
    icon: 'checkmark-circle',
    background: IS_LIGHT ? '#e8f4ec' : '#193327',
    border: IS_LIGHT ? '#b8d8c2' : '#2f5d48',
    iconColor: IS_LIGHT ? '#2d7a4b' : '#78d89f',
    textColor: IS_LIGHT ? '#2d7a4b' : '#9ae7b8',
  },
  syncing: {
    icon: 'sync-outline',
    background: IS_LIGHT ? '#efe8dc' : '#2d261e',
    border: IS_LIGHT ? '#d5c6ad' : '#4d3f31',
    iconColor: IS_LIGHT ? '#8f6f3f' : '#d7b987',
    textColor: IS_LIGHT ? '#7b6036' : '#e0c69d',
  },
  offline: {
    icon: 'cloud-offline-outline',
    background: IS_LIGHT ? '#f1e7e7' : '#331f1f',
    border: IS_LIGHT ? '#ddc1c1' : '#5d3535',
    iconColor: IS_LIGHT ? '#8b4c4c' : '#d39b9b',
    textColor: IS_LIGHT ? '#7a4545' : '#e1adad',
  },
};

export function SyncStatusPill({ tone, label, compact = false }: SyncStatusPillProps) {
  const toneStyle = TONE_STYLES[tone];

  return (
    <View
      style={[
        styles.pill,
        compact && styles.pillCompact,
        {
          backgroundColor: toneStyle.background,
          borderColor: toneStyle.border,
        },
      ]}
    >
      <Ionicons name={toneStyle.icon} size={compact ? 11 : 12} color={toneStyle.iconColor} />
      <Text style={[styles.text, compact && styles.textCompact, { color: toneStyle.textColor }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 150,
  },
  pillCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
    maxWidth: 130,
  },
  text: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.1,
  },
  textCompact: {
    fontSize: 10,
  },
});
