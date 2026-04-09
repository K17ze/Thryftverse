import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  TextInput
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { RootStackParamList } from '../navigation/types';
import {
  formatMoney,
  getCoOwnMarket,
  getUserLabel,
  CoOwnAsset,
} from '../data/tradeHub';
import { useToast } from '../context/ToastContext';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store/useStore';
import { useCurrencyContext } from '../context/CurrencyContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { formatIzeAmount, toIze } from '../utils/currency';
import { parseApiError } from '../lib/apiClient';
import { listCoOwnAssets, placeCoOwnOrder } from '../services/marketApi';

type NavT = StackNavigationProp<RootStackParamList>;
type CoOwnView = 'ISSUED' | 'HOLDINGS';

const STABLE_COIN = '1ze';
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = Colors.accentGold;
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_MUTED_BG = IS_LIGHT ? '#f1ede6' : '#151515';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2f2f2f';
const PANEL_BORDER_STRONG = IS_LIGHT ? '#cec5b8' : '#3a342b';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#2f291f';
const PANEL_TINT_BORDER = IS_LIGHT ? '#d0c3af' : '#4f4638';
const POSITIVE_BG = IS_LIGHT ? '#ece4d8' : '#14302a';
const NEGATIVE_BG = IS_LIGHT ? '#f3dddd' : '#301919';
const CO_OWN_MAX_UNITS = 20;

const COUNTRY_OPTIONS = [
  { code: 'GB', label: 'United Kingdom' },
  { code: 'EU', label: 'European Union' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'UAE' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
] as const;

const settlementLabelMap: Record<'GBP' | 'TVUSD' | 'HYBRID', string> = {
  GBP: '1ze settlement',
  TVUSD: '1ze settlement',
  HYBRID: '1ze settlement',
};

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

function shouldOpenComplianceModal(errorMessage: string, errorCode: string | null) {
  if (errorCode && COMPLIANCE_BLOCK_CODES.has(errorCode)) {
    return true;
  }

  const normalized = errorMessage.toLowerCase();
  return [
    'kyc',
    'jurisdiction',
    'country',
    'sanction',
    'aml',
    'risk',
    'compliance',
    'trading disabled',
  ].some((token) => normalized.includes(token));
}

type ComposerMode = 'buy' | 'sell';

function formatSigned(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}

export default function CoOwnScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { goldRates } = useCurrencyContext();
  const { formatFromFiat, formatFromIze } = useFormattedPrice();
  const currentUser = useStore((state) => state.currentUser);
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  const coOwnCompliance = useStore((state) => state.coOwnCompliance);
  const updateCoOwnCompliance = useStore((state) => state.updateCoOwnCompliance);
  const checkCoOwnEligibility = useStore((state) => state.checkCoOwnEligibility);

  const actingUserId = currentUser?.id ?? 'u1';

  const [refreshing, setRefreshing] = React.useState(false);
  const [activeView, setActiveView] = React.useState<CoOwnView>('ISSUED');
  const [unitsComposerVisible, setUnitsComposerVisible] = React.useState(false);
  const [complianceModalVisible, setComplianceModalVisible] = React.useState(false);
  const [composerMode, setComposerMode] = React.useState<ComposerMode>('buy');
  const [selectedAsset, setSelectedAsset] = React.useState<CoOwnAsset | null>(null);
  const [unitsInput, setUnitsInput] = React.useState('1');
  const [remoteAssets, setRemoteAssets] = React.useState<CoOwnAsset[]>([]);
  const [isSyncingAssets, setIsSyncingAssets] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = React.useState(false);

  const syncCoOwnAssets = React.useCallback(async () => {
    setIsSyncingAssets(true);
    try {
      const items = await listCoOwnAssets({ limit: 120, issuerId: actingUserId });
      const mapped: CoOwnAsset[] = items.map((item) => ({
        id: item.id,
        listingId: item.listingId,
        issuerId: item.issuerId,
        title: item.title,
        image: item.imageUrl ?? `https://picsum.photos/seed/${item.id}/500/700`,
        totalUnits: item.totalUnits,
        availableUnits: item.availableUnits,
        unitPriceGBP: item.unitPriceGbp,
        unitPriceStable: item.unitPriceStable,
        settlementMode: item.settlementMode,
        issuerJurisdiction: item.issuerJurisdiction ?? undefined,
        marketMovePct24h: item.marketMovePct24h,
        holders: item.holders,
        volume24hGBP: item.volume24hGbp,
        yourUnits: 0,
        isOpen: item.isOpen,
      }));

      setRemoteAssets(mapped);
      setSyncError(null);
    } catch (error) {
      setSyncError((error as Error).message || 'Unable to sync co-own pools');
      // Keep existing local market state when backend sync is unavailable.
    } finally {
      setIsSyncingAssets(false);
    }
  }, [actingUserId]);

  React.useEffect(() => {
    void syncCoOwnAssets();
  }, [syncCoOwnAssets]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await syncCoOwnAssets();
    setRefreshing(false);
  };

  const mergedAssets = React.useMemo(() => {
    const merged = new Map<string, CoOwnAsset>();

    for (const item of remoteAssets) {
      merged.set(item.id, item);
    }

    for (const item of customCoOwns) {
      if (item.issuerId !== actingUserId) {
        continue;
      }
      merged.set(item.id, item);
    }

    return [...merged.values()];
  }, [actingUserId, customCoOwns, remoteAssets]);

  const baseAssets = React.useMemo(() => getCoOwnMarket(mergedAssets), [mergedAssets]);

  const marketAssets = React.useMemo(
    () =>
      baseAssets.map((asset) => {
        const runtime = coOwnRuntime[asset.id];
        if (!runtime) {
          return asset;
        }

        return {
          ...asset,
          availableUnits: runtime.availableUnits,
          holders: runtime.holders,
          volume24hGBP: runtime.volume24hGBP,
          yourUnits: runtime.yourUnits,
          unitPriceGBP: runtime.unitPriceGBP,
          unitPriceStable: runtime.unitPriceStable,
          marketMovePct24h: runtime.marketMovePct24h,
          avgEntryPriceGBP: runtime.avgEntryPriceGBP,
          realizedProfitGBP: runtime.realizedProfitGBP,
        };
      }),
    [baseAssets, coOwnRuntime]
  );

  const visibleAssets = React.useMemo(() => {
    if (activeView === 'HOLDINGS') {
      return marketAssets.filter((asset) => asset.yourUnits > 0);
    }

    return marketAssets;
  }, [activeView, marketAssets]);

  const totalMarketValue = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + asset.totalUnits * asset.unitPriceGBP, 0),
    [marketAssets]
  );

  const holdingsValue = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + asset.yourUnits * asset.unitPriceGBP, 0),
    [marketAssets]
  );

  const unrealizedPnl = React.useMemo(
    () =>
      marketAssets.reduce((sum, asset) => {
        if (asset.yourUnits <= 0) {
          return sum;
        }

        const avgEntry = asset.avgEntryPriceGBP ?? asset.unitPriceGBP;
        return sum + (asset.unitPriceGBP - avgEntry) * asset.yourUnits;
      }, 0),
    [marketAssets]
  );

  const realizedPnl = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + (asset.realizedProfitGBP ?? 0), 0),
    [marketAssets]
  );

  const marketEligibility = checkCoOwnEligibility('HYBRID');

  const poolStatus = React.useMemo(() => {
    if (isSyncingAssets) {
      return {
        tone: 'syncing' as const,
        label: 'Syncing',
      };
    }

    if (syncError) {
      return {
        tone: 'offline' as const,
        label: 'Reconnecting',
      };
    }

    if (remoteAssets.length > 0) {
      return {
        tone: 'live' as const,
        label: 'Synced',
      };
    }

    if (marketAssets.length > 0) {
      return {
        tone: 'offline' as const,
        label: 'Local mode',
      };
    }

    return {
      tone: 'offline' as const,
      label: 'No pools',
    };
  }, [isSyncingAssets, marketAssets.length, remoteAssets.length, syncError]);

  const openUnitsComposer = (asset: CoOwnAsset, mode: ComposerMode) => {
    const eligibility = checkCoOwnEligibility(asset.settlementMode);
    if (!eligibility.ok) {
      show(eligibility.message ?? 'Compliance requirements are incomplete', 'error');
      setComplianceModalVisible(true);
      return;
    }

    setComposerMode(mode);
    setSelectedAsset(asset);
    if (mode === 'sell') {
      setUnitsInput(String(Math.max(1, Math.min(asset.yourUnits, 10))));
    } else {
      setUnitsInput('1');
    }
    setUnitsComposerVisible(true);
  };

  const closeUnitsComposer = () => {
    setUnitsComposerVisible(false);
    setSelectedAsset(null);
    setComposerMode('buy');
    setUnitsInput('1');
  };

  const submitUnitsOrder = async () => {
    if (!selectedAsset) {
      return;
    }

    if (isSubmittingOrder) {
      return;
    }

    const units = Math.floor(Number(unitsInput));
    if (!Number.isFinite(units) || units <= 0) {
      show('Units must be at least 1', 'error');
      return;
    }

    if (units > CO_OWN_MAX_UNITS) {
      show(`Units must be between 1 and ${CO_OWN_MAX_UNITS}`, 'error');
      return;
    }

    setIsSubmittingOrder(true);

    try {
      let remoteOrder: Awaited<ReturnType<typeof placeCoOwnOrder>> | null = null;

      try {
        remoteOrder = await placeCoOwnOrder(selectedAsset.id, {
          userId: actingUserId,
          side: composerMode,
          units,
        });

        await syncCoOwnAssets();
      } catch (error) {
        const parsedError = parseApiError(error, 'Unable to submit order');
        if (!parsedError.isNetworkError) {
          show(parsedError.message, 'error');
          if (shouldOpenComplianceModal(parsedError.message, parsedError.code)) {
            setComplianceModalVisible(true);
          }
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

        closeUnitsComposer();

        if (remoteOrder.order.status === 'open' || remoteOrder.order.status === 'partially_filled') {
          show('Order placed on server order book.', 'info');
        } else {
          show('Order executed on server market.', 'success');
        }

        if (remoteOrder.aml?.alertId) {
          show('Trade is flagged for AML review.', 'info');
        }

        return;
      }

      show('Unable to submit order', 'error');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const renderHeader = () => (
    <View>
      <View style={styles.heroHeader}>
        <Text style={styles.heroTitle}>My Co-Own</Text>
      </View>

      <View style={styles.heroQuickRow}>
        <AnimatedPressable
          style={styles.heroQuickChip}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('AssetLeaderboard')}
        >
          <Ionicons name="trophy-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.heroQuickText}>Leaderboard</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.heroQuickChip}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CoOwnOrderHistory')}
        >
          <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.heroQuickText}>Recent orders</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{marketAssets.length}</Text>
          <Text style={styles.metricLabel}>Issued Pools</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{formatFromFiat(totalMarketValue, 'GBP', { displayMode: 'fiat' })}</Text>
          <Text style={styles.metricLabel}>Issued Value</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{formatMoney(holdingsValue)}</Text>
          <Text style={styles.metricLabel}>Your Value</Text>
        </View>
      </View>

      <View style={styles.metricsPnlRow}>
        <View style={styles.metricCardWide}>
          <Text style={styles.metricWideLabel}>Unrealized P/L</Text>
          <Text style={[styles.metricWideValue, unrealizedPnl >= 0 ? styles.pnlUp : styles.pnlDown]}>
            {formatSigned(unrealizedPnl)}
          </Text>
        </View>
        <View style={styles.metricCardWide}>
          <Text style={styles.metricWideLabel}>Realized P/L</Text>
          <Text style={[styles.metricWideValue, realizedPnl >= 0 ? styles.pnlUp : styles.pnlDown]}>
            {formatSigned(realizedPnl)}
          </Text>
        </View>
      </View>

      <AnimatedPressable style={styles.complianceCard} activeOpacity={0.9} onPress={() => setComplianceModalVisible(true)}>
        <View style={styles.complianceTopRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color={BRAND} />
          <Text style={styles.complianceTitle}>Compliance</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
        <Text style={styles.complianceText}>
          Country {coOwnCompliance.countryCode} · KYC {coOwnCompliance.kycVerified ? 'on' : 'off'} ·
          Disclosure {coOwnCompliance.riskDisclosureAccepted ? 'accepted' : 'pending'}.
        </Text>
        {!marketEligibility.ok ? (
          <Text style={styles.complianceErrorText}>{marketEligibility.message}</Text>
        ) : (
          <Text style={styles.complianceOkText}>Eligible to trade co-owned assets.</Text>
        )}
      </AnimatedPressable>

      <View style={styles.issueRow}>
        <View>
          <Text style={styles.issueTitle}>Issuer Console</Text>
        </View>

        <AnimatedPressable
          style={styles.issueBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreateCoOwn')}
        >
          <Ionicons name="add" size={15} color={Colors.background} />
          <Text style={styles.issueBtnText}>Issue</Text>
        </AnimatedPressable>
      </View>

      {syncError ? (
        <SyncRetryBanner
          message="Co-Own pools are delayed. Showing local portfolio state."
          onRetry={() => void syncCoOwnAssets()}
          isRetrying={isSyncingAssets}
          telemetryContext="coOwn_market_sync"
          containerStyle={styles.syncBanner}
          actionStyle={styles.syncBannerBtn}
        />
      ) : null}

      <View style={styles.quickActionsRow}>
        <AnimatedPressable
          style={styles.quickActionChip}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('Portfolio')}
        >
          <Ionicons name="pie-chart-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.quickActionText}>Portfolio</Text>
        </AnimatedPressable>

        <AnimatedPressable
          style={styles.quickActionChip}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CoOwnOrderHistory')}
        >
          <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.quickActionText}>Orders</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.switcherWrap}>
        {(['ISSUED', 'HOLDINGS'] as const).map((view) => (
          <AnimatedPressable
            key={view}
            style={[styles.switcherBtn, activeView === view && styles.switcherBtnActive]}
            onPress={() => setActiveView(view)}
            activeOpacity={0.9}
          >
            <Text style={[styles.switcherText, activeView === view && styles.switcherTextActive]}>{view}</Text>
          </AnimatedPressable>
        ))}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{activeView === 'ISSUED' ? 'Your Issued Pools' : 'Your Holdings'}</Text>
        <SyncStatusPill tone={poolStatus.tone} label={poolStatus.label} compact />
      </View>

      <View style={styles.pegCard}>
        <Ionicons name="sparkles-outline" size={14} color={BRAND} />
        <Text style={styles.pegCardText}>
          1 {STABLE_COIN} = 1 gram of gold. Local value: {formatFromIze(1, { displayMode: 'fiat' })}.
        </Text>
      </View>
    </View>
  );

  const renderAssetCard = ({ item }: { item: CoOwnAsset }) => {
    const soldPct = ((item.totalUnits - item.availableUnits) / item.totalUnits) * 100;
    const moveIsPositive = item.marketMovePct24h >= 0;
    const isHoldingsMode = activeView === 'HOLDINGS';
    const avgEntry = item.avgEntryPriceGBP ?? item.unitPriceGBP;
    const unrealized = item.yourUnits > 0 ? (item.unitPriceGBP - avgEntry) * item.yourUnits : 0;
    const unitPriceIze = toIze(item.unitPriceGBP, 'GBP', goldRates);
    const eligibility = checkCoOwnEligibility(item.settlementMode);
    const primaryDisabled = isHoldingsMode
      ? item.yourUnits === 0
      : !item.isOpen || item.availableUnits === 0 || !eligibility.ok;

    return (
      <AnimatedPressable
        style={styles.assetCard}
        activeOpacity={0.94}
        onPress={() => navigation.navigate('AssetDetail', { assetId: item.id })}
      >
        <CachedImage uri={item.image} style={styles.assetImage} containerStyle={{ width: 54, height: 54, borderRadius: 14 }} contentFit="cover" />

        <View style={styles.assetBody}>
          <View style={styles.assetTopRow}>
            <Text style={styles.assetTitle} numberOfLines={1}>{item.title}</Text>
            <View style={[styles.movePill, moveIsPositive ? styles.movePillUp : styles.movePillDown]}>
              <Ionicons
                name={moveIsPositive ? 'trending-up-outline' : 'trending-down-outline'}
                size={12}
                color={moveIsPositive ? BRAND : '#ff9797'}
              />
              <Text style={[styles.moveText, moveIsPositive ? styles.moveTextUp : styles.moveTextDown]}>
                {moveIsPositive ? '+' : ''}{item.marketMovePct24h.toFixed(1)}%
              </Text>
            </View>
          </View>

          <Text style={styles.assetIssuer}>Issuer {getUserLabel(item.issuerId)}</Text>

          <View style={styles.assetBadgesRow}>
            <View style={styles.assetBadgePill}>
              <Text style={styles.assetBadgeText}>{settlementLabelMap[item.settlementMode]}</Text>
            </View>
            {item.issuerJurisdiction ? (
              <View style={styles.assetBadgePillMuted}>
                <Text style={styles.assetBadgeTextMuted}>{item.issuerJurisdiction}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.priceRow}>
            <Text style={styles.pricePrimary}>{formatIzeAmount(unitPriceIze)} / unit</Text>
            <Text style={styles.priceSecondary}>{formatFromFiat(item.unitPriceGBP, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(4, soldPct)}%` }]} />
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>{item.availableUnits} / {item.totalUnits} units left</Text>
            <Text style={styles.metaText}>{item.holders} holders</Text>
          </View>

          {item.yourUnits > 0 ? (
            <View style={styles.pnlRow}>
              <Text style={styles.metaText}>Entry {formatMoney(avgEntry)}</Text>
              <Text style={[styles.pnlValue, unrealized >= 0 ? styles.pnlUp : styles.pnlDown]}>
                Unrealized {formatSigned(unrealized)}
              </Text>
            </View>
          ) : null}

          <View style={styles.ctaRow}>
            <AnimatedPressable
              style={[styles.buyBtn, (primaryDisabled || isSubmittingOrder) && styles.buyBtnDisabled]}
              onPress={() => {
                if (isHoldingsMode) {
                  openUnitsComposer(item, 'sell');
                } else {
                  if (!item.isOpen || item.availableUnits === 0) {
                    show('Pool currently closed', 'error');
                    return;
                  }

                  if (!eligibility.ok) {
                    show(eligibility.message ?? 'Complete compliance checks to trade', 'error');
                    setComplianceModalVisible(true);
                    return;
                  }

                  openUnitsComposer(item, 'buy');
                }
              }}
              activeOpacity={0.9}
              disabled={primaryDisabled || isSubmittingOrder}
            >
              <Ionicons
                name={isHoldingsMode ? 'cash-outline' : 'wallet-outline'}
                size={13}
                color={!(primaryDisabled || isSubmittingOrder) ? Colors.background : Colors.textMuted}
              />
              <Text style={[styles.buyBtnText, (primaryDisabled || isSubmittingOrder) && styles.buyBtnTextDisabled]}>
                {isHoldingsMode ? 'Book Profit' : 'Buy Units'}
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={styles.detailsBtn}
              onPress={() => navigation.navigate('AssetDetail', { assetId: item.id })}
              activeOpacity={0.9}
            >
              <Text style={styles.detailsBtnText}>Asset</Text>
            </AnimatedPressable>
          </View>
        </View>
      </AnimatedPressable>
    );
  };

  const renderUnitsComposer = () => {
    if (!selectedAsset) {
      return null;
    }

    const unitsAsNumber = Number(unitsInput);
    const normalizedUnits = Number.isFinite(unitsAsNumber) && unitsAsNumber > 0 ? Math.floor(unitsAsNumber) : 0;
    const estimatedQuote = normalizedUnits > 0
      ? normalizedUnits * selectedAsset.unitPriceGBP
      : 0;
    const estimatedIze = toIze(estimatedQuote, 'GBP', goldRates);
    const estimatedRealized = composerMode === 'sell'
      ? normalizedUnits * (selectedAsset.unitPriceGBP - (selectedAsset.avgEntryPriceGBP ?? selectedAsset.unitPriceGBP))
      : 0;

    return (
      <Modal
        visible={unitsComposerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeUnitsComposer}
      >
        <View style={styles.unitsModalOverlay}>
          <AnimatedPressable style={styles.unitsModalDismissLayer} activeOpacity={1} onPress={closeUnitsComposer} />

          <View style={styles.unitsModalCard}>
            <Text style={styles.unitsModalLabel}>UNITS COMPOSER</Text>
            <Text style={styles.unitsModalTitle} numberOfLines={1}>{selectedAsset.title}</Text>
            <Text style={styles.unitsModalHint}>
              {composerMode === 'buy'
                ? `Available ${selectedAsset.availableUnits} units`
                : `Holdings ${selectedAsset.yourUnits} units`}
            </Text>

            <View style={styles.unitsInputWrap}>
              <Text style={styles.unitsInputPrefix}>Units</Text>
              <TextInput
                style={styles.unitsInput}
                value={unitsInput}
                onChangeText={(value) => {
                  const sanitized = value.replace(/\D/g, '');
                  if (!sanitized) {
                    setUnitsInput('');
                    return;
                  }

                  const parsed = Math.floor(Number(sanitized));
                  if (!Number.isFinite(parsed) || parsed <= 0) {
                    setUnitsInput('1');
                    return;
                  }

                  setUnitsInput(String(Math.min(CO_OWN_MAX_UNITS, parsed)));
                }}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.unitsQuickRow}>
              {[1, 5, 10, 20].map((units) => (
                <AnimatedPressable
                  key={units}
                  style={styles.unitsQuickChip}
                  onPress={() => setUnitsInput(String(units))}
                  activeOpacity={0.9}
                >
                  <Text style={styles.unitsQuickText}>{units}</Text>
                </AnimatedPressable>
              ))}
            </View>

            <Text style={styles.unitsSpendText}>
              {composerMode === 'buy' ? 'Estimated spend' : 'Estimated receive'} {formatIzeAmount(estimatedIze)}
            </Text>
            <Text style={styles.unitsSpendSubText}>Approx. {formatFromFiat(estimatedQuote, 'GBP', { displayMode: 'fiat' })}</Text>
            {composerMode === 'sell' ? (
              <Text style={[styles.unitsSpendSubText, estimatedRealized >= 0 ? styles.pnlUp : styles.pnlDown]}>
                Realized P/L preview {formatSigned(estimatedRealized)}
              </Text>
            ) : null}

            <View style={styles.unitsModalActions}>
              <AnimatedPressable
                style={styles.unitsCancelBtn}
                onPress={closeUnitsComposer}
                activeOpacity={0.9}
                disabled={isSubmittingOrder}
              >
                <Text style={styles.unitsCancelText}>Cancel</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.unitsSubmitBtn, isSubmittingOrder && styles.buyBtnDisabled]}
                onPress={() => void submitUnitsOrder()}
                activeOpacity={0.9}
                disabled={isSubmittingOrder}
              >
                <Text style={styles.unitsSubmitText}>
                  {isSubmittingOrder ? 'Submitting...' : composerMode === 'buy' ? 'Buy Units' : 'Sell Units'}
                </Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  const renderComplianceModal = () => (
    <Modal
      visible={complianceModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setComplianceModalVisible(false)}
    >
      <View style={styles.complianceModalOverlay}>
        <AnimatedPressable
          style={styles.complianceModalDismissLayer}
          activeOpacity={1}
          onPress={() => setComplianceModalVisible(false)}
        />

        <View style={styles.complianceModalCard}>
          <Text style={styles.complianceModalTitle}>Jurisdiction & KYC</Text>

          <Text style={styles.complianceFieldLabel}>Country</Text>
          <View style={styles.countryChipsWrap}>
            {COUNTRY_OPTIONS.map((country) => {
              const active = coOwnCompliance.countryCode === country.code;
              return (
                <AnimatedPressable
                  key={country.code}
                  style={[styles.countryChip, active && styles.countryChipActive]}
                  onPress={() => updateCoOwnCompliance({ countryCode: country.code })}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.countryChipText, active && styles.countryChipTextActive]}>{country.code}</Text>
                </AnimatedPressable>
              );
            })}
          </View>

          <View style={styles.complianceToggleRow}>
            <Text style={styles.complianceToggleText}>KYC verified</Text>
            <AnimatedPressable
              style={[styles.complianceToggleBtn, coOwnCompliance.kycVerified && styles.complianceToggleBtnActive]}
              onPress={() => updateCoOwnCompliance({ kycVerified: !coOwnCompliance.kycVerified })}
              activeOpacity={0.9}
            >
              <Text style={[styles.complianceToggleBtnText, coOwnCompliance.kycVerified && styles.complianceToggleBtnTextActive]}>
                {coOwnCompliance.kycVerified ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.complianceToggleRow}>
            <Text style={styles.complianceToggleText}>Risk disclosure accepted</Text>
            <AnimatedPressable
              style={[styles.complianceToggleBtn, coOwnCompliance.riskDisclosureAccepted && styles.complianceToggleBtnActive]}
              onPress={() =>
                updateCoOwnCompliance({ riskDisclosureAccepted: !coOwnCompliance.riskDisclosureAccepted })
              }
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.complianceToggleBtnText,
                  coOwnCompliance.riskDisclosureAccepted && styles.complianceToggleBtnTextActive,
                ]}
              >
                {coOwnCompliance.riskDisclosureAccepted ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.complianceToggleRow}>
            <Text style={styles.complianceToggleText}>{STABLE_COIN} wallet connected</Text>
            <AnimatedPressable
              style={[styles.complianceToggleBtn, coOwnCompliance.stableCoinWalletConnected && styles.complianceToggleBtnActive]}
              onPress={() =>
                updateCoOwnCompliance({ stableCoinWalletConnected: !coOwnCompliance.stableCoinWalletConnected })
              }
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.complianceToggleBtnText,
                  coOwnCompliance.stableCoinWalletConnected && styles.complianceToggleBtnTextActive,
                ]}
              >
                {coOwnCompliance.stableCoinWalletConnected ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={[styles.complianceStatusBanner, marketEligibility.ok ? styles.complianceStatusOk : styles.complianceStatusError]}>
            <Text style={[styles.complianceStatusText, marketEligibility.ok ? styles.complianceStatusTextOk : styles.complianceStatusTextError]}>
              {marketEligibility.ok ? 'Eligible for co-own trading' : marketEligibility.message}
            </Text>
          </View>

          <AnimatedPressable
            style={styles.complianceDoneBtn}
            onPress={() => setComplianceModalVisible(false)}
            activeOpacity={0.9}
          >
            <Text style={styles.complianceDoneBtnText}>Done</Text>
          </AnimatedPressable>
        </View>
      </View>
    </Modal>
  );

  const renderLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      {Array.from({ length: 3 }).map((_, index) => (
        <View key={`coOwn_loading_${index}`} style={styles.loadingCard}>
          <View style={styles.loadingCardHeader}>
            <SkeletonLoader width={54} height={54} borderRadius={14} />
            <View style={styles.loadingCardTitleCol}>
              <SkeletonLoader width="60%" height={15} borderRadius={7} />
              <SkeletonLoader width="35%" height={11} borderRadius={6} style={{ marginTop: 7 }} />
            </View>
          </View>

          <View style={styles.loadingCardBody}>
            <SkeletonLoader width="48%" height={13} borderRadius={7} />
            <SkeletonLoader width="100%" height={5} borderRadius={4} style={{ marginTop: 10 }} />
            <SkeletonLoader width="70%" height={11} borderRadius={6} style={{ marginTop: 10 }} />
            <View style={styles.loadingCtaRow}>
              <SkeletonLoader width="60%" height={34} borderRadius={12} />
              <SkeletonLoader width="35%" height={34} borderRadius={12} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );

  return (
    <>
      <FlatList
        data={visibleAssets}
        keyExtractor={(item) => item.id}
        renderItem={renderAssetCard}
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          isSyncingAssets ? (
            renderLoadingState()
          ) : (
            <EmptyState
              icon="pie-chart-outline"
              title={activeView === 'HOLDINGS' ? 'No holdings yet' : 'No issued pools yet'}
              ctaLabel={activeView === 'HOLDINGS' ? 'View Issued Pools' : 'Issue Co-Own'}
              onCtaPress={() =>
                activeView === 'HOLDINGS'
                  ? setActiveView('ISSUED')
                  : navigation.navigate('CreateCoOwn')
              }
            />
          )
        }
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={BRAND}
            colors={[BRAND]}
            progressBackgroundColor={PANEL_SOFT_BG}
          />
        }
      />
      {renderUnitsComposer()}
      {renderComplianceModal()}
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: 130,
  },
  heroQuickRow: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 8,
  },
  heroQuickChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingVertical: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  heroQuickText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  heroHeader: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  heroTitle: {
    fontSize: Typography.size.hero,
    lineHeight: 58,
    letterSpacing: -1.25,
    fontFamily: Typography.family.extrabold,
    color: Colors.textPrimary,
  },
  heroSubtitle: {
    marginTop: 2,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.28,
    textTransform: 'uppercase',
    fontFamily: Typography.family.light,
    color: Colors.textMuted,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  metricsPnlRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: PANEL_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  metricLabel: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  metricCardWide: {
    flex: 1,
    backgroundColor: PANEL_TINT_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  metricWideLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
  },
  metricWideValue: {
    marginTop: 4,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  pnlUp: {
    color: BRAND,
  },
  pnlDown: {
    color: '#ff9797',
  },
  complianceCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: PANEL_TINT_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  complianceTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  complianceTitle: {
    color: BRAND,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  complianceText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    lineHeight: 17,
  },
  complianceOkText: {
    marginTop: 6,
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  complianceErrorText: {
    marginTop: 6,
    color: '#ff9797',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  issueRow: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  issueTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  issueHint: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  issueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,
    backgroundColor: Colors.accentGold,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  issueBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  syncBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderColor: PANEL_BORDER,
    backgroundColor: IS_LIGHT ? '#f5ece2' : '#1a1a1a',
  },
  syncBannerBtn: {
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
  },
  quickActionsRow: {
    marginHorizontal: 16,
    marginBottom: 12,
    flexDirection: 'row',
    gap: 8,
  },
  quickActionChip: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 5,
  },
  quickActionText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  switcherWrap: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 4,
    flexDirection: 'row',
    gap: 4,
  },
  switcherBtn: {
    flex: 1,
    borderRadius: 20,
    paddingVertical: 10,
    alignItems: 'center',
  },
  switcherBtnActive: {
    backgroundColor: Colors.accentGold,
  },
  switcherText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  switcherTextActive: {
    color: Colors.textInverse,
  },
  sectionRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pegCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  pegCardText: {
    flex: 1,
    color: BRAND,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter_600SemiBold',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  separator: {
    height: 10,
  },
  loadingStateWrap: {
    paddingHorizontal: 16,
    gap: 10,
  },
  loadingCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 10,
  },
  loadingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  loadingCardTitleCol: {
    flex: 1,
  },
  loadingCardBody: {
    gap: 2,
  },
  loadingCtaRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  assetCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
  },
  assetImage: {
    width: '100%',
    height: 160,
  },
  assetBody: {
    padding: 12,
  },
  assetTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  movePillUp: {
    backgroundColor: POSITIVE_BG,
  },
  movePillDown: {
    backgroundColor: NEGATIVE_BG,
  },
  moveText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  moveTextUp: {
    color: BRAND,
  },
  moveTextDown: {
    color: '#ff9797',
  },
  assetIssuer: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  assetBadgesRow: {
    marginTop: 8,
    flexDirection: 'row',
    gap: 6,
  },
  assetBadgePill: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: PANEL_TINT_BG,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
  },
  assetBadgeText: {
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  assetBadgePillMuted: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: PANEL_MUTED_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  assetBadgeTextMuted: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  priceRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pricePrimary: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  priceSecondary: {
    color: BRAND,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    marginTop: 8,
    height: 5,
    borderRadius: 4,
    backgroundColor: IS_LIGHT ? '#ddd4c7' : '#1e1e1e',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: BRAND,
  },
  metaRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pnlRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pnlValue: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    fontVariant: ['tabular-nums'],
  },
  metaText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  ctaRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  buyBtn: {
    flex: 1,
    backgroundColor: Colors.accentGold,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  buyBtnDisabled: {
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  buyBtnText: {
    color: Colors.background,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  buyBtnTextDisabled: {
    color: Colors.textMuted,
  },
  detailsBtn: {
    width: 88,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailsBtnText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  unitsModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  unitsModalDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  unitsModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  unitsModalLabel: {
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  unitsModalTitle: {
    marginTop: 5,
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  unitsModalHint: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  unitsInputWrap: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 12,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unitsInputPrefix: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  unitsInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    paddingVertical: 0,
  },
  unitsQuickRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  unitsQuickChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unitsQuickText: {
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  unitsSpendText: {
    marginTop: 10,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  unitsSpendSubText: {
    marginTop: 4,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  unitsModalActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  unitsCancelBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: PANEL_SOFT_BG,
  },
  unitsCancelText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  unitsSubmitBtn: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: Colors.accentGold,
  },
  unitsSubmitText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  complianceModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  complianceModalDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  complianceModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  complianceModalLabel: {
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  complianceModalTitle: {
    marginTop: 5,
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  complianceModalHint: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    lineHeight: 17,
  },
  complianceFieldLabel: {
    marginTop: 12,
    marginBottom: 7,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  countryChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  countryChip: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countryChipActive: {
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
  },
  countryChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  countryChipTextActive: {
    color: BRAND,
  },
  complianceToggleRow: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  complianceToggleText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  complianceToggleBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  complianceToggleBtnActive: {
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
  },
  complianceToggleBtnText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  complianceToggleBtnTextActive: {
    color: BRAND,
  },
  complianceStatusBanner: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  complianceStatusOk: {
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
  },
  complianceStatusError: {
    borderColor: '#4a2b2b',
    backgroundColor: '#231616',
  },
  complianceStatusText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  complianceStatusTextOk: {
    color: BRAND,
  },
  complianceStatusTextError: {
    color: '#ff9797',
  },
  complianceDoneBtn: {
    marginTop: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: Colors.accentGold,
  },
  complianceDoneBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
});
