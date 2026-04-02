import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  StatusBar,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';

type Props = StackScreenProps<RootStackParamList, 'TwoFactorSetup'>;

export default function TwoFactorSetupScreen({ navigation }: Props) {
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const setTwoFactorEnabled = useStore((state) => state.setTwoFactorEnabled);
  const { show } = useToast();

  const handleEnable = () => {
    if (code.trim().length !== 6) {
      setErrorMsg('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setErrorMsg('');
    setTwoFactorEnabled(true);
    show('Two-factor authentication enabled', 'success');
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Two-Factor Setup</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>Secure your account</Text>
        <Text style={styles.subtitle}>
          Scan this code with an authenticator app, then enter the 6-digit verification code below.
        </Text>

        <View style={styles.qrCard}>
          <Ionicons name="qr-code-outline" size={88} color={Colors.textPrimary} />
          <Text style={styles.qrHint}>otpauth://totp/thryftverse:user@example.com</Text>
        </View>

        <Text style={styles.inputLabel}>Verification code</Text>
        <TextInput
          style={styles.input}
          value={code}
          onChangeText={(value) => {
            setCode(value.replace(/\D/g, '').slice(0, 6));
            if (errorMsg) {
              setErrorMsg('');
            }
          }}
          keyboardType="number-pad"
          placeholder="123456"
          placeholderTextColor={Colors.textMuted}
          maxLength={6}
        />

        {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

        <AnimatedPressable style={styles.secondaryBtn} onPress={() => show('New code requested', 'info')} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>I need a new code</Text>
        </AnimatedPressable>

        <AnimatedPressable style={styles.primaryBtn} onPress={handleEnable} activeOpacity={0.9}>
          <Text style={styles.primaryBtnText}>Enable 2FA</Text>
        </AnimatedPressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
  },
  title: {
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 12,
    letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: 24,
  },
  qrCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  qrHint: {
    marginTop: 16,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
  },
  inputLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  input: {
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: '#222',
    color: Colors.textPrimary,
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 6,
    paddingHorizontal: 2,
    marginBottom: 8,
  },
  errorText: {
    color: Colors.danger,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    marginBottom: 16,
  },
  secondaryBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    marginBottom: 24,
  },
  secondaryBtnText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    textDecorationLine: 'underline',
  },
  primaryBtn: {
    backgroundColor: Colors.textPrimary,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
