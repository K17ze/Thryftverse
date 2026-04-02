import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { buildBankAccountPaymentMethod } from '../utils/checkoutFlow';
import { createUserPaymentMethod } from '../services/commerceApi';

type Props = StackScreenProps<RootStackParamList, 'AddBankAccount'>;

const IS_LIGHT = ActiveTheme === 'light';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const CARD_SOFT = IS_LIGHT ? '#f7f4ef' : '#151515';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const DIVIDER = IS_LIGHT ? '#e4ded3' : '#1c1c1c';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';

export default function AddBankAccountScreen({ navigation }: Props) {
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [sortCode, setSortCode] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const currentUser = useStore((state) => state.currentUser);
  const savePaymentMethod = useStore((state) => state.savePaymentMethod);
  const { show } = useToast();

  const formatSortCode = (v: string) => {
    const clean = v.replace(/\D/g, '').slice(0, 6);
    if (clean.length >= 4) return `${clean.slice(0, 2)}-${clean.slice(2, 4)}-${clean.slice(4)}`;
    if (clean.length >= 2) return `${clean.slice(0, 2)}-${clean.slice(2)}`;
    return clean;
  };

  const isComplete = accountName.trim().length >= 2 && accountNumber.length === 8 && sortCode.replace(/-/g, '').length === 6;

  const handleSaveBank = async () => {
    if (!isComplete || isSaving) {
      return;
    }

    const localPaymentMethod = buildBankAccountPaymentMethod(accountNumber.slice(-4), sortCode);

    setIsSaving(true);
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
    } catch {
      savePaymentMethod(localPaymentMethod);
      show('Bank account saved locally. Backend sync unavailable.', 'info');
    } finally {
      setIsSaving(false);
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Add bank account</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
              Withdrawals typically take 1–3 business days. You'll receive a confirmation email once initiated.
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <AnimatedPressable
            style={[styles.saveBtn, (!isComplete || isSaving) && { opacity: 0.4 }]}
            disabled={!isComplete || isSaving}
            onPress={handleSaveBank}
          >
            <Text style={styles.saveBtnText}>{isSaving ? 'Saving...' : 'Save bank account'}</Text>
          </AnimatedPressable>
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
  content: { padding: 20, paddingBottom: 40 },
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
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.textInverse },
});
