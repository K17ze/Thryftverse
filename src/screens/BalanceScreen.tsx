import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useCurrencyContext } from '../context/CurrencyContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useToast } from '../context/ToastContext';
import { formatIzeAmount, toIze } from '../utils/currency';
import { convertDisplayToGbpAmount } from '../utils/currencyAuthoringFlows';
import { OnezeCoinIcon } from '../components/icons/OnezeCoinIcon';
import { useStore } from '../store/useStore';
import { parseApiError } from '../lib/apiClient';
import { AppButton } from '../components/ui/AppButton';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';
import {
  confirmPaymentIntent,
  createPaymentIntent,
  getIzeQuote,
  mintIze,
  buyIze,
  convertIzeToFiat,
} from '../services/walletApi';

type Props = StackScreenProps<RootStackParamList, 'Balance' | 'Wallet'>;
type TxFilter = 'all' | 'sale' | 'purchase' | 'withdrawal';

const TX_FILTERS: TxFilter[] = ['all', 'sale', 'purchase', 'withdrawal'];
const LOAD_IZE_FEE_RATE = 0.01;
const CONVERT_FEE_RATE = 0.005; // 0.5% fee for converting 1ze to fiat
const IS_LIGHT = ActiveTheme === 'light';
const TINT_CARD_BG = IS_LIGHT ? '#f1ede6' : '#1b1712';
const TINT_CARD_BORDER = IS_LIGHT ? '#d9d3c9' : '#3a342b';
const TINT_TEXT = IS_LIGHT ? '#2f251b' : '#d7b98f';

export default function BalanceScreen({ navigation }: Props) {
  const [activeTxFilter, setActiveTxFilter] = useState<TxFilter>('all');
  const [loadFiatInput, setLoadFiatInput] = useState('');
  const [isLoadingIze, setIsLoadingIze] = useState(false);
  const [availableBalance, setAvailableBalance] = useState(120.5); // Fiat balance
  const [availableIzeBalance, setAvailableIzeBalance] = useState(50000); // 1ze balance in mg (50 1ze)
  const [convertTab, setConvertTab] = useState<'load' | 'buy' | 'convert'>('load');
  const [buyFiatInput, setBuyFiatInput] = useState('');
  const [convertIzeInput, setConvertIzeInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const loadInputRef = useRef<TextInput>(null);
  const buyInputRef = useRef<TextInput>(null);
  const convertInputRef = useRef<TextInput>(null);

  const { currencyCode, goldRates } = useCurrencyContext();
  const { formatFromFiat, formatFromIze } = useFormattedPrice();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);

  const pendingBalance = 45;

  const availableIze = availableIzeBalance / 1000; // Convert mg to 1ze units
  const pendingIze = toIze(pendingBalance, 'GBP', goldRates);

  const loadFiatValue = Number(loadFiatInput || '0');
  const loadGrossIze = toIze(loadFiatValue, currencyCode, goldRates);
  const loadFeeIze = loadGrossIze * LOAD_IZE_FEE_RATE;
  const loadNetIze = Math.max(0, loadGrossIze - loadFeeIze);
  const loadFeeFiat = loadFiatValue * LOAD_IZE_FEE_RATE;
  const canLoadIze = Number.isFinite(loadFiatValue) && loadFiatValue > 0 && !isLoadingIze;
  const loadFeeRateLabel = `${Math.round(LOAD_IZE_FEE_RATE * 100)}%`;

  // Buy 1ze with Fiat calculations
  const buyFiatValue = Number(buyFiatInput || '0');
  const buyIzeAmount = toIze(buyFiatValue, currencyCode, goldRates);
  const canBuyIze = Number.isFinite(buyFiatValue) && buyFiatValue > 0 && buyFiatValue <= availableBalance && !isProcessing;

  // Convert 1ze to Fiat calculations
  const convertIzeValue = Number(convertIzeInput || '0');
  const convertFiatValue = convertIzeValue * (1 / toIze(1, currencyCode, goldRates)); // Reverse calculation
  const convertFee = convertFiatValue * CONVERT_FEE_RATE;
  const convertNetFiat = Math.max(0, convertFiatValue - convertFee);
  const canConvertIze = Number.isFinite(convertIzeValue) && convertIzeValue > 0 && convertIzeValue <= availableIze && !isProcessing;

  const transactions = [
    { id: '1', type: 'sale', amount: 45.0, title: 'Item sold: Y2K Hoodie', date: 'Today, 14:30', status: 'pending' },
    { id: '2', type: 'purchase', amount: 25.0, title: 'Bought: Vintage Tee', date: 'Yesterday, 09:12', status: 'completed' },
    { id: '3', type: 'withdrawal', amount: 100.0, title: 'Withdrawal to Monzo Bank', date: '12 Mar 2026', status: 'completed' },
    { id: '4', type: 'sale', amount: 35.0, title: 'Item sold: Carhartt Cargos', date: '10 Mar 2026', status: 'completed' },
  ] as const;

  const filteredTransactions = useMemo(
    () => (activeTxFilter === 'all' ? transactions : transactions.filter((tx) => tx.type === activeTxFilter)),
    [activeTxFilter]
  );
  const txFilterOptions = useMemo(
    () =>
      TX_FILTERS.map((filter) => ({
        value: filter,
        label: filter.toUpperCase(),
        accessibilityLabel: filter === 'all' ? 'Show all transactions' : `Show ${filter} transactions`,
      })),
    []
  );

  const handleConvertPress = () => {
    scrollRef.current?.scrollTo({ y: 460, animated: true });
    setTimeout(() => loadInputRef.current?.focus(), 220);
    show('Enter an amount to convert into 1ze.', 'info');
  };

  const handleLoadIze = async () => {
    if (!canLoadIze) {
      show('Enter a valid amount to convert into 1ze.', 'error');
      return;
    }

    if (!currentUser?.id) {
      show('Please sign in to load 1ze.', 'error');
      navigation.navigate('AuthLanding');
      return;
    }

    const loadAmountGbpRaw = convertDisplayToGbpAmount(loadFiatValue, currencyCode, goldRates);
    const loadAmountGbp = Number(loadAmountGbpRaw.toFixed(2));
    if (!Number.isFinite(loadAmountGbp) || loadAmountGbp <= 0) {
      show('Unable to convert that amount right now.', 'error');
      return;
    }

    setIsLoadingIze(true);
    try {
      const quote = await getIzeQuote({
        fiatCurrency: 'GBP',
        fiatAmount: loadAmountGbp,
      });
      const quoteFeeRate = quote.quote.platformFeeRate ?? LOAD_IZE_FEE_RATE;
      const quoteFeeAmount =
        quote.quote.platformFeeAmount ?? Number((quote.quote.fiatAmount * quoteFeeRate).toFixed(2));
      const quoteNetFiatAmount =
        quote.quote.netFiatAmount ?? Number((quote.quote.fiatAmount - quoteFeeAmount).toFixed(2));

      const intentResponse = await createPaymentIntent({
        userId: currentUser.id,
        channel: 'wallet_topup',
        amountGbp: quote.quote.fiatAmount,
        amountCurrency: 'GBP',
        idempotencyKey: `wallet_topup_${currentUser.id}_${Date.now()}`,
        metadata: {
          source: 'balance_screen_topup_intent',
          displayCurrency: currencyCode,
          enteredDisplayAmount: loadFiatValue,
          enteredGbpAmount: loadAmountGbp,
          platformFeeRate: quoteFeeRate,
          platformFeeAmount: quoteFeeAmount,
          netCreditedAmountGbp: quoteNetFiatAmount,
        },
      });

      let settledIntent = intentResponse.intent;
      if (settledIntent.status !== 'succeeded') {
        const confirmation = await confirmPaymentIntent(settledIntent.id, {
          simulateStatus: 'succeeded',
          payload: {
            source: 'balance_screen_manual_confirm',
          },
        });

        settledIntent = confirmation.intent;
      }

      if (settledIntent.status !== 'succeeded') {
        throw new Error('Payment intent could not be settled. Please try again.');
      }

      const mintResult = await mintIze({
        userId: currentUser.id,
        fiatAmount: quote.quote.fiatAmount,
        fiatCurrency: 'GBP',
        paymentIntentId: settledIntent.id,
        metadata: {
          source: 'balance_screen_load',
          displayCurrency: currencyCode,
          enteredDisplayAmount: loadFiatValue,
          enteredGbpAmount: loadAmountGbp,
          platformFeeRate: quoteFeeRate,
          platformFeeAmount: quoteFeeAmount,
          netCreditedAmountGbp: quoteNetFiatAmount,
          paymentIntentId: settledIntent.id,
        },
      });

      const netCreditedFiatGbp = mintResult.operation.netFiatAmount ?? mintResult.operation.fiatAmount;
      setAvailableBalance((prev) =>
        Number((prev + Number(netCreditedFiatGbp.toFixed(2))).toFixed(2))
      );
      setLoadFiatInput('');
      show(`Loaded ${formatIzeAmount(mintResult.operation.izeAmount)} into your wallet.`, 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to load 1ze right now. Please try again shortly.');
      show(parsed.message, 'error');
    } finally {
      setIsLoadingIze(false);
    }
  };

  const handleBuyIze = async () => {
    if (!canBuyIze || !currentUser?.id) {
      show('Enter a valid amount within your fiat balance.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await buyIze({
        userId: currentUser.id,
        fiatAmount: buyFiatValue,
        fiatCurrency: currencyCode,
      });

      // Update balances
      setAvailableBalance(result.wallet.fiatBalance);
      setAvailableIzeBalance(result.wallet.onezeBalanceMg);
      setBuyFiatInput('');
      show(`Bought ${formatIzeAmount(result.purchase.izeAmount)} with ${formatFromFiat(result.purchase.fiatAmount, currencyCode, { displayMode: 'fiat' })}`, 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to buy 1ze right now.');
      show(parsed.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConvertIzeToFiat = async () => {
    if (!canConvertIze || !currentUser?.id) {
      show('Enter a valid amount within your 1ze balance.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await convertIzeToFiat({
        userId: currentUser.id,
        izeAmount: convertIzeValue,
        fiatCurrency: currencyCode,
      });

      // Update balances
      setAvailableBalance(result.wallet.fiatBalance);
      setAvailableIzeBalance(result.wallet.onezeBalanceMg);
      setConvertIzeInput('');
      show(`Converted ${formatIzeAmount(result.conversion.izeAmount)} to ${formatFromFiat(result.conversion.fiatAmount, currencyCode, { displayMode: 'fiat' })}`, 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to convert 1ze right now.');
      show(parsed.message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen."
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>1ze wallet</Text>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.pegInfoCard}>
          <OnezeCoinIcon size={18} />
          <Text style={styles.pegInfoText}>
            1ze is a closed-loop settlement credit. Live local reference value: {formatFromIze(1, { displayMode: 'fiat' })} per 1ze.
          </Text>
        </View>

        <View style={styles.heroGroup}>
          <View style={styles.balanceHero}>
            <Text style={styles.balanceAmount}>{formatFromFiat(availableBalance, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.balanceIze}>{formatIzeAmount(availableIze)}</Text>
            <Text style={styles.balanceLabel}>available balance</Text>

            <View style={styles.balanceActions}>
              <AnimatedPressable
                style={styles.actionBtn}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Withdraw')}
                accessibilityLabel="Withdraw funds"
                accessibilityHint="Opens withdrawal options for your wallet balance."
              >
                <View style={styles.actionCircle}>
                  <Ionicons name="library-outline" size={22} color={Colors.textPrimary} />
                </View>
                <Text style={styles.actionText}>withdraw</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={styles.actionBtn}
                activeOpacity={0.85}
                onPress={handleConvertPress}
                accessibilityLabel="Convert local currency to 1ze"
                accessibilityHint="Focuses the load input to start conversion."
              >
                <View style={styles.actionCircle}>
                  <Ionicons name="swap-horizontal-outline" size={22} color={Colors.textPrimary} />
                </View>
                <Text style={styles.actionText}>convert</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={styles.actionBtn}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('MainTabs')}
                accessibilityLabel="Go to marketplace"
                accessibilityHint="Navigates to main shopping tabs."
              >
                <View style={styles.actionCircle}>
                  <Ionicons name="cart-outline" size={22} color={Colors.textPrimary} />
                </View>
                <Text style={styles.actionText}>shop</Text>
              </AnimatedPressable>
            </View>
          </View>

          <View style={styles.pendingCard}>
            <View>
              <Text style={styles.pendingTitle}>pending balance</Text>
            </View>
            <View style={styles.pendingAmountCol}>
              <Text style={styles.pendingAmount}>{formatFromFiat(pendingBalance, 'GBP', { displayMode: 'fiat' })}</Text>
              <Text style={styles.pendingIze}>{formatIzeAmount(pendingIze)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.loadCard}>
          {/* Tab Navigation */}
          <View style={styles.tabContainer}>
            <AnimatedPressable
              style={[styles.tab, convertTab === 'load' && styles.tabActive]}
              onPress={() => setConvertTab('load')}
            >
              <Text style={[styles.tabText, convertTab === 'load' && styles.tabTextActive]}>Load</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.tab, convertTab === 'buy' && styles.tabActive]}
              onPress={() => setConvertTab('buy')}
            >
              <Text style={[styles.tabText, convertTab === 'buy' && styles.tabTextActive]}>Buy</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.tab, convertTab === 'convert' && styles.tabActive]}
              onPress={() => setConvertTab('convert')}
            >
              <Text style={[styles.tabText, convertTab === 'convert' && styles.tabTextActive]}>Convert</Text>
            </AnimatedPressable>
          </View>

          {/* Load Tab - External Payment */}
          {convertTab === 'load' && (
            <>
              <Text style={styles.loadHint}>Convert your local currency into 1ze with a low {loadFeeRateLabel} platform spread.</Text>
              <Text style={styles.loadInputLabel}>Amount in {currencyCode}</Text>
              <TextInput
                ref={loadInputRef}
                style={styles.loadInput}
                value={loadFiatInput}
                onChangeText={(value) => setLoadFiatInput(value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel={`Amount in ${currencyCode}`}
                accessibilityHint="Enter the amount you want to convert into 1ze credits."
              />
              <View style={styles.loadSummaryRow}>
                <Text style={styles.loadSummaryLabel}>Gross 1ze</Text>
                <Text style={styles.loadSummaryValue}>{formatIzeAmount(loadGrossIze)}</Text>
              </View>
              <View style={styles.loadSummaryRow}>
                <Text style={styles.loadSummaryLabel}>Platform fee ({loadFeeRateLabel})</Text>
                <Text style={styles.loadSummaryValue}>{formatIzeAmount(loadFeeIze)} | {formatFromFiat(loadFeeFiat, currencyCode, { displayMode: 'fiat' })}</Text>
              </View>
              <View style={[styles.loadSummaryRow, styles.loadSummaryRowTotal]}>
                <Text style={styles.loadSummaryTotalLabel}>Net 1ze credited</Text>
                <Text style={styles.loadSummaryTotalValue}>{formatIzeAmount(loadNetIze)} | {formatFromIze(loadNetIze, { displayMode: 'fiat' })}</Text>
              </View>
              <AppButton
                title={isLoadingIze ? 'Loading...' : 'Load 1ze'}
                style={[styles.loadBtn, !canLoadIze && styles.loadBtnDisabled]}
                titleStyle={styles.loadBtnText}
                variant="primary"
                size="sm"
                onPress={handleLoadIze}
                disabled={!canLoadIze}
                accessibilityLabel="Load 1ze"
                accessibilityHint="Converts the entered amount into 1ze and credits your wallet."
              />
            </>
          )}

          {/* Buy Tab - Use Fiat Balance */}
          {convertTab === 'buy' && (
            <>
              <Text style={styles.loadHint}>Buy 1ze using your fiat balance. Available: {formatFromFiat(availableBalance, currencyCode, { displayMode: 'fiat' })}</Text>
              <Text style={styles.loadInputLabel}>Amount in {currencyCode}</Text>
              <TextInput
                ref={buyInputRef}
                style={styles.loadInput}
                value={buyFiatInput}
                onChangeText={(value) => setBuyFiatInput(value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel={`Amount in ${currencyCode}`}
                accessibilityHint="Enter the fiat amount to buy 1ze."
              />
              <View style={styles.loadSummaryRow}>
                <Text style={styles.loadSummaryLabel}>You will receive</Text>
                <Text style={styles.loadSummaryValue}>{formatIzeAmount(buyIzeAmount)}</Text>
              </View>
              <View style={[styles.loadSummaryRow, styles.loadSummaryRowTotal]}>
                <Text style={styles.loadSummaryTotalLabel}>Rate</Text>
                <Text style={styles.loadSummaryTotalValue}>1 1ze = {formatFromIze(1, { displayMode: 'fiat' })}</Text>
              </View>
              <AppButton
                title={isProcessing ? 'Processing...' : 'Buy 1ze'}
                style={[styles.loadBtn, !canBuyIze && styles.loadBtnDisabled]}
                titleStyle={styles.loadBtnText}
                variant="primary"
                size="sm"
                onPress={handleBuyIze}
                disabled={!canBuyIze}
                accessibilityLabel="Buy 1ze"
                accessibilityHint="Buys 1ze using your fiat balance."
              />
            </>
          )}

          {/* Convert Tab - 1ze to Fiat */}
          {convertTab === 'convert' && (
            <>
              <Text style={styles.loadHint}>Convert your 1ze to fiat for withdrawal. Available: {formatIzeAmount(availableIze)}</Text>
              <Text style={styles.loadInputLabel}>Amount in 1ze</Text>
              <TextInput
                ref={convertInputRef}
                style={styles.loadInput}
                value={convertIzeInput}
                onChangeText={(value) => setConvertIzeInput(value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Amount in 1ze"
                accessibilityHint="Enter the 1ze amount to convert to fiat."
              />
              <View style={styles.loadSummaryRow}>
                <Text style={styles.loadSummaryLabel}>Gross {currencyCode}</Text>
                <Text style={styles.loadSummaryValue}>{formatFromFiat(convertFiatValue, currencyCode, { displayMode: 'fiat' })}</Text>
              </View>
              <View style={styles.loadSummaryRow}>
                <Text style={styles.loadSummaryLabel}>Platform fee ({Math.round(CONVERT_FEE_RATE * 100)}%)</Text>
                <Text style={styles.loadSummaryValue}>{formatFromFiat(convertFee, currencyCode, { displayMode: 'fiat' })}</Text>
              </View>
              <View style={[styles.loadSummaryRow, styles.loadSummaryRowTotal]}>
                <Text style={styles.loadSummaryTotalLabel}>Net fiat credited</Text>
                <Text style={styles.loadSummaryTotalValue}>{formatFromFiat(convertNetFiat, currencyCode, { displayMode: 'fiat' })}</Text>
              </View>
              <AppButton
                title={isProcessing ? 'Processing...' : 'Convert to Fiat'}
                style={[styles.loadBtn, !canConvertIze && styles.loadBtnDisabled]}
                titleStyle={styles.loadBtnText}
                variant="primary"
                size="sm"
                onPress={handleConvertIzeToFiat}
                disabled={!canConvertIze}
                accessibilityLabel="Convert 1ze to fiat"
                accessibilityHint="Converts 1ze to fiat and credits your wallet."
              />
            </>
          )}
        </View>

        <View style={styles.historyCard}>
          <View style={styles.historyRow}>
            <View>
              <Text style={styles.historyTitle}>Start balance</Text>
              <Text style={styles.historyDate}>Mar 1, 2026</Text>
            </View>
            <Text style={styles.historyTitle}>{formatFromFiat(0, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <AppButton
            title="History"
            trailingIcon={<Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />}
            style={styles.historyLinkRow}
            titleStyle={styles.historyTitle}
            trailingIconContainerStyle={styles.historyChevronWrap}
            variant="secondary"
            size="sm"
            align="start"
            onPress={() => navigation.navigate('BalanceHistory')}
            accessibilityLabel="Open balance history"
            accessibilityHint="Shows all wallet transactions and balance activity."
          />
        </View>

        <Text style={styles.sectionTitle}>Recent Transactions</Text>

        <AppSegmentControl
          style={styles.filterRow}
          options={txFilterOptions}
          value={activeTxFilter}
          onChange={setActiveTxFilter}
          optionStyle={styles.filterChip}
          optionActiveStyle={styles.filterChipActive}
          optionTextStyle={styles.filterChipText}
          optionTextActiveStyle={styles.filterChipTextActive}
        />

        <View style={styles.cardGroup}>
          {filteredTransactions.map((tx) => (
            <View key={tx.id} style={styles.transactionRow}>
              <View style={styles.txLeft}>
                <View style={styles.iconCircle}>
                  <Ionicons
                    name={tx.type === 'sale' ? 'arrow-up' : tx.type === 'purchase' ? 'arrow-down' : 'log-out'}
                    size={18}
                    color={tx.type === 'sale' ? Colors.success : tx.type === 'purchase' ? Colors.danger : Colors.textPrimary}
                  />
                </View>
                <View>
                  <Text style={styles.txTitle}>{tx.title}</Text>
                  <Text style={styles.txDate}>
                      {tx.date} | <Text style={tx.status === 'pending' ? styles.txStatusPending : styles.txStatusCompleted}>{tx.status}</Text>
                  </Text>
                </View>
              </View>
              <Text style={[styles.txAmount, { color: tx.type === 'sale' ? Colors.success : Colors.textPrimary }]}>
                {tx.type === 'sale' ? '+' : '-'}{formatFromFiat(tx.amount, 'GBP', { displayMode: 'fiat' })}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  hugeTitle: {
    fontSize: 32,
    lineHeight: 36,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.42,
  },
  content: { paddingHorizontal: 20, paddingBottom: 34 },

  pegInfoCard: {
    marginBottom: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: TINT_CARD_BORDER,
    backgroundColor: TINT_CARD_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pegInfoText: {
    flex: 1,
    color: TINT_TEXT,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Inter_600SemiBold',
  },

  supportRow: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  supportIdentity: {
    flex: 1,
    minHeight: 40,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  supportAvatarWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  supportAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  supportCopyWrap: {
    flex: 1,
  },
  supportTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  supportHandle: {
    marginTop: 1,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  supportMessageBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  heroGroup: { marginBottom: 22, gap: 12 },
  balanceHero: { backgroundColor: Colors.surface, borderRadius: 28, borderWidth: 1, borderColor: Colors.border, paddingTop: 22, paddingBottom: 18, alignItems: 'center' },
  balanceLabel: { fontSize: 10, fontFamily: 'Inter_300Light', color: Colors.textMuted, letterSpacing: 0.92, marginBottom: 12, textTransform: 'uppercase' },
  balanceAmount: {
    fontSize: 96,
    lineHeight: 98,
    fontFamily: Typography.family.light,
    color: Colors.brand,
    letterSpacing: -3.4,
    fontVariant: ['tabular-nums'],
  },
  balanceIze: {
    fontSize: 12,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
    marginTop: 6,
    marginBottom: 8,
    fontVariant: ['tabular-nums'],
  },
  balanceActions: { flexDirection: 'row', gap: 14, marginTop: 4 },
  actionBtn: { alignItems: 'center', gap: 8 },
  actionCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },

  pendingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18 },
  pendingTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary },
  pendingAmount: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  pendingAmountCol: { alignItems: 'flex-end' },
  pendingIze: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginTop: 3 },

  loadCard: { backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18, marginBottom: 22 },
  loadTitle: { color: Colors.textPrimary, fontSize: 18, fontFamily: 'Inter_700Bold' },
  loadHint: { marginTop: 4, color: Colors.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 12, lineHeight: 18 },
  loadInputLabel: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  loadInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  loadSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: 10 },
  loadSummaryLabel: { color: Colors.textMuted, fontSize: 13, fontFamily: 'Inter_500Medium' },
  loadSummaryValue: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right', maxWidth: '70%' },
  loadSummaryRowTotal: { marginTop: 4, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: 9 },
  loadSummaryTotalLabel: { color: Colors.textPrimary, fontSize: 14, fontFamily: 'Inter_700Bold' },
  loadSummaryTotalValue: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right', maxWidth: '70%' },
  loadBtn: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: Colors.brand,
    minHeight: 44,
    borderWidth: 0,
  },
  loadBtnDisabled: { opacity: 0.55 },
  loadBtnText: { color: Colors.background, fontSize: 13, fontFamily: 'Inter_700Bold' },

  // Tab styles
  tabContainer: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: Colors.brand,
  },
  tabText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textSecondary,
  },
  tabTextActive: {
    color: Colors.background,
  },

  historyCard: { backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18, marginBottom: 22 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12 },
  historyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  historyDate: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  historyLinkRow: {
    borderRadius: 14,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
    minHeight: 36,
  },
  historyChevronWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 6, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 6 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, paddingHorizontal: 10, paddingVertical: 6 },
  filterChipActive: { borderColor: Colors.brand, backgroundColor: Colors.brand },
  filterChipText: { color: Colors.textSecondary, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  filterChipTextActive: { color: Colors.background },

  cardGroup: { backgroundColor: Colors.surface, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 16 },
  transactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  txLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 16 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  txTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4, lineHeight: 18 },
  txDate: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Inter_400Regular', textTransform: 'capitalize', lineHeight: 16 },
  txStatusPending: { color: Colors.brand },
  txStatusCompleted: { color: Colors.textSecondary },
  txAmount: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
});

