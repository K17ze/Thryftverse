import React, { useEffect } from 'react';
import { Text, TextStyle, StyleProp } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedProps,
  withTiming,
  Easing,
} from 'react-native-reanimated';

const AnimatedText = Reanimated.createAnimatedComponent(Text);

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  style?: StyleProp<TextStyle>;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export function AnimatedCounter({
  value,
  duration = 800,
  style,
  prefix = '',
  suffix = '',
  decimals = 0,
}: AnimatedCounterProps) {
  const animatedValue = useSharedValue(0);
  const [display, setDisplay] = React.useState(`${prefix}0${suffix}`);

  useEffect(() => {
    animatedValue.value = withTiming(value, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [value, duration, animatedValue]);

  // Use a JS-side running update via requestAnimationFrame for simplicity and reliability
  useEffect(() => {
    let frame: number;
    const startTime = Date.now();
    const startVal = 0;
    const endVal = value;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (endVal - startVal) * eased;

      if (decimals > 0) {
        setDisplay(`${prefix}${current.toFixed(decimals)}${suffix}`);
      } else {
        setDisplay(`${prefix}${Math.round(current)}${suffix}`);
      }

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, prefix, suffix, decimals]);

  return <Text style={style}>{display}</Text>;
}
