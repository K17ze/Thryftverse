import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { getSyndicateMarket, SyndicateAsset } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type NavT = StackNavigationProp<RootStackParamList>;
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const CONTROL_BG = IS_LIGHT ? '#f7f4ef' : '#121212';

export default function AssetLeaderboardScreen() {
  const navigation = useNavigation<NavT>();
  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const { formatFromFiat } = useFormattedPrice();

  const baseAssets = React.useMemo(() => getSyndicateMarket(customSyndicates), [customSyndicates]);

  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, syndicateRuntime[asset.id])),
    [baseAssets, syndicateRuntime]
  );

  const topMovers = React.useMemo(() => [...marketAssets].sort((a, b) => b.marketMovePct24h - a.marketMovePct24h).slice(0, 5), [marketAssets]);
  const topMarketValue = React.useMemo(
    () => [...marketAssets].sort((a, b) => b.totalUnits * b.unitPriceGBP - a.totalUnits * a.unitPriceGBP).slice(0, 5),
    [marketAssets]
  );
  const topHolders = React.useMemo(() => [...marketAssets].sort((a, b) => b.holders - a.holders).slice(0, 5), [marketAssets]);

  const renderList = (title: string, icon: keyof typeof Ionicons.glyphMap, data: SyndicateAsset[], metric: (asset: SyndicateAsset) => string) => (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Ionicons name={icon} size={16} color="#d7b98f" />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>

      {data.map((asset, idx) => (
        <Reanimated.View
          key={`${title}_${asset.id}`}
          entering={FadeInDown.duration(320).delay(Math.min(idx, 5) * 36)}
        >
          <AnimatedPressable
            style={styles.row}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('AssetDetail', { assetId: asset.id })}
          >
            <Text style={styles.rank}>{idx + 1}</Text>
            <Image source={{ uri: asset.image }} style={styles.thumb} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle} numberOfLines={1}>{asset.title}</Text>
              <Text style={styles.rowSub}>{formatFromFiat(asset.unitPriceGBP, 'GBP')}</Text>
            </View>
            <Text style={styles.metric}>{metric(asset)}</Text>
          </AnimatedPressable>
        </Reanimated.View>
      ))}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Asset Leaderboard</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {renderList('Top Movers', 'trending-up-outline', topMovers, (asset) => `${asset.marketMovePct24h >= 0 ? '+' : ''}${asset.marketMovePct24h.toFixed(1)}%`)}
        {renderList('Top Market Value', 'pulse-outline', topMarketValue, (asset) => formatFromFiat(asset.totalUnits * asset.unitPriceGBP, 'GBP', { displayMode: 'fiat' }))}
        {renderList('Most Held', 'people-outline', topHolders, (asset) => `${asset.holders} holders`)}
      </ScrollView>
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
    backgroundColor: CONTROL_BG,
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
    paddingBottom: 22,
    gap: 10,
  },
  sectionCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 7,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    gap: 9,
  },
  rank: {
    width: 18,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  thumb: {
    width: 34,
    height: 34,
    borderRadius: 9,
  },
  rowBody: {
    flex: 1,
  },
  rowTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  rowSub: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  metric: {
    color: '#d7b98f',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
});

