import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  RefreshControl,
  Modal,
  TextInput,
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

export default function SyndicateScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);
  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  const buySyndicateUnits = useStore((state) => state.buySyndicateUnits);
  const sellSyndicateUnits = useStore((state) => state.sellSyndicateUnits);

  const actingUserId = currentUser?.id ?? 'u1';

  const [refreshing, setRefreshing] = React.useState(false);
  const [activeView, setActiveView] = React.useState<SyndicateView>('MARKET');
  const [unitsComposerVisible, setUnitsComposerVisible] = React.useState(false);
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

  const openUnitsComposer = (asset: SyndicateAsset) => {
    setSelectedAsset(asset);
    setUnitsInput('1');
    setUnitsComposerVisible(true);
  };

  const closeUnitsComposer = () => {
    setUnitsComposerVisible(false);
    setSelectedAsset(null);
    setUnitsInput('1');
  };

  const submitUnitsPurchase = () => {
    if (!selectedAsset) {
      return;
    }

    const units = Math.floor(Number(unitsInput));
    if (!Number.isFinite(units) || units <= 0) {
      show('Units must be at least 1', 'error');
      return;
    }

    const result = buySyndicateUnits(selectedAsset, actingUserId, units);
    if (!result.ok) {
      show(result.message ?? 'Unable to purchase units', 'error');
      return;
    }

    show(`Purchased ${units} unit${units === 1 ? '' : 's'} in ${selectedAsset.title}`, 'success');
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

      <View style={styles.complianceCard}>
        <View style={styles.complianceTopRow}>
          <Ionicons name="shield-checkmark-outline" size={16} color="#4ECDC4" />
          <Text style={styles.complianceTitle}>Regulatory Guardrails</Text>
        </View>
        <Text style={styles.complianceText}>
          Syndicate access is jurisdiction-aware. Real launch requires KYC, AML checks, suitability rules,
          and country-level eligibility controls.
        </Text>
      </View>

      <View style={styles.issueRow}>
        <View>
          <Text style={styles.issueTitle}>Issuer Console</Text>
          <Text style={styles.issueHint}>Tokenize a listing into buyable unit lots</Text>
        </View>

        <TouchableOpacity
          style={styles.issueBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreateSyndicate')}
        >
          <Ionicons name="add" size={15} color={Colors.background} />
          <Text style={styles.issueBtnText}>Issue</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.switcherWrap}>
        {(['MARKET', 'HOLDINGS'] as const).map((view) => (
          <TouchableOpacity
            key={view}
            style={[styles.switcherBtn, activeView === view && styles.switcherBtnActive]}
            onPress={() => setActiveView(view)}
            activeOpacity={0.9}
          >
            <Text style={[styles.switcherText, activeView === view && styles.switcherTextActive]}>{view}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{activeView === 'MARKET' ? 'Open Syndicates' : 'Your Holdings'}</Text>
        <Text style={styles.sectionHint}>Settles in GBP or {STABLE_COIN}</Text>
      </View>
    </View>
  );

  const renderAssetCard = ({ item }: { item: SyndicateAsset }) => {
    const soldPct = ((item.totalUnits - item.availableUnits) / item.totalUnits) * 100;
    const moveIsPositive = item.marketMovePct24h >= 0;
    const isHoldingsMode = activeView === 'HOLDINGS';
    const primaryDisabled = isHoldingsMode
      ? item.yourUnits === 0
      : !item.isOpen || item.availableUnits === 0;

    return (
      <TouchableOpacity
        style={styles.assetCard}
        activeOpacity={0.94}
        onPress={() => navigation.navigate('ItemDetail', { itemId: item.listingId })}
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

          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={[styles.buyBtn, primaryDisabled && styles.buyBtnDisabled]}
              onPress={() => {
                if (isHoldingsMode) {
                  const result = sellSyndicateUnits(item, actingUserId, 1);
                  if (!result.ok) {
                    show(result.message ?? 'Unable to sell units', 'error');
                    return;
                  }

                  show(`Sold 1 unit in ${item.title}`, 'success');
                } else {
                  if (!item.isOpen || item.availableUnits === 0) {
                    show('Pool currently closed', 'error');
                    return;
                  }

                  openUnitsComposer(item);
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
                {isHoldingsMode ? 'Sell 1 Unit' : 'Buy Units'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.detailsBtn}
              onPress={() => navigation.navigate('ItemDetail', { itemId: item.listingId })}
              activeOpacity={0.9}
            >
              <Text style={styles.detailsBtnText}>Asset</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderUnitsComposer = () => {
    if (!selectedAsset) {
      return null;
    }

    const unitsAsNumber = Number(unitsInput);
    const estimatedSpend = Number.isFinite(unitsAsNumber) && unitsAsNumber > 0
      ? unitsAsNumber * selectedAsset.unitPriceGBP
      : 0;

    return (
      <Modal
        visible={unitsComposerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeUnitsComposer}
      >
        <View style={styles.unitsModalOverlay}>
          <TouchableOpacity style={styles.unitsModalDismissLayer} activeOpacity={1} onPress={closeUnitsComposer} />

          <View style={styles.unitsModalCard}>
            <Text style={styles.unitsModalLabel}>UNITS COMPOSER</Text>
            <Text style={styles.unitsModalTitle} numberOfLines={1}>{selectedAsset.title}</Text>
            <Text style={styles.unitsModalHint}>Available {selectedAsset.availableUnits} units</Text>

            <View style={styles.unitsInputWrap}>
              <Text style={styles.unitsInputPrefix}>Units</Text>
              <TextInput
                style={styles.unitsInput}
                value={unitsInput}
                onChangeText={setUnitsInput}
                keyboardType="number-pad"
                placeholder="1"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.unitsQuickRow}>
              {[1, 5, 10].map((units) => (
                <TouchableOpacity
                  key={units}
                  style={styles.unitsQuickChip}
                  onPress={() => setUnitsInput(String(units))}
                  activeOpacity={0.9}
                >
                  <Text style={styles.unitsQuickText}>{units}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.unitsSpendText}>Estimated spend {formatMoney(estimatedSpend)}</Text>

            <View style={styles.unitsModalActions}>
              <TouchableOpacity style={styles.unitsCancelBtn} onPress={closeUnitsComposer} activeOpacity={0.9}>
                <Text style={styles.unitsCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.unitsSubmitBtn} onPress={submitUnitsPurchase} activeOpacity={0.9}>
                <Text style={styles.unitsSubmitText}>Buy Units</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

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
            title="No holdings yet"
            subtitle="Buy fractions from an open pool to see your syndicate positions here."
            ctaLabel="Browse Market"
            onCtaPress={() => setActiveView('MARKET')}
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
});
