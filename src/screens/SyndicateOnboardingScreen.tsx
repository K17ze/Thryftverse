import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Reanimated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';

type NavT = StackNavigationProp<RootStackParamList>;

const SLIDES = [
  {
    icon: 'pie-chart-outline' as const,
    title: 'Fractional Ownership',
    body: 'Split premium fashion assets into tradable shares and let buyers enter positions at any size.',
  },
  {
    icon: 'trending-up-outline' as const,
    title: 'Trade In Real Time',
    body: 'Execute instantly at market or send direct buy/sell offers to owners at your chosen price.',
  },
  {
    icon: 'wallet-outline' as const,
    title: '1ze + Local Fiat',
    body: 'Use your preferred display mode while transactions settle through the gold-aware wallet layer.',
  },
  {
    icon: 'shield-checkmark-outline' as const,
    title: 'Compliance Controls',
    body: 'Country rules, KYC status, and settlement eligibility guard trading access for each market.',
  },
];

export default function SyndicateOnboardingScreen() {
  const navigation = useNavigation<NavT>();
  const [index, setIndex] = React.useState(0);

  const slide = SLIDES[index];
  const isLast = index === SLIDES.length - 1;

  const handleNext = () => {
    if (isLast) {
      navigation.replace('SyndicateHub');
      return;
    }

    setIndex((prev) => Math.min(prev + 1, SLIDES.length - 1));
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.headerRow}>
        <AnimatedPressable onPress={() => navigation.goBack()} style={styles.headerBtn}>
          <Ionicons name="close" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <AnimatedPressable onPress={() => navigation.replace('SyndicateHub')}>
          <Text style={styles.skipText}>Skip</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.hero}>
        <Reanimated.View
          key={slide.title}
          entering={FadeInDown.duration(320)}
          exiting={FadeOutUp.duration(220)}
          style={styles.heroSlide}
        >
          <View style={styles.iconRing}>
            <Ionicons name={slide.icon} size={64} color="#e8dcc8" />
          </View>
          <Text style={styles.title}>{slide.title}</Text>
          <Text style={styles.body}>{slide.body}</Text>
        </Reanimated.View>
      </View>

      <View style={styles.footer}>
        <View style={styles.dotsRow}>
          {SLIDES.map((_, dotIdx) => (
            <View key={`dot_${dotIdx}`} style={[styles.dot, dotIdx === index && styles.dotActive]} />
          ))}
        </View>

        <AnimatedPressable style={styles.primaryBtn} onPress={handleNext} activeOpacity={0.9}>
          <Text style={styles.primaryBtnText}>{isLast ? 'Enter Syndicate Hub' : 'Next'}</Text>
          <Ionicons name="arrow-forward" size={16} color={Colors.background} />
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
  },
  headerRow: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroSlide: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconRing: {
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: '#23413d',
    backgroundColor: '#0f1918',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    marginTop: 22,
    color: Colors.textPrimary,
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  body: {
    marginTop: 10,
    color: Colors.textSecondary,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    lineHeight: 23,
    textAlign: 'center',
  },
  footer: {
    paddingBottom: 22,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginBottom: 18,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#333',
  },
  dotActive: {
    width: 24,
    backgroundColor: '#e8dcc8',
  },
  primaryBtn: {
    borderRadius: 14,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryBtnText: {
    color: Colors.background,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
});
