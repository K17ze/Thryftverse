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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { formatCompact, getSyndicateMarket } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState, getOrderBookSnapshot, getPriceSeries, ChartRange } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { EmptyState } from '../components/EmptyState';

type RouteT = RouteProp<RootStackParamList, 'AssetDetail'>;
type NavT = StackNavigationProp<RootStackParamList>;

const RANGE_OPTIONS: ChartRange[] = ['1H', '1D', '1W', '1M', 'ALL'];

export default function AssetDetailScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const { formatFromFiat } = useFormattedPrice();

  const [range, setRange] = React.useState<ChartRange>('1D');

  const baseAssets = React.useMemo(() => getSyndicateMarket(customSyndicates), [customSyndicates]);
  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, syndicateRuntime[asset.id])),
    [baseAssets, syndicateRuntime]
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
        <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
        <View style={styles.fallbackHeader}>
          <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </AnimatedPressable>
        </View>
        <EmptyState
          icon="analytics-outline"
          title="Asset not found"
          subtitle="This syndicate may have been delisted or does not exist yet."
          ctaLabel="Back to hub"
          onCtaPress={() => navigation.navigate('SyndicateHub')}
        />
      </SafeAreaView>
    );
  }

  const bids = orderBook.filter((entry) => entry.side === 'bid').sort((a, b) => b.price - a.price);
  const asks = orderBook.filter((entry) => entry.side === 'ask').sort((a, b) => a.price - b.price);
  const marketCap = asset.totalUnits * asset.unitPriceGBP;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Asset Detail</Text>
        <AnimatedPressable style={styles.iconBtn} onPress={() => navigation.navigate('SyndicateOrderHistory')}>
          <Ionicons name="time-outline" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: asset.image }} style={styles.heroImage} />

        <Text style={styles.assetTitle}>{asset.title}</Text>
        <Text style={styles.assetSub}>Asset ID {asset.id.toUpperCase()} · Issuer {asset.issuerId}</Text>

        <View style={styles.priceRow}>
          <Text style={styles.pricePrimary}>{formatFromFiat(asset.unitPriceGBP, 'GBP')}</Text>
          <Text style={[styles.deltaText, delta >= 0 ? styles.deltaUp : styles.deltaDown]}>
            {delta >= 0 ? '+' : ''}{deltaPct.toFixed(2)}%
          </Text>
        </View>

        <View style={styles.rangeRow}>
          {RANGE_OPTIONS.map((option) => {
            const active = option === range;
            return (
              <AnimatedPressable
                key={option}
                style={[styles.rangeChip, active && styles.rangeChipActive]}
                onPress={() => setRange(option)}
                activeOpacity={0.9}
              >
                <Text style={[styles.rangeChipText, active && styles.rangeChipTextActive]}>{option}</Text>
              </AnimatedPressable>
            );
          })}
        </View>

        <View style={styles.chartCard}>
          <View style={styles.chartBarsRow}>
            {chartPoints.map((point, index) => (
              <View
                key={`${point.value}_${index}`}
                style={[
                  styles.chartBar,
                  {
                    height: 24 + point.level * 68,
                    backgroundColor: delta >= 0 ? '#4ECDC4' : '#ef6f6f',
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
            <Text style={styles.statLabel}>Market Cap</Text>
            <Text style={styles.statValue}>{formatFromFiat(marketCap, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>24h Volume</Text>
            <Text style={styles.statValue}>{formatCompact(Math.round(asset.volume24hGBP))}</Text>
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

        <View style={{ height: 120 }} />
      </ScrollView>

      <View style={styles.footer}>
        <AnimatedPressable
          style={[styles.ctaBtn, styles.ctaBuy]}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Trade', { assetId: asset.id, side: 'buy' })}
        >
          <Text style={styles.ctaBuyText}>Buy</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.ctaBtn, styles.ctaSell]}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Trade', { assetId: asset.id, side: 'sell' })}
        >
          <Text style={styles.ctaSellText}>Sell</Text>
        </AnimatedPressable>
        <AnimatedPressable
          style={[styles.ctaBtn, styles.ctaBuyout]}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Buyout', { assetId: asset.id })}
        >
          <Ionicons name="diamond-outline" size={15} color={Colors.textPrimary} />
          <Text style={styles.ctaSellText}>Buyout</Text>
        </AnimatedPressable>
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
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#272727',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: '#272727',
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
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.8,
  },
  deltaText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  deltaUp: {
    color: '#8de5dc',
  },
  deltaDown: {
    color: '#ff9d9d',
  },
  rangeRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  rangeChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2d2d2d',
    backgroundColor: '#161616',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rangeChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#17302b',
  },
  rangeChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  rangeChipTextActive: {
    color: '#8de5dc',
  },
  chartCard: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#26343f',
    backgroundColor: '#10171d',
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
    borderColor: '#2a2a2a',
    backgroundColor: '#121212',
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
    borderColor: '#2a2a2a',
    backgroundColor: '#101010',
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
    color: '#8de5dc',
  },
  orderAsk: {
    color: '#ff9d9d',
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
    backgroundColor: 'rgba(10,10,10,0.95)',
  },
  ctaBtn: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 5,
  },
  ctaBuy: {
    backgroundColor: Colors.accent,
  },
  ctaSell: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#303030',
  },
  ctaBuyout: {
    backgroundColor: '#101822',
    borderWidth: 1,
    borderColor: '#29475a',
  },
  ctaBuyText: {
    color: Colors.background,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  ctaSellText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
});
