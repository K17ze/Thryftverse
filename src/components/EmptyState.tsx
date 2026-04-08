import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, {
  cancelAnimation,
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from './AnimatedPressable';
import { useReducedMotion } from '../hooks/useReducedMotion';

const IS_LIGHT = ActiveTheme === 'light';
const RING_BG = IS_LIGHT ? '#f0ebe3' : '#151515';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  ctaLabel?: string;
  onCtaPress?: () => void;
  iconColor?: string;
}
export function EmptyState({ icon, title, subtitle, ctaLabel, onCtaPress, iconColor = Colors.accent }: Props) {
  const reducedMotionEnabled = useReducedMotion();

  // Floating animation on the icon ring
  const translateY = useSharedValue(0);
  const iconScale = useSharedValue(0.8);

  useEffect(() => {
    if (reducedMotionEnabled) {
      cancelAnimation(translateY);
      cancelAnimation(iconScale);
      translateY.value = 0;
      iconScale.value = 1;
      return;
    }

    // Gentle float up/down
    translateY.value = withRepeat(
      withSequence(
        withTiming(-8, { duration: 1600, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 1600, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );

    // Spring entrance on mount
    iconScale.value = withSpring(1, { damping: 12, stiffness: 150 });

    return () => {
      cancelAnimation(translateY);
      cancelAnimation(iconScale);
    };
  }, [iconScale, reducedMotionEnabled, translateY]);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: iconScale.value },
    ],
  }));

  return (
    <View style={styles.container}>
      <Reanimated.View
        entering={FadeInDown.delay(100).duration(500).springify()}
        style={[styles.iconRing, { borderColor: iconColor + '25' }, floatStyle]}
      >
        <Ionicons name={icon} size={38} color={iconColor} />
      </Reanimated.View>

      <Reanimated.Text
        entering={FadeInDown.delay(200).duration(400)}
        style={styles.title}
      >
        {title}
      </Reanimated.Text>

      {subtitle && (
        <Reanimated.Text
          entering={FadeInDown.delay(300).duration(400)}
          style={styles.subtitle}
        >
          {subtitle}
        </Reanimated.Text>
      )}

      {ctaLabel && onCtaPress && (
        <Reanimated.View entering={FadeInDown.delay(400).duration(400)}>
          <AnimatedPressable style={styles.cta} onPress={onCtaPress} activeOpacity={0.8} hapticFeedback="selection">
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </AnimatedPressable>
        </Reanimated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 60,
    gap: 10,
  },
  iconRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1.5,
    backgroundColor: RING_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    shadowColor: '#d7b98f',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: Typography.family.bold,
    letterSpacing: -0.3,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    fontFamily: Typography.family.regular,
    letterSpacing: 0.08,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    maxWidth: 260,
  },
  cta: {
    marginTop: 16,
    backgroundColor: Colors.accent,
    paddingHorizontal: 34,
    paddingVertical: 15,
    borderRadius: 30,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaText: {
    fontSize: 14,
    fontFamily: Typography.family.bold,
    letterSpacing: 0.2,
    color: Colors.textInverse,
  },
});

