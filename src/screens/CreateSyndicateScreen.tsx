import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  Image,
  FlatList,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import type { SyndicateAsset } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { toFiat, toIze } from '../utils/currency';
import { sanitizeDecimalInput, sanitizeIntegerInput } from '../utils/currencyAuthoringFlows';
import { getCreateSyndicateInitialState } from '../utils/syndicatePrefill';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
type RouteT = RouteProp<RootStackParamList, 'CreateSyndicate'>;

const STABLE_COIN = '1ze';
const COUNTRY_OPTIONS = ['GB', 'EU', 'SG', 'AE', 'US', 'CA'] as const;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#121212';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#151515';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2d2d2d';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#152520';
const PANEL_TINT_BORDER = IS_LIGHT ? '#d0c3af' : '#2f4944';
const SETTLEMENT_MODES: Array<{ key: 'GBP' | 'TVUSD' | 'HYBRID' }> = [
  { key: 'GBP' },
  { key: 'TVUSD' },
  { key: 'HYBRID' },
];

export default function CreateSyndicateScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const { listings } = useBackendData();

  const prefill = route.params;

  const currentUser = useStore((state) => state.currentUser);
  const addSyndicate = useStore((state) => state.addSyndicate);
  const syndicateCompliance = useStore((state) => state.syndicateCompliance);
  const updateSyndicateCompliance = useStore((state) => state.updateSyndicateCompliance);
  const checkSyndicateEligibility = useStore((state) => state.checkSyndicateEligibility);

  const issuerId = currentUser?.id ?? MOCK_USERS[0]?.id ?? 'u1';

  const issuerListings = React.useMemo(() => {
    const sourceListings = listings.length ? listings : MOCK_LISTINGS;
    const own = sourceListings.filter((item) => item.sellerId === issuerId);
    return own.length ? own : sourceListings.slice(0, 12);
  }, [issuerId, listings]);

  const initialState = React.useMemo(
    () => getCreateSyndicateInitialState(prefill, issuerListings[0]?.id ?? ''),
    [prefill, issuerListings]
  );

  const [selectedListingId, setSelectedListingId] = React.useState(initialState.selectedListingId);
  const [totalUnitsInput, setTotalUnitsInput] = React.useState(initialState.totalUnitsInput);
  const [unitPriceInput, setUnitPriceInput] = React.useState(initialState.unitPriceInput);
  const [stablePriceInput, setStablePriceInput] = React.useState('1.28');
  const [settlementMode, setSettlementMode] = React.useState<'GBP' | 'TVUSD' | 'HYBRID'>('HYBRID');

  const handleTotalUnitsChange = React.useCallback((value: string) => {
    const sanitized = sanitizeIntegerInput(value);
    if (!sanitized) {
      setTotalUnitsInput('');
      return;
    }

    const parsed = Math.floor(Number(sanitized));
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setTotalUnitsInput('1');
      return;
    }

    setTotalUnitsInput(String(Math.min(20, parsed)));
  }, []);

  const fromDisplayToGbp = React.useCallback(
    (amountDisplay: number) => {
      if (currencyCode === 'GBP') {
        return amountDisplay;
      }
      const amountIze = toIze(amountDisplay, currencyCode, goldRates);
      return toFiat(amountIze, 'GBP', goldRates);
    },
    [currencyCode, goldRates]
  );

  React.useEffect(() => {
    if (!issuerListings.length) {
      return;
    }

    if (!issuerListings.some((item) => item.id === selectedListingId)) {
      setSelectedListingId(issuerListings[0].id);
    }
  }, [issuerListings, selectedListingId]);

  const selectedListing = React.useMemo(
    () => issuerListings.find((item) => item.id === selectedListingId),
    [issuerListings, selectedListingId]
  );

  const issueSyndicate = () => {
    if (!selectedListing) {
      show('Select a listing to issue', 'error');
      return;
    }

    const totalUnits = Number(totalUnitsInput);
    if (!Number.isFinite(totalUnits) || totalUnits < 1 || totalUnits > 20 || !Number.isInteger(totalUnits)) {
      show('Units must be an integer between 1 and 20', 'error');
      return;
    }

    const unitPriceGBP = fromDisplayToGbp(Number(unitPriceInput));
    if (!Number.isFinite(unitPriceGBP) || unitPriceGBP <= 0) {
      show(`Enter a valid ${currencyCode} unit price`, 'error');
      return;
    }

    const unitPriceStable = Number(stablePriceInput);
    if (!Number.isFinite(unitPriceStable) || unitPriceStable <= 0) {
      show('Enter a valid stable coin unit price', 'error');
      return;
    }

    const eligibility = checkSyndicateEligibility(settlementMode);
    if (!eligibility.ok) {
      show(eligibility.message ?? 'Complete compliance checks before issuing', 'error');
      return;
    }

    const now = Date.now();

    const newAsset: SyndicateAsset = {
      id: `s_user_${now}`,
      listingId: selectedListing.id,
      issuerId,
      title: `${selectedListing.title} Split`,
      image: selectedListing.images[0] ?? 'https://picsum.photos/seed/new-syndicate/500/700',
      totalUnits,
      availableUnits: totalUnits,
      unitPriceGBP,
      unitPriceStable,
      settlementMode,
      issuerJurisdiction: syndicateCompliance.countryCode,
      marketMovePct24h: 0,
      holders: 0,
      volume24hGBP: 0,
      yourUnits: 0,
      avgEntryPriceGBP: unitPriceGBP,
      realizedProfitGBP: 0,
      isOpen: true,
    };

    addSyndicate(newAsset);
    show('Syndicate issued successfully', 'success');
    navigation.goBack();
  };

  const estimatedValue = React.useMemo(() => {
    const units = Number(totalUnitsInput);
    const unitPrice = fromDisplayToGbp(Number(unitPriceInput));

    if (!Number.isFinite(units) || !Number.isFinite(unitPrice)) {
      return 0;
    }

    return units * unitPrice;
  }, [fromDisplayToGbp, totalUnitsInput, unitPriceInput]);

  const renderListingCard = ({ item }: { item: Listing }) => {
    const selected = item.id === selectedListingId;

    return (
      <AnimatedPressable
        style={[styles.listingCard, selected && styles.listingCardSelected]}
        onPress={() => setSelectedListingId(item.id)}
        activeOpacity={0.9}
      >
        <Image source={{ uri: item.images[0] }} style={styles.listingImage} />
        <View style={styles.listingMeta}>
          <Text style={styles.listingTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.listingPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        </View>
        {selected ? (
          <View style={styles.selectedTick}>
            <Ionicons name="checkmark" size={12} color={Colors.background} />
          </View>
        ) : null}
      </AnimatedPressable>
    );
  };

  const previewImage = selectedListing?.images[0] ?? 'https://picsum.photos/seed/syndicate-preview/500/700';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.closeBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="close" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>

        <View>
          <Text style={styles.headerLabel}>ISSUER CONSOLE</Text>
          <Text style={styles.headerTitle}>Create Syndicate</Text>
        </View>

        <AnimatedPressable style={styles.issueBtn} onPress={issueSyndicate} activeOpacity={0.9}>
          <Text style={styles.issueBtnText}>Issue</Text>
        </AnimatedPressable>
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.previewCard}>
          <Image source={{ uri: previewImage }} style={styles.previewImage} />
          <View style={styles.previewOverlay}>
            <Text style={styles.previewTitle} numberOfLines={1}>{selectedListing?.title ?? 'Select listing'}</Text>
            <Text style={styles.previewMeta}>
              Estimated cap {formatFromFiat(estimatedValue, 'GBP', { displayMode: 'fiat' })}
            </Text>
          </View>
        </View>

        {prefill?.offeringWindowHours ? (
          <View style={styles.prefillBanner}>
            <Ionicons name="sparkles-outline" size={14} color={BRAND} />
            <Text style={styles.prefillBannerText}>
              Imported from Sell flow · {prefill.offeringWindowHours}h offer window · {prefill.authPhotos?.length ?? 0} auth photos
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Compliance Profile</Text>
            <Text style={styles.sectionHint}>Required before issuance</Text>
          </View>

          <Text style={styles.inputLabel}>Country</Text>
          <View style={styles.rowWrap}>
            {COUNTRY_OPTIONS.map((countryCode) => {
              const active = syndicateCompliance.countryCode === countryCode;
              return (
                <AnimatedPressable
                  key={countryCode}
                  style={[styles.chipBtn, active && styles.chipBtnActive]}
                  onPress={() => updateSyndicateCompliance({ countryCode })}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.chipBtnText, active && styles.chipBtnTextActive]}>{countryCode}</Text>
                </AnimatedPressable>
              );
            })}
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>KYC verified</Text>
            <AnimatedPressable
              style={[styles.toggleBtn, syndicateCompliance.kycVerified && styles.toggleBtnActive]}
              onPress={() => updateSyndicateCompliance({ kycVerified: !syndicateCompliance.kycVerified })}
              activeOpacity={0.9}
            >
              <Text style={[styles.toggleText, syndicateCompliance.kycVerified && styles.toggleTextActive]}>
                {syndicateCompliance.kycVerified ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>Risk disclosure accepted</Text>
            <AnimatedPressable
              style={[styles.toggleBtn, syndicateCompliance.riskDisclosureAccepted && styles.toggleBtnActive]}
              onPress={() =>
                updateSyndicateCompliance({ riskDisclosureAccepted: !syndicateCompliance.riskDisclosureAccepted })
              }
              activeOpacity={0.9}
            >
              <Text style={[styles.toggleText, syndicateCompliance.riskDisclosureAccepted && styles.toggleTextActive]}>
                {syndicateCompliance.riskDisclosureAccepted ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleLabel}>{STABLE_COIN} wallet connected</Text>
            <AnimatedPressable
              style={[styles.toggleBtn, syndicateCompliance.stableCoinWalletConnected && styles.toggleBtnActive]}
              onPress={() =>
                updateSyndicateCompliance({
                  stableCoinWalletConnected: !syndicateCompliance.stableCoinWalletConnected,
                })
              }
              activeOpacity={0.9}
            >
              <Text style={[styles.toggleText, syndicateCompliance.stableCoinWalletConnected && styles.toggleTextActive]}>
                {syndicateCompliance.stableCoinWalletConnected ? 'ON' : 'OFF'}
              </Text>
            </AnimatedPressable>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Token Split</Text>

          <Text style={styles.inputLabel}>Settlement mode</Text>
          <View style={styles.rowWrap}>
            {SETTLEMENT_MODES.map((mode) => {
              const active = settlementMode === mode.key;
              const modeLabel =
                mode.key === 'GBP'
                  ? `${currencyCode} only`
                  : mode.key === 'TVUSD'
                    ? `${STABLE_COIN} only`
                    : `Hybrid (${currencyCode} + ${STABLE_COIN})`;
              return (
                <AnimatedPressable
                  key={mode.key}
                  style={[styles.chipBtn, active && styles.chipBtnActive]}
                  onPress={() => setSettlementMode(mode.key)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.chipBtnText, active && styles.chipBtnTextActive]}>{modeLabel}</Text>
                </AnimatedPressable>
              );
            })}
          </View>

          <Text style={styles.inputLabel}>Total Units</Text>
          <TextInput
            style={styles.input}
            value={totalUnitsInput}
            onChangeText={handleTotalUnitsChange}
            keyboardType="number-pad"
            placeholder="20"
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.accent}
          />
          <Text style={styles.inputHint}>Maximum 20 units per asset</Text>

          <Text style={styles.inputLabel}>Unit Price ({currencyCode})</Text>
          <TextInput
            style={styles.input}
            value={unitPriceInput}
            onChangeText={(value) => setUnitPriceInput(sanitizeDecimalInput(value))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.accent}
          />

          <Text style={styles.inputLabel}>Unit Price ({STABLE_COIN})</Text>
          <TextInput
            style={styles.input}
            value={stablePriceInput}
            onChangeText={(value) => setStablePriceInput(sanitizeDecimalInput(value))}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
            selectionColor={Colors.accent}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Attach Listing</Text>
            <Text style={styles.sectionHint}>{issuerListings.length} available</Text>
          </View>

          <FlatList
            data={issuerListings}
            horizontal
            keyExtractor={(item) => item.id}
            renderItem={renderListingCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listingsContent}
          />
        </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  headerLabel: {
    color: BRAND,
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  issueBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  issueBtnText: {
    color: Colors.textInverse,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  previewCard: {
    height: 188,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    marginBottom: 16,
    backgroundColor: PANEL_BG,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  previewTitle: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  previewMeta: {
    marginTop: 3,
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  prefillBanner: {
    marginBottom: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  prefillBannerText: {
    flex: 1,
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  section: {
    marginBottom: 15,
  },
  sectionHeaderRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  chipBtn: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipBtnActive: {
    borderColor: BRAND,
    backgroundColor: PANEL_TINT_BG,
  },
  chipBtnText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  chipBtnTextActive: {
    color: BRAND,
  },
  toggleRow: {
    borderRadius: 11,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleLabel: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  toggleBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toggleBtnActive: {
    borderColor: BRAND,
    backgroundColor: PANEL_TINT_BG,
  },
  toggleText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.5,
  },
  toggleTextActive: {
    color: BRAND,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
  },
  inputHint: {
    marginTop: -4,
    marginBottom: 10,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    backgroundColor: PANEL_BG,
    marginBottom: 10,
  },
  listingsContent: {
    gap: 8,
  },
  listingCard: {
    width: 156,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
  },
  listingCardSelected: {
    borderColor: BRAND,
    backgroundColor: PANEL_TINT_BG,
  },
  listingImage: {
    width: '100%',
    height: 92,
  },
  listingMeta: {
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  listingTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  listingPrice: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  selectedTick: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
});
