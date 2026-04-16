import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  StatusBar
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { getCoOwnMarket, getUserLabel } from '../data/tradeHub';
import { MOCK_USERS } from '../data/mockData';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState, getOrderBookSnapshot, getPriceSeries, ChartRange } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { EmptyState } from '../components/EmptyState';
import { AppButton } from '../components/ui/AppButton';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';

type RouteT = RouteProp<RootStackParamList, 'AssetDetail'>;
type NavT = StackNavigationProp<RootStackParamList>;

const RANGE_OPTIONS: ChartRange[] = ['1H', '1D', '1W', '1M', 'ALL'];
const RANGE_SEGMENT_OPTIONS: Array<{ value: ChartRange; label: string; accessibilityLabel: string }> = RANGE_OPTIONS.map((option) => ({
  value: option,
  label: option,
  accessibilityLabel: `Set chart range to ${option}`,
}));
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#121212';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#17302b';
const PANEL_TINT_BORDER = IS_LIGHT ? '#d0c3af' : '#35574d';
const CHART_BG = IS_LIGHT ? '#f1ede6' : '#10171d';
const CHART_BORDER = IS_LIGHT ? '#d6cec1' : '#26343f';
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.97)' : 'rgba(10,10,10,0.95)';

export default function AssetDetailScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const insets = useSafeAreaInsets();
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  const currentUser = useStore((state) => state.currentUser);
  const { formatFromFiat } = useFormattedPrice();

  const [range, setRange] = React.useState<ChartRange>('1D');

  const baseAssets = React.useMemo(() => getCoOwnMarket(customCoOwns), [customCoOwns]);
  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, coOwnRuntime[asset.id])),
    [baseAssets, coOwnRuntime]
  );

  const asset = marketAssets.find((item) => item.id === route.params.assetId);

  const series = React.useMemo(() => {
    if (!asset) {
      return [];
    }

    return getPriceSeries(asset.id, range);
  }, [asset, range]);

  const orderBook = React.useMemo(() => {
    if (!asset) {
      return [];
    }

    return getOrderBookSnapshot(asset.id);
  }, [asset]);

  const chartPoints = React.useMemo(() => {
    if (series.length === 0) {
      return [];
    }

    const sampleSize = 28;
    const step = Math.max(1, Math.floor(series.length / sampleSize));
    const closes = series.filter((_, idx) => idx % step === 0).map((point) => point.close);

    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const spread = max - min || 1;

    return closes.map((close) => ({
      value: close,
      level: (close - min) / spread,
    }));
  }, [series]);

  const currentPoint = series[series.length - 1];
  const previousPoint = series[series.length - 2] ?? currentPoint;
  const delta = currentPoint && previousPoint ? currentPoint.close - previousPoint.close : 0;
  const deltaPct = previousPoint && previousPoint.close > 0 ? (delta / previousPoint.close) * 100 : 0;

  if (!asset) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
        <View style={styles.fallbackHeader}>
          <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </AnimatedPressable>
        </View>
        <EmptyState
          icon="analytics-outline"
          title="Asset not found"
          subtitle="This co-own may have been delisted or does not exist yet."
          ctaLabel="Back to hub"
          onCtaPress={() => navigation.navigate('CoOwnHub')}
        />
      </SafeAreaView>
    );
  }

  const bids = orderBook.filter((entry) => entry.side === 'bid').sort((a, b) => b.price - a.price);
  const asks = orderBook.filter((entry) => entry.side === 'ask').sort((a, b) => a.price - b.price);
  const marketValue = asset.totalUnits * asset.unitPriceGBP;
  const circulatingValue = Math.max(0, asset.totalUnits - asset.availableUnits) * asset.unitPriceGBP;

  const ownerAccounts: Array<{ id: string; handle: string; role: string; units: number }> = [];
  ownerAccounts.push({
    id: `issuer_${asset.issuerId}`,
    handle: getUserLabel(asset.issuerId),
    role: 'Issuer treasury',
    units: Math.max(0, asset.availableUnits),
  });

  if (asset.yourUnits > 0) {
    ownerAccounts.push({
      id: 'you',
      handle: currentUser ? `@${currentUser.username}` : '@you',
      role: 'Your position',
      units: asset.yourUnits,
    });
  }

  const allocatedUnits = ownerAccounts.reduce((sum, account) => sum + account.units, 0);
  let remainingUnits = Math.max(0, asset.totalUnits - allocatedUnits);
  const syntheticOwners = Math.max(0, Math.min(3, asset.holders - (asset.yourUnits > 0 ? 1 : 0)));
  const fallbackHandles = MOCK_USERS
    .filter((user) => user.id !== asset.issuerId && user.id !== currentUser?.id)
    .map((user) => `@${user.username}`);

  for (let index = 0; index < syntheticOwners; index += 1) {
    const slotsLeft = syntheticOwners - index;
    const units = slotsLeft === 1
      ? remainingUnits
      : Math.max(1, Math.floor(remainingUnits / slotsLeft));

    if (units <= 0) {
      break;
    }

    remainingUnits = Math.max(0, remainingUnits - units);
    ownerAccounts.push({
      id: `owner_${index + 1}`,
      handle: fallbackHandles[index] ?? `@holder${index + 1}`,
      role: 'Owner account',
      units,
    });
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Asset Detail</Text>
        <AnimatedPressable style={styles.iconBtn} onPress={() => navigation.navigate('CoOwnOrderHistory')}>
          <Ionicons name="time-outline" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: asset.image }} style={styles.heroImage} />

        <Text style={styles.assetTitle}>{asset.title}</Text>
        <Text style={styles.assetSub}>Asset ID {asset.id.toUpperCase()} | Issuer {asset.issuerId}</Text>

        <View style={styles.priceRow}>
          <Text style={styles.pricePrimary}>{formatFromFiat(asset.unitPriceGBP, 'GBP')}</Text>
          <Text style={[styles.deltaText, delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
            {delta >= 0 ? '+' : ''}{deltaPct.toFixed(2)}%
          </Text>
        </View>

        <AppSegmentControl
          style={styles.rangeRow}
          options={RANGE_SEGMENT_OPTIONS}
          value={range}
          onChange={setRange}
          optionStyle={styles.rangeChip}
          optionActiveStyle={styles.rangeChipActive}
          optionTextStyle={styles.rangeChipText}
          optionTextActiveStyle={styles.rangeChipTextActive}
        />

        <View style={styles.chartCard}>
          <View style={styles.chartBarsRow}>
            {chartPoints.map((point, index) => (
              <View
                key={`${point.value}_${index}`}
                style={[
                  styles.chartBar,
                  {
                    height: 24 + point.level * 68,
                    backgroundColor: delta >= 0 ? BRAND : Colors.danger,
                    opacity: 0.32 + point.level * 0.68,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.chartFooter}>
            <Text style={styles.chartFooterText}>Open {formatFromFiat(series[0]?.open ?? asset.unitPriceGBP, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.chartFooterText}>High {formatFromFiat(currentPoint?.high ?? asset.unitPriceGBP, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.chartFooterText}>Low {formatFromFiat(currentPoint?.low ?? asset.unitPriceGBP, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Market Value</Text>
            <Text style={styles.statValue}>{formatFromFiat(marketValue, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Circulating Value</Text>
            <Text style={styles.statValue}>{formatFromFiat(circulatingValue, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Holders</Text>
            <Text style={styles.statValue}>{asset.holders}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Available Shares</Text>
            <Text style={styles.statValue}>{asset.availableUnits}</Text>
          </View>
        </View>

        <View style={styles.orderBookCard}>
          <Text style={styles.orderBookTitle}>Order Book</Text>
          <View style={styles.orderHeaderRow}>
            <Text style={styles.orderHead}>Bid</Text>
            <Text style={styles.orderHead}>Qty</Text>
            <Text style={styles.orderHead}>Ask</Text>
            <Text style={styles.orderHead}>Qty</Text>
          </View>
          {Array.from({ length: Math.max(bids.length, asks.length) }).map((_, idx) => {
            const bid = bids[idx];
            const ask = asks[idx];
            return (
              <View style={styles.orderRow} key={`row_${idx}`}>
                <Text style={[styles.orderCell, styles.orderBid]}>{bid ? formatFromFiat(bid.price, 'GBP', { displayMode: 'fiat' }) : '-'}</Text>
                <Text style={styles.orderCell}>{bid ? bid.quantity : '-'}</Text>
                <Text style={[styles.orderCell, styles.orderAsk]}>{ask ? formatFromFiat(ask.price, 'GBP', { displayMode: 'fiat' }) : '-'}</Text>
                <Text style={styles.orderCell}>{ask ? ask.quantity : '-'}</Text>
              </View>
            );
          })}
        </View>

        <View style={styles.ownersCard}>
          <Text style={styles.ownersTitle}>Owner Accounts</Text>
          {ownerAccounts
            .filter((account) => account.units > 0)
            .slice(0, 5)
            .map((account) => (
              <View key={account.id} style={styles.ownerRow}>
                <View>
                  <Text style={styles.ownerHandle}>{account.handle}</Text>
                  <Text style={styles.ownerRole}>{account.role}</Text>
                </View>
                <Text style={styles.ownerUnits}>{account.units} units</Text>
              </View>
            ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <AppButton
          style={[styles.ctaBtn, styles.ctaBuy]}
          variant="gold"
          size="sm"
          align="center"
          title="Buy"
          onPress={() => navigation.navigate('Trade', { assetId: asset.id, side: 'buy' })}
          accessibilityLabel={`Buy shares of ${asset.title}`}
          accessibilityHint="Opens the trade ticket with buy selected."
        />
        <AppButton
          style={[styles.ctaBtn, styles.ctaSell]}
          variant="secondary"
          size="sm"
          align="center"
          title="Sell"
          onPress={() => navigation.navigate('Trade', { assetId: asset.id, side: 'sell' })}
          accessibilityLabel={`Sell shares of ${asset.title}`}
          accessibilityHint="Opens the trade ticket with sell selected."
        />
        <AppButton
          style={[styles.ctaBtn, styles.ctaBuyout]}
          variant="secondary"
          size="sm"
          align="center"
          title="Buyout"
          icon={<Ionicons name="diamond-outline" size={15} color={Colors.textPrimary} />}
          onPress={() => navigation.navigate('Buyout', { assetId: asset.id })}
          accessibilityLabel={`Start buyout flow for ${asset.title}`}
          accessibilityHint="Opens buyout request and terms for this asset."
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  fallbackHeader: {
    paddingHorizontal: 16,
    paddingTop: 8,
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
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  heroImage: {
    width: '100%',
    height: 250,
    borderRadius: 16,
    backgroundColor: Colors.surface,
  },
  assetTitle: {
    marginTop: 12,
    color: Colors.textPrimary,
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
  },
  assetSub: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  priceRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pricePrimary: {
    color: Colors.textPrimary,
    fontSize: 30,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.8,
  },
  deltaText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  deltaUp: {
    color: BRAND,
  },
  deltaDown: {
    color: Colors.danger,
  },
  rangeRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  rangeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rangeChipActive: {
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
  },
  rangeChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  rangeChipTextActive: {
    color: BRAND,
  },
  chartCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CHART_BORDER,
    backgroundColor: CHART_BG,
    paddingHorizontal: 10,
    paddingVertical: 12,
  },
  chartBarsRow: {
    height: 100,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
  },
  chartBar: {
    flex: 1,
    borderRadius: 4,
  },
  chartFooter: {
    marginTop: 9,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartFooterText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  statsGrid: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statCard: {
    width: '48.8%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  statValue: {
    marginTop: 4,
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  orderBookCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  orderBookTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    marginBottom: 10,
  },
  orderHeaderRow: {
    flexDirection: 'row',
  },
  orderHead: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
  },
  orderRow: {
    flexDirection: 'row',
    paddingTop: 7,
  },
  orderCell: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  orderBid: {
    color: BRAND,
  },
  orderAsk: {
    color: Colors.danger,
  },
  ownersCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  ownersTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  ownerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
  },
  ownerHandle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  ownerRole: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  ownerUnits: {
    color: BRAND,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    backgroundColor: FOOTER_BG,
  },
  ctaBtn: {
    flex: 1,
  },
  ctaBuy: {
    backgroundColor: 'transparent',
  },
  ctaSell: {
    backgroundColor: 'transparent',
  },
  ctaBuyout: {
    backgroundColor: 'transparent',
  },
});

