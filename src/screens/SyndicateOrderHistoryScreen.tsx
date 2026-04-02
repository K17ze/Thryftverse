import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  FlatList,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { EmptyState } from '../components/EmptyState';
import { getOrderHistoryForAsset } from '../data/mockSyndicateData';
import { TradeOrder } from '../data/syndicateModels';

type NavT = StackNavigationProp<RootStackParamList>;

type SideFilter = 'all' | 'buy' | 'sell';
type DateFilter = 'all' | '24h' | '7d' | '30d';

interface HistoryEntry {
  id: string;
  assetId: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  quantity: number;
  pricePerShare: number;
  totalAmount: number;
  fee: number;
  status: 'pending' | 'filled' | 'partial' | 'cancelled';
  filledQuantity: number;
  createdAt: string;
  source: 'seeded' | 'ledger';
}

const SIDE_FILTERS: SideFilter[] = ['all', 'buy', 'sell'];
const DATE_FILTERS: DateFilter[] = ['all', '24h', '7d', '30d'];

function toHistoryEntry(order: TradeOrder): HistoryEntry {
  return {
    id: order.id,
    assetId: order.assetId,
    side: order.side,
    type: order.type,
    quantity: order.quantity,
    pricePerShare: order.pricePerShare,
    totalAmount: order.totalAmount,
    fee: order.fee,
    status: order.status,
    filledQuantity: order.filledQuantity,
    createdAt: order.createdAt,
    source: 'seeded',
  };
}

function getFilterWindowMs(dateFilter: DateFilter) {
  if (dateFilter === '24h') {
    return 24 * 60 * 60 * 1000;
  }

  if (dateFilter === '7d') {
    return 7 * 24 * 60 * 60 * 1000;
  }

  if (dateFilter === '30d') {
    return 30 * 24 * 60 * 60 * 1000;
  }

  return null;
}

function statusPillStyle(status: HistoryEntry['status']) {
  switch (status) {
    case 'filled':
      return {
        borderColor: '#2f4944',
        backgroundColor: '#152520',
        textColor: '#8de5dc',
      };
    case 'pending':
      return {
        borderColor: '#4a4330',
        backgroundColor: '#232014',
        textColor: '#ffd886',
      };
    case 'partial':
      return {
        borderColor: '#4a3f2f',
        backgroundColor: '#231f16',
        textColor: '#ffcf8a',
      };
    case 'cancelled':
    default:
      return {
        borderColor: '#4d2f2f',
        backgroundColor: '#241717',
        textColor: '#ff9d9d',
      };
  }
}

export default function SyndicateOrderHistoryScreen() {
  const navigation = useNavigation<NavT>();
  const marketLedger = useStore((state) => state.marketLedger);
  const { formatFromFiat } = useFormattedPrice();

  const [sideFilter, setSideFilter] = React.useState<SideFilter>('all');
  const [dateFilter, setDateFilter] = React.useState<DateFilter>('all');
  const [assetFilter, setAssetFilter] = React.useState<string>('all');

  const seededOrders = React.useMemo(() => getOrderHistoryForAsset().map(toHistoryEntry), []);

  const ledgerOrders = React.useMemo<HistoryEntry[]>(() => {
    return marketLedger
      .filter((entry) => entry.channel === 'syndicate')
      .map((entry) => {
        const quantity = Math.max(0, entry.units ?? 0);
        const totalAmount = Number(entry.amountGBP.toFixed(2));
        const pricePerShare = quantity > 0 ? Number((totalAmount / quantity).toFixed(4)) : 0;

        return {
          id: `ledger_${entry.id}`,
          assetId: entry.referenceId,
          side: entry.action === 'buy-units' ? 'buy' : 'sell',
          type: 'market',
          quantity,
          pricePerShare,
          totalAmount,
          fee: Number((totalAmount * 0.005).toFixed(2)),
          status: 'filled',
          filledQuantity: quantity,
          createdAt: entry.timestamp,
          source: 'ledger',
        };
      });
  }, [marketLedger]);

  const allEntries = React.useMemo(() => {
    return [...ledgerOrders, ...seededOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [ledgerOrders, seededOrders]);

  const assetOptions = React.useMemo(() => {
    const ids = Array.from(new Set(allEntries.map((entry) => entry.assetId)));
    return ['all', ...ids];
  }, [allEntries]);

  React.useEffect(() => {
    if (!assetOptions.includes(assetFilter)) {
      setAssetFilter('all');
    }
  }, [assetFilter, assetOptions]);

  const entries = React.useMemo(() => {
    const windowMs = getFilterWindowMs(dateFilter);
    const nowTs = Date.now();

    return allEntries.filter((entry) => {
      if (sideFilter !== 'all' && entry.side !== sideFilter) {
        return false;
      }

      if (assetFilter !== 'all' && entry.assetId !== assetFilter) {
        return false;
      }

      if (windowMs !== null) {
        const entryTs = new Date(entry.createdAt).getTime();
        if (!Number.isFinite(entryTs)) {
          return false;
        }

        if (nowTs - entryTs > windowMs) {
          return false;
        }
      }

      return true;
    });
  }, [allEntries, assetFilter, dateFilter, sideFilter]);

  const renderItem = ({ item }: { item: HistoryEntry }) => {
    const isBuy = item.side === 'buy';
    const ts = new Date(item.createdAt);
    const statusStyle = statusPillStyle(item.status);

    return (
      <AnimatedPressable
        style={styles.row}
        activeOpacity={0.92}
        onPress={() => navigation.navigate('AssetDetail', { assetId: item.assetId })}
      >
        <View style={[styles.iconCircle, isBuy ? styles.iconBuy : styles.iconSell]}>
          <Ionicons
            name={isBuy ? 'arrow-down-outline' : 'arrow-up-outline'}
            size={15}
            color={isBuy ? '#8de5dc' : '#ff9d9d'}
          />
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle}>{isBuy ? 'Buy' : 'Sell'} · {item.assetId.toUpperCase()}</Text>
            <View style={[styles.statusPill, { borderColor: statusStyle.borderColor, backgroundColor: statusStyle.backgroundColor }]}>
              <Text style={[styles.statusPillText, { color: statusStyle.textColor }]}>{item.status.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.rowMeta}>
            {item.quantity} units · {item.type.toUpperCase()} · {formatFromFiat(item.pricePerShare, 'GBP', { displayMode: 'fiat' })}/unit
          </Text>
          <Text style={styles.rowNote}>
            Filled {item.filledQuantity}/{item.quantity} · {ts.toLocaleDateString()} {ts.toLocaleTimeString()}
          </Text>
        </View>

        <Text style={[styles.rowAmount, isBuy ? styles.rowAmountBuy : styles.rowAmountSell]}>
          {isBuy ? '-' : '+'}{formatFromFiat(item.totalAmount, 'GBP', { displayMode: 'fiat' })}
        </Text>
      </AnimatedPressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Syndicate Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filterRow}>
        {SIDE_FILTERS.map((item) => {
          const active = sideFilter === item;
          return (
            <AnimatedPressable
              key={item}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setSideFilter(item)}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.toUpperCase()}</Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <View style={styles.filterRow}>
        {DATE_FILTERS.map((item) => {
          const active = dateFilter === item;
          return (
            <AnimatedPressable
              key={item}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setDateFilter(item)}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>{item.toUpperCase()}</Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.assetFilterRow}
      >
        {assetOptions.map((assetId) => {
          const active = assetFilter === assetId;
          return (
            <AnimatedPressable
              key={assetId}
              style={[styles.assetChip, active && styles.assetChipActive]}
              onPress={() => setAssetFilter(assetId)}
            >
              <Text style={[styles.assetChipText, active && styles.assetChipTextActive]}>
                {assetId === 'all' ? 'ALL ASSETS' : assetId.toUpperCase()}
              </Text>
            </AnimatedPressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="No syndicate orders"
            subtitle="Your buy and sell activity will appear here once you start trading."
            ctaLabel="Open Hub"
            onCtaPress={() => navigation.navigate('SyndicateHub')}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#272727',
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  filterRow: {
    paddingHorizontal: 16,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  assetFilterRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 10,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    backgroundColor: '#151515',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#17302b',
  },
  filterText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  filterTextActive: {
    color: '#8de5dc',
  },
  assetChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    backgroundColor: '#151515',
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  assetChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#17302b',
  },
  assetChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.45,
  },
  assetChipTextActive: {
    color: '#8de5dc',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBuy: {
    borderWidth: 1,
    borderColor: '#2f4944',
    backgroundColor: '#152520',
  },
  iconSell: {
    borderWidth: 1,
    borderColor: '#4d2f2f',
    backgroundColor: '#241717',
  },
  rowBody: {
    flex: 1,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  statusPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  rowMeta: {
    marginTop: 3,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  rowNote: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  rowAmount: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  rowAmountBuy: {
    color: '#ff9d9d',
  },
  rowAmountSell: {
    color: '#8de5dc',
  },
});
