import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, {
  FadeInDown,
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Colors } from '../constants/colors';

interface BrandedSplashProps {
  onFinish: () => void;
}

const WORDMARK = 'THRYFTVERSE';

export function BrandedSplash({ onFinish }: BrandedSplashProps) {
  const pulse = useSharedValue(1);

  React.useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 850, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 850, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    const timeoutId = setTimeout(onFinish, 1900);
    return () => clearTimeout(timeoutId);
  }, [onFinish, pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <View style={styles.container}>
      <Reanimated.View style={[styles.centerWrap, pulseStyle]} entering={FadeIn.duration(350)}>
        <View style={styles.brandRow}>
          {WORDMARK.split('').map((letter, index) => (
            <Reanimated.Text
              key={`${letter}_${index}`}
              entering={FadeInDown.duration(320).delay(Math.min(index, 12) * 45)}
              style={styles.brandLetter}
            >
              {letter}
            </Reanimated.Text>
          ))}
        </View>
        <Reanimated.Text entering={FadeIn.delay(520).duration(420)} style={styles.tagline}>
          Resale meets investment
        </Reanimated.Text>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  brandRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
  },
  brandLetter: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_800ExtraBold',
    fontSize: 28,
    letterSpacing: 0.8,
  },
  tagline: {
    marginTop: 14,
    color: '#8de5dc',
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    letterSpacing: 0.4,
  },
});
