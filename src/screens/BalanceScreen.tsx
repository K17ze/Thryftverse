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
import { mintIze } from '../services/walletApi';

type Props = StackScreenProps<RootStackParamList, 'Balance' | 'Wallet'>;
type TxFilter = 'all' | 'sale' | 'purchase' | 'withdrawal';

const TX_FILTERS: TxFilter[] = ['all', 'sale', 'purchase', 'withdrawal'];
const LOAD_IZE_FEE_RATE = 0.02;
const IS_LIGHT = ActiveTheme === 'light';
const TINT_CARD_BG = IS_LIGHT ? '#f1ede6' : '#1b1712';
const TINT_CARD_BORDER = IS_LIGHT ? '#d9d3c9' : '#3a342b';
const TINT_TEXT = IS_LIGHT ? '#2f251b' : '#e8dcc8';

export default function BalanceScreen({ navigation }: Props) {
  const [activeTxFilter, setActiveTxFilter] = useState<TxFilter>('all');
  const [loadFiatInput, setLoadFiatInput] = useState('');
  const [availableBalance, setAvailableBalance] = useState(120.5);
  const scrollRef = useRef<ScrollView>(null);
  const loadInputRef = useRef<TextInput>(null);

  const { currencyCode, goldRates } = useCurrencyContext();
  const { formatFromFiat, formatFromIze } = useFormattedPrice();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);

  const pendingBalance = 45;

  const availableIze = toIze(availableBalance, 'GBP', goldRates);
  const pendingIze = toIze(pendingBalance, 'GBP', goldRates);

  const loadFiatValue = Number(loadFiatInput || '0');
  const loadGrossIze = toIze(loadFiatValue, currencyCode, goldRates);
  const loadFeeIze = loadGrossIze * LOAD_IZE_FEE_RATE;
  const loadNetIze = Math.max(0, loadGrossIze - loadFeeIze);
  const loadFeeFiat = loadFiatValue * LOAD_IZE_FEE_RATE;

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

  const handleConvertPress = () => {
    scrollRef.current?.scrollTo({ y: 460, animated: true });
    setTimeout(() => loadInputRef.current?.focus(), 220);
    show('Enter an amount to convert into 1ze.', 'info');
  };

  const handleLoadIze = async () => {
    if (!Number.isFinite(loadFiatValue) || loadFiatValue <= 0) {
      show('Enter a valid amount to convert into 1ze.', 'error');
      return;
    }

    const loadAmountGbp = convertDisplayToGbpAmount(loadFiatValue, currencyCode, goldRates);
    if (!Number.isFinite(loadAmountGbp) || loadAmountGbp <= 0) {
      show('Unable to convert that amount right now.', 'error');
      return;
    }

    const netCreditGbp = Number((loadAmountGbp * (1 - LOAD_IZE_FEE_RATE)).toFixed(2));
    const actingUserId = currentUser?.id ?? 'u1';

    try {
      await mintIze({
        userId: actingUserId,
        fiatAmount: netCreditGbp,
        fiatCurrency: 'GBP',
        metadata: {
          source: 'balance_screen_load',
          displayCurrency: currencyCode,
          enteredDisplayAmount: loadFiatValue,
          uiFeeRate: LOAD_IZE_FEE_RATE,
        },
      });

      setAvailableBalance((prev) => Number((prev + netCreditGbp).toFixed(2)));
      setLoadFiatInput('');
      show(`Loaded ${formatIzeAmount(loadNetIze)} into your wallet.`, 'success');
    } catch {
      show('Unable to load 1ze right now. Please try again shortly.', 'error');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>1ze wallet</Text>
      </View>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.pegInfoCard}>
          <OnezeCoinIcon size={18} />
          <Text style={styles.pegInfoText}>
            1 1ze = 1 gram of gold. Live local value: {formatFromIze(1, { displayMode: 'fiat' })} per 1ze.
          </Text>
        </View>

        <View style={styles.heroGroup}>
          <View style={styles.balanceHero}>
            <Text style={styles.balanceAmount}>{formatFromFiat(availableBalance, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.balanceIze}>{formatIzeAmount(availableIze)}</Text>
            <Text style={styles.balanceLabel}>available balance</Text>

            <View style={styles.balanceActions}>
              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.85} onPress={() => navigation.navigate('Withdraw')}>
                <View style={styles.actionCircle}>
                  <Ionicons name="library-outline" size={22} color={Colors.textPrimary} />
                </View>
                <Text style={styles.actionText}>withdraw</Text>
              </AnimatedPressable>

              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.85} onPress={handleConvertPress}>
                <View style={styles.actionCircle}>
                  <Ionicons name="swap-horizontal-outline" size={22} color={Colors.textPrimary} />
                </View>
                <Text style={styles.actionText}>convert</Text>
              </AnimatedPressable>

              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.85} onPress={() => navigation.navigate('MainTabs')}>
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
          <Text style={styles.loadTitle}>Load 1ze Wallet</Text>
          <Text style={styles.loadHint}>Convert your local currency into 1ze with a 2% platform transaction fee.</Text>

          <Text style={styles.loadInputLabel}>Amount in {currencyCode}</Text>
          <TextInput
            ref={loadInputRef}
            style={styles.loadInput}
            value={loadFiatInput}
            onChangeText={(value) => setLoadFiatInput(value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1'))}
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
            keyboardType="decimal-pad"
          />

          <View style={styles.loadSummaryRow}>
            <Text style={styles.loadSummaryLabel}>Gross 1ze</Text>
            <Text style={styles.loadSummaryValue}>{formatIzeAmount(loadGrossIze)}</Text>
          </View>
          <View style={styles.loadSummaryRow}>
            <Text style={styles.loadSummaryLabel}>Platform fee (2%)</Text>
            <Text style={styles.loadSummaryValue}>{formatIzeAmount(loadFeeIze)} · {formatFromFiat(loadFeeFiat, currencyCode, { displayMode: 'fiat' })}</Text>
          </View>
          <View style={[styles.loadSummaryRow, styles.loadSummaryRowTotal]}>
            <Text style={styles.loadSummaryTotalLabel}>Net 1ze credited</Text>
            <Text style={styles.loadSummaryTotalValue}>{formatIzeAmount(loadNetIze)} · {formatFromIze(loadNetIze, { displayMode: 'fiat' })}</Text>
          </View>

          <AnimatedPressable style={styles.loadBtn} activeOpacity={0.9} onPress={handleLoadIze}>
            <Text style={styles.loadBtnText}>Load 1ze</Text>
          </AnimatedPressable>
        </View>

        <View style={styles.historyCard}>
          <View style={styles.historyRow}>
            <View>
              <Text style={styles.historyTitle}>Start balance</Text>
              <Text style={styles.historyDate}>Mar 1, 2026</Text>
            </View>
            <Text style={styles.historyTitle}>{formatFromFiat(0, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <AnimatedPressable style={styles.historyLinkRow} onPress={() => navigation.navigate('BalanceHistory')}>
            <Text style={styles.historyTitle}>History</Text>
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </AnimatedPressable>
        </View>

        <Text style={styles.sectionTitle}>Recent Transactions</Text>

        <View style={styles.filterRow}>
          {TX_FILTERS.map((filter) => {
            const active = activeTxFilter === filter;
            return (
              <AnimatedPressable
                key={filter}
                style={[styles.filterChip, active && styles.filterChipActive]}
                activeOpacity={0.9}
                onPress={() => setActiveTxFilter(filter)}
              >
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.toUpperCase()}</Text>
              </AnimatedPressable>
            );
          })}
        </View>

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
                      {tx.date} • <Text style={tx.status === 'pending' ? styles.txStatusPending : styles.txStatusCompleted}>{tx.status}</Text>
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
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
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

  heroGroup: { marginBottom: 22, gap: 12 },
  balanceHero: { backgroundColor: Colors.card, borderRadius: 28, borderWidth: 1, borderColor: Colors.border, paddingTop: 22, paddingBottom: 18, alignItems: 'center' },
  balanceLabel: { fontSize: 10, fontFamily: 'Inter_300Light', color: Colors.textMuted, letterSpacing: 0.92, marginBottom: 12, textTransform: 'uppercase' },
  balanceAmount: {
    fontSize: 96,
    lineHeight: 98,
    fontFamily: Typography.family.light,
    color: Colors.accentGold,
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
  actionCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },

  pendingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18 },
  pendingTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary },
  pendingAmount: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  pendingAmountCol: { alignItems: 'flex-end' },
  pendingIze: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginTop: 3 },

  loadCard: { backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18, marginBottom: 22 },
  loadTitle: { color: Colors.textPrimary, fontSize: 18, fontFamily: 'Inter_700Bold' },
  loadHint: { marginTop: 4, color: Colors.textSecondary, fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 12, lineHeight: 18 },
  loadInputLabel: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  loadInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardAlt,
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
    backgroundColor: Colors.accentGold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  loadBtnText: { color: Colors.textInverse, fontSize: 13, fontFamily: 'Inter_700Bold' },

  historyCard: { backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, padding: 18, marginBottom: 22 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12 },
  historyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  historyDate: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  historyLinkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 6, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 6 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.cardAlt, paddingHorizontal: 10, paddingVertical: 6 },
  filterChipActive: { borderColor: Colors.accentGold, backgroundColor: Colors.accentGold },
  filterChipText: { color: Colors.textSecondary, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  filterChipTextActive: { color: Colors.textInverse },

  cardGroup: { backgroundColor: Colors.card, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 16 },
  transactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  txLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 16 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.cardAlt, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  txTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4, lineHeight: 18 },
  txDate: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Inter_400Regular', textTransform: 'capitalize', lineHeight: 16 },
  txStatusPending: { color: Colors.accentGold },
  txStatusCompleted: { color: Colors.textSecondary },
  txAmount: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
});
