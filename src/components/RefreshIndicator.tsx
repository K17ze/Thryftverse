import React, { useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withRepeat,
  withTiming,
  Easing,
  SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

interface Props {
  scrollY: SharedValue<number>;
  isRefreshing: boolean;
  topInset?: number;
}

export function RefreshIndicator({ scrollY, isRefreshing, topInset = 60 }: Props) {
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (isRefreshing) {
      rotation.value = withRepeat(
        withTiming(360, { duration: 800, easing: Easing.linear }),
        -1
      );
    } else {
      rotation.value = 0;
    }
  }, [isRefreshing]);

  const animStyle = useAnimatedStyle(() => {
    // When pulldown Y is negative
    const pullRotation = interpolate(scrollY.value, [-100, 0], [360, 0], Extrapolation.CLAMP);
    const scale = interpolate(scrollY.value, [-100, -20, 0], [1.2, 0.8, 0], Extrapolation.CLAMP);
    const opacity = interpolate(scrollY.value, [-40, -10], [1, 0], Extrapolation.CLAMP);

    return {
      opacity: isRefreshing ? 1 : opacity,
      transform: [
        { rotate: `${isRefreshing ? rotation.value : pullRotation}deg` },
        { scale: isRefreshing ? 1.2 : scale },
      ],
    };
  });

  return (
    <View style={[styles.container, { top: topInset }]}>
      <Reanimated.View style={animStyle}>
        <View style={styles.circle}>
          <Text style={{ fontFamily: 'Inter_700Bold', color: '#111', fontSize: 16, marginTop: -2 }}>T</Text>
        </View>
      </Reanimated.View>
    </View>
  );
}

import { Text } from 'react-native';

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: -1,
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 4,
  },
});
