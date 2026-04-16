import React, { useEffect, useMemo, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { AppButton } from '../components/ui/AppButton';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
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
import { formatCountryPolicyScope, isPaymentMethodAllowed } from '../utils/capabilityPolicy';
import { buildBankAccountPaymentMethod } from '../utils/checkoutFlow';
import { createUserPaymentMethod } from '../services/commerceApi';
import { getUserCountryCapabilities, UserCountryCapabilities } from '../services/capabilitiesApi';
import { parseApiError } from '../lib/apiClient';

type Props = StackScreenProps<RootStackParamList, 'AddBankAccount'>;

const IS_LIGHT = ActiveTheme === 'light';
const BG = Colors.background;
const CARD = Colors.card;
const CARD_SOFT = Colors.cardAlt;
const BORDER = Colors.border;
const DIVIDER = Colors.border;
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';

export default function AddBankAccountScreen({ navigation }: Props) {
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [countryCapabilities, setCountryCapabilities] = useState<UserCountryCapabilities | null>(null);
  const currentUser = useStore((state) => state.currentUser);
  const savePaymentMethod = useStore((state) => state.savePaymentMethod);
  const { show } = useToast();

  useEffect(() => {
    let cancelled = false;

    const hydrateCapabilities = async () => {
      if (!currentUser?.id) {
        setCountryCapabilities(null);
        return;
      }

      try {
        const capabilities = await getUserCountryCapabilities(currentUser.id);
        if (!cancelled) {
          setCountryCapabilities(capabilities);
        }
      } catch {
        if (!cancelled) {
          setCountryCapabilities(null);
        }
      }
    };

    void hydrateCapabilities();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const formatSortCode = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 6);
    if (clean.length >= 4) return `${clean.slice(0, 2)}-${clean.slice(2, 4)}-${clean.slice(4)}`;
    if (clean.length >= 2) return `${clean.slice(0, 2)}-${clean.slice(2)}`;
    return clean;
  };

  const isComplete = accountName.trim().length >= 2 && accountNumber.length === 8 && sortCode.replace(/-/g, '').length === 6;

  const bankAllowed = isPaymentMethodAllowed(countryCapabilities, 'bank_account');

  const policyLabel = useMemo(() => {
    if (!countryCapabilities) {
      return null;
    }

    return formatCountryPolicyScope(countryCapabilities);
  }, [countryCapabilities]);

  const handleSaveBank = async () => {
    if (!bankAllowed) {
      show('Bank accounts are unavailable for your country policy.', 'error');
      return;
    }

    if (!isComplete || isSaving) {
      return;
    }

    const localPaymentMethod = buildBankAccountPaymentMethod(accountNumber.slice(-4), sortCode);

    setIsSaving(true);
    let shouldCloseScreen = true;
    try {
      const userId = currentUser?.id ?? 'u1';
      const saved = await createUserPaymentMethod(userId, {
        type: 'bank_account',
        label: localPaymentMethod.label,
        details: localPaymentMethod.details,
        isDefault: true,
      });

      savePaymentMethod({
        id: saved.id,
        type: saved.type,
        label: saved.label,
        details: saved.details ?? undefined,
        isDefault: saved.isDefault,
      });
      show('Bank account saved', 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to save bank account right now.');
      if (parsed.isNetworkError) {
        savePaymentMethod(localPaymentMethod);
        show('Bank account saved locally. Backend sync unavailable.', 'info');
      } else {
        shouldCloseScreen = false;
        show(parsed.message, 'error');
      }
    } finally {
      setIsSaving(false);
      if (shouldCloseScreen) {
        navigation.goBack();
      }
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Add bank account</Text>
        <View style={{ width: 24 }} />
      </View>

      {policyLabel ? <Text style={styles.policyLabel}>Policy scope: {policyLabel}</Text> : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {!bankAllowed ? (
            <View style={styles.blockedCard}>
              <Text style={styles.blockedTitle}>Bank payouts unavailable in your region</Text>
              <Text style={styles.blockedText}>Switch your country policy to enable bank withdrawal rails.</Text>
            </View>
          ) : null}

          <Text style={styles.intro}>
            Your bank account is used for withdrawals. We use bank-grade encryption to keep your details safe.
          </Text>

          <Text style={styles.sectionLabel}>ACCOUNT DETAILS</Text>
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Account holder name</Text>
              <TextInput
                style={styles.fieldInput}
                value={accountName}
                onChangeText={setAccountName}
                placeholder="Full name on account"
                placeholderTextColor={MUTED}
                autoCapitalize="words"
                selectionColor={BRAND}
                accessibilityLabel="Account holder name"
                accessibilityHint="Enter the full legal name on the bank account"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Account number</Text>
              <TextInput
                style={styles.fieldInput}
                value={accountNumber}
                onChangeText={v => setAccountNumber(v.replace(/\D/g, '').slice(0, 8))}
                placeholder="8 digits"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                selectionColor={BRAND}
                maxLength={8}
                accessibilityLabel="Account number"
                accessibilityHint="Enter your 8-digit account number"
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Sort code</Text>
              <TextInput
                style={styles.fieldInput}
                value={sortCode}
                onChangeText={v => setSortCode(formatSortCode(v))}
                placeholder="00-00-00"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                selectionColor={BRAND}
                maxLength={8}
                accessibilityLabel="Sort code"
                accessibilityHint="Enter the 6-digit sort code"
              />
            </View>
          </View>

          <View style={styles.secureRow}>
            <Ionicons name="shield-checkmark-outline" size={14} color={BRAND} />
            <Text style={styles.secureText}>Protected by bank-level encryption</Text>
          </View>

          <View style={styles.infoCard}>
            <Ionicons name="information-circle-outline" size={16} color={MUTED} />
            <Text style={styles.infoText}>
              Withdrawals typically take 1-3 business days. You'll receive a confirmation email once initiated.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <AppButton
            title={isSaving ? 'Saving...' : 'Save bank account'}
            onPress={handleSaveBank}
            disabled={!isComplete || isSaving || !bankAllowed}
            style={styles.saveBtn}
            accessibilityLabel={isSaving ? 'Saving bank account' : 'Save bank account'}
            accessibilityHint="Saves this bank account for withdrawals"
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  policyLabel: { fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 8 },
  content: { padding: 20, paddingBottom: 40 },
  blockedCard: {
    backgroundColor: CARD_SOFT,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  blockedTitle: { fontSize: 13, fontWeight: '700', color: TEXT, marginBottom: 4 },
  blockedText: { fontSize: 12, color: MUTED, lineHeight: 18 },
  intro: { fontSize: 14, color: MUTED, lineHeight: 20, marginBottom: 24 },
  sectionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  fieldRow: { paddingHorizontal: 18, paddingVertical: 14 },
  fieldLabel: { fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  fieldInput: { fontSize: 16, color: TEXT, fontWeight: '500' },
  divider: { height: 1, backgroundColor: DIVIDER },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 16 },
  secureText: { fontSize: 12, color: BRAND },
  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: CARD_SOFT,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 14,
  },
  infoText: { flex: 1, fontSize: 12, color: MUTED, lineHeight: 18 },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: BORDER },
  saveBtn: { borderRadius: 30 },
});

