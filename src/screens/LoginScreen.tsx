import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  ScrollView,
  Keyboard,
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring, FadeInUp, FadeOutUp, Layout } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useStore } from '../store/useStore';
import {
  loginWithPassword,
  requestEmailOtp,
  requestMagicLink,
  verifyEmailOtp,
  type LoginWithPasswordError,
} from '../services/authApi';

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : Colors.surface;

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const canGoBack = navigation.canGoBack();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMagicSending, setIsMagicSending] = useState(false);
  const [isOtpSending, setIsOtpSending] = useState(false);
  const [isOtpVerifying, setIsOtpVerifying] = useState(false);
  const [otpChallengeId, setOtpChallengeId] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const login = useStore(state => state.login);
  const setTwoFactorEnabled = useStore(state => state.setTwoFactorEnabled);
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;
  const canRequestMagicLink = email.trim().length > 0 && !isSubmitting && !isMagicSending;
  const canRequestOtp = email.trim().length > 0 && !isSubmitting && !isOtpSending;
  const canVerifyOtp = !!otpChallengeId && otpCode.trim().length >= 4 && !isOtpVerifying && !isSubmitting;

  const shakeOffset = useSharedValue(0);

  const shake = () => {
    shakeOffset.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withSpring(0, { damping: 20, stiffness: 400 })
    );
  };

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }]
  }));

  const handleLogin = async () => {
    if (isSubmitting) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setErrorMsg('Please fill in both email and password.');
      setInfoMsg('');
      shake();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMsg('Enter a valid email address.');
      setInfoMsg('');
      shake();
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      setInfoMsg('');
      shake();
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setIsSubmitting(true);

    try {
      const result = await loginWithPassword({
        email: normalizedEmail,
        password,
        twoFactorCode: recoveryCode.trim() ? undefined : twoFactorCode.trim() || undefined,
        recoveryCode: recoveryCode.trim() || undefined,
      });

      login(result.storeUser);
      setTwoFactorEnabled(result.user.twoFactorEnabled);
      navigation.replace('MainTabs');
    } catch (error) {
      const authError = error as LoginWithPasswordError;
      if (
        authError.code === 'TWO_FACTOR_CODE_REQUIRED'
        || authError.code === 'TWO_FACTOR_CODE_INVALID'
        || authError.code === 'RECOVERY_CODE_INVALID'
        || authError.code === 'TWO_FACTOR_NOT_CONFIGURED'
      ) {
        setRequiresTwoFactor(true);
        setInfoMsg('Enter your authenticator code (or a recovery code) to continue.');
      }
      setErrorMsg(authError.message || 'Unable to log in right now.');
      shake();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestOtp = async () => {
    if (isOtpSending || isSubmitting) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMsg('Enter your email first to receive an OTP code.');
      setInfoMsg('');
      shake();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMsg('Enter a valid email address before requesting OTP.');
      setInfoMsg('');
      shake();
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setIsOtpSending(true);

    try {
      const result = await requestEmailOtp(normalizedEmail);
      setOtpChallengeId(result.challengeId);
      setOtpCode('');

      if (result.developmentCode) {
        setInfoMsg(`Development OTP: ${result.developmentCode}`);
      } else {
        setInfoMsg('OTP sent to your email. Enter the code below.');
      }
    } catch (error) {
      setErrorMsg((error as Error).message || 'Unable to send OTP right now.');
      setInfoMsg('');
      shake();
    } finally {
      setIsOtpSending(false);
    }
  };

  const handleRequestMagicLink = async () => {
    if (isMagicSending || isSubmitting) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMsg('Enter your email first to request a magic link.');
      setInfoMsg('');
      shake();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMsg('Enter a valid email address before requesting a magic link.');
      setInfoMsg('');
      shake();
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setIsMagicSending(true);

    try {
      const result = await requestMagicLink(normalizedEmail);
      if (result.developmentMagicLink) {
        setInfoMsg(`Development magic link: ${result.developmentMagicLink}`);
      } else {
        setInfoMsg(result.message);
      }
    } catch (error) {
      setErrorMsg((error as Error).message || 'Unable to send magic link right now.');
      setInfoMsg('');
      shake();
    } finally {
      setIsMagicSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!otpChallengeId || isOtpVerifying || isSubmitting) {
      return;
    }

    const normalizedCode = otpCode.trim();
    if (normalizedCode.length < 4) {
      setErrorMsg('Enter the OTP code from your email.');
      setInfoMsg('');
      shake();
      return;
    }

    setErrorMsg('');
    setInfoMsg('');
    setIsOtpVerifying(true);

    try {
      const result = await verifyEmailOtp({
        challengeId: otpChallengeId,
        code: normalizedCode,
      });

      login(result.storeUser);
      setTwoFactorEnabled(result.user.twoFactorEnabled);
      navigation.replace('MainTabs');
    } catch (error) {
      const maybeAttempts = (error as { attemptsRemaining?: number }).attemptsRemaining;
      const baseMessage = (error as Error).message || 'Unable to verify OTP right now.';
      if (typeof maybeAttempts === 'number') {
        setErrorMsg(`${baseMessage} Attempts left: ${maybeAttempts}.`);
      } else {
        setErrorMsg(baseMessage);
      }
      shake();
    } finally {
      setIsOtpVerifying(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        {canGoBack ? (
          <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
          </AnimatedPressable>
        ) : (
          <View style={styles.backBtnSpacer} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          <View>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Log in to continue buying, selling, and trading.</Text>

            <View style={styles.form}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your email"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setRequiresTwoFactor(false);
                    setTwoFactorCode('');
                    setRecoveryCode('');
                    if (otpChallengeId) {
                      setOtpChallengeId(null);
                      setOtpCode('');
                    }
                    if (errorMsg) {
                      setErrorMsg('');
                    }
                    if (infoMsg) {
                      setInfoMsg('');
                    }
                  }}
                />
              </View>

              {requiresTwoFactor && (
                <View style={styles.twoFactorGroup}>
                  <Text style={styles.label}>Authenticator code</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="123456"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={6}
                    value={twoFactorCode}
                    onChangeText={(value) => {
                      setTwoFactorCode(value.replace(/\D/g, '').slice(0, 6));
                      if (errorMsg) {
                        setErrorMsg('');
                      }
                    }}
                  />

                  <Text style={styles.twoFactorHint}>If you lost access, use a recovery code below.</Text>

                  <Text style={styles.label}>Recovery code (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="ABCD-1234"
                    placeholderTextColor={Colors.textMuted}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    value={recoveryCode}
                    onChangeText={(value) => {
                      setRecoveryCode(value.toUpperCase());
                      if (errorMsg) {
                        setErrorMsg('');
                      }
                    }}
                  />
                </View>
              )}

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter your password"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry
                  returnKeyType="done"
                  value={password}
                  onChangeText={setPassword}
                  onSubmitEditing={() => {
                    Keyboard.dismiss();
                    if (canSubmit) {
                      void handleLogin();
                    }
                  }}
                />
              </View>

              <AnimatedPressable
                style={styles.forgotBtn}
                onPress={() => navigation.navigate('ForgotPassword')}
              >
                <Text style={styles.forgotText}>Forgot password?</Text>
              </AnimatedPressable>

              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>or</Text>
                <View style={styles.dividerLine} />
              </View>

              <AnimatedPressable
                style={[styles.otpRequestBtn, !canRequestOtp && styles.primaryBtnDisabled]}
                onPress={handleRequestOtp}
                activeOpacity={0.9}
                disabled={!canRequestOtp}
              >
                <Text style={styles.otpRequestText}>{isOtpSending ? 'Sending OTP...' : 'Send OTP to Email'}</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.magicLinkBtn, !canRequestMagicLink && styles.primaryBtnDisabled]}
                onPress={handleRequestMagicLink}
                activeOpacity={0.9}
                disabled={!canRequestMagicLink}
              >
                <Text style={styles.magicLinkText}>{isMagicSending ? 'Sending magic link...' : 'Send Magic Link Instead'}</Text>
              </AnimatedPressable>

              {!!otpChallengeId && (
                <View style={styles.otpGroup}>
                  <Text style={styles.label}>One-time code</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Enter OTP"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="number-pad"
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={10}
                    value={otpCode}
                    onChangeText={setOtpCode}
                    onSubmitEditing={() => {
                      Keyboard.dismiss();
                      if (canVerifyOtp) {
                        void handleVerifyOtp();
                      }
                    }}
                  />

                  <AnimatedPressable
                    style={[styles.otpVerifyBtn, !canVerifyOtp && styles.primaryBtnDisabled]}
                    onPress={handleVerifyOtp}
                    activeOpacity={0.9}
                    disabled={!canVerifyOtp}
                  >
                    <Text style={styles.otpVerifyText}>{isOtpVerifying ? 'Verifying...' : 'Verify OTP & Log In'}</Text>
                  </AnimatedPressable>
                </View>
              )}
            </View>
          </View>

          <View style={styles.footer}>
            {!!infoMsg && !errorMsg && (
              <Reanimated.Text
                entering={FadeInUp.springify().damping(20).duration(400)}
                exiting={FadeOutUp}
                layout={Layout.springify()}
                style={styles.infoText}
              >
                {infoMsg}
              </Reanimated.Text>
            )}

            {!!errorMsg && (
              <Reanimated.Text
                entering={FadeInUp.springify().damping(20).duration(400)}
                exiting={FadeOutUp}
                layout={Layout.springify()}
                style={styles.errorText}
              >
                {errorMsg}
              </Reanimated.Text>
            )}

            <Reanimated.View style={shakeStyle} layout={Layout.springify()}>
              <AnimatedPressable
                style={[styles.primaryBtn, !canSubmit && styles.primaryBtnDisabled]}
                onPress={handleLogin}
                activeOpacity={0.9}
                disabled={!canSubmit}
              >
                <Text style={styles.primaryText}>{isSubmitting ? 'Logging in...' : 'Log In'}</Text>
              </AnimatedPressable>
            </Reanimated.View>

            <View style={styles.switchRow}>
              <Text style={styles.switchText}>New to Thryftverse?</Text>
              <AnimatedPressable onPress={() => navigation.navigate('SignUp')} activeOpacity={0.8}>
                <Text style={styles.switchLink}>Create account</Text>
              </AnimatedPressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PANEL_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  backBtnSpacer: { width: 44, height: 44 },
  
  keyboardWrap: { flex: 1 },
  content: { flex: 1 },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 24,
  },
  title: { fontSize: 34, fontFamily: Typography.family.bold, color: Colors.textPrimary, lineHeight: 38, letterSpacing: -0.7 },
  subtitle: { marginTop: 8, fontSize: 14, lineHeight: 20, color: Colors.textSecondary, fontFamily: Typography.family.regular, marginBottom: 24 },
  
  form: { marginBottom: 24 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontFamily: Typography.family.semibold, color: Colors.textSecondary, marginBottom: 8 },
  input: { 
    height: 52,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 14,
    color: Colors.textPrimary, 
    fontSize: 16, 
    fontFamily: Typography.family.regular 
  },
  
  forgotBtn: { alignSelf: 'flex-start', marginTop: 8 },
  forgotText: { color: Colors.textSecondary, fontSize: 14, fontFamily: Typography.family.medium, textDecorationLine: 'underline' },
  dividerRow: {
    marginTop: 18,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  dividerText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: Typography.family.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  otpRequestBtn: {
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpRequestText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: Typography.family.semibold,
  },
  otpGroup: {
    marginTop: 14,
    gap: 10,
  },
  twoFactorGroup: {
    marginBottom: 16,
    gap: 8,
  },
  twoFactorHint: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: Typography.family.medium,
    marginBottom: 2,
  },
  magicLinkBtn: {
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 10,
  },
  magicLinkText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: Typography.family.medium,
    textDecorationLine: 'underline',
  },
  otpVerifyBtn: {
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
  otpVerifyText: {
    color: Colors.textInverse,
    fontSize: 14,
    fontFamily: Typography.family.semibold,
  },
  
  footer: { paddingTop: 8, position: 'relative' },
  infoText: { color: Colors.success, fontSize: 13, fontFamily: Typography.family.medium, textAlign: 'center', marginBottom: 12 },
  errorText: { color: Colors.danger, fontSize: 13, fontFamily: Typography.family.medium, textAlign: 'center', marginBottom: 12 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: Typography.family.semibold },
  switchRow: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  switchText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: Typography.family.regular,
  },
  switchLink: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    textDecorationLine: 'underline',
  },
});
