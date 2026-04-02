import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { Alert,
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { formatIzeAmount, toIze } from '../utils/currency';

type Props = StackScreenProps<RootStackParamList, 'Balance' | 'Wallet'>;
type TxFilter = 'all' | 'sale' | 'purchase' | 'withdrawal';

const TX_FILTERS: TxFilter[] = ['all', 'sale', 'purchase', 'withdrawal'];

export default function BalanceScreen({ navigation }: Props) {
  const [activeTxFilter, setActiveTxFilter] = useState<TxFilter>('all');
  const availableBalance = 120.5;
  const pendingBalance = 45;
  const { formatFromFiat } = useFormattedPrice();

  const availableIze = toIze(availableBalance, 'GBP');
  const pendingIze = toIze(pendingBalance, 'GBP');

  const transactions = [
    { id: '1', type: 'sale', amount: 45.00, title: 'Item sold: Y2K Hoodie', date: 'Today, 14:30', status: 'pending' },
    { id: '2', type: 'purchase', amount: 25.00, title: 'Bought: Vintage Tee', date: 'Yesterday, 09:12', status: 'completed' },
    { id: '3', type: 'withdrawal', amount: 100.00, title: 'Withdrawal to Monzo Bank', date: '12 Mar 2026', status: 'completed' },
    { id: '4', type: 'sale', amount: 35.00, title: 'Item sold: Carhartt Cargos', date: '10 Mar 2026', status: 'completed' }
  ];

  const filteredTransactions =
    activeTxFilter === 'all'
      ? transactions
      : transactions.filter((transaction) => transaction.type === activeTxFilter);

  const handleConvertPress = () => {
    Alert.alert(
      'Convert balance',
      'Conversion flow is in prototype mode. Rate preview and confirm steps will be connected to live wallet APIs later.'
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Wallet</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Restored Split Balance Logic */}
        <View style={styles.heroGroup}>
          <View style={styles.pendingCard}>
            <View style={styles.pendingLeft}>
              <View>
                <Text style={styles.pendingTitle}>Pending balance</Text>
              </View>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
              <View style={styles.pendingAmountCol}>
                <Text style={styles.pendingAmount}>{formatFromFiat(pendingBalance, 'GBP', { displayMode: 'fiat' })}</Text>
                <Text style={styles.pendingIze}>{formatIzeAmount(pendingIze)}</Text>
              </View>
              <Ionicons name="information-circle-outline" size={20} color={Colors.textSecondary} />
            </View>
          </View>

          <View style={styles.balanceHero}>
            <Text style={styles.balanceAmount}>{formatFromFiat(availableBalance, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.balanceIze}>{formatIzeAmount(availableIze)}</Text>
            <Text style={styles.balanceLabel}>Available balance</Text>

            <View style={styles.balanceActions}>
              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.8} onPress={() => navigation.navigate('Withdraw')}>
                <View style={styles.actionCircle}><Ionicons name="library-outline" size={24} color={Colors.textPrimary} /></View>
                <Text style={styles.actionText}>Withdraw</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.8} onPress={handleConvertPress}>
                <View style={styles.actionCircle}><Ionicons name="swap-horizontal-outline" size={24} color={Colors.textPrimary} /></View>
                <Text style={styles.actionText}>Convert</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.actionBtn} activeOpacity={0.8}>
                <View style={styles.actionCircle}><Ionicons name="cart-outline" size={24} color={Colors.textPrimary} /></View>
                <Text style={styles.actionText}>Shop</Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>

        {/* Start Balance History Row */}
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

        {/* Restored Detailed Transactions Mapping */}
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
                <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                  {filter.toUpperCase()}
                </Text>
              </AnimatedPressable>
            );
          })}
        </View>

        <View style={styles.cardGroup}>
          {filteredTransactions.map((tx, idx) => (
            <View key={tx.id} style={[styles.transactionRow, idx === 0 && { borderTopWidth: 0 }]}>
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
                  <Text style={styles.txDate}>{tx.date} • <Text style={{color: tx.status === 'pending' ? Colors.accent : Colors.textSecondary}}>{tx.status}</Text></Text>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  heroGroup: { marginBottom: 24, gap: 16 },
  balanceHero: { backgroundColor: '#111', borderRadius: 32, paddingVertical: 40, alignItems: 'center' },
  balanceLabel: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 32 },
  balanceAmount: { fontSize: 48, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -1 },
  balanceIze: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginTop: 6, marginBottom: 6 },
  balanceActions: { flexDirection: 'row', gap: 32, marginTop: 10 },
  actionBtn: { alignItems: 'center', gap: 8 },
  actionCircle: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },

  pendingCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 24, padding: 20 },
  pendingLeft: { flexDirection: 'row', alignItems: 'center' },
  pendingTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  pendingAmount: { fontSize: 20, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  pendingAmountCol: { alignItems: 'flex-end' },
  pendingIze: { fontSize: 11, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginTop: 2 },

  historyCard: { backgroundColor: '#111', borderRadius: 24, padding: 20, marginBottom: 32 },
  historyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, marginBottom: 12 },
  historyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  historyDate: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  historyLinkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 8, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 10, paddingHorizontal: 6 },
  filterChip: { borderRadius: 999, borderWidth: 1, borderColor: '#2f2f2f', backgroundColor: '#151515', paddingHorizontal: 10, paddingVertical: 6 },
  filterChipActive: { borderColor: '#4ECDC4', backgroundColor: '#17302b' },
  filterChipText: { color: Colors.textSecondary, fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.4 },
  filterChipTextActive: { color: '#8de5dc' },
  cardGroup: { backgroundColor: '#111', borderRadius: 24, paddingVertical: 12, paddingHorizontal: 16 },
  transactionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
  txLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, paddingRight: 16 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  txTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  txDate: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Inter_400Regular', textTransform: 'capitalize' },
  txAmount: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
});
