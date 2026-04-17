import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Image
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { getCoOwnMarket, CoOwnAsset } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { EmptyState } from '../components/EmptyState';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Motion } from '../constants/motion';

type NavT = StackNavigationProp<RootStackParamList>;
const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const HEADER_BTN_BG = Colors.card;
const HEADER_BTN_BORDER = Colors.border;
const HERO_BG = IS_LIGHT ? '#f0ede7' : '#10161c';
const HERO_BORDER = IS_LIGHT ? '#d7d1c8' : '#24313b';
const CARD_BG = Colors.card;
const CARD_BORDER = Colors.border;
const POSITIVE_COLOR = IS_LIGHT ? '#7c5f1e' : '#d7b98f';
const NEGATIVE_COLOR = IS_LIGHT ? '#b64242' : '#ff9d9d';

export default function PortfolioScreen() {
  const navigation = useNavigation<NavT>();
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  const { formatFromFiat } = useFormattedPrice();
  const reducedMotionEnabled = useReducedMotion();

  const baseAssets = React.useMemo(() => getCoOwnMarket(customCoOwns), [customCoOwns]);

  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, coOwnRuntime[asset.id])),
    [baseAssets, coOwnRuntime]
  );

  const holdings = React.useMemo(
    () => marketAssets.filter((asset) => asset.yourUnits > 0),
    [marketAssets]
  );

  const totalValue = React.useMemo(
    () => holdings.reduce((sum, asset) => sum + asset.yourUnits * asset.unitPriceGBP, 0),
    [holdings]
  );

  const unrealized = React.useMemo(
    () =>
      holdings.reduce((sum, asset) => {
        const avg = asset.avgEntryPriceGBP ?? asset.unitPriceGBP;
        return sum + (asset.unitPriceGBP - avg) * asset.yourUnits;
      }, 0),
    [holdings]
  );

  const realized = React.useMemo(
    () => holdings.reduce((sum, asset) => sum + (asset.realizedProfitGBP ?? 0), 0),
    [holdings]
  );

  const portfolioBars = React.useMemo(() => {
    if (holdings.length === 0 || totalValue <= 0) {
      return [];
    }

    return holdings.map((asset) => ({
      id: asset.id,
      ratio: (asset.yourUnits * asset.unitPriceGBP) / totalValue,
      title: asset.title,
    }));
  }, [holdings, totalValue]);

  const renderHolding = ({ item, index }: { item: CoOwnAsset; index: number }) => {
    const value = item.yourUnits * item.unitPriceGBP;
    const avg = item.avgEntryPriceGBP ?? item.unitPriceGBP;
    const pnl = (item.unitPriceGBP - avg) * item.yourUnits;

    return (
      <Reanimated.View
        entering={
          reducedMotionEnabled
            ? undefined
            : FadeInDown
                .duration(Motion.list.enterDuration)
                .delay(Math.min(index, Motion.list.maxStaggerItems) * Motion.list.staggerStep)
        }
      >
        <AnimatedPressable
          style={styles.holdingRow}
          activeOpacity={0.92}
          onPress={() => navigation.navigate('AssetDetail', { assetId: item.id })}
        >
          <Image source={{ uri: item.image }} style={styles.holdingImage} />
          <View style={styles.holdingInfo}>
            <Text style={styles.holdingTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.holdingMeta}>{item.yourUnits} shares | Avg {formatFromFiat(avg, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <View style={styles.holdingRight}>
            <Text style={styles.holdingValue}>{formatFromFiat(value, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={[styles.holdingPnl, pnl >= 0 ? styles.pnlUp : styles.pnlDown]}>
              {pnl >= 0 ? '+' : ''}{formatFromFiat(Math.abs(pnl), 'GBP', { displayMode: 'fiat' })}
            </Text>
          </View>
        </AnimatedPressable>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Portfolio</Text>
        <AnimatedPressable style={styles.iconBtn} onPress={() => navigation.navigate('CoOwnOrderHistory')}>
          <Ionicons name="receipt-outline" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <FlashList
        data={holdings}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>TOTAL VALUE</Text>
              <Text style={styles.heroValue}>{formatFromFiat(totalValue, 'GBP')}</Text>
              <View style={styles.heroPnlRow}>
                <Text style={[styles.heroPnl, unrealized >= 0 ? styles.pnlUp : styles.pnlDown]}>
                  Unrealized {unrealized >= 0 ? '+' : ''}{formatFromFiat(Math.abs(unrealized), 'GBP', { displayMode: 'fiat' })}
                </Text>
                <Text style={[styles.heroPnl, realized >= 0 ? styles.pnlUp : styles.pnlDown]}>
                  Realized {realized >= 0 ? '+' : ''}{formatFromFiat(Math.abs(realized), 'GBP', { displayMode: 'fiat' })}
                </Text>
              </View>
            </View>

            <View style={styles.mixCard}>
              <Text style={styles.mixTitle}>Allocation Mix</Text>
              <View style={styles.mixBarsRow}>
                {portfolioBars.map((bar, idx) => (
                  <View
                    key={bar.id}
                    style={[
                      styles.mixBar,
                      {
                        width: `${Math.max(6, bar.ratio * 100)}%`,
                        backgroundColor: idx % 2 === 0 ? '#d7b98f' : '#9dd6ff',
                      },
                    ]}
                  />
                ))}
              </View>
            </View>

            <View style={styles.sectionRow}>
              <Text style={styles.sectionTitle}>Holdings</Text>
              <AnimatedPressable onPress={() => navigation.navigate('AssetLeaderboard')}>
                <Text style={styles.sectionLink}>Leaderboards</Text>
              </AnimatedPressable>
            </View>
          </View>
        }
        renderItem={renderHolding}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="pie-chart-outline"
            title="No holdings yet"
            subtitle="Buy your first co-owned shares from the hub to build your portfolio."
            ctaLabel="Browse Hub"
            onCtaPress={() => navigation.navigate('CoOwnHub')}
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
    borderColor: HEADER_BTN_BORDER,
    backgroundColor: HEADER_BTN_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HEADER_BTN_BORDER,
    backgroundColor: HEADER_BTN_BG,
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
  heroCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: HERO_BORDER,
    backgroundColor: HERO_BG,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  heroLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
  },
  heroValue: {
    marginTop: 5,
    color: Colors.textPrimary,
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.7,
  },
  heroPnlRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroPnl: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  pnlUp: {
    color: POSITIVE_COLOR,
  },
  pnlDown: {
    color: NEGATIVE_COLOR,
  },
  mixCard: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  mixTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  mixBarsRow: {
    marginTop: 10,
    gap: 6,
  },
  mixBar: {
    height: 10,
    borderRadius: 6,
  },
  sectionRow: {
    marginTop: 13,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  sectionLink: {
    color: TRADE_ACCENT,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  holdingRow: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    backgroundColor: CARD_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  holdingImage: {
    width: 54,
    height: 54,
    borderRadius: 12,
    backgroundColor: Colors.surface,
  },
  holdingInfo: {
    flex: 1,
  },
  holdingTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  holdingMeta: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  holdingRight: {
    alignItems: 'flex-end',
  },
  holdingValue: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  holdingPnl: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
});

