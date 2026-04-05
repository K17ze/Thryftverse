import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface OnezeCoinIconProps {
  size?: number;
}

export function OnezeCoinIcon({ size = 18 }: OnezeCoinIconProps) {
  const ringRadius = size / 2;
  const innerSize = Math.max(10, Math.round(size * 0.72));

  return (
    <LinearGradient
      colors={['#f4d27b', '#c68a2d']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.coin, { width: size, height: size, borderRadius: ringRadius }]}
    >
      <View style={[styles.inner, { width: innerSize, height: innerSize, borderRadius: innerSize / 2 }]}>
        <Text style={[styles.mark, { fontSize: Math.max(7, Math.round(size * 0.37)) }]}>1z</Text>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  coin: {
    borderWidth: 1,
    borderColor: '#9b6f22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.22)',
    backgroundColor: 'rgba(255,255,255,0.36)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    color: '#5d3c08',
    fontWeight: '700',
    letterSpacing: -0.2,
  },
});
