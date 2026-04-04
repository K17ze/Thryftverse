import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring, FadeInUp, FadeOutUp, Layout } from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useStore } from '../store/useStore';
import { MY_USER } from '../data/mockData';

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : Colors.surface;

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const canGoBack = navigation.canGoBack();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const login = useStore(state => state.login);
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isSubmitting;

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

  const handleLogin = () => {
    if (isSubmitting) {
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail || !password) {
      setErrorMsg('Please fill in both email and password.');
      shake();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMsg('Enter a valid email address.');
      shake();
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      shake();
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    // Use local mock auth state, then continue to the main app shell.
    login(MY_USER);
    navigation.replace('MainTabs');
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
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
              value={email}
              onChangeText={setEmail}
            />
          </View>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Enter your password" 
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <AnimatedPressable 
            style={styles.forgotBtn} 
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </AnimatedPressable>
        </View>

        <View style={styles.footer}>
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 8 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: PANEL_BG, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  backBtnSpacer: { width: 44, height: 44 },
  
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 10 },
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
  
  footer: { paddingBottom: 24, position: 'relative' },
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
