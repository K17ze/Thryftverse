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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { getSyndicateMarket } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useToast } from '../context/ToastContext';

type RouteT = RouteProp<RootStackParamList, 'Buyout'>;
type NavT = StackNavigationProp<RootStackParamList>;

export default function BuyoutScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { show } = useToast();

  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const { formatFromFiat } = useFormattedPrice();

  const baseAssets = React.useMemo(() => getSyndicateMarket(customSyndicates), [customSyndicates]);

  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, syndicateRuntime[asset.id])),
    [baseAssets, syndicateRuntime]
  );

  const asset = marketAssets.find((item) => item.id === route.params.assetId);

  if (!asset) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
        <View style={styles.header}>
          <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </AnimatedPressable>
          <Text style={styles.headerTitle}>Buyout</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Asset not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sharesOwned = asset.yourUnits;
  const sharesNeeded = Math.max(0, asset.totalUnits - sharesOwned);
  const ownershipPct = asset.totalUnits > 0 ? (sharesOwned / asset.totalUnits) * 100 : 0;
  const offerPricePerShare = Number((asset.unitPriceGBP * 1.08).toFixed(2));
  const totalCost = sharesNeeded * offerPricePerShare;

  const handleBuyout = () => {
    if (sharesNeeded <= 0) {
      show('You already control 100% of this asset pool.', 'success');
      navigation.goBack();
      return;
    }

    show('Buyout intent submitted (prototype)', 'success');
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Buyout</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.content}>
        <Image source={{ uri: asset.image }} style={styles.image} />
        <Text style={styles.title}>{asset.title}</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.label}>Owned shares</Text>
            <Text style={styles.value}>{sharesOwned} / {asset.totalUnits}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Ownership</Text>
            <Text style={styles.value}>{ownershipPct.toFixed(2)}%</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Remaining shares</Text>
            <Text style={styles.value}>{sharesNeeded}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Buyout offer/share</Text>
            <Text style={styles.value}>{formatFromFiat(offerPricePerShare, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Estimated buyout total</Text>
            <Text style={styles.totalValue}>{formatFromFiat(totalCost, 'GBP')}</Text>
          </View>
        </View>

        <AnimatedPressable style={styles.submitBtn} onPress={handleBuyout} activeOpacity={0.9}>
          <Ionicons name="diamond-outline" size={16} color={Colors.background} />
          <Text style={styles.submitText}>{sharesNeeded > 0 ? 'Initiate Buyout' : 'Claim Full Ownership'}</Text>
        </AnimatedPressable>

        <Text style={styles.footNote}>
          Buyout execution, custody transfer, and shipping workflows are represented as a prototype interaction in this build.
        </Text>
      </View>
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
  content: {
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  image: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    backgroundColor: Colors.surface,
  },
  title: {
    marginTop: 10,
    color: Colors.textPrimary,
    fontSize: 21,
    fontFamily: 'Inter_700Bold',
  },
  card: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 7,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  value: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: '#252525',
    marginTop: 4,
    paddingTop: 10,
  },
  totalLabel: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  totalValue: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_800ExtraBold',
  },
  submitBtn: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  submitText: {
    color: Colors.background,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  footNote: {
    marginTop: 11,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    lineHeight: 17,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
  },
});
