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

export function AnimatedPressable({
  children,
  onPress,
  onLongPress,
  onPressIn,
  onPressOut,
  style,
  scaleValue = 0.96,
  disableAnimation = false,
  disabled = false,
  activeOpacity,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Reanimated.View style={[animStyle, style]}>
      <Pressable
        onPressIn={(event) => {
          if (!disabled && !disableAnimation) {
            scale.value = withTiming(scaleValue, { duration: 100 });
          }
          if (onPressIn) {
            onPressIn(event);
          }
        }}
        onPressOut={(event) => {
          if (!disableAnimation) {
            scale.value = withSpring(1, { damping: 15, stiffness: 400 });
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
      </Pressable>
    </Reanimated.View>
  );
}
