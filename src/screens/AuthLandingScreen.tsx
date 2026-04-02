import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Dimensions,
} from 'react-native';
import Reanimated, {
  FadeInDown,
  FadeIn,
  FadeInUp,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';

const { width, height } = Dimensions.get('window');

const BG_IMAGE = 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=85';

export default function AuthLandingScreen() {
  const navigation = useNavigation<any>();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Full-bleed editorial background */}
      <CachedImage
        uri={BG_IMAGE}
        style={styles.bgImage}
        containerStyle={styles.bgImageContainer}
        contentFit="cover"
        priority="high"
      />

      {/* Gradient overlay */}
      <LinearGradient
        colors={['rgba(9,9,9,0.15)', 'rgba(9,9,9,0.50)', 'rgba(9,9,9,0.92)', '#090909']}
        locations={[0, 0.4, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />

      <SafeAreaView style={styles.safeArea}>
        {/* Top - animated brand wordmark */}
        <Reanimated.View entering={FadeIn.delay(200).duration(600)} style={styles.topSection}>
          <Text style={styles.logo}>THRYFTVERSE</Text>
        </Reanimated.View>

        {/* Middle - main copy */}
        <View style={styles.content}>
          <Reanimated.Text
            entering={FadeInDown.delay(400).duration(600).springify()}
            style={styles.title}
          >
            Thrift smarter.{'\n'}Trade sharper.
          </Reanimated.Text>

          <Reanimated.Text
            entering={FadeInDown.delay(600).duration(500)}
            style={styles.subtitle}
          >
            Shop pre-loved pieces, launch listings, and access Trade Hub from one account.
          </Reanimated.Text>

          {/* Feature pills */}
          <Reanimated.View entering={FadeIn.delay(900).duration(500)} style={styles.featurePills}>
            {[
              { icon: 'pricetag-outline' as const, label: 'Zero listing fees' },
              { icon: 'shield-checkmark-outline' as const, label: 'Buyer protection' },
              { icon: 'stats-chart-outline' as const, label: 'Trade Hub access' },
            ].map((f, i) => (
              <View key={f.label} style={styles.featurePill}>
                <Ionicons name={f.icon} size={13} color="#e8dcc8" />
                <Text style={styles.featurePillText}>{f.label}</Text>
              </View>
            ))}
          </Reanimated.View>
        </View>

        {/* Bottom - CTAs */}
        <Reanimated.View entering={FadeInUp.delay(700).duration(500).springify()} style={styles.footer}>
          <AnimatedPressable
            style={styles.primaryBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={styles.primaryText}>Create Account</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={styles.secondaryBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.secondaryText}>I already have an account</Text>
          </AnimatedPressable>

          {/* Social login row */}
          <View style={styles.socialRow}>
            <AnimatedPressable
              style={styles.socialBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('SignUp')}
            >
              <Ionicons name="logo-apple" size={20} color="#fff" />
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.socialBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('SignUp')}
            >
              <Ionicons name="logo-google" size={18} color="#fff" />
            </AnimatedPressable>
          </View>

          <Text style={styles.termsText}>
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </Text>
        </Reanimated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#090909',
  },
  bgImageContainer: {
    ...StyleSheet.absoluteFillObject,
  },
  bgImage: {
    width: '100%',
    height: '100%',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topSection: {
    paddingHorizontal: 22,
    paddingTop: 12,
  },
  logo: {
    fontSize: 15,
    fontFamily: Typography.family.bold,
    color: 'rgba(232,220,200,0.9)',
    letterSpacing: 3.5,
  },
  content: {
    paddingHorizontal: 22,
  },
  title: {
    fontSize: 38,
    fontFamily: Typography.family.bold,
    color: '#f6f2ea',
    lineHeight: 44,
    letterSpacing: -0.8,
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: Typography.family.regular,
    color: 'rgba(245,239,230,0.75)',
    lineHeight: 23,
    letterSpacing: 0.08,
    marginBottom: 20,
  },
  featurePills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(232,220,200,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(232,220,200,0.18)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  featurePillText: {
    color: 'rgba(232,220,200,0.85)',
    fontSize: 12,
    fontFamily: Typography.family.medium,
    letterSpacing: 0.1,
  },
  footer: {
    paddingHorizontal: 22,
    paddingBottom: 14,
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: '#e8dcc8',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#e8dcc8',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 8,
  },
  primaryText: {
    color: '#0b0907',
    fontSize: 16,
    fontFamily: Typography.family.bold,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(232,220,200,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: 'rgba(245,239,230,0.85)',
    fontSize: 14,
    fontFamily: Typography.family.medium,
    letterSpacing: 0.1,
  },
  socialRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginTop: 4,
  },
  socialBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  termsText: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    fontFamily: Typography.family.regular,
    textAlign: 'center',
    lineHeight: 16,
    marginTop: 4,
  },
});
