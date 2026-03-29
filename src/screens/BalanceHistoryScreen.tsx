import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'BalanceHistory'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

type TxType = 'sale' | 'withdrawal' | 'refund' | 'purchase';

interface Transaction {
  id: string;
  type: TxType;
  label: string;
  amount: number;
  date: string;
}

const TRANSACTIONS: { month: string; items: Transaction[] }[] = [
  {
    month: 'March 2026',
    items: [
      { id: 't1', type: 'sale', label: 'Sale: Vintage Levi Jacket', amount: 45.0, date: '19 Mar' },
      { id: 't2', type: 'withdrawal', label: 'Withdrawal to bank', amount: -45.0, date: '21 Mar' },
    ],
  },
  {
    month: 'February 2026',
    items: [
      { id: 't3', type: 'sale', label: 'Sale: Nike Air Max 95', amount: 80.0, date: '14 Feb' },
      { id: 't4', type: 'purchase', label: 'Purchase: AMI Striped Shirt', amount: -35.0, date: '10 Feb' },
      { id: 't5', type: 'refund', label: 'Refund: Cancelled order', amount: 35.0, date: '8 Feb' },
    ],
  },
  {
    month: 'January 2026',
    items: [
      { id: 't6', type: 'sale', label: 'Sale: Ralph Lauren Oxford', amount: 28.0, date: '22 Jan' },
      { id: 't7', type: 'sale', label: 'Sale: Stussy T-Shirt', amount: 18.0, date: '5 Jan' },
    ],
  },
];

const iconForType = (type: TxType) => {
  switch (type) {
    case 'sale': return 'trending-up';
    case 'withdrawal': return 'arrow-up-circle-outline';
    case 'refund': return 'refresh-outline';
    case 'purchase': return 'bag-handle-outline';
  }
};

const colorForType = (type: TxType) => {
  switch (type) {
    case 'sale': return '#4ECDC4';
    case 'withdrawal': return '#FF6B6B';
    case 'refund': return '#FFE66D';
    case 'purchase': return '#888888';
  }
};

export default function BalanceHistoryScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>History</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {TRANSACTIONS.map(group => (
          <View key={group.month} style={styles.group}>
            <Text style={styles.monthLabel}>{group.month}</Text>
            <View style={styles.card}>
              {group.items.map((tx, idx) => (
                <View key={tx.id}>
                  <View style={styles.txRow}>
                    <View style={[styles.txIcon, { backgroundColor: colorForType(tx.type) + '22' }]}>
                      <Ionicons name={iconForType(tx.type) as any} size={18} color={colorForType(tx.type)} />
                    </View>
                    <View style={styles.txInfo}>
                      <Text style={styles.txLabel}>{tx.label}</Text>
                      <Text style={styles.txDate}>{tx.date}</Text>
                    </View>
                    <Text style={[
                      styles.txAmount,
                      { color: tx.amount > 0 ? TEAL : '#FF6B6B' }
                    ]}>
                      {tx.amount > 0 ? '+' : ''}£{Math.abs(tx.amount).toFixed(2)}
                    </Text>
                  </View>
                  {idx < group.items.length - 1 && <View style={styles.divider} />}
                </View>
              ))}
            </View>
          </View>
        ))}

        <Text style={styles.footerNote}>Showing all transactions from the last 3 months.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20 },
  group: { marginBottom: 24 },
  monthLabel: { fontSize: 13, fontWeight: '700', color: MUTED, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.8 },
  card: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden' },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  txIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  txInfo: { flex: 1 },
  txLabel: { fontSize: 14, fontWeight: '500', color: TEXT, marginBottom: 2 },
  txDate: { fontSize: 12, color: MUTED },
  txAmount: { fontSize: 15, fontWeight: '700' },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 18 },
  footerNote: { fontSize: 12, color: MUTED, textAlign: 'center', marginTop: 8 },
});
