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
import { useStore } from '../store/useStore';
import { MY_USER } from '../data/mockData';

export default function SignUpScreen() {
  const navigation = useNavigation<any>();
  const login = useStore((state) => state.login);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const canSubmit = username.trim().length > 0 && email.trim().length > 0 && password.length > 0 && !isSubmitting;

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

  const handleSignUp = () => {
    if (isSubmitting) {
      return;
    }

    const normalizedUsername = username.trim();
    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedUsername || !normalizedEmail || !password) {
      setErrorMsg('Please fill in all details.');
      shake();
      return;
    }

    if (normalizedUsername.length < 3) {
      setErrorMsg('Username must be at least 3 characters.');
      shake();
      return;
    }

    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setErrorMsg('Enter a valid email address.');
      shake();
      return;
    }

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters.');
      shake();
      return;
    }

    setErrorMsg('');
    setIsSubmitting(true);
    login({ ...MY_USER, username: normalizedUsername });
    navigation.replace('MainTabs');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>Join{'\n'}the movement.</Text>
        
        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Pick a unique username" 
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
              value={username}
              onChangeText={setUsername}
            />
          </View>

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
              placeholder="Create a password" 
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.termsText}>
            By signing up, you agree to our Terms of Service and Privacy Policy.
          </Text>
          
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
              onPress={handleSignUp}
              activeOpacity={0.9}
              disabled={!canSubmit}
            >
              <Text style={styles.primaryText}>{isSubmitting ? 'Creating account...' : 'Create Account'}</Text>
            </AnimatedPressable>
          </Reanimated.View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, lineHeight: 48, letterSpacing: -1, marginBottom: 40 },
  
  form: { marginBottom: 30 },
  inputGroup: { marginBottom: 24 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 12 },
  input: { 
    height: 56, 
    borderBottomWidth: 1, 
    borderBottomColor: '#222', 
    color: Colors.textPrimary, 
    fontSize: 16, 
    fontFamily: 'Inter_400Regular' 
  },
  
  footer: { paddingBottom: 40, position: 'relative' },
  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  errorText: { color: Colors.danger, fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 12 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
