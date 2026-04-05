import React from 'react';
import Reanimated, {
  Extrapolation,
  interpolate,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useHaptic } from '../hooks/useHaptic';
import { AnimatedPressable } from './AnimatedPressable';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface Props {
  isActive: boolean;
  onToggle: () => void;
  size?: number;
  activeColor?: string;
  inactiveColor?: string;
}

interface ParticleSpec {
  id: string;
  x: number;
  y: number;
  scale: number;
  size: number;
}

interface HeartParticleProps {
  particle: ParticleSpec;
  progress: SharedValue<number>;
  color: string;
}

function HeartParticle({ particle, progress, color }: HeartParticleProps) {
  const style = useAnimatedStyle(() => {
    const p = progress.value;
    const translateX = interpolate(p, [0, 1], [0, particle.x], Extrapolation.CLAMP);
    const translateY = interpolate(p, [0, 1], [0, particle.y], Extrapolation.CLAMP);
    const opacity = interpolate(p, [0, 0.12, 0.9, 1], [0, 1, 0.25, 0], Extrapolation.CLAMP);
    const scale = interpolate(
      p,
      [0, 0.18, 1],
      [0.4, particle.scale * 1.12, particle.scale],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ translateX }, { translateY }, { scale }],
    };
  });

  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

function createParticleBurst(size: number): ParticleSpec[] {
  const count = 12;
  const radiusBase = Math.max(16, size * 1.15);

  return Array.from({ length: count }).map((_, index) => {
    const angle = (Math.PI * 2 * index) / count + (Math.random() * 0.35 - 0.175);
    const distance = radiusBase * (0.65 + Math.random() * 0.85);
    const dotSize = Math.max(2, Math.round(size * (0.11 + Math.random() * 0.09)));

    return {
      id: `p_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance,
      scale: 0.75 + Math.random() * 0.55,
      size: dotSize,
    };
  });
}

export function AnimatedHeart({
  isActive,
  onToggle,
  size = 24,
  activeColor = '#FF6B6B',
  inactiveColor = '#ffffff',
}: Props) {
  const haptic = useHaptic();
  const reducedMotionEnabled = useReducedMotion();
  const scale = useSharedValue(1);
  const burstProgress = useSharedValue(0);
  const [particles, setParticles] = React.useState<ParticleSpec[]>([]);

  const triggerBurst = React.useCallback(() => {
    if (reducedMotionEnabled) {
      return;
    }

    setParticles(createParticleBurst(size));
    burstProgress.value = 0;
    burstProgress.value = withSequence(
      withTiming(1, { duration: 420 }),
      withTiming(0, { duration: 0 })
    );
  }, [burstProgress, reducedMotionEnabled, size]);

  const handleToggle = () => {
    haptic.medium();
    onToggle();

    if (!isActive) {
      triggerBurst();
    }

    if (reducedMotionEnabled) {
      return;
    }

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
      hapticFeedback="none"
    >
      <Reanimated.View style={[animStyle, { alignItems: 'center', justifyContent: 'center' }]}>
        {particles.map((particle) => (
          <HeartParticle key={particle.id} particle={particle} progress={burstProgress} color={activeColor} />
        ))}
        <Ionicons
          name={isActive ? 'heart' : 'heart-outline'}
          size={size}
          color={isActive ? activeColor : inactiveColor}
        />
      </Reanimated.View>
    </AnimatedPressable>
  );
}
