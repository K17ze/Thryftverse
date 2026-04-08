import React from 'react';
import {
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useHaptic } from '../hooks/useHaptic';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Motion } from '../constants/motion';

type HapticFeedbackStyle = 'none' | 'light' | 'medium' | 'heavy' | 'selection';

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
  activeOpacity?: number;
  disableAnimation?: boolean;
  hapticFeedback?: HapticFeedbackStyle;
}

const AnimatedNativePressable = Reanimated.createAnimatedComponent(Pressable);

export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  style,
  scaleValue = 1,
  disableAnimation = true,
  disabled = false,
  activeOpacity,
  hapticFeedback = 'none',
  ...rest
}: Props) {
  const haptic = useHaptic();
  const reducedMotionEnabled = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const triggerHaptic = React.useCallback(() => {
    if (hapticFeedback === 'none') {
      return;
    }

    if (hapticFeedback === 'selection') {
      haptic.selection();
      return;
    }

    if (hapticFeedback === 'heavy') {
      haptic.heavy();
      return;
    }

    if (hapticFeedback === 'medium') {
      haptic.medium();
      return;
    }

    haptic.light();
  }, [haptic, hapticFeedback]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <AnimatedNativePressable
      style={[style, animStyle]}
      onPressIn={(event) => {
        if (!disabled && !disableAnimation) {
          if (reducedMotionEnabled) {
            scale.value = withTiming(1, { duration: 0 });
          } else {
            scale.value = withTiming(scaleValue, { duration: Motion.timing.pressIn });
          }
        }
        if (typeof activeOpacity === 'number') {
          if (reducedMotionEnabled) {
            opacity.value = withTiming(1, { duration: 0 });
          } else {
            opacity.value = withTiming(activeOpacity, { duration: Motion.timing.pressIn });
          }
        }
        if (!disabled) {
          triggerHaptic();
        }
        if (onPressIn) {
          onPressIn(event);
        }
      }}
      onPressOut={(event) => {
        if (!disableAnimation) {
          if (reducedMotionEnabled) {
            scale.value = withTiming(1, { duration: 0 });
          } else {
            scale.value = withSpring(1, Motion.spring.pressRelease);
          }
        }
        if (typeof activeOpacity === 'number') {
          if (reducedMotionEnabled) {
            opacity.value = withTiming(1, { duration: 0 });
          } else {
            opacity.value = withTiming(1, { duration: Motion.timing.pressOut });
          }
        }
        if (onPressOut) {
          onPressOut(event);
        }
      }}
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      {...rest}
    >
      {children}
    </AnimatedNativePressable>
  );
}
