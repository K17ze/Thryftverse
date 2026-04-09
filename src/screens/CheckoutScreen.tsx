import React, { useEffect, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { MOCK_LISTINGS, MOCK_USERS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { isCheckoutReady } from '../utils/checkoutFlow';
import { formatCountryPolicyScope, isPaymentMethodAllowed } from '../utils/capabilityPolicy';
import { calculatePlatformChargeGbp } from '../utils/currencyAuthoringFlows';
import { useBackendData } from '../context/BackendDataContext';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { AddCardSheet } from '../components/checkout/AddCardSheet';
import { AddAddressSheet } from '../components/checkout/AddAddressSheet';
import {
  createOrder,
  listUserAddresses,
  listUserPaymentMethods,
  payOrder,
} from '../services/commerceApi';
import { CapabilityCarrier, getUserCountryCapabilities, UserCountryCapabilities } from '../services/capabilitiesApi';
import { CachedImage } from '../components/CachedImage';
import { getListingCoverUri } from '../utils/media';

type RouteT = RouteProp<RootStackParamList, 'Checkout'>;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.97)' : 'rgba(10,10,10,0.95)';

interface CheckoutPostageOption {
  label: string;
  etaLabel: string;
  priceFromGbp: number;
}

const DEFAULT_POSTAGE_OPTION: CheckoutPostageOption = {
  label: 'Standard shipping',
  etaLabel: '2-3 working days',
  priceFromGbp: 2.89,
};

function toEtaLabel(carrier: CapabilityCarrier): string {
  if (carrier.etaMinDays === carrier.etaMaxDays) {
    return `${carrier.etaMinDays} working day${carrier.etaMinDays === 1 ? '' : 's'}`;
  }

  return `${carrier.etaMinDays}-${carrier.etaMaxDays} working days`;
}

export default function CheckoutScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteT>();
  const { itemId } = route.params;
  const { listings } = useBackendData();
  const currentUser = useStore((state) => state.currentUser);
  const savedAddress = useStore((state) => state.savedAddress);
  const saveAddress = useStore((state) => state.saveAddress);
  const savedPaymentMethod = useStore((state) => state.savedPaymentMethod);
  const savePaymentMethod = useStore((state) => state.savePaymentMethod);
  const [isHydratingCheckout, setIsHydratingCheckout] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [addCardSheetVisible, setAddCardSheetVisible] = useState(false);
  const [addAddressSheetVisible, setAddAddressSheetVisible] = useState(false);
  const [postageOption, setPostageOption] = useState<CheckoutPostageOption>(DEFAULT_POSTAGE_OPTION);
  const [checkoutCapabilities, setCheckoutCapabilities] = useState<UserCountryCapabilities | null>(null);
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();

  const item = listings.find((l) => l.id === itemId) || MOCK_LISTINGS.find((l) => l.id === itemId) || listings[0] || MOCK_LISTINGS[0];
  const seller = MOCK_USERS.find(u => u.id === item.sellerId) || MOCK_USERS[0];

  const PLATFORM_CHARGE = calculatePlatformChargeGbp(item.price);
  const POSTAGE_FEE = postageOption.priceFromGbp;
  const TOTAL = item.price + PLATFORM_CHARGE + POSTAGE_FEE;
  const checkoutReady = isCheckoutReady(savedAddress, savedPaymentMethod);
  const allowCardPayments = isPaymentMethodAllowed(checkoutCapabilities, 'card');
  const paymentPolicyLabel = formatCountryPolicyScope(checkoutCapabilities);

  useEffect(() => {
    let cancelled = false;

    const hydratePostageOption = async () => {
      if (!currentUser?.id) {
        setPostageOption(DEFAULT_POSTAGE_OPTION);
        setCheckoutCapabilities(null);
        return;
      }

      try {
        const capabilities = await getUserCountryCapabilities(currentUser.id);
        if (cancelled) {
          return;
        }

        setCheckoutCapabilities(capabilities);

        const primaryCarrier = capabilities.postage.carriers[0];
        if (!primaryCarrier) {
          setPostageOption(DEFAULT_POSTAGE_OPTION);
          return;
        }

        setPostageOption({
          label: primaryCarrier.label,
          etaLabel: toEtaLabel(primaryCarrier),
          priceFromGbp: primaryCarrier.priceFromGbp,
        });
      } catch {
        if (!cancelled) {
          setPostageOption(DEFAULT_POSTAGE_OPTION);
          setCheckoutCapabilities(null);
        }
      }
    };

    void hydratePostageOption();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id]);

  const checkoutStatus = React.useMemo(() => {
    if (isSubmittingPayment) {
      return {
        tone: 'syncing' as const,
        label: 'Processing payment',
      };
    }

    if (isHydratingCheckout) {
      return {
        tone: 'syncing' as const,
        label: 'Syncing details',
      };
    }

    if (checkoutReady) {
      return {
        tone: 'live' as const,
        label: 'Ready to pay',
      };
    }

    return {
      tone: 'offline' as const,
      label: 'Incomplete setup',
    };
  }, [checkoutReady, isHydratingCheckout, isSubmittingPayment]);

  useEffect(() => {
    let cancelled = false;

    const hydrateCheckoutDefaults = async () => {
      setIsHydratingCheckout(true);
      try {
        const userId = currentUser?.id ?? 'u1';
        const [addresses, paymentMethods] = await Promise.all([
          listUserAddresses(userId),
          listUserPaymentMethods(userId),
        ]);

        if (cancelled) {
          return;
        }

        if (!savedAddress && addresses.length > 0) {
          const preferredAddress = addresses.find((entry) => entry.isDefault) ?? addresses[0];
          saveAddress({
            id: preferredAddress.id,
            name: preferredAddress.name,
            street: preferredAddress.street,
            city: preferredAddress.city,
            postcode: preferredAddress.postcode,
            isDefault: preferredAddress.isDefault,
          });
        }

        if (!savedPaymentMethod && paymentMethods.length > 0) {
          const preferredPaymentMethod =
            paymentMethods.find((entry) => entry.isDefault) ?? paymentMethods[0];
          savePaymentMethod({
            id: preferredPaymentMethod.id,
            type: preferredPaymentMethod.type,
            label: preferredPaymentMethod.label,
            details: preferredPaymentMethod.details ?? undefined,
            isDefault: preferredPaymentMethod.isDefault,
          });
        }
      } catch {
        // Keep local checkout state if backend data is unavailable.
      } finally {
        if (!cancelled) {
          setIsHydratingCheckout(false);
        }
      }
    };

    void hydrateCheckoutDefaults();

    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, saveAddress, savePaymentMethod, savedAddress, savedPaymentMethod]);

  const handlePay = async () => {
    if (!checkoutReady) {
      show('Add delivery address and payment method before paying.', 'error');
      return;
    }

    if (isSubmittingPayment) {
      return;
    }

    setIsSubmittingPayment(true);
    try {
      const userId = currentUser?.id ?? 'u1';
      const order = await createOrder({
        buyerId: userId,
        listingId: item.id,
        addressId: savedAddress?.id,
        paymentMethodId: savedPaymentMethod?.id,
        platformChargeGbp: PLATFORM_CHARGE,
      });
      await payOrder(order.id);

      show('Payment completed', 'success');
      navigation.replace('Success');
    } catch {
      show('Backend checkout unavailable. Completed locally.', 'info');
      navigation.replace('Success');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* Item Summary Card */}
        <View style={styles.itemCard}>
          <CachedImage uri={getListingCoverUri(item.images, 'https://picsum.photos/seed/checkout-item-fallback/300/400')} style={styles.itemThumb} contentFit="cover" />
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.itemSeller}>from {seller.username}</Text>
            <Text style={styles.itemPrice}>{formatFromFiat(item.price, 'GBP')}</Text>
          </View>
        </View>

        <View style={styles.readinessCard}>
          <View style={styles.readinessTopRow}>
            <Text style={styles.readinessTitle}>Checkout readiness</Text>
            <SyncStatusPill tone={checkoutStatus.tone} label={checkoutStatus.label} compact />
          </View>

          <View style={styles.readinessChipsRow}>
            <View style={[styles.readinessChip, savedAddress ? styles.readinessChipReady : styles.readinessChipPending]}>
              <Text style={[styles.readinessChipText, savedAddress ? styles.readinessChipTextReady : styles.readinessChipTextPending]}>
                Address
              </Text>
            </View>
            <View style={[styles.readinessChip, savedPaymentMethod ? styles.readinessChipReady : styles.readinessChipPending]}>
              <Text style={[styles.readinessChipText, savedPaymentMethod ? styles.readinessChipTextReady : styles.readinessChipTextPending]}>
                Payment
              </Text>
            </View>
            <View style={[styles.readinessChip, checkoutReady ? styles.readinessChipReady : styles.readinessChipPending]}>
              <Text style={[styles.readinessChipText, checkoutReady ? styles.readinessChipTextReady : styles.readinessChipTextPending]}>
                Confirm
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Delivery</Text>
        <AnimatedPressable style={styles.blockBtn} activeOpacity={0.8} onPress={() => setAddAddressSheetVisible(true)}>
          <View style={styles.blockLeft}>
            <Ionicons name="location-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>{savedAddress ? savedAddress.street : 'Add delivery address'}</Text>
              <Text style={styles.blockSub}>
                {savedAddress ? `${savedAddress.city} | ${savedAddress.postcode}` : 'Required for postage'}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </AnimatedPressable>

        <AnimatedPressable style={styles.blockBtn} activeOpacity={0.8} onPress={() => navigation.navigate('Postage')}>
          <View style={styles.blockLeft}>
            <Ionicons name="cube-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>{postageOption.label}</Text>
              <Text style={styles.blockSub}>{postageOption.etaLabel}</Text>
            </View>
          </View>
          <Text style={styles.blockRightPrice}>{formatFromFiat(POSTAGE_FEE, 'GBP')}</Text>
        </AnimatedPressable>

        <Text style={styles.sectionTitle}>Payment</Text>
        {paymentPolicyLabel ? <Text style={styles.policyHint}>Policy scope: {paymentPolicyLabel}</Text> : null}
        <AnimatedPressable
          style={styles.blockBtn}
          activeOpacity={0.8}
          onPress={() => {
            if (!allowCardPayments) {
              show('Cards are unavailable for your region. Open Payments for supported rails.', 'error');
              navigation.navigate('Payments');
              return;
            }

            setAddCardSheetVisible(true);
          }}
        >
          <View style={styles.blockLeft}>
            <Ionicons name="card-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>{savedPaymentMethod ? savedPaymentMethod.label : 'Add payment method'}</Text>
              <Text style={styles.blockSub}>
                {!allowCardPayments
                  ? 'Cards unavailable in your policy region'
                  : (savedPaymentMethod?.details ?? 'Card, Apple Pay, or Google Pay')}
              </Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </AnimatedPressable>

        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.summaryCard}>
          <SummaryRow label="Item price" value={formatFromFiat(item.price, 'GBP')} />
          <SummaryRow label="Platform charge" value={formatFromFiat(PLATFORM_CHARGE, 'GBP')} info />
          <SummaryRow label="Postage" value={formatFromFiat(POSTAGE_FEE, 'GBP')} />
          <View style={styles.divider} />
          <SummaryRow label="Total" value={formatFromFiat(TOTAL, 'GBP')} bold />
        </View>

        <Text style={styles.termsText}>
          By tapping "Pay", you agree to our Terms of Sale and Privacy Policy. You have 2 days to report an issue after delivery.
        </Text>

        {!checkoutReady && (
          <Text style={styles.requirementText}>Add both delivery details and a payment method to continue.</Text>
        )}
        {isHydratingCheckout && (
          <Text style={styles.syncText}>Syncing saved checkout details...</Text>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky Bottom Footer */}
      <View style={styles.footer}>
        <View style={styles.footerPriceCol}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalPrice}>{formatFromFiat(TOTAL, 'GBP')}</Text>
        </View>
        <AnimatedPressable 
          style={[styles.payBtn, (!checkoutReady || isSubmittingPayment) && styles.payBtnDisabled]} 
          activeOpacity={0.9} 
          onPress={handlePay}
          disabled={!checkoutReady || isSubmittingPayment}
        >
          <Text style={styles.payBtnText}>{isSubmittingPayment ? 'Processing...' : 'Pay securely'}</Text>
        </AnimatedPressable>
      </View>

      <AddCardSheet visible={addCardSheetVisible} onDismiss={() => setAddCardSheetVisible(false)} />
      <AddAddressSheet visible={addAddressSheetVisible} onDismiss={() => setAddAddressSheetVisible(false)} />
    </SafeAreaView>
  );
}

function SummaryRow({ label, value, bold, info }: { label: string; value: string; bold?: boolean; info?: boolean }) {
  return (
    <View style={summaryStyles.row}>
      <View style={summaryStyles.labelRow}>
        <Text style={[summaryStyles.label, bold && summaryStyles.bold]}>{label}</Text>
        {info && <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} style={{ marginLeft: 6 }} />}
      </View>
      <Text style={[summaryStyles.value, bold && summaryStyles.bold]}>{value}</Text>
    </View>
  );
}

const summaryStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center' },
  label: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  value: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  bold: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16 },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  scrollContent: { paddingHorizontal: 20, paddingTop: 16 },

  itemCard: {
    flexDirection: 'row',
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 16,
    padding: 12,
    marginBottom: 32,
    gap: 16,
    alignItems: 'center',
  },
  itemThumb: { width: 64, height: 64, borderRadius: 12 },
  itemInfo: { flex: 1, justifyContent: 'center' },
  itemTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  itemSeller: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginBottom: 4 },
  itemPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },

  readinessCard: {
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 20,
  },
  readinessTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  readinessTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  readinessChipsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  readinessChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readinessChipReady: {
    backgroundColor: IS_LIGHT ? '#ece4d8' : '#1b2e23',
    borderColor: IS_LIGHT ? '#cdbc9f' : '#335444',
  },
  readinessChipPending: {
    backgroundColor: PANEL_SOFT_BG,
    borderColor: PANEL_BORDER,
  },
  readinessChipText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
  readinessChipTextReady: {
    color: BRAND,
  },
  readinessChipTextPending: {
    color: Colors.textSecondary,
  },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },
  policyHint: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
    marginBottom: 10,
    marginLeft: 4,
  },

  blockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
  },
  blockLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  blockTextCol: { justifyContent: 'center' },
  blockTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  blockSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  blockRightPrice: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  summaryCard: { backgroundColor: PANEL_BG, borderWidth: 1, borderColor: PANEL_BORDER, padding: 24, borderRadius: 20, marginBottom: 24 },
  divider: { height: 1, backgroundColor: PANEL_BORDER, marginVertical: 12 },

  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, lineHeight: 18, textAlign: 'center', paddingHorizontal: 16 },
  requirementText: {
    marginTop: 12,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.danger,
    textAlign: 'center',
  },
  syncText: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
  },

  footer: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    backgroundColor: FOOTER_BG, 
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  footerPriceCol: { flex: 1 },
  footerTotalLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  footerTotalPrice: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  payBtn: { backgroundColor: Colors.accent, height: 56, borderRadius: 28, paddingHorizontal: 48, alignItems: 'center', justifyContent: 'center' },
  payBtnDisabled: { opacity: 0.45 },
  payBtnText: { color: Colors.textInverse, fontSize: 16, fontFamily: 'Inter_700Bold' }
});

