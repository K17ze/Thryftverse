import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { BottomSheet } from '../BottomSheet';
import { AnimatedPressable } from '../AnimatedPressable';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../../constants/colors';
import { useStore } from '../../store/useStore';
import { useToast } from '../../context/ToastContext';
import { buildCardPaymentMethod } from '../../utils/checkoutFlow';
import { formatCountryPolicyScope, isPaymentMethodAllowed } from '../../utils/capabilityPolicy';
import { createUserPaymentMethod } from '../../services/commerceApi';
import { getUserCountryCapabilities, UserCountryCapabilities } from '../../services/capabilitiesApi';
import { parseApiError } from '../../lib/apiClient';
import * as Haptics from 'expo-haptics';

const IS_LIGHT = ActiveTheme === 'light';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const DIVIDER = IS_LIGHT ? '#e4ded3' : '#1c1c1c';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';
const CARD_PREVIEW_BG = IS_LIGHT ? '#f1ede6' : '#1a2a1a';
const CARD_PREVIEW_BORDER = IS_LIGHT ? '#d0c3af' : `${BRAND}44`;

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSuccess?: () => void;
}

export function AddCardSheet({ visible, onDismiss, onSuccess }: Props) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [countryCapabilities, setCountryCapabilities] = useState<UserCountryCapabilities | null>(null);
  const currentUser = useStore((state) => state.currentUser);
  const savePaymentMethod = useStore((state) => state.savePaymentMethod);
  const { show } = useToast();

  useEffect(() => {
    if (!visible) {
      // Reset state if closed
      setCardNumber('');
      setExpiry('');
      setCvv('');
      setName('');
    }
  }, [visible]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCapabilities = async () => {
      if (!visible || !currentUser?.id) {
        if (!cancelled) {
          setCountryCapabilities(null);
        }
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
  }, [currentUser?.id, visible]);

  const formatCardNumber = (val: string) =>
    val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  const formatExpiry = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    return clean.length >= 2 ? clean.slice(0, 2) + '/' + clean.slice(2) : clean;
  };

  const expiryIsValid = (() => {
    if (!/^\d{2}\/\d{2}$/.test(expiry)) return false;
    const month = Number(expiry.slice(0, 2));
    return month >= 1 && month <= 12;
  })();

  const isComplete =
    cardNumber.replace(/\s/g, '').length === 16 &&
    expiryIsValid &&
    cvv.length >= 3 &&
    name.trim().length >= 2;

  const cardAllowed = isPaymentMethodAllowed(countryCapabilities, 'card');

  const policyLabel = useMemo(() => {
    if (!countryCapabilities) {
      return null;
    }

    return formatCountryPolicyScope(countryCapabilities);
  }, [countryCapabilities]);

  const handleSaveCard = async () => {
    if (!cardAllowed) {
      show('Card payments are unavailable for your country policy.', 'error');
      return;
    }

    if (!isComplete || isSaving) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const last4 = cardNumber.replace(/\s/g, '').slice(-4);
    const localPaymentMethod = buildCardPaymentMethod(last4, expiry, 'Visa');

    setIsSaving(true);
    let shouldDismiss = true;
    try {
      const userId = currentUser?.id ?? 'u1';
      const saved = await createUserPaymentMethod(userId, {
        type: 'card',
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
      show('Card saved to wallet', 'success');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to save card right now.');
      if (parsed.isNetworkError) {
        savePaymentMethod(localPaymentMethod);
        show('Card saved locally. Backend sync unavailable.', 'info');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        shouldDismiss = false;
        show(parsed.message, 'error');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setIsSaving(false);
      if (shouldDismiss) {
        onDismiss();
        if (onSuccess) onSuccess();
      }
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} snapPoint={0.88}>
      <Text style={styles.sheetTitle}>Add card</Text>
      {policyLabel ? <Text style={styles.policyLabel}>Policy scope: {policyLabel}</Text> : null}
      
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {!cardAllowed ? (
          <View style={styles.blockedCard}>
            <Text style={styles.blockedTitle}>Cards unavailable in your region</Text>
            <Text style={styles.blockedText}>Switch country policy to enable card rails.</Text>
          </View>
        ) : null}

        <View style={styles.cardPreview}>
          <Text style={styles.cardPreviewNumber}>
            {cardNumber || '**** **** **** ****'}
          </Text>
          <View style={styles.cardPreviewBottom}>
            <View>
              <Text style={styles.cardPreviewLabel}>CARDHOLDER</Text>
              <Text style={styles.cardPreviewValue}>{name || 'YOUR NAME'}</Text>
            </View>
            <View>
              <Text style={styles.cardPreviewLabel}>EXPIRES</Text>
              <Text style={styles.cardPreviewValue}>{expiry || 'MM/YY'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>CARD DETAILS</Text>
        <View style={styles.card}>
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Card number</Text>
            <TextInput
              style={styles.fieldInput}
              value={cardNumber}
              onChangeText={v => setCardNumber(formatCardNumber(v))}
              placeholder="0000 0000 0000 0000"
              placeholderTextColor={MUTED}
              keyboardType="number-pad"
              selectionColor={BRAND}
              maxLength={19}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.fieldRowHalf}>
            <View style={styles.halfField}>
              <Text style={styles.fieldLabel}>Expiry date</Text>
              <TextInput
                style={styles.fieldInput}
                value={expiry}
                onChangeText={v => setExpiry(formatExpiry(v))}
                placeholder="MM/YY"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                selectionColor={BRAND}
                maxLength={5}
              />
            </View>
            <View style={styles.halfDivider} />
            <View style={styles.halfField}>
              <Text style={styles.fieldLabel}>CVV</Text>
              <TextInput
                style={styles.fieldInput}
                value={cvv}
                onChangeText={v => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                placeholder="***"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                selectionColor={BRAND}
                secureTextEntry
                maxLength={4}
              />
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.fieldRow}>
            <Text style={styles.fieldLabel}>Name on card</Text>
            <TextInput
              style={styles.fieldInput}
              value={name}
              onChangeText={setName}
              placeholder="As it appears on card"
              placeholderTextColor={MUTED}
              autoCapitalize="words"
              selectionColor={BRAND}
            />
          </View>
        </View>

        <View style={styles.secureRow}>
          <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
          <Text style={styles.secureText}>Your card details are encrypted and secure</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={styles.footer}>
        <AnimatedPressable
          style={[styles.saveBtn, (!isComplete || isSaving || !cardAllowed) && { opacity: 0.4 }]}
          disabled={!isComplete || isSaving || !cardAllowed}
          onPress={handleSaveCard}
        >
          <Text style={styles.saveBtnText}>{isSaving ? 'Processing...' : 'Save securely'}</Text>
        </AnimatedPressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 20 },
  policyLabel: { fontSize: 12, color: MUTED, textAlign: 'center', marginTop: -8, marginBottom: 12 },
  content: { paddingBottom: 40 },
  blockedCard: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 16,
  },
  blockedTitle: { fontSize: 13, fontWeight: '700', color: TEXT, marginBottom: 4 },
  blockedText: { fontSize: 12, color: MUTED, lineHeight: 18 },
  cardPreview: {
    backgroundColor: CARD_PREVIEW_BG,
    borderRadius: 20,
    padding: 24,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: CARD_PREVIEW_BORDER,
    height: 180,
    justifyContent: 'space-between',
  },
  cardPreviewNumber: { fontSize: 22, fontWeight: '700', color: TEXT, letterSpacing: 2 },
  cardPreviewBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardPreviewLabel: { fontSize: 10, color: MUTED, letterSpacing: 1.5, marginBottom: 4 },
  cardPreviewValue: { fontSize: 14, fontWeight: '600', color: TEXT },
  sectionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  fieldRow: { paddingHorizontal: 18, paddingVertical: 14 },
  fieldRowHalf: { flexDirection: 'row' },
  halfField: { flex: 1, paddingHorizontal: 18, paddingVertical: 14 },
  halfDivider: { width: 1, backgroundColor: DIVIDER },
  fieldLabel: { fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  fieldInput: { fontSize: 16, color: TEXT, fontWeight: '500' },
  divider: { height: 1, backgroundColor: DIVIDER },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  secureText: { fontSize: 12, color: MUTED },
  footer: { paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 0 : 20 },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.textInverse },
});

