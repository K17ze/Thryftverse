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
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { requestTwoFactorEnrollment, verifyTwoFactorEnrollment } from '../services/authApi';

type Props = StackScreenProps<RootStackParamList, 'TwoFactorSetup'>;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;

export default function TwoFactorSetupScreen({ navigation }: Props) {
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [manualKey, setManualKey] = useState('');
  const [otpauthUrl, setOtpauthUrl] = useState('');
  const [isLoadingEnrollment, setIsLoadingEnrollment] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const setTwoFactorEnabled = useStore((state) => state.setTwoFactorEnabled);
  const { show } = useToast();
  const canEnable = code.trim().length === 6 && !isLoadingEnrollment && !isVerifying;

  const fetchEnrollment = async () => {
    setIsLoadingEnrollment(true);
    setErrorMsg('');

    try {
      const result = await requestTwoFactorEnrollment();
      setManualKey(result.secret);
      setOtpauthUrl(result.otpauthUrl);
      show('Authenticator secret generated. Add it in your app and verify.', 'info');
    } catch (error) {
      setErrorMsg((error as Error).message || 'Unable to start two-factor setup.');
    } finally {
      setIsLoadingEnrollment(false);
    }
  };

  React.useEffect(() => {
    void fetchEnrollment();
  }, []);

  const handleEnable = async () => {
    if (code.trim().length !== 6) {
      setErrorMsg('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setErrorMsg('');
    setIsVerifying(true);
    try {
      const result = await verifyTwoFactorEnrollment(code.trim());
      setTwoFactorEnabled(true);
      Alert.alert(
        '2FA Enabled',
        `Save these recovery codes in a secure location:\n\n${result.recoveryCodes.join('\n')}`,
        [
          {
            text: 'Done',
            onPress: () => navigation.goBack(),
          },
        ]
      );
      show('Two-factor authentication enabled', 'success');
    } catch (error) {
      setErrorMsg((error as Error).message || 'Unable to verify the provided code.');
    } finally {
      setIsVerifying(false);
    }
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
          {isLoadingEnrollment ? (
            <ActivityIndicator color={Colors.textPrimary} size="large" />
          ) : (
            <Ionicons name="qr-code-outline" size={88} color={Colors.textPrimary} />
          )}
          <Text style={styles.qrHint} numberOfLines={3}>{otpauthUrl || 'Generating secure enrollment secret...'}</Text>
          {!!manualKey && <Text style={styles.manualKeyText}>Manual key: {manualKey}</Text>}
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

        <AnimatedPressable style={styles.secondaryBtn} onPress={() => void fetchEnrollment()} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>{isLoadingEnrollment ? 'Refreshing secret...' : 'I need a new secret'}</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={[styles.primaryBtn, !canEnable && styles.primaryBtnDisabled]}
          onPress={() => void handleEnable()}
          activeOpacity={0.9}
          disabled={!canEnable}
        >
          <Text style={styles.primaryBtnText}>{isVerifying ? 'Verifying...' : 'Enable 2FA'}</Text>
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
    backgroundColor: PANEL_BG,
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
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  qrHint: {
    marginTop: 16,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
  manualKeyText: {
    marginTop: 10,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
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
    borderBottomColor: Colors.border,
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
  primaryBtnDisabled: {
    opacity: 0.45,
  },
  primaryBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
