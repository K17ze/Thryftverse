import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  RefreshControl,
  Modal,
  TextInput
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import {
  formatCompact,
  formatMoney,
  getSyndicateMarket,
  getUserLabel,
  SyndicateAsset,
} from '../data/tradeHub';
import { useToast } from '../context/ToastContext';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store/useStore';

type NavT = StackNavigationProp<RootStackParamList>;
type SyndicateView = 'MARKET' | 'HOLDINGS';

const STABLE_COIN = 'TVUSD';
const COUNTRY_OPTIONS = [
  { code: 'GB', label: 'United Kingdom' },
  { code: 'EU', label: 'European Union' },
  { code: 'SG', label: 'Singapore' },
  { code: 'AE', label: 'UAE' },
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
] as const;

const settlementLabelMap: Record<'GBP' | 'TVUSD' | 'HYBRID', string> = {
  GBP: 'GBP only',
  TVUSD: 'TVUSD only',
  HYBRID: 'GBP + TVUSD',
};

type ComposerMode = 'buy' | 'sell';

function formatSigned(value: number) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatMoney(Math.abs(value))}`;
}

export default function SyndicateScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);
  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const syndicateCompliance = useStore((state) => state.syndicateCompliance);
  const updateSyndicateCompliance = useStore((state) => state.updateSyndicateCompliance);
  const checkSyndicateEligibility = useStore((state) => state.checkSyndicateEligibility);
  const buySyndicateUnits = useStore((state) => state.buySyndicateUnits);
  const sellSyndicateUnits = useStore((state) => state.sellSyndicateUnits);

  const actingUserId = currentUser?.id ?? 'u1';

  const [refreshing, setRefreshing] = React.useState(false);
  const [activeView, setActiveView] = React.useState<SyndicateView>('MARKET');
  const [unitsComposerVisible, setUnitsComposerVisible] = React.useState(false);
  const [complianceModalVisible, setComplianceModalVisible] = React.useState(false);
  const [composerMode, setComposerMode] = React.useState<ComposerMode>('buy');
  const [selectedAsset, setSelectedAsset] = React.useState<SyndicateAsset | null>(null);
  const [unitsInput, setUnitsInput] = React.useState('1');

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 650);
  };

  const baseAssets = React.useMemo(() => getSyndicateMarket(customSyndicates), [customSyndicates, refreshing]);

  const marketAssets = React.useMemo(
    () =>
      baseAssets.map((asset) => {
        const runtime = syndicateRuntime[asset.id];
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
    [baseAssets, syndicateRuntime]
  );

  const visibleAssets = React.useMemo(() => {
    if (activeView === 'HOLDINGS') {
      return marketAssets.filter((asset) => asset.yourUnits > 0);
    }

    return marketAssets;
  }, [activeView, marketAssets]);

  const totalVolume = React.useMemo(
    () => marketAssets.reduce((sum, asset) => sum + asset.volume24hGBP, 0),
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

  const marketEligibility = checkSyndicateEligibility('HYBRID');

  const openUnitsComposer = (asset: SyndicateAsset, mode: ComposerMode) => {
    const eligibility = checkSyndicateEligibility(asset.settlementMode);
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

  const submitUnitsOrder = () => {
    if (!selectedAsset) {
      return;
    }

    const units = Math.floor(Number(unitsInput));
    if (!Number.isFinite(units) || units <= 0) {
      show('Units must be at least 1', 'error');
      return;
    }

    const result = composerMode === 'buy'
      ? buySyndicateUnits(selectedAsset, actingUserId, units)
      : sellSyndicateUnits(selectedAsset, actingUserId, units);

    if (!result.ok) {
      show(result.message ?? 'Unable to purchase units', 'error');
      if (result.message?.toLowerCase().includes('kyc') || result.message?.toLowerCase().includes('country')) {
        setComplianceModalVisible(true);
      }
      return;
    }

    show(result.message ?? `${composerMode === 'buy' ? 'Purchased' : 'Sold'} units`, 'success');
    closeUnitsComposer();
  };

  const renderHeader = () => (
    <View>
      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{marketAssets.length}</Text>
          <Text style={styles.metricLabel}>Pools</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>£{formatCompact(Math.round(totalVolume))}</Text>
          <Text style={styles.metricLabel}>24h Volume</Text>
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
          <Ionicons name="shield-checkmark-outline" size={16} color="#4ECDC4" />
          <Text style={styles.complianceTitle}>Regulatory Guardrails</Text>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
        <Text style={styles.complianceText}>
          Country {syndicateCompliance.countryCode} · KYC {syndicateCompliance.kycVerified ? 'on' : 'off'} ·
          Disclosure {syndicateCompliance.riskDisclosureAccepted ? 'accepted' : 'pending'}.
        </Text>
        {!marketEligibility.ok ? (
          <Text style={styles.complianceErrorText}>{marketEligibility.message}</Text>
        ) : (
          <Text style={styles.complianceOkText}>Eligible to trade syndicated assets.</Text>
        )}
      </AnimatedPressable>

      <View style={styles.issueRow}>
        <View>
          <Text style={styles.issueTitle}>Issuer Console</Text>
          <Text style={styles.issueHint}>Tokenize a listing into buyable unit lots</Text>
        </View>

        <AnimatedPressable
          style={styles.issueBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreateSyndicate')}
        >
          <Ionicons name="add" size={15} color={Colors.background} />
          <Text style={styles.issueBtnText}>Issue</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.quickActionsRow}>
        <AnimatedPressable
          style={styles.quickActionChip}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('SyndicateHub')}
        >
          <Ionicons name="grid-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.quickActionText}>Hub</Text>
        </AnimatedPressable>

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
          onPress={() => navigation.navigate('SyndicateOrderHistory')}
        >
          <Ionicons name="time-outline" size={13} color={Colors.textSecondary} />
          <Text style={styles.quickActionText}>Orders</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.switcherWrap}>
        {(['MARKET', 'HOLDINGS'] as const).map((view) => (
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
        <Text style={styles.sectionTitle}>{activeView === 'MARKET' ? 'Open Syndicates' : 'Your Holdings'}</Text>
        <Text style={styles.sectionHint}>Settles in local GBP, {STABLE_COIN}, or hybrid rails</Text>
      </View>
    </View>
  );

  const renderAssetCard = ({ item }: { item: SyndicateAsset }) => {
    const soldPct = ((item.totalUnits - item.availableUnits) / item.totalUnits) * 100;
    const moveIsPositive = item.marketMovePct24h >= 0;
    const isHoldingsMode = activeView === 'HOLDINGS';
    const avgEntry = item.avgEntryPriceGBP ?? item.unitPriceGBP;
    const unrealized = item.yourUnits > 0 ? (item.unitPriceGBP - avgEntry) * item.yourUnits : 0;
    const eligibility = checkSyndicateEligibility(item.settlementMode);
    const primaryDisabled = isHoldingsMode
      ? item.yourUnits === 0
      : !item.isOpen || item.availableUnits === 0 || !eligibility.ok;

    return (
      <AnimatedPressable
        style={styles.assetCard}
        activeOpacity={0.94}
        onPress={() => navigation.navigate('AssetDetail', { assetId: item.id })}
      >
        <Image source={{ uri: item.image }} style={styles.assetImage} />

        <View style={styles.assetBody}>
          <View style={styles.assetTopRow}>
            <Text style={styles.assetTitle} numberOfLines={1}>{item.title}</Text>
            <View style={[styles.movePill, moveIsPositive ? styles.movePillUp : styles.movePillDown]}>
              <Ionicons
                name={moveIsPositive ? 'trending-up-outline' : 'trending-down-outline'}
                size={12}
                color={moveIsPositive ? '#8de5dc' : '#ff9797'}
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
            <Text style={styles.pricePrimary}>{formatMoney(item.unitPriceGBP)} / unit</Text>
            <Text style={styles.priceSecondary}>{item.unitPriceStable.toFixed(2)} {STABLE_COIN}</Text>
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
              style={[styles.buyBtn, primaryDisabled && styles.buyBtnDisabled]}
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
            >
              <Ionicons
                name={isHoldingsMode ? 'cash-outline' : 'wallet-outline'}
                size={13}
                color={!primaryDisabled ? Colors.background : Colors.textMuted}
              />
              <Text style={[styles.buyBtnText, primaryDisabled && styles.buyBtnTextDisabled]}>
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
    const estimatedStable = normalizedUnits > 0
      ? normalizedUnits * selectedAsset.unitPriceStable
      : 0;
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
                onChangeText={(value) => setUnitsInput(value.replace(/\D/g, ''))}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.unitsQuickRow}>
              {[1, 5, 10, 25].map((units) => (
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
              {composerMode === 'buy' ? 'Estimated spend' : 'Estimated receive'} {formatMoney(estimatedQuote)}
            </Text>
            <Text style={styles.unitsSpendSubText}>Approx. {estimatedStable.toFixed(2)} {STABLE_COIN}</Text>
            {composerMode === 'sell' ? (
              <Text style={[styles.unitsSpendSubText, estimatedRealized >= 0 ? styles.pnlUp : styles.pnlDown]}>
                Realized P/L preview {formatSigned(estimatedRealized)}
              </Text>
            ) : null}

            <View style={styles.unitsModalActions}>
              <AnimatedPressable style={styles.unitsCancelBtn} onPress={closeUnitsComposer} activeOpacity={0.9}>
                <Text style={styles.unitsCancelText}>Cancel</Text>
              </AnimatedPressable>

              <AnimatedPressable style={styles.unitsSubmitBtn} onPress={submitUnitsOrder} activeOpacity={0.9}>
                <Text style={styles.unitsSubmitText}>{composerMode === 'buy' ? 'Buy Units' : 'Sell Units'}</Text>
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
          <Text style={styles.complianceModalLabel}>COMPLIANCE SETUP</Text>
          <Text style={styles.complianceModalTitle}>Jurisdiction & KYC</Text>
          <Text style={styles.complianceModalHint}>
            Configure regional eligibility checks before issuing or trading syndicate units.
          </Text>

          <Text style={styles.complianceFieldLabel}>Country</Text>
          <View style={styles.countryChipsWrap}>
            {COUNTRY_OPTIONS.map((country) => {
              const active = syndicateCompliance.countryCode === country.code;
              return (
                <AnimatedPressable
                  key={country.code}
                  style={[styles.countryChip, active && styles.countryChipActive]}
                  onPress={() => updateSyndicateCompliance({ countryCode: country.code })}
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
              style={[styles.complianceToggleBtn, syndicateCompliance.kycVerified && styles.complianceToggleBtnActive]}
              onPress={() => updateSyndicateCompliance({ kycVerified: !syndicateCompliance.kycVerified })}
              activeOpacity={0.9}
            >
              <Text style={[styles.complianceToggleBtnText, syndicateCompliance.kycVerified && styles.complianceToggleBtnTextActive]}>
                {syndicateCompliance.kycVerified ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.complianceToggleRow}>
            <Text style={styles.complianceToggleText}>Risk disclosure accepted</Text>
            <AnimatedPressable
              style={[styles.complianceToggleBtn, syndicateCompliance.riskDisclosureAccepted && styles.complianceToggleBtnActive]}
              onPress={() =>
                updateSyndicateCompliance({ riskDisclosureAccepted: !syndicateCompliance.riskDisclosureAccepted })
              }
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.complianceToggleBtnText,
                  syndicateCompliance.riskDisclosureAccepted && styles.complianceToggleBtnTextActive,
                ]}
              >
                {syndicateCompliance.riskDisclosureAccepted ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.complianceToggleRow}>
            <Text style={styles.complianceToggleText}>{STABLE_COIN} wallet connected</Text>
            <AnimatedPressable
              style={[styles.complianceToggleBtn, syndicateCompliance.stableCoinWalletConnected && styles.complianceToggleBtnActive]}
              onPress={() =>
                updateSyndicateCompliance({ stableCoinWalletConnected: !syndicateCompliance.stableCoinWalletConnected })
              }
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.complianceToggleBtnText,
                  syndicateCompliance.stableCoinWalletConnected && styles.complianceToggleBtnTextActive,
                ]}
              >
                {syndicateCompliance.stableCoinWalletConnected ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={[styles.complianceStatusBanner, marketEligibility.ok ? styles.complianceStatusOk : styles.complianceStatusError]}>
            <Text style={[styles.complianceStatusText, marketEligibility.ok ? styles.complianceStatusTextOk : styles.complianceStatusTextError]}>
              {marketEligibility.ok ? 'Eligible for syndicate trading' : marketEligibility.message}
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

  return (
    <>
      <FlatList
        data={visibleAssets}
        keyExtractor={(item) => item.id}
        renderItem={renderAssetCard}
        ListHeaderComponent={renderHeader}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <EmptyState
            icon="pie-chart-outline"
            title={activeView === 'HOLDINGS' ? 'No holdings yet' : 'No open syndicates'}
            subtitle={
              activeView === 'HOLDINGS'
                ? 'Buy fractions from an open pool to see your syndicate positions here.'
                : 'Create a new syndicate to tokenize a listing and open fractional ownership.'
            }
            ctaLabel={activeView === 'HOLDINGS' ? 'Browse Market' : 'Issue Syndicate'}
            onCtaPress={() =>
              activeView === 'HOLDINGS'
                ? setActiveView('MARKET')
                : navigation.navigate('CreateSyndicate')
            }
          />
        }
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#4ECDC4"
            colors={['#4ECDC4']}
            progressBackgroundColor="#161616"
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
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#242424',
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  metricLabel: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  metricCardWide: {
    flex: 1,
    backgroundColor: '#11151b',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#27313a',
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
  },
  pnlUp: {
    color: '#8de5dc',
  },
  pnlDown: {
    color: '#ff9797',
  },
  complianceCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: '#10151b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22303a',
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
    color: '#4ECDC4',
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
    color: '#8de5dc',
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
    borderColor: '#2d3031',
    backgroundColor: '#121414',
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
    backgroundColor: Colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  issueBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
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
    borderColor: '#2f2f2f',
    backgroundColor: '#141414',
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
    backgroundColor: '#111111',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#282828',
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
    backgroundColor: Colors.accent,
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
  assetCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#232323',
    backgroundColor: '#111111',
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
    backgroundColor: '#14302a',
  },
  movePillDown: {
    backgroundColor: '#301919',
  },
  moveText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  moveTextUp: {
    color: '#8de5dc',
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
    backgroundColor: '#14231f',
    borderWidth: 1,
    borderColor: '#2e4440',
  },
  assetBadgeText: {
    color: '#8de5dc',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.3,
  },
  assetBadgePillMuted: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: '#151515',
    borderWidth: 1,
    borderColor: '#2e2e2e',
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
  },
  priceSecondary: {
    color: '#8de5dc',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  progressTrack: {
    marginTop: 8,
    height: 5,
    borderRadius: 4,
    backgroundColor: '#1e1e1e',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: '#4ECDC4',
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
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  buyBtnDisabled: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#303030',
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
    borderColor: '#323232',
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
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  unitsModalLabel: {
    color: '#4ECDC4',
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
    borderColor: '#2f2f2f',
    borderRadius: 12,
    backgroundColor: '#161616',
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
    borderColor: '#304044',
    backgroundColor: '#131c1e',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  unitsQuickText: {
    color: '#8de5dc',
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
    borderColor: '#313131',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: '#161616',
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
    backgroundColor: Colors.accent,
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
    borderColor: '#2a2a2a',
    backgroundColor: '#111111',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  complianceModalLabel: {
    color: '#4ECDC4',
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
    borderColor: '#313131',
    backgroundColor: '#161616',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  countryChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#17302b',
  },
  countryChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  countryChipTextActive: {
    color: '#8de5dc',
  },
  complianceToggleRow: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2c2c2c',
    backgroundColor: '#161616',
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
    borderColor: '#353535',
    backgroundColor: '#121212',
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  complianceToggleBtnActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#17302b',
  },
  complianceToggleBtnText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  complianceToggleBtnTextActive: {
    color: '#8de5dc',
  },
  complianceStatusBanner: {
    marginTop: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  complianceStatusOk: {
    borderColor: '#2d4a45',
    backgroundColor: '#152420',
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
    color: '#8de5dc',
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
    backgroundColor: Colors.accent,
  },
  complianceDoneBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
});
