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

interface Props extends Omit<PressableProps, 'style' | 'children'> {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleValue?: number;
  activeOpacity?: number;
  disableAnimation?: boolean;
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
  disableAnimation = false,
  disabled = false,
  activeOpacity,
  ...rest
}: Props) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <AnimatedNativePressable
      style={[style, animStyle]}
      onPressIn={(event) => {
        if (!disabled && !disableAnimation) {
          scale.value = withTiming(scaleValue, { duration: 85 });
        }
        if (typeof activeOpacity === 'number') {
          opacity.value = withTiming(activeOpacity, { duration: 85 });
        }
        if (onPressIn) {
          onPressIn(event);
        }
      }}
      onPressOut={(event) => {
        if (!disableAnimation) {
          scale.value = withSpring(1, { damping: 18, stiffness: 420 });
        }
        if (typeof activeOpacity === 'number') {
          opacity.value = withTiming(1, { duration: 110 });
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
