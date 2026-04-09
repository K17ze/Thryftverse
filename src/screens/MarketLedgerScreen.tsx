import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { formatMoney } from '../data/tradeHub';
import {
  MarketHistoryItem,
  MarketHistoryCursor,
  listUserMarketHistory,
} from '../services/marketApi';

type NavT = StackNavigationProp<RootStackParamList>;
type LedgerFilter = 'ALL' | 'AUCTION' | 'CO-OWN';

type LedgerEntry = {
  id: string;
  timestamp: string;
  channel: 'auction' | 'co-own';
  action: 'bid' | 'win' | 'buy-units' | 'sell-units';
  referenceId: string;
  amountGBP: number;
  units?: number;
  note?: string;
};

const PAGE_SIZE = 80;
const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const HEADER_BUTTON_BG = Colors.card;
const HEADER_BUTTON_BORDER = Colors.border;
const METRICS_CARD_BG = IS_LIGHT ? '#f0ede7' : '#0f151b';
const METRICS_CARD_BORDER = IS_LIGHT ? '#d7d1c8' : '#22303a';
const CHIP_BG = Colors.card;
const CHIP_BORDER = Colors.border;
const CHIP_ACTIVE_BG = IS_LIGHT ? '#ede4d3' : '#15201f';
const ROW_BG = Colors.card;
const ROW_BORDER = Colors.border;
const ROW_ICON_BG = Colors.cardAlt;
const EMPTY_ICON_BG = Colors.card;
const POSITIVE_COLOR = IS_LIGHT ? '#7c5f1e' : '#d7b98f';
const NEGATIVE_COLOR = IS_LIGHT ? '#b64242' : '#ff9797';
const REFRESH_BG = Colors.surface;

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

function sortLedgerEntriesDesc(a: LedgerEntry, b: LedgerEntry) {
  const tsDiff = new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  if (tsDiff !== 0) {
    return tsDiff;
  }

  return b.id.localeCompare(a.id);
}

function mapHistoryToLedgerEntries(items: MarketHistoryItem[]): LedgerEntry[] {
  return items
    .filter((item) => item.action === 'bid' || item.action === 'buy-units' || item.action === 'sell-units')
    .map<LedgerEntry>((item) => ({
      id: item.id,
      timestamp: item.timestamp,
      channel: item.channel,
      action: item.action,
      referenceId: item.referenceId,
      amountGBP: item.amountGbp,
      units: item.units ?? undefined,
      note: item.note ?? undefined,
    }))
    .sort(sortLedgerEntriesDesc);
}

export default function MarketLedgerScreen() {
  const navigation = useNavigation<NavT>();
  const localEntries = useStore((state) => state.marketLedger);
  const currentUser = useStore((state) => state.currentUser);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  const viewerId = currentUser?.id ?? 'u1';

  const [filter, setFilter] = React.useState<LedgerFilter>('ALL');
  const [remoteEntries, setRemoteEntries] = React.useState<LedgerEntry[]>([]);
  const [isSyncingLedger, setIsSyncingLedger] = React.useState(false);
  const [isRemoteAvailable, setIsRemoteAvailable] = React.useState(false);
  const [hasMoreRemote, setHasMoreRemote] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<MarketHistoryCursor | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const refreshRemoteLedger = React.useCallback(async () => {
    setIsSyncingLedger(true);

    try {
      const page = await listUserMarketHistory(viewerId, {
        channel: 'all',
        limit: PAGE_SIZE,
      });

      setRemoteEntries(mapHistoryToLedgerEntries(page.items));
      setIsRemoteAvailable(true);
      setHasMoreRemote(page.pageInfo.hasMore);
      setNextCursor(page.pageInfo.nextCursor ?? null);
    } catch {
      setIsRemoteAvailable(false);
      setRemoteEntries([]);
      setHasMoreRemote(false);
      setNextCursor(null);
    } finally {
      setIsSyncingLedger(false);
    }
  }, [viewerId]);

  const loadMoreRemoteLedger = React.useCallback(async () => {
    if (!isRemoteAvailable || !hasMoreRemote || !nextCursor || isLoadingMore || isSyncingLedger) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await listUserMarketHistory(viewerId, {
        channel: 'all',
        limit: PAGE_SIZE,
        cursorTs: nextCursor.cursorTs,
        cursorId: nextCursor.cursorId,
      });

      const pageEntries = mapHistoryToLedgerEntries(page.items);
      setRemoteEntries((previous) => {
        const merged = [...previous, ...pageEntries];
        const deduped = new Map<string, LedgerEntry>();

        for (const item of merged) {
          deduped.set(item.id, item);
        }

        return [...deduped.values()].sort(sortLedgerEntriesDesc);
      });

      setHasMoreRemote(page.pageInfo.hasMore);
      setNextCursor(page.pageInfo.nextCursor ?? null);
    } catch {
      setHasMoreRemote(false);
      setNextCursor(null);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreRemote, isLoadingMore, isRemoteAvailable, isSyncingLedger, nextCursor, viewerId]);

  React.useEffect(() => {
    void refreshRemoteLedger();
  }, [refreshRemoteLedger]);

  const entries = React.useMemo(
    () => (isRemoteAvailable ? remoteEntries : localEntries),
    [isRemoteAvailable, localEntries, remoteEntries]
  );

  const filteredEntries = React.useMemo(() => {
    if (filter === 'ALL') {
      return entries;
    }

    const channel = filter === 'AUCTION' ? 'auction' : 'co-own';
    return entries.filter((entry) => entry.channel === channel);
  }, [entries, filter]);

  const totalMarketValue = React.useMemo(
    () => filteredEntries.reduce((sum, entry) => sum + entry.amountGBP, 0),
    [filteredEntries]
  );

  const realizedCoOwnPL = React.useMemo(
    () => Object.values(coOwnRuntime).reduce((sum, runtime) => sum + runtime.realizedProfitGBP, 0),
    [coOwnRuntime]
  );

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
          <Ionicons name={iconName} size={16} color={isAuction ? '#d7b98f' : '#a9c9ff'} />
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
          <Text style={styles.rowMeta} numberOfLines={1}>{item.referenceId} | {relativeTime(item.timestamp)}</Text>
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
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>

        <View>
          <Text style={styles.headerLabel}>MARKET LEDGER</Text>
          <Text style={styles.headerTitle}>Trade History</Text>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.headerRightText}>{filteredEntries.length}</Text>
        </View>
      </View>

      <View style={styles.metricsCard}>
        <Text style={styles.metricsTitle}>Tracked Market Value</Text>
        <Text style={styles.metricsValue}>{formatMoney(totalMarketValue)}</Text>
        <Text style={styles.metricsSyncText}>
          {isSyncingLedger
            ? 'Syncing backend ledger...'
            : isRemoteAvailable
              ? 'Live backend market events'
              : 'Showing local ledger fallback'}
        </Text>

        <View style={styles.metricsSubRow}>
          <View style={styles.metricsSubCol}>
            <Text style={styles.metricsSubLabel}>Realized P/L</Text>
            <Text style={[
              styles.metricsSubValue,
              realizedCoOwnPL >= 0 ? styles.rowAmountPositive : styles.rowAmountNegative,
            ]}>{formatSignedMoney(realizedCoOwnPL)}</Text>
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
        {(['ALL', 'AUCTION', 'CO-OWN'] as const).map((nextFilter) => {
          const active = filter === nextFilter;
          return (
            <AnimatedPressable
              key={nextFilter}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setFilter(nextFilter)}
              activeOpacity={0.9}
            >
              <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{nextFilter}</Text>
            </AnimatedPressable>
          );
        })}
      </View>

      <FlatList
        data={filteredEntries}
        keyExtractor={(item) => item.id}
        renderItem={renderLedgerRow}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          void loadMoreRemoteLedger();
        }}
        refreshControl={
          <RefreshControl
            refreshing={isSyncingLedger}
            onRefresh={() => {
              void refreshRemoteLedger();
            }}
            tintColor={TRADE_ACCENT}
            colors={[TRADE_ACCENT]}
            progressBackgroundColor={REFRESH_BG}
          />
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          isRemoteAvailable && (isLoadingMore || hasMoreRemote) ? (
            <Text style={styles.footerHint}>{isLoadingMore ? 'Loading more ledger rows...' : 'Scroll for more history'}</Text>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pulse-outline" size={42} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No ledger events yet</Text>
            <Text style={styles.emptySubtitle}>No activity yet.</Text>
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
    backgroundColor: HEADER_BUTTON_BG,
  },
  headerLabel: {
    color: TRADE_ACCENT,
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
    borderColor: HEADER_BUTTON_BORDER,
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
    borderColor: METRICS_CARD_BORDER,
    backgroundColor: METRICS_CARD_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricsTitle: {
    color: TRADE_ACCENT,
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
  metricsSyncText: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
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
    borderColor: CHIP_BORDER,
    backgroundColor: CHIP_BG,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  filterChipTextActive: {
    color: TRADE_ACCENT,
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
    borderColor: ROW_BORDER,
    backgroundColor: ROW_BG,
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
    backgroundColor: ROW_ICON_BG,
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
    color: NEGATIVE_COLOR,
  },
  rowAmountPositive: {
    color: POSITIVE_COLOR,
  },
  rowUnits: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  footerHint: {
    marginTop: 8,
    marginBottom: 4,
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
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
    backgroundColor: EMPTY_ICON_BG,
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

