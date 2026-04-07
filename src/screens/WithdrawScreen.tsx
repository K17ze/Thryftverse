import React, { useEffect, useMemo, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { CURRENCIES } from '../constants/currencies';
import { useToast } from '../context/ToastContext';
import { useStore } from '../store/useStore';
import { formatIzeAmount } from '../utils/currency';
import { parseApiError } from '../lib/apiClient';
import {
  burnIze,
  createPayoutAccount,
  createPayoutRequest,
  getIzeFxQuote,
  getIzeQuote,
  listPayoutAccounts,
  PayoutAccountPayload,
} from '../services/walletApi';
import {
  convertDisplayToGbpAmount,
  getDefaultWithdrawDisplayAmount,
  sanitizeDecimalInput,
} from '../utils/currencyAuthoringFlows';

export default function WithdrawScreen() {
  const navigation = useNavigation<any>();
  const [amount, setAmount] = useState('');
  const [availableBalance, setAvailableBalance] = useState(120.5);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [payoutAccount, setPayoutAccount] = useState<PayoutAccountPayload | null>(null);
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);
  const savedPaymentMethod = useStore((state) => state.savedPaymentMethod);
  const currencySymbol = CURRENCIES[currencyCode].symbol;

  useEffect(() => {
    const displayAmount = getDefaultWithdrawDisplayAmount(availableBalance, currencyCode, goldRates);
    setAmount(displayAmount.toFixed(2));
  }, [availableBalance, currencyCode, goldRates]);

  useEffect(() => {
    let isCancelled = false;

    const hydratePayoutAccount = async () => {
      if (!currentUser?.id) {
        setPayoutAccount(null);
        return;
      }

      try {
        const accounts = await listPayoutAccounts(currentUser.id);
        if (isCancelled) {
          return;
        }

        const activeAccount = accounts.find((account) => account.status === 'active') ?? accounts[0] ?? null;
        setPayoutAccount(activeAccount);
      } catch {
        if (!isCancelled) {
          setPayoutAccount(null);
        }
      }
    };

    void hydratePayoutAccount();

    return () => {
      isCancelled = true;
    };
  }, [currentUser?.id]);

  const numericAmountDisplay = Number(amount) || 0;
  const numericAmount = Number(convertDisplayToGbpAmount(numericAmountDisplay, currencyCode, goldRates).toFixed(2));
  const exceedsBalance = numericAmount > availableBalance;
  const canWithdraw = numericAmount > 0 && !exceedsBalance && !isWithdrawing;

  const bankCopy = useMemo(() => {
    if (savedPaymentMethod?.type === 'bank_account') {
      return {
        name: savedPaymentMethod.label,
        details: savedPaymentMethod.details ?? 'bank account',
      };
    }

    if (payoutAccount) {
      return {
        name: 'Connected payout profile',
        details: `${payoutAccount.gatewayId} · ${payoutAccount.currency}`,
      };
    }

    return {
      name: 'No bank account linked',
      details: 'Add a bank account to enable withdrawals',
    };
  }, [savedPaymentMethod, payoutAccount]);

  const ensurePayoutAccount = async (): Promise<PayoutAccountPayload> => {
    if (!currentUser?.id) {
      throw new Error('Please sign in to withdraw your balance.');
    }

    if (payoutAccount && payoutAccount.status === 'active') {
      return payoutAccount;
    }

    const existingAccounts = await listPayoutAccounts(currentUser.id);
    const activeAccount =
      existingAccounts.find((account) => account.status === 'active') ?? existingAccounts[0] ?? null;

    if (activeAccount) {
      setPayoutAccount(activeAccount);
      return activeAccount;
    }

    const createdAccount = await createPayoutAccount(currentUser.id, {
      currency: 'GBP',
      countryCode: 'GB',
      metadata: {
        source: 'withdraw_screen_auto_create',
        linkedPaymentMethodLabel: savedPaymentMethod?.label ?? null,
        linkedPaymentMethodDetails: savedPaymentMethod?.details ?? null,
      },
    });

    setPayoutAccount(createdAccount);
    return createdAccount;
  };

  const handleWithdraw = async () => {
    if (!canWithdraw) {
      return;
    }

    if (!currentUser?.id) {
      show('Please sign in to withdraw your balance.', 'error');
      navigation.navigate('AuthLanding');
      return;
    }

    setIsWithdrawing(true);
    try {
      const payoutProfile = await ensurePayoutAccount();
      const amountGbp = Number(numericAmount.toFixed(2));

      if (!Number.isFinite(amountGbp) || amountGbp <= 0) {
        throw new Error('Enter a valid withdrawal amount.');
      }

      const payoutCurrency = payoutProfile.currency.toUpperCase();
      let payoutAmount = amountGbp;

      if (payoutCurrency !== 'GBP') {
        const fxQuote = await getIzeFxQuote({
          fromCurrency: 'GBP',
          toCurrency: payoutCurrency,
          amount: amountGbp,
        });

        payoutAmount = Number(fxQuote.quote.convertedAmount.toFixed(2));
      }

      if (!Number.isFinite(payoutAmount) || payoutAmount <= 0) {
        throw new Error('Unable to resolve payout conversion right now.');
      }

      const burnQuote = await getIzeQuote({
        fiatCurrency: payoutCurrency,
        fiatAmount: payoutAmount,
      });

      const payoutRequestInput =
        payoutCurrency === 'GBP'
          ? {
              payoutAccountId: payoutProfile.id,
              amountGbp: burnQuote.quote.fiatAmount,
              amountCurrency: 'GBP',
              metadata: {
                source: 'withdraw_screen_request',
                enteredDisplayAmount: numericAmountDisplay,
                enteredDisplayCurrency: currencyCode,
              },
            }
          : {
              payoutAccountId: payoutProfile.id,
              amount: burnQuote.quote.fiatAmount,
              amountCurrency: payoutCurrency,
              metadata: {
                source: 'withdraw_screen_request',
                enteredDisplayAmount: numericAmountDisplay,
                enteredDisplayCurrency: currencyCode,
              },
            };

      const payoutRequest = await createPayoutRequest(currentUser.id, payoutRequestInput);

      const burnResult = await burnIze({
        userId: currentUser.id,
        izeAmount: burnQuote.quote.izeAmount,
        fiatCurrency: payoutCurrency,
        payoutRequestId: payoutRequest.payoutRequest.id,
        metadata: {
          source: 'withdraw_screen_burn',
          payoutRequestId: payoutRequest.payoutRequest.id,
          displayCurrency: currencyCode,
          enteredDisplayAmount: numericAmountDisplay,
        },
      });

      const nextBalance = Number(Math.max(0, availableBalance - amountGbp).toFixed(2));
      setAvailableBalance(nextBalance);
      setAmount(getDefaultWithdrawDisplayAmount(nextBalance, currencyCode, goldRates).toFixed(2));

      show(
        `Withdrawal queued: ${formatFromFiat(amountGbp, 'GBP', { displayMode: 'fiat' })} (${formatIzeAmount(
          burnResult.operation.izeAmount
        )} redeemed).`,
        'success'
      );
      navigation.goBack();
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to submit withdrawal right now.');
      show(parsed.message, 'error');
    } finally {
      setIsWithdrawing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Withdraw Balance</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          
          <View style={styles.amountWrap}>
            <Text style={styles.currencySymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(value) => setAmount(sanitizeDecimalInput(value))}
              keyboardType="decimal-pad"
              autoFocus
              selectionColor={Colors.accent}
            />
          </View>
          <Text style={styles.availableText}>Available: {formatFromFiat(availableBalance, 'GBP', { displayMode: 'fiat' })}</Text>
          {exceedsBalance ? <Text style={styles.balanceError}>Entered amount exceeds available balance.</Text> : null}

          <Text style={styles.sectionTitle}>Transfer to</Text>
          <AnimatedPressable
            style={styles.bankCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('AddBankAccount')}
          >
            <View style={styles.bankLeft}>
              <View style={styles.bankIcon}>
                <Ionicons name="business" size={24} color={Colors.textPrimary} />
              </View>
              <View>
                <Text style={styles.bankName}>{bankCopy.name}</Text>
                <Text style={styles.bankDetails}>{bankCopy.details}</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </AnimatedPressable>

          <AnimatedPressable style={styles.addBankBtn} onPress={() => navigation.navigate('AddBankAccount')}>
            <Ionicons name="add" size={18} color={Colors.accent} />
            <Text style={styles.addBankText}>Add a new bank account</Text>
          </AnimatedPressable>

        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.feeText}>Withdrawals take 3-5 working days. No fees apply.</Text>
          <AnimatedPressable 
            style={[styles.primaryBtn, !canWithdraw && styles.primaryBtnDisabled]} 
            activeOpacity={0.9} 
            disabled={!canWithdraw}
            onPress={handleWithdraw}
          >
            <Text style={styles.primaryText}>
              {isWithdrawing
                ? 'Processing...'
                : `Withdraw ${formatFromFiat(numericAmount, 'GBP', { displayMode: 'fiat' })}`}
            </Text>
          </AnimatedPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: 1, borderBottomColor: Colors.border },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  content: { flex: 1, paddingHorizontal: 20 },
  
  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 40, marginBottom: 12 },
  currencySymbol: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginRight: 8 },
  amountInput: { fontSize: 56, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, minWidth: 150 },
  availableText: { textAlign: 'center', fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 40 },
  balanceError: { textAlign: 'center', marginTop: -28, marginBottom: 24, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.danger },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  bankCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, padding: 16, borderRadius: 16, marginBottom: 12 },
  bankLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bankIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  bankName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  bankDetails: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },

  addBankBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addBankText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.accent },

  footer: { paddingVertical: 20, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.background },
  feeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, textAlign: 'center', marginBottom: 16 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
