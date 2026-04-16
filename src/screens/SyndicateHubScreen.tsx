import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Image,
  StatusBar
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
import { EmptyState } from '../components/EmptyState';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { AppButton } from '../components/ui/AppButton';
import { AppStatusPill } from '../components/ui/AppStatusPill';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';

type NavT = StackNavigationProp<RootStackParamList>;

type HubSort = 'value' | 'movers' | 'latest';
const SORT_OPTIONS: Array<{ value: HubSort; label: string; accessibilityLabel: string }> = [
  { value: 'value', label: 'VALUE', accessibilityLabel: 'Sort by market value' },
  { value: 'movers', label: 'MOVERS', accessibilityLabel: 'Sort by price movers' },
  { value: 'latest', label: 'LATEST', accessibilityLabel: 'Sort by latest listings' },
];
const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;
const SEARCH_BG = Colors.cardAlt;
const METRIC_BG = IS_LIGHT ? '#f0ede7' : '#10161c';
const METRIC_BORDER = IS_LIGHT ? '#d7d1c8' : '#24313b';
const SORT_ACTIVE_BG = IS_LIGHT ? '#ede4d3' : '#17302b';

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
            <AppStatusPill
              tone={isPositive ? 'positive' : 'negative'}
              iconName={isPositive ? 'trending-up-outline' : 'trending-down-outline'}
              label={`${isPositive ? '+' : ''}${item.marketMovePct24h.toFixed(1)}%`}
            />
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
            <AppButton
              style={styles.tradeBtn}
              variant="gold"
              size="sm"
              align="center"
              title="Buy"
              onPress={() => navigation.navigate('Trade', { assetId: item.id, side: 'buy' })}
              accessibilityLabel={`Buy shares of ${item.title}`}
            />

            <AppButton
              style={[styles.tradeBtn, styles.tradeBtnOutline]}
              variant="secondary"
              size="sm"
              align="center"
              title="Sell"
              onPress={() => navigation.navigate('Trade', { assetId: item.id, side: 'sell' })}
              accessibilityLabel={`Sell shares of ${item.title}`}
            />
          </View>
        </View>
        </AnimatedPressable>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <FlashList
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
              <AppButton
                style={styles.quickBtn}
                variant="gold"
                size="sm"
                align="center"
                icon={<Ionicons name="pie-chart-outline" size={15} color={Colors.textInverse} />}
                title="Portfolio"
                onPress={() => navigation.navigate('Portfolio')}
                accessibilityLabel="Open co-own portfolio"
              />
              <AppButton
                style={styles.quickBtn}
                variant="gold"
                size="sm"
                align="center"
                icon={<Ionicons name="time-outline" size={15} color={Colors.textInverse} />}
                title="Orders"
                onPress={() => navigation.navigate('CoOwnOrderHistory')}
                accessibilityLabel="Open co-own order history"
              />
              <AppButton
                style={styles.quickBtn}
                variant="gold"
                size="sm"
                align="center"
                icon={<Ionicons name="trophy-outline" size={15} color={Colors.textInverse} />}
                title="Leaders"
                onPress={() => navigation.navigate('AssetLeaderboard')}
                accessibilityLabel="Open asset leaderboard"
              />
            </View>

            <AppSegmentControl
              style={styles.sortRow}
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={setSortBy}
              optionStyle={styles.sortChip}
              optionActiveStyle={styles.sortChipActive}
              optionTextStyle={styles.sortChipText}
              optionTextActiveStyle={styles.sortChipTextActive}
            />

            <AppButton
              style={styles.issueBtn}
              variant="secondary"
              size="sm"
              align="center"
              icon={<Ionicons name="add" size={16} color={Colors.textPrimary} />}
              title="Issue New Co-Own"
              onPress={() => navigation.navigate('CreateCoOwn')}
              accessibilityLabel="Issue new co-own asset"
            />
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
  },
  tradeBtnOutline: {
    backgroundColor: 'transparent',
  },
});

