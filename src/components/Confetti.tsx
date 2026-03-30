import React, { useEffect } from 'react';
import { View, Dimensions } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  withSequence,
  runOnJS,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const COLORS = ['#4ECDC4', '#FF6B6B', '#F7D794', '#ffffff'];

interface ParticleProps {
  x: number;
  y: number;
  color: string;
  delay: number;
}

function Particle({ x, y, color, delay }: ParticleProps) {
  const translateY = useSharedValue(0);
  const translateX = useSharedValue(0);
  const scale = useSharedValue(0);
  const rotate = useSharedValue(0);
  const opacity = useSharedValue(1);

  useEffect(() => {
    // Pop out
    scale.value = withDelay(delay, withTiming(1, { duration: 200 }));
    
    // Spread and fall
    translateX.value = withDelay(
      delay,
      withTiming(x, { duration: 800, easing: Easing.out(Easing.cubic) })
    );
    
    translateY.value = withDelay(
      delay,
      withSequence(
        withTiming(-y, { duration: 300, easing: Easing.out(Easing.quad) }),
        withTiming(height, { duration: 1500, easing: Easing.in(Easing.quad) })
      )
    );

    // Spin
    rotate.value = withDelay(
      delay,
      withTiming(Math.random() * 720, { duration: 1800 })
    );

    // Fade out
    opacity.value = withDelay(
      delay + 1000,
      withTiming(0, { duration: 800 })
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View
      style={[
        {
          position: 'absolute',
          width: 8,
          height: 8,
          backgroundColor: color,
          borderRadius: Math.random() > 0.5 ? 4 : 0,
        },
        style,
      ]}
    />
  );
}

export function Confetti({ count = 40 }: { count?: number }) {
  const particles = Array.from({ length: count }).map((_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * width,
    y: Math.random() * 200 + 50,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    delay: Math.random() * 200,
  }));

  const [active, setActive] = React.useState(true);

  useEffect(() => {
    const t = setTimeout(() => setActive(false), 3000);
    return () => clearTimeout(t);
  }, []);

  if (!active) return null;

  return (
    <View style={{ position: 'absolute', top: height * 0.4, left: width / 2, zIndex: 100 }} pointerEvents="none">
      {particles.map((p) => (
        <Particle key={p.id} {...p} />
      ))}
    </View>
  );
}
