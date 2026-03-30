import React, { useEffect } from 'react';
import { TouchableOpacity } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useHaptic } from '../hooks/useHaptic';

interface Props {
  isFavourite: boolean;
  onToggle: () => void;
  size?: number;
  activeColor?: string;
  inactiveColor?: string;
}

const AnimatedIonicons = Reanimated.createAnimatedComponent(Ionicons as any);

export function AnimatedHeart({
  isFavourite,
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
    if (!isFavourite) {
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
    <TouchableOpacity onPress={handleToggle} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Reanimated.View style={animStyle}>
        <Ionicons
          name={isFavourite ? 'heart' : 'heart-outline'}
          size={size}
          color={isFavourite ? activeColor : inactiveColor}
        />
      </Reanimated.View>
    </TouchableOpacity>
  );
}
