import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { formatCountryPolicyScope, isPaymentMethodAllowed } from '../utils/capabilityPolicy';
import { AddCardSheet } from '../components/checkout/AddCardSheet';
import { CommercePaymentMethod, listUserPaymentMethods } from '../services/commerceApi';
import { getUserCountryCapabilities, UserCountryCapabilities } from '../services/capabilitiesApi';

type Props = StackScreenProps<RootStackParamList, 'Payments'>;
const PANEL_BG = Colors.card;
const PANEL_SOFT_BG = Colors.cardAlt;
const PANEL_BORDER = Colors.border;

export default function PaymentsScreen({ navigation }: Props) {
  const [useBalance, setUseBalance] = useState(true);
  const [backendPaymentMethods, setBackendPaymentMethods] = useState<CommercePaymentMethod[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [addCardSheetVisible, setAddCardSheetVisible] = useState(false);
  const [countryCapabilities, setCountryCapabilities] = useState<UserCountryCapabilities | null>(null);
  const currentUser = useStore((state) => state.currentUser);
  const savedPaymentMethod = useStore((state) => state.savedPaymentMethod);
  const { formatFromFiat } = useFormattedPrice();

  const syncPaymentMethods = useCallback(async (isCancelled?: () => boolean) => {
    setIsSyncing(true);
    try {
      const userId = currentUser?.id ?? 'u1';
      const [methodsResult, capabilitiesResult] = await Promise.allSettled([
        listUserPaymentMethods(userId),
        getUserCountryCapabilities(userId),
      ]);

      if (isCancelled?.()) {
        return;
      }

      setBackendPaymentMethods(methodsResult.status === 'fulfilled' ? methodsResult.value : []);
      setCountryCapabilities(capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null);
    } catch {
      if (isCancelled?.()) {
        return;
      }

      setBackendPaymentMethods([]);
      setCountryCapabilities(null);
    } finally {
      if (!isCancelled?.()) {
        setIsSyncing(false);
      }
    }
  }, [currentUser?.id]);

  useEffect(() => {
    let cancelled = false;

    void syncPaymentMethods(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [syncPaymentMethods]);

  const cardMethods = useMemo(
    () => backendPaymentMethods.filter((method) => method.type === 'card'),
    [backendPaymentMethods]
  );
  const bankMethods = useMemo(
    () => backendPaymentMethods.filter((method) => method.type === 'bank_account'),
    [backendPaymentMethods]
  );

  const fallbackCard = savedPaymentMethod?.type === 'card' ? savedPaymentMethod : null;
  const fallbackBank = savedPaymentMethod?.type === 'bank_account' ? savedPaymentMethod : null;
  const allowCards = isPaymentMethodAllowed(countryCapabilities, 'card');
  const allowBankAccounts = isPaymentMethodAllowed(countryCapabilities, 'bank_account');
  const policyLabel = formatCountryPolicyScope(countryCapabilities);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Payments</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {policyLabel ? <Text style={styles.policyLabel}>Payment policy: {policyLabel}</Text> : null}
        
        {/* Restored Balance usage toggle */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.cardGroup}>
          <View style={styles.paymentRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentTitle}>Use Thryftverse Balance</Text>
              <Text style={styles.paymentSub}>Automatically apply {formatFromFiat(120.5, 'GBP', { displayMode: 'fiat' })} to purchases</Text>
            </View>
            <AnimatedPressable onPress={() => setUseBalance(!useBalance)}>
              <Ionicons 
                name={useBalance ? "toggle" : "toggle-outline"} 
                size={36} 
                color={useBalance ? Colors.success : Colors.textMuted} 
              />
            </AnimatedPressable>
          </View>
        </View>

        {/* Restored Complete Payment Methods View */}
        <Text style={styles.sectionTitle}>{isSyncing ? 'Cards · syncing...' : 'Cards'}</Text>
        <View style={styles.cardGroup}>
          {!allowCards ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="card-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>Cards unavailable in your region</Text>
                <Text style={styles.paymentSub}>Switching compliance country will refresh payment rails.</Text>
              </View>
            </View>
          ) : cardMethods.length > 0 ? (
            cardMethods.map((method) => (
              <View key={`card-${method.id}`} style={styles.paymentRow}>
                <View style={styles.iconCircle}>
                  <Ionicons name="card" size={20} color={Colors.textPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentTitle}>{method.label}</Text>
                  <Text style={styles.paymentSub}>{method.details ?? 'Saved card'}</Text>
                </View>
                {method.isDefault ? (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultText}>Default</Text>
                  </View>
                ) : null}
              </View>
            ))
          ) : fallbackCard ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="card" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>{fallbackCard.label}</Text>
                <Text style={styles.paymentSub}>{fallbackCard.details ?? 'Saved card'}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="card-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>No saved cards</Text>
                <Text style={styles.paymentSub}>Add a card to pay instantly at checkout</Text>
              </View>
            </View>
          )}
          {allowCards ? (
            <AnimatedPressable style={styles.addBtn} onPress={() => setAddCardSheetVisible(true)}>
              <Ionicons name="add" size={20} color={Colors.textPrimary} />
              <Text style={styles.addText}>Add new card</Text>
            </AnimatedPressable>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>Bank Accounts</Text>
        <View style={styles.cardGroup}>
          {!allowBankAccounts ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="business-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>Bank payouts unavailable in your region</Text>
                <Text style={styles.paymentSub}>Supported rails will appear when available for your country.</Text>
              </View>
            </View>
          ) : bankMethods.length > 0 ? (
            bankMethods.map((method) => (
              <View key={`bank-${method.id}`} style={styles.paymentRow}>
                <View style={styles.iconCircle}>
                  <Ionicons name="business" size={20} color={Colors.textPrimary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.paymentTitle}>{method.label}</Text>
                  <Text style={styles.paymentSub}>{method.details ?? 'Saved bank account'}</Text>
                </View>
                {method.isDefault ? (
                  <View style={styles.defaultBadge}>
                    <Text style={styles.defaultText}>Default</Text>
                  </View>
                ) : null}
              </View>
            ))
          ) : fallbackBank ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="business" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>{fallbackBank.label}</Text>
                <Text style={styles.paymentSub}>{fallbackBank.details ?? 'Saved bank account'}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="business-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>No linked bank accounts</Text>
                <Text style={styles.paymentSub}>Add one for withdrawals and payouts</Text>
              </View>
            </View>
          )}
          {allowBankAccounts ? (
            <AnimatedPressable style={styles.addBtn} onPress={() => navigation.navigate('AddBankAccount')}>
              <Ionicons name="add" size={20} color={Colors.textPrimary} />
              <Text style={styles.addText}>Add new bank account</Text>
            </AnimatedPressable>
          ) : null}
        </View>
      </ScrollView>

      <AddCardSheet
        visible={addCardSheetVisible}
        onDismiss={() => setAddCardSheetVisible(false)}
        onSuccess={() => {
          void syncPaymentMethods();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  policyLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textMuted, marginTop: 4, marginBottom: 8, marginLeft: 8 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 8, marginBottom: 12, marginTop: 24 },
  cardGroup: {
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  paymentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  paymentTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  paymentSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, paddingRight: 10 },
  
  defaultBadge: {
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  defaultText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  addBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  addText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
});
