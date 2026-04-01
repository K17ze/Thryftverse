import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { formatMoney } from '../data/tradeHub';

type NavT = StackNavigationProp<RootStackParamList>;
type LedgerFilter = 'ALL' | 'AUCTION' | 'SYNDICATE';

function getEntryCashflow(entry: {
  action: 'bid' | 'win' | 'buy-units' | 'sell-units';
  amountGBP: number;
}) {
  if (entry.action === 'sell-units') {
    return entry.amountGBP;
  }

  if (entry.action === 'buy-units' || entry.action === 'win') {
    return -entry.amountGBP;
  }

  return 0;
}

function formatSignedMoney(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}

function relativeTime(isoTs: string) {
  const diffMs = Date.now() - new Date(isoTs).getTime();
  const mins = Math.max(1, Math.floor(diffMs / (60 * 1000)));
  if (mins < 60) {
    return `${mins}m ago`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function MarketLedgerScreen() {
  const navigation = useNavigation<NavT>();
  const entries = useStore((state) => state.marketLedger);

  const [filter, setFilter] = React.useState<LedgerFilter>('ALL');

  const filteredEntries = React.useMemo(() => {
    if (filter === 'ALL') {
      return entries;
    }

    const channel = filter === 'AUCTION' ? 'auction' : 'syndicate';
    return entries.filter((entry) => entry.channel === channel);
  }, [entries, filter]);

  const totalVolume = React.useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + entry.amountGBP, 0),
    [filteredEntries]
  );

  const realizedSyndicatePL = React.useMemo(() => {
    const sell = filteredEntries
      .filter((entry) => entry.action === 'sell-units')
      .reduce((sum, entry) => sum + entry.amountGBP, 0);
    const buy = filteredEntries
      .filter((entry) => entry.action === 'buy-units')
      .reduce((sum, entry) => sum + entry.amountGBP, 0);
    return sell - buy;
  }, [filteredEntries]);

  const netCashflow = React.useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + getEntryCashflow(entry), 0),
    [filteredEntries]
  );

  const renderLedgerRow = ({ item }: { item: (typeof filteredEntries)[number] }) => {
    const isAuction = item.channel === 'auction';
    const iconName =
      item.action === 'bid'
        ? 'hammer-outline'
        : item.action === 'win'
          ? 'trophy-outline'
          : item.action === 'sell-units'
            ? 'cash-outline'
            : 'wallet-outline';

    const signedCashflow = getEntryCashflow(item);
    const amountText = item.action === 'bid'
      ? formatMoney(item.amountGBP)
      : formatSignedMoney(signedCashflow);

    return (
      <View style={styles.rowCard}>
        <View style={styles.rowIconWrap}>
          <Ionicons name={iconName} size={16} color={isAuction ? '#8de5dc' : '#a9c9ff'} />
        </View>

        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>
            {item.action === 'bid'
              ? 'Bid Submitted'
              : item.action === 'win'
                ? 'Auction Settlement'
                : item.action === 'sell-units'
                  ? 'Units Sold'
                  : 'Units Purchased'}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>{item.referenceId} · {relativeTime(item.timestamp)}</Text>
          {item.note ? <Text style={styles.rowNote} numberOfLines={1}>{item.note}</Text> : null}
        </View>

        <View style={styles.rowAmountWrap}>
          <Text style={[
            styles.rowAmount,
            item.action !== 'bid' && signedCashflow < 0 && styles.rowAmountNegative,
            item.action !== 'bid' && signedCashflow > 0 && styles.rowAmountPositive,
          ]}>{amountText}</Text>
          {typeof item.units === 'number' ? <Text style={styles.rowUnits}>{item.units} units</Text> : null}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>

        <View>
          <Text style={styles.headerLabel}>MARKET LEDGER</Text>
          <Text style={styles.headerTitle}>Trade History</Text>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.headerRightText}>{filteredEntries.length}</Text>
        </View>
      </View>

      <View style={styles.metricsCard}>
        <Text style={styles.metricsTitle}>Tracked Volume</Text>
        <Text style={styles.metricsValue}>{formatMoney(totalVolume)}</Text>

        <View style={styles.metricsSubRow}>
          <View style={styles.metricsSubCol}>
            <Text style={styles.metricsSubLabel}>Realized P/L</Text>
            <Text style={[
              styles.metricsSubValue,
              realizedSyndicatePL >= 0 ? styles.rowAmountPositive : styles.rowAmountNegative,
            ]}>{formatSignedMoney(realizedSyndicatePL)}</Text>
          </View>

          <View style={styles.metricsSubCol}>
            <Text style={styles.metricsSubLabel}>Net Cashflow</Text>
            <Text style={[
              styles.metricsSubValue,
              netCashflow >= 0 ? styles.rowAmountPositive : styles.rowAmountNegative,
            ]}>{formatSignedMoney(netCashflow)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.filtersRow}>
        {(['ALL', 'AUCTION', 'SYNDICATE'] as const).map((nextFilter) => {
          const active = filter === nextFilter;
          return (
            <TouchableOpacity
              key={nextFilter}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(nextFilter)}
              activeOpacity={0.9}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{nextFilter}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <FlatList
        data={filteredEntries}
        keyExtractor={(item) => item.id}
        renderItem={renderLedgerRow}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pulse-outline" size={42} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No ledger events yet</Text>
            <Text style={styles.emptySubtitle}>Place bids or buy units to populate your market tape history.</Text>
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111111',
  },
  headerLabel: {
    color: '#4ECDC4',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
    textAlign: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  headerRight: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2c2c2c',
  },
  headerRightText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  metricsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22303a',
    backgroundColor: '#0f151b',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricsTitle: {
    color: '#4ECDC4',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },
  metricsValue: {
    marginTop: 4,
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  metricsSubRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 14,
  },
  metricsSubCol: {
    flex: 1,
  },
  metricsSubLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.3,
  },
  metricsSubValue: {
    marginTop: 3,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  filterChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    backgroundColor: '#111111',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#15201f',
  },
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  filterChipTextActive: {
    color: '#8de5dc',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  separator: {
    height: 8,
  },
  rowCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242424',
    backgroundColor: '#111111',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  rowMeta: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  rowNote: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  rowAmountWrap: {
    alignItems: 'flex-end',
  },
  rowAmount: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  rowAmountNegative: {
    color: '#ff9797',
  },
  rowAmountPositive: {
    color: '#8de5dc',
  },
  rowUnits: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 40,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  emptySubtitle: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    lineHeight: 19,
  },
});
