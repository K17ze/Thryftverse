import React from 'react';
import { View, StyleSheet } from 'react-native';

interface ThryftCartIconProps {
  size?: number;
  color?: string;
}

export function ThryftCartIcon({ size = 14, color = '#ffffff' }: ThryftCartIconProps) {
  const bodyWidth = Math.max(8, Math.round(size * 0.88));
  const wheelSize = Math.max(2, Math.round(size * 0.2));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <View style={[styles.handle, { borderColor: color }]} />
      <View style={[styles.body, { width: bodyWidth, borderColor: color }]} />
      <View style={styles.wheelsRow}>
        <View style={[styles.wheel, { width: wheelSize, height: wheelSize, borderRadius: wheelSize / 2, backgroundColor: color }]} />
        <View style={[styles.wheel, { width: wheelSize, height: wheelSize, borderRadius: wheelSize / 2, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    position: 'absolute',
    top: 2,
    left: 1,
    width: 5,
    height: 3,
    borderTopWidth: 1.4,
    borderLeftWidth: 1.4,
    borderTopLeftRadius: 2,
  },
  body: {
    position: 'absolute',
    top: 4,
    left: 3,
    height: 6,
    borderWidth: 1.5,
    borderTopRightRadius: 2,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 3,
  },
  wheelsRow: {
    position: 'absolute',
    bottom: 1,
    left: 4,
    right: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  wheel: {},
});
