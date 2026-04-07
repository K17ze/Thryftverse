import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  ScrollView
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
import { useCurrencyContext } from '../context/CurrencyContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useToast } from '../context/ToastContext';
import { formatIzeAmount, toIze } from '../utils/currency';
import {
  buildTradeQuote,
  evaluateTradeSubmit,
  isTradeSubmitEnabled,
  sanitizeTradePriceInput,
  sanitizeTradeQuantityInput,
  SYNDICATE_FEE_RATE,
  TradeSide,
} from '../utils/tradeFlow';
import { parseApiError } from '../lib/apiClient';
import { placeSyndicateOrder } from '../services/marketApi';

type NavT = StackNavigationProp<RootStackParamList>;
type RouteT = RouteProp<RootStackParamList, 'Trade'>;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2f2f2f';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#2f291f';
const PANEL_TINT_BORDER = IS_LIGHT ? '#d0c3af' : '#4f4638';
const ALERT_BG = IS_LIGHT ? '#f4e0e0' : '#221515';
const ALERT_BORDER = IS_LIGHT ? '#d9b5b5' : '#4a2d2d';

const COMPLIANCE_BLOCK_CODES = new Set([
  'RISK_DISCLOSURE_REQUIRED',
  'KYC_REQUIRED',
  'KYC_LEVEL_INSUFFICIENT',
  'JURISDICTION_BLOCKED',
  'JURISDICTION_RULE_MISSING',
  'SANCTIONS_BLOCKED',
  'SANCTIONS_REVIEW_REQUIRED',
  'TRADING_DISABLED',
  'MAX_ORDER_NOTIONAL_EXCEEDED',
  'MAX_DAILY_NOTIONAL_EXCEEDED',
  'MAX_OPEN_ORDERS_EXCEEDED',
  'AML_BLOCKED',
]);

function isComplianceBlocked(code: string | null) {
  return !!code && COMPLIANCE_BLOCK_CODES.has(code);
}

export default function TradeScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { show } = useToast();

  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const currentUser = useStore((state) => state.currentUser);
  const checkSyndicateEligibility = useStore((state) => state.checkSyndicateEligibility);
  const { goldRates } = useCurrencyContext();

  const { formatFromIze } = useFormattedPrice();

  const [side, setSide] = React.useState<TradeSide>(route.params.side);
  const [quantityInput, setQuantityInput] = React.useState('1');
  const [offerPriceInput, setOfferPriceInput] = React.useState('');
  const [isSubmittingOrder, setIsSubmittingOrder] = React.useState(false);

  const baseAssets = React.useMemo(() => getSyndicateMarket(customSyndicates), [customSyndicates]);
  const marketAssets = React.useMemo(
    () => baseAssets.map((asset) => resolveAssetMarketState(asset, syndicateRuntime[asset.id])),
    [baseAssets, syndicateRuntime]
  );

  const asset = marketAssets.find((item) => item.id === route.params.assetId);
  const marketPrice = asset ? toIze(asset.unitPriceGBP, 'GBP', goldRates) : 0;
  const orderMode = offerPriceInput.trim().length > 0 ? 'limit' : 'market';

  const quote = React.useMemo(
    () => buildTradeQuote({
      orderMode,
      side,
      quantityInput,
      limitPriceInput: offerPriceInput,
      marketPrice,
    }),
    [marketPrice, offerPriceInput, orderMode, quantityInput, side]
  );

  const eligibility = asset ? checkSyndicateEligibility(asset.settlementMode) : { ok: false, message: 'Asset not found' };

  const canSubmit = isTradeSubmitEnabled({
    assetFound: !!asset,
    eligibility,
    quote,
  });

  const handleSubmit = async () => {
    if (isSubmittingOrder) {
      return;
    }

    const decision = evaluateTradeSubmit({
      orderMode,
      side,
      quantityInput,
      limitPriceInput: offerPriceInput,
      marketPrice,
      assetFound: !!asset,
      eligibility,
      maxSellUnits: asset?.yourUnits ?? 0,
    });

    if (!decision.ok) {
      show(decision.message, 'error');
      return;
    }

    const expectedQueue = decision.kind === 'queue';

    if (!asset) {
      show('Asset not found', 'error');
      return;
    }

    setIsSubmittingOrder(true);

    try {
      const actingUserId = currentUser?.id ?? 'u1';
      let remoteOrder: Awaited<ReturnType<typeof placeSyndicateOrder>> | null = null;

      try {
        remoteOrder = await placeSyndicateOrder(asset.id, {
          userId: actingUserId,
          side,
          units: quote.quantity,
          orderType: orderMode,
          limitPriceGbp: orderMode === 'limit' && quote.hasLimitPrice ? quote.limitPrice : undefined,
        });
      } catch (error) {
        const parsedError = parseApiError(error, 'Unable to submit order');
        if (!parsedError.isNetworkError) {
          if (isComplianceBlocked(parsedError.code)) {
            show(parsedError.message, 'error');
            return;
          }

          show(parsedError.message, parsedError.status && parsedError.status >= 500 ? 'error' : 'info');
          return;
        }

        show('Trading engine unavailable. Please retry once connection is restored.', 'error');
        return;
      }

      if (remoteOrder) {
        if (remoteOrder.order.status === 'rejected') {
          show('Order rejected by matching engine.', 'error');
          return;
        }

        if (remoteOrder.order.status === 'open' || remoteOrder.order.status === 'partially_filled' || expectedQueue) {
          show('Offer placed on the server order book.', 'info');
        } else {
          show('Order executed on SYNDICATE engine.', 'success');
        }

        if (remoteOrder.aml?.alertId) {
          show('Trade is flagged for AML review.', 'info');
        }

        navigation.goBack();
        return;
      }

      show(expectedQueue ? decision.message : 'Unable to submit order', 'error');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  if (!asset) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
        <View style={styles.header}>
          <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
          </AnimatedPressable>
          <Text style={styles.headerTitle}>Trade</Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyText}>Asset not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Trade {asset.id.toUpperCase()}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.assetTitle}>{asset.title}</Text>
        <Text style={styles.assetMeta}>
          Market {formatIzeAmount(marketPrice)} · {formatFromIze(marketPrice, { displayMode: 'fiat' })} · {asset.availableUnits} available
        </Text>

        <View style={styles.pegCard}>
          <Ionicons name="sparkles-outline" size={14} color={BRAND} />
          <Text style={styles.pegCardText}>
            Syndicate trades settle in 1ze only. 1 1ze = 1 gram of gold. Current local value is {formatFromIze(1, { displayMode: 'fiat' })}.
          </Text>
        </View>

        <View style={styles.segmentRow}>
          {(['buy', 'sell'] as TradeSide[]).map((value) => {
            const active = side === value;
            return (
              <AnimatedPressable
                key={value}
                style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                onPress={() => setSide(value)}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{value.toUpperCase()}</Text>
              </AnimatedPressable>
            );
          })}
        </View>

        {!eligibility.ok && (
          <View style={styles.alertCard}>
            <Ionicons name="alert-circle-outline" size={16} color={Colors.danger} />
            <Text style={styles.alertText}>{eligibility.message}</Text>
          </View>
        )}

        <Text style={styles.label}>Quantity</Text>
        <TextInput
          style={styles.input}
          value={quantityInput}
          onChangeText={(value) => setQuantityInput(sanitizeTradeQuantityInput(value))}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={Colors.textMuted}
        />

        <Text style={styles.label}>Offer price to owners (1ze, optional)</Text>
        <TextInput
          style={styles.input}
          value={offerPriceInput}
          onChangeText={(value) => setOfferPriceInput(sanitizeTradePriceInput(value))}
          keyboardType="decimal-pad"
          placeholder={marketPrice.toFixed(6)}
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.offerHint}>
          Leave blank for instant market execution. Set a lower buy or higher sell offer to send it to owners.
        </Text>

        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Execution price</Text>
            <Text style={styles.summaryValue}>{formatIzeAmount(quote.executionPrice)}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Gross</Text>
            <Text style={styles.summaryValue}>{formatIzeAmount(quote.grossValue)} · {formatFromIze(quote.grossValue, { displayMode: 'fiat' })}</Text>
          </View>
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Fee ({(SYNDICATE_FEE_RATE * 100).toFixed(0)}%)</Text>
            <Text style={styles.summaryValue}>{formatIzeAmount(quote.fee)} · {formatFromIze(quote.fee, { displayMode: 'fiat' })}</Text>
          </View>
          <View style={[styles.summaryRow, styles.summaryRowTotal]}>
            <Text style={styles.summaryTotalLabel}>{side === 'buy' ? 'Total Cost' : 'Net Receive'}</Text>
            <Text style={styles.summaryTotalValue}>{formatIzeAmount(quote.netValue)} · {formatFromIze(quote.netValue, { displayMode: 'fiat' })}</Text>
          </View>
        </View>

        <AnimatedPressable
          style={[styles.submitBtn, (!canSubmit || isSubmittingOrder) && styles.submitBtnDisabled]}
          disabled={!canSubmit || isSubmittingOrder}
          onPress={() => void handleSubmit()}
          activeOpacity={0.9}
        >
          <Text style={styles.submitText}>
            {isSubmittingOrder ? 'Submitting...' : orderMode === 'limit' ? 'Send Offer To Owners' : `Execute ${side.toUpperCase()}`}
          </Text>
        </AnimatedPressable>
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
    paddingBottom: 24,
  },
  assetTitle: {
    color: Colors.textPrimary,
    fontSize: 23,
    fontFamily: 'Inter_700Bold',
  },
  assetMeta: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  pegCard: {
    marginTop: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  pegCardText: {
    flex: 1,
    color: BRAND,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'Inter_600SemiBold',
  },
  segmentRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  segmentBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
  },
  segmentBtnActive: {
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
  },
  segmentText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  segmentTextActive: {
    color: BRAND,
  },
  alertCard: {
    marginTop: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: ALERT_BORDER,
    backgroundColor: ALERT_BG,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertText: {
    flex: 1,
    color: Colors.danger,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  label: {
    marginTop: 13,
    marginBottom: 6,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  offerHint: {
    marginTop: 7,
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: 'Inter_500Medium',
  },
  summaryCard: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  summaryValue: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    textAlign: 'right',
    maxWidth: '62%',
  },
  summaryRowTotal: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    paddingTop: 10,
  },
  summaryTotalLabel: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  summaryTotalValue: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    textAlign: 'right',
    maxWidth: '62%',
  },
  submitBtn: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: Colors.accentGold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  submitBtnDisabled: {
    opacity: 0.45,
  },
  submitText: {
    color: Colors.textInverse,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
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
