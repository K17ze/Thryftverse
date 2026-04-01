import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Colors } from '../constants/colors';

interface AnimatedBadgeProps {
  count: number;
  size?: number;
}

export function AnimatedBadge({ count, size = 18 }: AnimatedBadgeProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (count > 0) {
      // Rubber-band bounce effect on count change
      scale.value = withSequence(
        withTiming(1.3, { duration: 100 }),
        withSpring(1, { damping: 10, stiffness: 300 })
      );
    } else {
      scale.value = withTiming(0, { duration: 200 }); // Shrink out if 0
    }
  }, [count]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: scale.value === 0 ? 0 : 1,
  }));

  if (count === 0) {
    // Rely on opacity/scale to hide it completely when count is 0
    // Don't log or access scale.value synchronously on JS thread
  }

  return (
    <Reanimated.View style={[
      styles.badge, 
      { minWidth: size, height: size, borderRadius: size / 2 },
      animatedStyle
    ]}>
      <Text style={[styles.text, { fontSize: size * 0.6 }]}>
        {count > 99 ? '99+' : count}
      </Text>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    position: 'absolute',
    top: -4,
    right: -4,
    borderWidth: 1.5,
    borderColor: '#111',
  },
  text: {
    color: '#fff',
    fontFamily: 'Inter_800ExtraBold',
    includeFontPadding: false,
    textAlign: 'center',
  },
});
