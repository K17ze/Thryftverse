import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS } from '../data/mockData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { getOrder } from '../services/commerceApi';

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

  return 'shipped';
}

function buildTrackingSteps(status: OrderStatus, sellerUsername: string): TrackingStep[] {
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

  const activeIndexByStatus: Record<Exclude<OrderStatus, 'cancelled'>, number> = {
    created: 0,
    paid: 1,
    shipped: 2,
    delivered: 4,
  };

  const activeIndex = activeIndexByStatus[status as Exclude<OrderStatus, 'cancelled'>];
  const allDone = status === 'delivered';

  const steps: Array<Omit<TrackingStep, 'done' | 'active'>> = [
    {
      id: 's1',
      label: 'Order confirmed',
      subtitle: 'Payment received. Seller has been notified.',
      date: '19 Mar 2026',
    },
    {
      id: 's2',
      label: 'Seller preparing',
      subtitle: `${sellerUsername} is packing your order.`,
      date: '20 Mar 2026',
    },
    {
      id: 's3',
      label: 'In transit',
      subtitle: 'Your parcel is on the way.',
      date: '21 Mar 2026',
    },
    {
      id: 's4',
      label: 'Out for delivery',
      subtitle: 'Your parcel will arrive today.',
    },
    {
      id: 's5',
      label: 'Delivered',
      subtitle: 'You have 2 days to raise any issues.',
    },
  ];

  return steps.map((step, index) => ({
    ...step,
    done: allDone || index < activeIndex,
    active: !allDone && index === activeIndex,
  }));
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
    subtitle: `${sellerUsername} has to send it by 26 Mar. We will keep you updated.`,
  };
}

export default function OrderDetailScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();
  const { orderId } = route.params;
  const [backendOrder, setBackendOrder] = React.useState<
    | {
        id: string;
        buyerId: string;
        sellerId: string;
        listingId: string;
        subtotalGbp: number;
        buyerProtectionFeeGbp: number;
        totalGbp: number;
        status: string;
        addressId: number | null;
        paymentMethodId: number | null;
        createdAt: string;
        updatedAt: string;
      }
    | null
  >(null);
  const [isSyncingOrder, setIsSyncingOrder] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    const syncOrder = async () => {
      setIsSyncingOrder(true);
      try {
        const order = await getOrder(orderId);
        if (!cancelled) {
          setBackendOrder(order);
        }
      } catch {
        if (!cancelled) {
          setBackendOrder(null);
        }
      } finally {
        if (!cancelled) {
          setIsSyncingOrder(false);
        }
      }
    };

    void syncOrder();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const listingPool = listings.length > 0 ? listings : MOCK_LISTINGS;
  const listingId = backendOrder?.listingId;
  const listing =
    (listingId
      ? listingPool.find((item) => item.id === listingId) ?? MOCK_LISTINGS.find((item) => item.id === listingId)
      : undefined) ??
    listingPool[0] ??
    MOCK_LISTINGS[0];

  const seller =
    MOCK_USERS.find((item) => item.id === (backendOrder?.sellerId ?? listing.sellerId)) ??
    MOCK_USERS[0];

  const subtotal = backendOrder?.subtotalGbp ?? listing.price;
  const buyerProtectionFee = backendOrder?.buyerProtectionFeeGbp ?? listing.price * 0.05 + 0.7;
  const postageFee = backendOrder
    ? Math.max(0, Number((backendOrder.totalGbp - subtotal - buyerProtectionFee).toFixed(2)))
    : 2.89;
  const totalPaid = backendOrder?.totalGbp ?? subtotal + buyerProtectionFee + postageFee;

  const orderStatus = normalizeOrderStatus(backendOrder?.status);
  const trackingSteps = buildTrackingSteps(orderStatus, seller.username);
  const statusBanner = getStatusBanner(orderStatus, seller.username);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* ── Header ── */}
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

        {/* ── Item Card ── */}
        <AnimatedPressable
          style={styles.itemCard}
          onPress={() => navigation.navigate('ItemDetail', { itemId: listing.id })}
          activeOpacity={0.88}
        >
          <Image source={{ uri: listing.images[0] }} style={styles.itemThumb} />
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={styles.itemMeta}>{listing.size} · {listing.condition}</Text>
            <Text style={styles.itemPrice}>{formatFromFiat(listing.price, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

        {/* ── Status Banner ── */}
        <View style={styles.statusBanner}>
          <Ionicons name="cube-outline" size={20} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>{statusBanner.label}</Text>
            <Text style={styles.statusSub}>{statusBanner.subtitle}</Text>
          </View>
        </View>
        {isSyncingOrder ? <Text style={styles.syncHint}>Syncing live order status...</Text> : null}

        {/* ── Tracking Timeline ── */}
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

        {/* ── Seller Info ── */}
        <Text style={styles.sectionTitle}>Seller</Text>
        <AnimatedPressable
          style={styles.sellerCard}
          onPress={() => navigation.navigate('UserProfile', { userId: seller.id })}
          activeOpacity={0.88}
        >
          <Image source={{ uri: seller.avatar }} style={styles.sellerAvatar} />
          <View style={styles.sellerInfo}>
            <Text style={styles.sellerName}>{seller.username}</Text>
            <View style={styles.sellerMeta}>
              <Ionicons name="star" size={13} color={Colors.star} />
              <Text style={styles.sellerRating}>{seller.rating} ({seller.reviewCount} reviews)</Text>
            </View>
          </View>
          <AnimatedPressable
            style={styles.msgBtn}
            onPress={() => navigation.navigate('Chat', { conversationId: 'c1' })}
          >
            <Text style={styles.msgBtnText}>Message</Text>
          </AnimatedPressable>
        </AnimatedPressable>

        {/* ── Transaction Info ── */}
        <Text style={styles.sectionTitle}>Transaction</Text>
        <View style={styles.txCard}>
          <TxRow label="Item price" value={formatFromFiat(subtotal, 'GBP', { displayMode: 'fiat' })} />
          <TxRow label="Buyer protection" value={formatFromFiat(buyerProtectionFee, 'GBP', { displayMode: 'fiat' })} />
          <TxRow label="Postage" value={`from ${formatFromFiat(postageFee, 'GBP', { displayMode: 'fiat' })}`} />
          <View style={styles.txDivider} />
          <TxRow label="Total paid" value={formatFromFiat(totalPaid, 'GBP', { displayMode: 'fiat' })} bold />
        </View>

        {/* ── Actions ── */}
        <View style={styles.actionsRow}>
          <AnimatedPressable 
            style={styles.actionBtnSecondary} 
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Report', { type: 'item' })}
          >
            <Ionicons name="alert-circle-outline" size={18} color={Colors.textPrimary} />
            <Text style={styles.actionBtnSecondaryText}>Report issue</Text>
          </AnimatedPressable>
          <AnimatedPressable 
            style={styles.actionBtnPrimary} 
            activeOpacity={0.85}
            onPress={() => navigation.navigate('WriteReview', { orderId })}
          >
            <Text style={styles.actionBtnPrimaryText}>Mark as received</Text>
          </AnimatedPressable>
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
  itemThumb: { width: 72, height: 72, borderRadius: 14 },
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
    marginBottom: 28,
    borderWidth: 1,
    borderColor: STATUS_PANEL_BORDER,
  },
  statusLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.accent, marginBottom: 4 },
  statusSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 20 },
  syncHint: {
    marginTop: -18,
    marginBottom: 22,
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
    paddingHorizontal: 16, paddingVertical: 10,
    borderRadius: 20, borderWidth: 1, borderColor: Colors.accent,
  },
  msgBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.accent },

  // Transaction card
  txCard: { backgroundColor: Colors.card, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, marginBottom: 28 },
  txDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6 },

  // Actions
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 20,
    backgroundColor: Colors.card,
  },
  actionBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  actionBtnPrimary: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 20,
    backgroundColor: Colors.accent,
  },
  actionBtnPrimaryText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.background },
});
