import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  StatusBar
} from 'react-native';
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
import { EmptyState } from '../components/EmptyState';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type NavT = StackNavigationProp<RootStackParamList>;

type HubSort = 'value' | 'movers' | 'latest';
const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;
const SEARCH_BG = Colors.cardAlt;
const METRIC_BG = IS_LIGHT ? '#f0ede7' : '#10161c';
const METRIC_BORDER = IS_LIGHT ? '#d7d1c8' : '#24313b';
const SORT_ACTIVE_BG = IS_LIGHT ? '#ede4d3' : '#17302b';
const UP_PILL_BG = IS_LIGHT ? '#efe7d6' : '#142420';
const UP_PILL_BORDER = IS_LIGHT ? '#d9c6a2' : '#2d4a45';
const DOWN_PILL_BG = IS_LIGHT ? '#f6e6e6' : '#231616';
const DOWN_PILL_BORDER = IS_LIGHT ? '#ddb0b0' : '#4b2c2c';
const UP_TEXT_COLOR = IS_LIGHT ? '#7c5f1e' : '#d7b98f';
const DOWN_TEXT_COLOR = IS_LIGHT ? '#b64242' : '#ff9d9d';
const OUTLINE_BTN_BG = Colors.cardAlt;
const OUTLINE_BTN_BORDER = Colors.border;

export default function CoOwnHubScreen() {
  const navigation = useNavigation<NavT>();
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  const { formatFromFiat } = useFormattedPrice();

  const [query, setQuery] = React.useState('');
  const [sortBy, setSortBy] = React.useState<HubSort>('value');

  const handleBack = React.useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.navigate('MainTabs');
  }, [navigation]);

  const baseAssets = React.useMemo(() => getCoOwnMarket(customCoOwns), [customCoOwns]);

  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, coOwnRuntime[asset.id])),
    [baseAssets, coOwnRuntime]
  );

  const filteredAssets = React.useMemo(() => {
    const normalized = query.trim().toLowerCase();

    const filtered = marketAssets.filter((asset) => {
      if (!normalized) {
        return true;
      }

      return [asset.title, asset.id, asset.issuerId].join(' ').toLowerCase().includes(normalized);
    });

    const sorted = [...filtered];
    if (sortBy === 'movers') {
      sorted.sort((a, b) => b.marketMovePct24h - a.marketMovePct24h);
    } else if (sortBy === 'latest') {
      sorted.sort((a, b) => Number(b.id.localeCompare(a.id)));
    } else {
      sorted.sort((a, b) => b.totalUnits * b.unitPriceGBP - a.totalUnits * a.unitPriceGBP);
    }

    return sorted;
  }, [marketAssets, query, sortBy]);

  const totalOpenValue = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + asset.availableUnits * asset.unitPriceGBP, 0),
    [marketAssets]
  );

  const totalMarketValue = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + asset.totalUnits * asset.unitPriceGBP, 0),
    [marketAssets]
  );

  const renderAsset = ({ item, index }: { item: CoOwnAsset; index: number }) => {
    const isPositive = item.marketMovePct24h >= 0;
    const marketValue = item.totalUnits * item.unitPriceGBP;
    const openValue = item.availableUnits * item.unitPriceGBP;

    return (
      <Reanimated.View entering={FadeInDown.duration(420).delay(Math.min(index, 8) * 45)}>
        <AnimatedPressable
          style={styles.assetCard}
          activeOpacity={0.92}
          onPress={() => navigation.navigate('AssetDetail', { assetId: item.id })}
        >
          <Image source={{ uri: item.image }} style={styles.assetImage} />

        <View style={styles.assetBody}>
          <View style={styles.assetTopRow}>
            <Text style={styles.assetTitle} numberOfLines={1}>{item.title}</Text>
            <View style={[styles.movePill, isPositive ? styles.movePillUp : styles.movePillDown]}>
              <Ionicons
                name={isPositive ? 'trending-up-outline' : 'trending-down-outline'}
                size={12}
                color={isPositive ? UP_TEXT_COLOR : DOWN_TEXT_COLOR}
              />
              <Text style={[styles.moveText, isPositive ? styles.moveTextUp : styles.moveTextDown]}>
                {isPositive ? '+' : ''}{item.marketMovePct24h.toFixed(1)}%
              </Text>
            </View>
          </View>

          <Text style={styles.assetMeta}>{item.availableUnits} / {item.totalUnits} shares available</Text>

          <View style={styles.assetStatsRow}>
            <View>
              <Text style={styles.assetStatLabel}>Share Price</Text>
              <Text style={styles.assetStatValue}>{formatFromFiat(item.unitPriceGBP, 'GBP')}</Text>
            </View>
            <View>
              <Text style={styles.assetStatLabel}>Market Value</Text>
              <Text style={styles.assetStatValue}>{formatFromFiat(marketValue, 'GBP', { displayMode: 'fiat' })}</Text>
            </View>
            <View>
              <Text style={styles.assetStatLabel}>Open Value</Text>
              <Text style={styles.assetStatValue}>{formatFromFiat(openValue, 'GBP', { displayMode: 'fiat' })}</Text>
            </View>
          </View>

          <View style={styles.assetActionRow}>
            <AnimatedPressable
              style={styles.tradeBtn}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Trade', { assetId: item.id, side: 'buy' })}
            >
              <Text style={styles.tradeBtnText}>Buy</Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={[styles.tradeBtn, styles.tradeBtnOutline]}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('Trade', { assetId: item.id, side: 'sell' })}
            >
              <Text style={styles.tradeBtnOutlineText}>Sell</Text>
            </AnimatedPressable>
          </View>
        </View>
        </AnimatedPressable>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <FlatList
        data={filteredAssets}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <View style={styles.headerNavRow}>
              <AnimatedPressable style={styles.backBtn} activeOpacity={0.84} onPress={handleBack}>
                <Ionicons name="chevron-back" size={16} color={Colors.textPrimary} />
                <Text style={styles.backBtnText}>Back</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={styles.backBtn}
                activeOpacity={0.84}
                onPress={() => navigation.navigate('MarketLedger')}
              >
                <Ionicons name="pulse-outline" size={15} color={Colors.textPrimary} />
                <Text style={styles.backBtnText}>Activity</Text>
              </AnimatedPressable>
            </View>

            <Text style={styles.headerLabel}>CO-OWN MARKET</Text>
            <Text style={styles.headerTitle}>Co-Own Hub</Text>

            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search assets or issuers"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.metricRow}>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{marketAssets.length}</Text>
                <Text style={styles.metricLabel}>Assets</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{formatFromFiat(totalOpenValue, 'GBP', { displayMode: 'fiat' })}</Text>
                <Text style={styles.metricLabel}>Open Value</Text>
              </View>
              <View style={styles.metricCard}>
                <Text style={styles.metricValue}>{formatFromFiat(totalMarketValue, 'GBP', { displayMode: 'fiat' })}</Text>
                <Text style={styles.metricLabel}>Market Value</Text>
              </View>
            </View>

            <View style={styles.actionRow}>
              <AnimatedPressable style={styles.quickBtn} onPress={() => navigation.navigate('Portfolio')}>
                <Ionicons name="pie-chart-outline" size={15} color={Colors.background} />
                <Text style={styles.quickBtnText}>Portfolio</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.quickBtn} onPress={() => navigation.navigate('CoOwnOrderHistory')}>
                <Ionicons name="time-outline" size={15} color={Colors.background} />
                <Text style={styles.quickBtnText}>Orders</Text>
              </AnimatedPressable>
              <AnimatedPressable style={styles.quickBtn} onPress={() => navigation.navigate('AssetLeaderboard')}>
                <Ionicons name="trophy-outline" size={15} color={Colors.background} />
                <Text style={styles.quickBtnText}>Leaders</Text>
              </AnimatedPressable>
            </View>

            <View style={styles.sortRow}>
              {(['value', 'movers', 'latest'] as HubSort[]).map((sortKey) => {
                const active = sortBy === sortKey;
                return (
                  <AnimatedPressable
                    key={sortKey}
                    style={[styles.sortChip, active && styles.sortChipActive]}
                    onPress={() => setSortBy(sortKey)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{sortKey.toUpperCase()}</Text>
                  </AnimatedPressable>
                );
              })}
            </View>

            <AnimatedPressable
              style={styles.issueBtn}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('CreateCoOwn')}
            >
              <Ionicons name="add" size={16} color={Colors.background} />
              <Text style={styles.issueBtnText}>Issue New Co-Own</Text>
            </AnimatedPressable>
          </View>
        }
        contentContainerStyle={styles.contentContainer}
        renderItem={renderAsset}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No assets found"
            subtitle="Try another search keyword or clear the query."
            ctaLabel="Clear"
            onCtaPress={() => setQuery('')}
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
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  headerBlock: {
    paddingTop: 8,
    paddingBottom: 14,
  },
  headerNavRow: {
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  backBtnText: {
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  headerLabel: {
    color: TRADE_ACCENT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 1,
  },
  headerTitle: {
    marginTop: 4,
    color: Colors.textPrimary,
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.7,
  },
  headerSubtitle: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 19,
  },
  searchWrap: {
    marginTop: 14,
    borderRadius: 14,
    backgroundColor: SEARCH_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    paddingVertical: 0,
  },
  metricRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  metricCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: METRIC_BORDER,
    backgroundColor: METRIC_BG,
    paddingVertical: 10,
    paddingHorizontal: 9,
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  metricLabel: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
  },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  quickBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: Colors.accentGold,
    paddingVertical: 9,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  quickBtnText: {
    color: Colors.background,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  sortRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  sortChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  sortChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: SORT_ACTIVE_BG,
  },
  sortChipText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  sortChipTextActive: {
    color: TRADE_ACCENT,
  },
  issueBtn: {
    marginTop: 12,
    borderRadius: 11,
    paddingVertical: 11,
    backgroundColor: '#f0f0e8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  issueBtnText: {
    color: Colors.background,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  assetCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    overflow: 'hidden',
  },
  assetImage: {
    width: '100%',
    height: 180,
    backgroundColor: Colors.surface,
  },
  assetBody: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  assetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  assetTitle: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  movePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  movePillUp: {
    borderColor: UP_PILL_BORDER,
    backgroundColor: UP_PILL_BG,
  },
  movePillDown: {
    borderColor: DOWN_PILL_BORDER,
    backgroundColor: DOWN_PILL_BG,
  },
  moveText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  moveTextUp: {
    color: UP_TEXT_COLOR,
  },
  moveTextDown: {
    color: DOWN_TEXT_COLOR,
  },
  assetMeta: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  assetStatsRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  assetStatLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  assetStatValue: {
    marginTop: 2,
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  assetActionRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  tradeBtn: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: Colors.accentGold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  tradeBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  tradeBtnOutline: {
    backgroundColor: OUTLINE_BTN_BG,
    borderWidth: 1,
    borderColor: OUTLINE_BTN_BORDER,
  },
  tradeBtnOutlineText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
});

