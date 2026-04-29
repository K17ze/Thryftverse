/**
 * DoubleTapHeart - Instagram-style double-tap to like
 * Shows animated heart overlay on double tap
 */

import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useHaptic } from '../hooks/useHaptic';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Colors } from '../constants/colors';

interface Props {
  /** Whether the item is already liked */
  isLiked: boolean;
  /** Callback when like is triggered */
  onLike: () => void;
  /** Children to render inside the gesture detector */
  children: React.ReactNode;
  /** Size of the heart animation */
  heartSize?: number;
}

export function DoubleTapHeart({
  isLiked,
  onLike,
  children,
  heartSize = 80,
}: Props) {
  const haptic = useHaptic();
  const reducedMotionEnabled = useReducedMotion();
  const heartScale = useSharedValue(0);
  const heartOpacity = useSharedValue(0);

  const triggerLike = useCallback(() => {
    if (!isLiked) {
      haptic.medium();
      onLike();
    }

    if (reducedMotionEnabled) {
      return;
    }

    // Reset and trigger animation
    heartScale.value = 0;
    heartOpacity.value = 1;

    // Spring up, then fade out
    heartScale.value = withSequence(
      withSpring(1.2, { damping: 10, stiffness: 200 }),
      withSpring(1, { damping: 10, stiffness: 200 }),
      withDelay(
        600,
        withSpring(0, { damping: 15, stiffness: 100 }, () => {
          heartOpacity.value = 0;
        })
      )
    );
  }, [isLiked, onLike, haptic, reducedMotionEnabled, heartScale, heartOpacity]);

  const gesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(triggerLike)();
    });

  const heartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartOpacity.value,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.container}>
        {children}
        
        {/* Animated heart overlay */}
        <Animated.View style={[styles.heartOverlay, heartStyle]} pointerEvents="none">
          <Ionicons name="heart" size={heartSize} color={Colors.danger} />
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  heartOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
});

export default DoubleTapHeart;
