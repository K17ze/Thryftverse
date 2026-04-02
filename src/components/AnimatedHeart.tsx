import React from 'react';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useHaptic } from '../hooks/useHaptic';
import { AnimatedPressable } from './AnimatedPressable';

interface Props {
  isActive: boolean;
  onToggle: () => void;
  size?: number;
  activeColor?: string;
  inactiveColor?: string;
}

const AnimatedIonicons = Reanimated.createAnimatedComponent(Ionicons as any);

export function AnimatedHeart({
  isActive,
  onToggle,
  size = 24,
  activeColor = '#FF6B6B',
  inactiveColor = '#ffffff',
}: Props) {
  const haptic = useHaptic();
  const scale = useSharedValue(1);

  const handleToggle = () => {
    haptic.medium();
    onToggle();
    if (!isActive) {
      // Filling — spring bounce up
      scale.value = withSequence(
        withSpring(1.35, { damping: 6, stiffness: 400 }),
        withSpring(1, { damping: 12, stiffness: 300 }),
      );
    } else {
      // Unfilling — quick deflate
      scale.value = withSequence(
        withTiming(0.85, { duration: 80 }),
        withSpring(1, { damping: 12 }),
      );
    }
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={handleToggle}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      disableAnimation
      activeOpacity={1}
    >
      <Reanimated.View style={animStyle}>
        <Ionicons
          name={isActive ? 'heart' : 'heart-outline'}
          size={size}
          color={isActive ? activeColor : inactiveColor}
        />
      </Reanimated.View>
    </AnimatedPressable>
  );
}
