import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  FlatList,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { EmptyState } from '../components/EmptyState';
import { getOrderHistoryForAsset } from '../data/mockSyndicateData';
import { TradeOrder } from '../data/syndicateModels';
import {
  MarketHistoryCursor,
  MarketHistoryItem,
  listUserMarketHistory,
} from '../services/marketApi';
import { SYNDICATE_FEE_RATE } from '../utils/tradeFlow';

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
  source: 'seeded' | 'ledger' | 'backend';
}

const SIDE_FILTERS: SideFilter[] = ['all', 'buy', 'sell'];
const DATE_FILTERS: DateFilter[] = ['all', '24h', '7d', '30d'];
const PAGE_SIZE = 80;
const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;
const CHIP_ACTIVE_BG = IS_LIGHT ? '#ede4d3' : '#17302b';
const ROW_BG = Colors.card;
const ROW_BORDER = Colors.border;
const POSITIVE_COLOR = IS_LIGHT ? '#7c5f1e' : '#d7b98f';
const NEGATIVE_COLOR = IS_LIGHT ? '#b64242' : '#ff9d9d';
const REFRESH_BG = Colors.surface;
const ICON_BUY_BORDER = IS_LIGHT ? '#d9c6a2' : '#2f4944';
const ICON_BUY_BG = IS_LIGHT ? '#efe7d6' : '#152520';
const ICON_SELL_BORDER = IS_LIGHT ? '#ddb0b0' : '#4d2f2f';
const ICON_SELL_BG = IS_LIGHT ? '#f6e6e6' : '#241717';

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
        borderColor: IS_LIGHT ? '#d9c6a2' : '#2f4944',
        backgroundColor: IS_LIGHT ? '#efe7d6' : '#152520',
        textColor: IS_LIGHT ? '#7c5f1e' : '#d7b98f',
      };
    case 'pending':
      return {
        borderColor: IS_LIGHT ? '#dcc7a4' : '#4a4330',
        backgroundColor: IS_LIGHT ? '#f6ebd8' : '#232014',
        textColor: IS_LIGHT ? '#7c5f1e' : '#ffd886',
      };
    case 'partial':
      return {
        borderColor: IS_LIGHT ? '#dfc9a5' : '#4a3f2f',
        backgroundColor: IS_LIGHT ? '#f7ecdb' : '#231f16',
        textColor: IS_LIGHT ? '#7c5f1e' : '#ffcf8a',
      };
    case 'cancelled':
    default:
      return {
        borderColor: IS_LIGHT ? '#ddb0b0' : '#4d2f2f',
        backgroundColor: IS_LIGHT ? '#f6e6e6' : '#241717',
        textColor: IS_LIGHT ? '#b64242' : '#ff9d9d',
      };
  }
}

function sortHistoryEntriesDesc(a: HistoryEntry, b: HistoryEntry) {
  const tsDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  if (tsDiff !== 0) {
    return tsDiff;
  }

  return b.id.localeCompare(a.id);
}

function mapRemoteHistoryToEntries(history: MarketHistoryItem[]): HistoryEntry[] {
  return history
    .filter(
      (item) =>
        item.channel === 'syndicate' &&
        (item.action === 'buy-units' || item.action === 'sell-units')
    )
    .map<HistoryEntry>((item) => {
      const quantity = Math.max(0, item.units ?? 0);
      const pricePerShare =
        item.unitPriceGbp ??
        (quantity > 0 ? Number((item.amountGbp / quantity).toFixed(4)) : 0);
      const status =
        item.status === 'filled'
          ? 'filled'
          : item.status === 'rejected'
            ? 'cancelled'
            : 'filled';

      return {
        id: item.id,
        assetId: item.referenceId,
        side: item.action === 'buy-units' ? 'buy' : 'sell',
        type: 'market',
        quantity,
        pricePerShare,
        totalAmount: item.amountGbp,
        fee: item.feeGbp ?? Number((item.amountGbp * SYNDICATE_FEE_RATE).toFixed(2)),
        status,
        filledQuantity: status === 'filled' ? quantity : 0,
        createdAt: item.timestamp,
        source: 'backend',
      };
    })
    .sort(sortHistoryEntriesDesc);
}

export default function SyndicateOrderHistoryScreen() {
  const navigation = useNavigation<NavT>();
  const marketLedger = useStore((state) => state.marketLedger);
  const currentUser = useStore((state) => state.currentUser);
  const { formatFromFiat } = useFormattedPrice();
  const viewerId = currentUser?.id ?? 'u1';

  const [sideFilter, setSideFilter] = React.useState<SideFilter>('all');
  const [dateFilter, setDateFilter] = React.useState<DateFilter>('all');
  const [assetFilter, setAssetFilter] = React.useState<string>('all');
  const [remoteEntries, setRemoteEntries] = React.useState<HistoryEntry[]>([]);
  const [isSyncingRemote, setIsSyncingRemote] = React.useState(false);
  const [isRemoteAvailable, setIsRemoteAvailable] = React.useState(false);
  const [hasMoreRemote, setHasMoreRemote] = React.useState(false);
  const [nextCursor, setNextCursor] = React.useState<MarketHistoryCursor | null>(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);

  const syncRemoteHistory = React.useCallback(async () => {
    setIsSyncingRemote(true);

    try {
      const page = await listUserMarketHistory(viewerId, {
        channel: 'syndicate',
        limit: PAGE_SIZE,
      });

      setRemoteEntries(mapRemoteHistoryToEntries(page.items));
      setIsRemoteAvailable(true);
      setHasMoreRemote(page.pageInfo.hasMore);
      setNextCursor(page.pageInfo.nextCursor ?? null);
    } catch {
      setIsRemoteAvailable(false);
      setRemoteEntries([]);
      setHasMoreRemote(false);
      setNextCursor(null);
    } finally {
      setIsSyncingRemote(false);
    }
  }, [viewerId]);

  const loadMoreRemoteHistory = React.useCallback(async () => {
    if (!isRemoteAvailable || !hasMoreRemote || !nextCursor || isLoadingMore || isSyncingRemote) {
      return;
    }

    setIsLoadingMore(true);
    try {
      const page = await listUserMarketHistory(viewerId, {
        channel: 'syndicate',
        limit: PAGE_SIZE,
        cursorTs: nextCursor.cursorTs,
        cursorId: nextCursor.cursorId,
      });

      const pageEntries = mapRemoteHistoryToEntries(page.items);
      setRemoteEntries((previous) => {
        const merged = [...previous, ...pageEntries];
        const deduped = new Map<string, HistoryEntry>();

        for (const item of merged) {
          deduped.set(item.id, item);
        }

        return [...deduped.values()].sort(sortHistoryEntriesDesc);
      });

      setHasMoreRemote(page.pageInfo.hasMore);
      setNextCursor(page.pageInfo.nextCursor ?? null);
    } catch {
      setHasMoreRemote(false);
      setNextCursor(null);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreRemote, isLoadingMore, isRemoteAvailable, isSyncingRemote, nextCursor, viewerId]);

  React.useEffect(() => {
    void syncRemoteHistory();
  }, [syncRemoteHistory]);

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
          fee: Number((totalAmount * SYNDICATE_FEE_RATE).toFixed(2)),
          status: 'filled',
          filledQuantity: quantity,
          createdAt: entry.timestamp,
          source: 'ledger',
        };
      });
  }, [marketLedger]);

  const fallbackEntries = React.useMemo(() => {
    return [...ledgerOrders, ...seededOrders].sort(sortHistoryEntriesDesc);
  }, [ledgerOrders, seededOrders]);

  const allEntries = React.useMemo(() => {
    if (isRemoteAvailable) {
      return remoteEntries;
    }

    return fallbackEntries;
  }, [fallbackEntries, isRemoteAvailable, remoteEntries]);

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
            color={isBuy ? '#d7b98f' : '#ff9d9d'}
          />
        </View>

        <View style={styles.rowBody}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.rowTitle}>{isBuy ? 'Buy' : 'Sell'} | {item.assetId.toUpperCase()}</Text>
            <View style={[styles.statusPill, { borderColor: statusStyle.borderColor, backgroundColor: statusStyle.backgroundColor }]}>
              <Text style={[styles.statusPillText, { color: statusStyle.textColor }]}>{item.status.toUpperCase()}</Text>
            </View>
          </View>

          <Text style={styles.rowMeta}>
            {item.quantity} units | {item.type.toUpperCase()} | {formatFromFiat(item.pricePerShare, 'GBP', { displayMode: 'fiat' })}/unit
          </Text>
          <Text style={styles.rowNote}>
            Filled {item.filledQuantity}/{item.quantity} | {ts.toLocaleDateString()} {ts.toLocaleTimeString()}
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
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Syndicate Orders</Text>
        <View style={{ width: 40 }} />
      </View>

      {isSyncingRemote ? <Text style={styles.syncHint}>Syncing backend order fills...</Text> : null}

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
        onEndReachedThreshold={0.35}
        onEndReached={() => {
          void loadMoreRemoteHistory();
        }}
        refreshControl={
          <RefreshControl
            refreshing={isSyncingRemote}
            onRefresh={() => {
              void syncRemoteHistory();
            }}
            tintColor={TRADE_ACCENT}
            colors={[TRADE_ACCENT]}
            progressBackgroundColor={REFRESH_BG}
          />
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListFooterComponent={
          isRemoteAvailable && (isLoadingMore || hasMoreRemote) ? (
            <Text style={styles.footerHint}>{isLoadingMore ? 'Loading more orders...' : 'Scroll for more order history'}</Text>
          ) : null
        }
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
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
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
  syncHint: {
    marginTop: -2,
    marginBottom: 8,
    paddingHorizontal: 16,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  footerHint: {
    marginTop: 4,
    marginBottom: 6,
    color: Colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    fontFamily: 'Inter_500Medium',
  },
  assetFilterRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 10,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  filterText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  filterTextActive: {
    color: TRADE_ACCENT,
  },
  assetChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  assetChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  assetChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.45,
  },
  assetChipTextActive: {
    color: TRADE_ACCENT,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  row: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: ROW_BORDER,
    backgroundColor: ROW_BG,
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
    borderColor: ICON_BUY_BORDER,
    backgroundColor: ICON_BUY_BG,
  },
  iconSell: {
    borderWidth: 1,
    borderColor: ICON_SELL_BORDER,
    backgroundColor: ICON_SELL_BG,
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
    color: NEGATIVE_COLOR,
  },
  rowAmountSell: {
    color: POSITIVE_COLOR,
  },
});

