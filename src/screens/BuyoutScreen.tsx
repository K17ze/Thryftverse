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
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { getSyndicateMarket } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useToast } from '../context/ToastContext';
import { parseApiError } from '../lib/apiClient';
import { createSyndicateBuyoutOffer } from '../services/marketApi';

type RouteT = RouteProp<RootStackParamList, 'Buyout'>;
type NavT = StackNavigationProp<RootStackParamList>;
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#121212';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';

export default function BuyoutScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { show } = useToast();
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const currentUser = useStore((state) => state.currentUser);
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
        <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
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

  const handleBuyout = async () => {
    if (isSubmitting) {
      return;
    }

    if (sharesNeeded <= 0) {
      show('You already control 100% of this asset pool.', 'success');
      navigation.navigate('AssetDetail', { assetId: asset.id });
      return;
    }

    setIsSubmitting(true);

    try {
      const bidderUserId = currentUser?.id ?? 'u1';
      const response = await createSyndicateBuyoutOffer(asset.id, {
        bidderUserId,
        offerPriceGbp: offerPricePerShare,
        targetUnits: sharesNeeded,
        expiresInHours: 24,
        metadata: {
          source: 'buyout_screen',
        },
      });

      show('Buyout offer submitted. Track progress in order history.', 'success');

      if (response.aml?.alertId) {
        show('Buyout offer is flagged for AML review.', 'info');
      }

      navigation.navigate('SyndicateOrderHistory');
    } catch (error) {
      const parsedError = parseApiError(error, 'Unable to submit buyout offer');
      if (parsedError.isNetworkError) {
        show('Network unavailable. Could not submit buyout offer.', 'error');
      } else {
        show(parsedError.message, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

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

        <AnimatedPressable
          style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]}
          onPress={handleBuyout}
          activeOpacity={0.9}
          disabled={isSubmitting}
        >
          <Ionicons name="diamond-outline" size={16} color={Colors.background} />
          <Text style={styles.submitText}>
            {isSubmitting ? 'Submitting...' : sharesNeeded > 0 ? 'Initiate Buyout' : 'Claim Full Ownership'}
          </Text>
        </AnimatedPressable>

        <Text style={styles.footNote}>
          Buyout requests are routed to the order ledger so you can monitor acceptance and settlement status.
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
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
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
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
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
    borderTopColor: PANEL_BORDER,
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
    fontFamily: 'Inter_700Bold',
  },
  submitBtn: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: Colors.accentGold,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  submitBtnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    color: Colors.textInverse,
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
