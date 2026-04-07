import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Dimensions,
  Alert,
  ActivityIndicator,
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
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import { Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
import { useStore } from '../store/useStore';
import { consumeMagicLink, loginWithAppleIdentityToken, loginWithGoogleIdToken } from '../services/authApi';

const { width, height } = Dimensions.get('window');

const BG_IMAGE = 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=85';

WebBrowser.maybeCompleteAuthSession();

function firstQueryParam(value: string | string[] | undefined): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === 'string');
  }

  return undefined;
}

export default function AuthLandingScreen() {
  const navigation = useNavigation<any>();
  const login = useStore((state) => state.login);
  const setTwoFactorEnabled = useStore((state) => state.setTwoFactorEnabled);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [isMagicLinkLoading, setIsMagicLinkLoading] = useState(false);

  const [googleRequest, googleResponse, promptGoogleAuth] = Google.useIdTokenAuthRequest({
    clientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID,
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID,
  });

  const handleMagicLink = useCallback(
    async (url: string | null) => {
      if (!url) {
        return;
      }

      const parsed = Linking.parse(url);
      const normalizedPath = (parsed.path ?? '').replace(/^\/+/, '').toLowerCase();
      const isExpectedMagicPath = normalizedPath === 'auth/magic-link' || normalizedPath === 'magic-link';
      if (!isExpectedMagicPath) {
        return;
      }

      const token = firstQueryParam(parsed.queryParams?.token as string | string[] | undefined);
      const email = firstQueryParam(parsed.queryParams?.email as string | string[] | undefined);

      if (!token) {
        return;
      }

      setIsMagicLinkLoading(true);
      try {
        const result = await consumeMagicLink({
          token,
          email,
        });
        login(result.storeUser);
        setTwoFactorEnabled(result.user.twoFactorEnabled);
        navigation.replace('MainTabs');
      } catch (error) {
        Alert.alert('Magic link failed', (error as Error).message);
      } finally {
        setIsMagicLinkLoading(false);
      }
    },
    [login, navigation, setTwoFactorEnabled]
  );

  useEffect(() => {
    void (async () => {
      const initialUrl = await Linking.getInitialURL();
      await handleMagicLink(initialUrl);
    })();

    const subscription = Linking.addEventListener('url', ({ url }) => {
      void handleMagicLink(url);
    });

    return () => {
      subscription.remove();
    };
  }, [handleMagicLink]);

  useEffect(() => {
    if (!googleResponse) {
      return;
    }

    if (googleResponse.type !== 'success') {
      setSocialLoading(null);
      return;
    }

    const tokenFromAuth = googleResponse.authentication?.idToken;
    const tokenFromParams = typeof googleResponse.params?.id_token === 'string'
      ? googleResponse.params.id_token
      : null;
    const idToken = tokenFromAuth ?? tokenFromParams;

    if (!idToken) {
      setSocialLoading(null);
      Alert.alert('Google sign-in failed', 'Unable to get Google identity token.');
      return;
    }

    void (async () => {
      try {
        const result = await loginWithGoogleIdToken(idToken);
        login(result.storeUser);
        setTwoFactorEnabled(result.user.twoFactorEnabled);
        navigation.replace('MainTabs');
      } catch (error) {
        Alert.alert('Google sign-in failed', (error as Error).message);
      } finally {
        setSocialLoading(null);
      }
    })();
  }, [googleResponse, login, navigation, setTwoFactorEnabled]);

  const handleGoogleSignIn = async () => {
    if (socialLoading || isMagicLinkLoading) {
      return;
    }

    if (!googleRequest) {
      Alert.alert(
        'Google sign-in unavailable',
        'Configure Google OAuth client IDs in your Expo public environment variables.'
      );
      return;
    }

    setSocialLoading('google');

    try {
      const response = await promptGoogleAuth();
      if (response.type !== 'success') {
        setSocialLoading(null);
      }
    } catch (error) {
      setSocialLoading(null);
      Alert.alert('Google sign-in failed', (error as Error).message);
    }
  };

  const handleAppleSignIn = async () => {
    if (socialLoading || isMagicLinkLoading) {
      return;
    }

    const available = await AppleAuthentication.isAvailableAsync();
    if (!available) {
      Alert.alert('Apple sign-in unavailable', 'Apple sign-in is only available on supported iOS devices.');
      return;
    }

    setSocialLoading('apple');

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('Missing Apple identity token');
      }

      const result = await loginWithAppleIdentityToken(credential.identityToken);
      login(result.storeUser);
      setTwoFactorEnabled(result.user.twoFactorEnabled);
      navigation.replace('MainTabs');
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ERR_REQUEST_CANCELED') {
        Alert.alert('Apple sign-in failed', (error as Error).message);
      }
    } finally {
      setSocialLoading(null);
    }
  };

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
          <Text style={styles.logo}>entry 01</Text>
        </Reanimated.View>

        {/* Middle - main copy */}
        <View style={styles.content}>
          <Reanimated.Text
            entering={FadeInDown.delay(400).duration(600).springify()}
            style={styles.title}
          >
            THRYFT
          </Reanimated.Text>

          <Reanimated.Text
            entering={FadeInDown.delay(600).duration(500)}
            style={styles.subtitle}
          >
            buy, sell, trade. no noise.
          </Reanimated.Text>
        </View>

        {/* Bottom - CTAs */}
        <Reanimated.View entering={FadeInUp.delay(700).duration(500).springify()} style={styles.footer}>
          <AnimatedPressable
            style={styles.primaryBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={styles.primaryText}>create account</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={styles.secondaryBtn}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.secondaryText}>i already have an account</Text>
          </AnimatedPressable>

          {/* Social login row */}
          <View style={styles.socialRow}>
            <AnimatedPressable
              style={[styles.socialBtn, (!!socialLoading || isMagicLinkLoading) && styles.socialBtnDisabled]}
              activeOpacity={0.8}
              onPress={handleAppleSignIn}
              disabled={!!socialLoading || isMagicLinkLoading}
            >
              {socialLoading === 'apple' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="logo-apple" size={20} color="#fff" />
              )}
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.socialBtn, (!!socialLoading || isMagicLinkLoading) && styles.socialBtnDisabled]}
              activeOpacity={0.8}
              onPress={handleGoogleSignIn}
              disabled={!!socialLoading || isMagicLinkLoading}
            >
              {socialLoading === 'google' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Ionicons name="logo-google" size={18} color="#fff" />
              )}
            </AnimatedPressable>
          </View>

          {isMagicLinkLoading && (
            <Text style={styles.magicLinkLoadingText}>Signing you in from your email link...</Text>
          )}

          <Text style={styles.termsText}>
            by continuing, you agree to our terms of service and privacy policy.
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
    fontSize: 11,
    fontFamily: Typography.family.medium,
    color: 'rgba(232,220,200,0.9)',
    letterSpacing: 2.8,
    textTransform: 'uppercase',
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  title: {
    fontSize: 72,
    fontFamily: Typography.family.extrabold,
    color: '#f6f2ea',
    lineHeight: 74,
    letterSpacing: -2.4,
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: Typography.family.light,
    color: 'rgba(245,239,230,0.72)',
    lineHeight: 18,
    letterSpacing: 0.24,
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
  socialBtnDisabled: {
    opacity: 0.7,
  },
  magicLinkLoadingText: {
    marginTop: 8,
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    textAlign: 'center',
    fontFamily: Typography.family.medium,
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
