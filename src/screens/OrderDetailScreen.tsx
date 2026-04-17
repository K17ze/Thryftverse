import React from 'react';
import {
  AnimatedPressable,
} from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS } from '../data/mockData';
import { mockFind, mockArrayOrEmpty } from '../utils/mockGate';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import {
  CommerceOrder,
  OrderParcelEvent,
  getOrder,
  getOrderParcelEvents,
} from '../services/commerceApi';
import { calculatePlatformChargeGbp } from '../utils/currencyAuthoringFlows';
import { CachedImage } from '../components/CachedImage';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { getListingCoverUri } from '../utils/media';
import { AppButton } from '../components/ui/AppButton';

type NavT = StackNavigationProp<RootStackParamList>;
type RouteT = RouteProp<RootStackParamList, 'OrderDetail'>;

type TrackingStep = {
  id: string;
  label: string;
  subtitle: string;
  date?: string;
  done: boolean;
  active?: boolean;
};

const IS_LIGHT = ActiveTheme === 'light';
const STATUS_PANEL_BG = IS_LIGHT ? '#e6efe8' : '#0d2020';
const STATUS_PANEL_BORDER = IS_LIGHT ? '#c5d7ca' : '#1a3a3a';

type OrderStatus = 'created' | 'paid' | 'shipped' | 'delivered' | 'cancelled';

function normalizeOrderStatus(status?: string): OrderStatus {
  if (status === 'created' || status === 'paid' || status === 'shipped' || status === 'delivered' || status === 'cancelled') {
    return status;
  }

  return 'created';
}

function formatTimelineDate(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getParcelEventDisplay(
  eventType: OrderParcelEvent['eventType'],
  sellerUsername: string
): { label: string; subtitle: string } {
  if (eventType === 'picked_up') {
    return {
      label: 'Picked up',
      subtitle: 'Carrier has collected your parcel from the seller.',
    };
  }

  if (eventType === 'in_transit') {
    return {
      label: 'In transit',
      subtitle: 'Your parcel is moving through the carrier network.',
    };
  }

  if (eventType === 'out_for_delivery') {
    return {
      label: 'Out for delivery',
      subtitle: 'Your parcel is out for delivery today.',
    };
  }

  if (eventType === 'delivered' || eventType === 'collection_confirmed') {
    return {
      label: 'Delivered',
      subtitle: 'Delivery confirmed. You can now leave a review.',
    };
  }

  if (eventType === 'delivery_failed') {
    return {
      label: 'Delivery failed',
      subtitle: 'Carrier attempted delivery but could not complete it.',
    };
  }

  return {
    label: 'Returned to sender',
    subtitle: `${sellerUsername}'s parcel is being returned by the carrier.`,
  };
}

function buildTrackingSteps(
  status: OrderStatus,
  sellerUsername: string,
  order: CommerceOrder | null,
  parcelEvents: OrderParcelEvent[]
): TrackingStep[] {
  if (status === 'cancelled') {
    return [
      {
        id: 'cancelled',
        label: 'Order cancelled',
        subtitle: 'This order was cancelled and no further delivery updates will be shown.',
        done: false,
        active: true,
      },
    ];
  }

  const steps: TrackingStep[] = [
    {
      id: 'order_confirmed',
      label: 'Order confirmed',
      subtitle: 'Payment received. Seller has been notified.',
      date: formatTimelineDate(order?.createdAt),
      done: status !== 'created',
      active: status === 'created',
    },
    {
      id: 'seller_preparing',
      label: 'Seller preparing',
      subtitle: `${sellerUsername} is packing your order.`,
      date: formatTimelineDate(status !== 'created' ? order?.updatedAt : null),
      done: status === 'shipped' || status === 'delivered',
      active: status === 'paid',
    },
  ];

  if (parcelEvents.length > 0) {
    for (const event of parcelEvents) {
      const display = getParcelEventDisplay(event.eventType, sellerUsername);
      steps.push({
        id: `carrier_${event.id}`,
        label: display.label,
        subtitle: display.subtitle,
        date: formatTimelineDate(event.occurredAt ?? event.receivedAt),
        done: true,
      });
    }

    if (status === 'shipped' && steps.length > 0) {
      const lastStep = steps[steps.length - 1];
      steps[steps.length - 1] = {
        ...lastStep,
        done: false,
        active: true,
      };
    }
  } else if (status === 'shipped' || status === 'delivered') {
    steps.push({
      id: 'in_transit_fallback',
      label: 'In transit',
      subtitle: 'Your parcel is on the way.',
      date: formatTimelineDate(order?.shippedAt ?? order?.updatedAt),
      done: status === 'delivered',
      active: status === 'shipped',
    });
  }

  const hasDeliveredStep = steps.some((step) => step.label === 'Delivered');
  if (status === 'delivered' && !hasDeliveredStep) {
    steps.push({
      id: 'delivered_fallback',
      label: 'Delivered',
      subtitle: 'Delivery marked complete. You can now leave a review.',
      date: formatTimelineDate(order?.deliveredAt ?? order?.updatedAt),
      done: true,
    });
  }

  return steps;
}

function getStatusBanner(status: OrderStatus, sellerUsername: string) {
  if (status === 'created') {
    return {
      label: 'Awaiting payment',
      subtitle: 'Complete payment to confirm this order and notify the seller.',
    };
  }

  if (status === 'paid') {
    return {
      label: 'Seller preparing',
      subtitle: `${sellerUsername} is preparing your parcel for dispatch.`,
    };
  }

  if (status === 'delivered') {
    return {
      label: 'Delivered',
      subtitle: 'Delivery marked complete. You can now leave a review.',
    };
  }

  if (status === 'cancelled') {
    return {
      label: 'Cancelled',
      subtitle: 'This order has been cancelled.',
    };
  }

  return {
    label: 'In transit',
    subtitle: 'Your parcel is moving through the carrier network.',
  };
}

export default function OrderDetailScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();
  const { orderId } = route.params;
  const [backendOrder, setBackendOrder] = React.useState<CommerceOrder | null>(null);
  const [parcelEvents, setParcelEvents] = React.useState<OrderParcelEvent[]>([]);
  const [isSyncingOrder, setIsSyncingOrder] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const syncOrder = async () => {
      setIsSyncingOrder(true);
      try {
        const [order, events] = await Promise.all([
          getOrder(orderId),
          getOrderParcelEvents(orderId).catch(() => [] as OrderParcelEvent[]),
        ]);

        if (!cancelled) {
          setBackendOrder(order);
          setParcelEvents(events);
        }
      } catch {
        if (!cancelled) {
          setBackendOrder(null);
          setParcelEvents([]);
        }
      } finally {
        if (!cancelled) {
          setIsSyncingOrder(false);
        }
      }
    };

    void syncOrder();
    const refreshInterval = setInterval(() => {
      void syncOrder();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, [orderId]);

  const listingPool = listings.length > 0 ? listings : mockArrayOrEmpty(MOCK_LISTINGS);
  const listingId = backendOrder?.listingId;
  const listing =
    (listingId
      ? listingPool.find((item) => item.id === listingId) ?? mockFind(MOCK_LISTINGS, (item) => item.id === listingId)
      : undefined) ??
    listingPool[0] ??
    MOCK_LISTINGS[0];

  const seller =
    mockFind(MOCK_USERS, (item) => item.id === (backendOrder?.sellerId ?? listing.sellerId)) ??
    MOCK_USERS[0];

  const subtotal = backendOrder?.subtotalGbp ?? listing.price;
  const platformCharge =
    backendOrder?.platformChargeGbp ??
    backendOrder?.buyerProtectionFeeGbp ??
    calculatePlatformChargeGbp(listing.price);
  const postageFee = backendOrder?.postageFeeGbp ?? 2.89;
  const totalPaid = backendOrder?.totalGbp ?? subtotal + platformCharge + postageFee;

  const orderStatus = normalizeOrderStatus(backendOrder?.status);
  const trackingSteps = buildTrackingSteps(orderStatus, seller.username, backendOrder, parcelEvents);
  const statusBanner = getStatusBanner(orderStatus, seller.username);
  const latestParcelEvent = parcelEvents.length > 0 ? parcelEvents[parcelEvents.length - 1] : null;
  const shipmentLastUpdated = formatTimelineDate(
    latestParcelEvent?.occurredAt ?? latestParcelEvent?.receivedAt ?? backendOrder?.updatedAt
  );
  const showShipmentMeta = Boolean(
    backendOrder?.shippingProvider || backendOrder?.trackingNumber || backendOrder?.shippingLabelUrl || shipmentLastUpdated
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* -- Header -- */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Order Details</Text>
        <AnimatedPressable style={styles.moreBtn} onPress={() => navigation.navigate('HelpSupport')}>
          <Ionicons name="ellipsis-horizontal" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* -- Item Card -- */}
        <AnimatedPressable
          style={styles.itemCard}
          onPress={() => navigation.push('ItemDetail', { itemId: listing.id })}
          activeOpacity={0.88}
        >
          <SharedTransitionView
            style={styles.itemThumb}
            sharedTransitionTag={`image-${listing.id}-0`}
          >
            <CachedImage uri={getListingCoverUri(listing.images, 'https://picsum.photos/seed/order-detail-fallback/300/400')} style={styles.itemThumbImage} contentFit="cover" />
          </SharedTransitionView>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={styles.itemMeta}>{listing.size} - {listing.condition}</Text>
            <Text style={styles.itemPrice}>{formatFromFiat(subtotal, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

        {/* -- Status Banner -- */}
        <View style={styles.statusBanner}>
          <Ionicons name="cube-outline" size={20} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>{statusBanner.label}</Text>
            <Text style={styles.statusSub}>{statusBanner.subtitle}</Text>
          </View>
        </View>
        {isSyncingOrder ? <Text style={styles.syncHint}>Syncing live order status...</Text> : null}

        {showShipmentMeta ? (
          <>
            <Text style={styles.sectionTitle}>Shipment details</Text>
            <View style={styles.shipmentMetaCard}>
              {backendOrder?.shippingProvider ? (
                <ShipmentMetaRow label="Carrier" value={backendOrder.shippingProvider} />
              ) : null}
              {backendOrder?.trackingNumber ? (
                <ShipmentMetaRow label="Tracking #" value={backendOrder.trackingNumber} />
              ) : null}
              {shipmentLastUpdated ? (
                <ShipmentMetaRow label="Last update" value={shipmentLastUpdated} />
              ) : null}

              {backendOrder?.shippingLabelUrl ? (
                <AppButton
                  title="Open shipping label"
                  icon={<Ionicons name="open-outline" size={16} color={Colors.accent} />}
                  style={styles.shipmentLinkBtn}
                  titleStyle={styles.shipmentLinkBtnText}
                  iconContainerStyle={styles.shipmentLinkIconWrap}
                  variant="secondary"
                  size="sm"
                  onPress={() => {
                    if (!backendOrder.shippingLabelUrl) {
                      return;
                    }

                    void Linking.openURL(backendOrder.shippingLabelUrl).catch(() => {
                      // Invalid/unsupported URLs should not break the order detail screen.
                    });
                  }}
                  accessibilityLabel="Open shipping label"
                />
              ) : null}
            </View>
          </>
        ) : null}

        {/* -- Tracking Timeline -- */}
        <Text style={styles.sectionTitle}>Tracking</Text>
        <View style={styles.timelineCard}>
          {trackingSteps.map((step, index) => (
            <View key={step.id} style={styles.timelineRow}>
              {/* Left column: dot + line */}
              <View style={styles.timelineLeft}>
                <View style={[
                  styles.dot,
                  step.active && styles.dotActive,
                  !step.done && !step.active && styles.dotInactive,
                ]} />
                {index < trackingSteps.length - 1 && (
                  <View style={[styles.line, !step.done && styles.lineInactive]} />
                )}
              </View>
              {/* Right column: content */}
              <View style={styles.timelineContent}>
                <View style={styles.timelineTop}>
                  <Text style={[styles.stepLabel, !step.done && !step.active && styles.stepLabelInactive]}>
                    {step.label}
                  </Text>
                  {step.date && <Text style={styles.stepDate}>{step.date}</Text>}
                </View>
                <Text style={[styles.stepSub, !step.done && !step.active && styles.stepSubInactive]}>
                  {step.subtitle}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* -- Seller Info -- */}
        <Text style={styles.sectionTitle}>Seller</Text>
        <AnimatedPressable
          style={styles.sellerCard}
          onPress={() => navigation.navigate('UserProfile', { userId: seller.id })}
          activeOpacity={0.88}
        >
          <CachedImage uri={seller.avatar} style={styles.sellerAvatar} contentFit="cover" />
          <View style={styles.sellerInfo}>
            <Text style={styles.sellerName}>{seller.username}</Text>
            <View style={styles.sellerMeta}>
              <Ionicons name="star" size={13} color={Colors.star} />
              <Text style={styles.sellerRating}>{seller.rating} ({seller.reviewCount} reviews)</Text>
            </View>
          </View>
          <AppButton
            title="Message"
            style={styles.msgBtn}
            titleStyle={styles.msgBtnText}
            variant="secondary"
            size="sm"
            onPress={() => navigation.navigate('Chat', { conversationId: 'c1' })}
            accessibilityLabel="Message seller"
          />
        </AnimatedPressable>

        {/* -- Transaction Info -- */}
        <Text style={styles.sectionTitle}>Transaction</Text>
        <View style={styles.txCard}>
          <TxRow label="Item price" value={formatFromFiat(subtotal, 'GBP', { displayMode: 'fiat' })} />
          <TxRow label="Platform charge" value={formatFromFiat(platformCharge, 'GBP', { displayMode: 'fiat' })} />
          <TxRow label="Postage" value={`from ${formatFromFiat(postageFee, 'GBP', { displayMode: 'fiat' })}`} />
          <View style={styles.txDivider} />
          <TxRow label="Total paid" value={formatFromFiat(totalPaid, 'GBP', { displayMode: 'fiat' })} bold />
        </View>

        {/* -- Actions -- */}
        <View style={styles.actionsRow}>
          <AppButton
            title="Report issue"
            icon={<Ionicons name="alert-circle-outline" size={18} color={Colors.textPrimary} />}
            style={styles.actionBtnSecondary}
            titleStyle={styles.actionBtnSecondaryText}
            iconContainerStyle={styles.actionSecondaryIconWrap}
            variant="secondary"
            size="md"
            onPress={() => navigation.navigate('Report', { type: 'item' })}
            accessibilityLabel="Report issue"
          />
          <AppButton
            title="Mark as received"
            style={styles.actionBtnPrimary}
            titleStyle={styles.actionBtnPrimaryText}
            variant="primary"
            size="md"
            onPress={() => navigation.navigate('WriteReview', { orderId })}
            accessibilityLabel="Mark order as received"
          />
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TxRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={txStyles.row}>
      <Text style={[txStyles.label, bold && txStyles.bold]}>{label}</Text>
      <Text style={[txStyles.value, bold && txStyles.bold]}>{value}</Text>
    </View>
  );
}

function ShipmentMetaRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.shipmentMetaRow}>
      <Text style={styles.shipmentMetaLabel}>{label}</Text>
      <Text style={styles.shipmentMetaValue}>{value}</Text>
    </View>
  );
}

const txStyles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10 },
  label: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  value: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  bold: { fontFamily: 'Inter_700Bold', color: Colors.textPrimary, fontSize: 15 },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },
  moreBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.textPrimary,
  },

  content: { paddingHorizontal: 20, paddingTop: 8 },

  itemCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 14,
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  itemThumb: { width: 72, height: 72, borderRadius: 14, overflow: 'hidden' },
  itemThumbImage: { width: '100%', height: '100%' },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  itemMeta: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginBottom: 4 },
  itemPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },

  statusBanner: {
    flexDirection: 'row',
    backgroundColor: STATUS_PANEL_BG,
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 22,
    borderWidth: 1,
    borderColor: STATUS_PANEL_BORDER,
  },
  statusLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.accent, marginBottom: 4 },
  statusSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 20 },
  syncHint: {
    marginTop: -12,
    marginBottom: 18,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },

  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 14,
  },

  shipmentMetaCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  shipmentMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  shipmentMetaLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
    flex: 1,
  },
  shipmentMetaValue: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    flex: 2,
    textAlign: 'right',
  },
  shipmentLinkBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  shipmentLinkIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  shipmentLinkBtnText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.accent,
  },

  // Timeline
  timelineCard: { backgroundColor: Colors.card, borderRadius: 20, padding: 20, marginBottom: 28 },
  timelineRow: { flexDirection: 'row', gap: 16 },
  timelineLeft: { alignItems: 'center', width: 20 },
  dot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.accent,
    marginTop: 2,
  },
  dotActive: {
    backgroundColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOpacity: 0.6,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  dotInactive: { backgroundColor: Colors.border },
  line: { width: 2, flex: 1, backgroundColor: Colors.accent, marginVertical: 4, minHeight: 24 },
  lineInactive: { backgroundColor: Colors.borderLight },
  timelineContent: { flex: 1, paddingBottom: 20 },
  timelineTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  stepLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  stepLabelInactive: { color: Colors.textMuted },
  stepDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted },
  stepSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18 },
  stepSubInactive: { color: Colors.textMuted },

  // Seller card
  sellerCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    gap: 12,
    marginBottom: 28,
  },
  sellerAvatar: { width: 48, height: 48, borderRadius: 24 },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  sellerMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sellerRating: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  msgBtn: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  msgBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.accent },

  // Transaction card
  txCard: { backgroundColor: Colors.card, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, marginBottom: 28 },
  txDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },

  // Actions
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionBtnSecondary: {
    flex: 1,
    minHeight: 56,
    borderRadius: 20,
    backgroundColor: Colors.card,
  },
  actionSecondaryIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  actionBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  actionBtnPrimary: {
    flex: 2,
    minHeight: 56,
    borderRadius: 20,
    borderWidth: 0,
    backgroundColor: Colors.accent,
  },
  actionBtnPrimaryText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.background },
});
