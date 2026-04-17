import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Dimensions,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { useSharedValue, useAnimatedScrollHandler, FadeInDown } from 'react-native-reanimated';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MOCK_LISTINGS, MOCK_USERS, Listing, User } from '../data/mockData';
import { mockArrayOrEmpty, mockFind } from '../utils/mockGate';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { EmptyState } from '../components/EmptyState';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { useStore } from '../store/useStore';
import { CommerceUserOrder, listUserOrders } from '../services/commerceApi';
import { CachedImage } from '../components/CachedImage';
import { getListingCoverUri } from '../utils/media';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Motion } from '../constants/motion';

const { width } = Dimensions.get('window');

type OrderItem = {
  id: string;
  item: Listing;
  status: string;
  isDone: boolean;
  buyer?: User;
};

type OrdersTab = 'buying' | 'selling';
type OrdersStatusFilter = 'All' | 'In Progress' | 'Cancelled' | 'Completed';

const ORDER_TAB_OPTIONS: Array<{ value: OrdersTab; label: string; accessibilityLabel: string }> = [
  { value: 'buying', label: 'Buying', accessibilityLabel: 'Show buying orders' },
  { value: 'selling', label: 'Selling', accessibilityLabel: 'Show selling orders' },
];

const ORDER_STATUS_FILTER_OPTIONS: Array<{ value: OrdersStatusFilter; label: string; accessibilityLabel: string }> = [
  { value: 'All', label: 'All', accessibilityLabel: 'Filter orders by all statuses' },
  { value: 'In Progress', label: 'In Progress', accessibilityLabel: 'Filter orders by in progress status' },
  { value: 'Cancelled', label: 'Cancelled', accessibilityLabel: 'Filter orders by cancelled status' },
  { value: 'Completed', label: 'Completed', accessibilityLabel: 'Filter orders by completed status' },
];

export default function MyOrdersScreen() {
  const navigation = useNavigation<any>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings, refreshListings } = useBackendData();
  const reducedMotionEnabled = useReducedMotion();
  const currentUser = useStore((state) => state.currentUser);
  const viewerId = currentUser?.id ?? 'u1';
  const [activeTab, setActiveTab] = useState<OrdersTab>('buying');
  const [backendOrders, setBackendOrders] = useState<CommerceUserOrder[]>([]);

  const listingPool = React.useMemo(() => (listings.length ? listings : mockArrayOrEmpty(MOCK_LISTINGS)), [listings]);

  const syncOrders = React.useCallback(async () => {
    try {
      const items = await listUserOrders(viewerId, 'all', 80);
      setBackendOrders(items);
    } catch {
      setBackendOrders([]);
    }
  }, [viewerId]);

  React.useEffect(() => {
    void syncOrders();
  }, [syncOrders]);

  // Restored full mock mapping for Buying and Selling tabs
  const buyingOrders: OrderItem[] = React.useMemo(() => {
    const inTransitItem = listingPool[0];
    const deliveredItem = listingPool[2] || listingPool[1] || listingPool[0];

    return [
      ...(inTransitItem ? [{ id: 'o1', item: inTransitItem, status: 'In Transit', isDone: false }] : []),
      ...(deliveredItem ? [{ id: 'o2', item: deliveredItem, status: 'Delivered', isDone: true }] : []),
    ];
  }, [listingPool]);

  const sellingOrders: OrderItem[] = React.useMemo(() => {
    const awaitingDispatchItem = listingPool[6] || listingPool[0];
    const completedItem = listingPool[1] || listingPool[0];

    return [
      ...(awaitingDispatchItem
        ? [{ id: 'o3', item: awaitingDispatchItem, status: 'Awaiting Dispatch', isDone: false, buyer: mockArrayOrEmpty(MOCK_USERS)[1] }]
        : []),
      ...(completedItem
        ? [{ id: 'o4', item: completedItem, status: 'Completed', isDone: true, buyer: mockArrayOrEmpty(MOCK_USERS)[2] }]
        : []),
    ];
  }, [listingPool]);

  const backendOrderCards: OrderItem[] = React.useMemo(() => {
    const statusLabelByState: Record<string, string> = {
      created: 'Awaiting Payment',
      paid: 'Paid',
      shipped: 'Shipped',
      delivered: 'Delivered',
      cancelled: 'Cancelled',
    };

    return backendOrders.map((order) => {
      const existingListing = listingPool.find((entry) => entry.id === order.listingId);
      const fallbackListing: Listing = existingListing ?? {
        id: order.listingId,
        title: order.listingTitle || 'Ordered item',
        brand: 'Thryftverse',
        size: 'One size',
        condition: 'Very good',
        price: order.totalGbp,
        priceWithProtection: order.totalGbp,
        images: [order.listingImageUrl ?? `https://picsum.photos/seed/${order.listingId}/400/400`],
        likes: 0,
        sellerId: order.sellerId,
        category: 'general',
        subcategory: 'General',
        description: order.listingTitle || 'Order item',
      };

      const normalizedStatusLabel =
        order.status === 'shipped' && order.trackingNumber
          ? 'In Transit'
          : statusLabelByState[order.status] ?? 'In progress';

      return {
        id: order.id,
        item: fallbackListing,
        status: normalizedStatusLabel,
        isDone: order.status === 'delivered' || order.status === 'cancelled',
        buyer: mockFind(MOCK_USERS, (user) => user.id === order.buyerId),
      };
    });
  }, [backendOrders, listingPool]);

  const backendOrderById = React.useMemo(
    () => new Map(backendOrders.map((order) => [order.id, order])),
    [backendOrders]
  );

  const backendBuyingOrders = React.useMemo(
    () => backendOrderCards.filter((order) => backendOrderById.get(order.id)?.buyerId === viewerId),
    [backendOrderById, backendOrderCards, viewerId]
  );

  const backendSellingOrders = React.useMemo(
    () => backendOrderCards.filter((order) => backendOrderById.get(order.id)?.sellerId === viewerId),
    [backendOrderById, backendOrderCards, viewerId]
  );

  const activeOrders = React.useMemo(() => {
    if (backendOrders.length > 0) {
      return activeTab === 'buying' ? backendBuyingOrders : backendSellingOrders;
    }

    return activeTab === 'buying' ? buyingOrders : sellingOrders;
  }, [activeTab, backendBuyingOrders, backendOrders, backendSellingOrders, buyingOrders, sellingOrders]);

  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<OrdersStatusFilter>('All');
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshListings(), syncOrders()]);
    setTimeout(() => setRefreshing(false), 400);
  };

  const filteredOrders = React.useMemo(() => {
    if (statusFilter === 'All') {
      return activeOrders;
    }

    if (statusFilter === 'Cancelled') {
      return activeOrders.filter((order) => /cancel/i.test(order.status));
    }

    if (statusFilter === 'Completed') {
      return activeOrders.filter((order) => order.isDone && !/cancel/i.test(order.status));
    }

    return activeOrders.filter((order) => !order.isDone && !/cancel/i.test(order.status));
  }, [activeOrders, statusFilter]);

  const AnimatedScrollView = Reanimated.createAnimatedComponent(ScrollView);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>My Orders</Text>
      </View>

      {/* Restored Custom Tabs */}
      <AppSegmentControl
        style={styles.tabsContainer}
        options={ORDER_TAB_OPTIONS}
        value={activeTab}
        onChange={setActiveTab}
        fullWidth
        optionStyle={styles.tabBtn}
        optionActiveStyle={styles.activeTabBtn}
        optionTextStyle={styles.tabText}
        optionTextActiveStyle={styles.activeTabText}
      />

      {/* Filter Pills Horizontal List */}
      <AppSegmentControl
        style={styles.filterStrip}
        options={ORDER_STATUS_FILTER_OPTIONS}
        value={statusFilter}
        onChange={setStatusFilter}
        fullWidth
        optionStyle={styles.filterPill}
        optionActiveStyle={styles.activeFilterPill}
        optionTextStyle={styles.filterText}
        optionTextActiveStyle={styles.activeFilterText}
      />

      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={10} />
        
        <AnimatedScrollView 
          contentContainerStyle={[styles.content, filteredOrders.length === 0 && { flex: 1, justifyContent: 'center' }]} 
          showsVerticalScrollIndicator={false}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
        >
          {filteredOrders.length === 0 ? (
            <EmptyState
              icon="cube-outline"
              title={statusFilter === 'All' ? 'No tracking data' : `No ${statusFilter.toLowerCase()} orders`}
              subtitle={
                statusFilter === 'All'
                  ? `When you ${activeTab === 'buying' ? 'buy' : 'sell'} items, you'll track them here.`
                  : 'Try another status filter to view more orders.'
              }
              ctaLabel={activeTab === 'buying' ? 'Start Browsing' : 'List an Item'}
              onCtaPress={() => navigation.navigate(activeTab === 'buying' ? 'MainTabs' : 'Sell')}
            />
          ) : (
            filteredOrders.map((order, index) => {
              const backendMeta = backendOrderById.get(order.id);
              const trackingSnippet = backendMeta?.trackingNumber
                ? `${backendMeta.shippingProvider ? `${backendMeta.shippingProvider.toUpperCase()} · ` : ''}${backendMeta.trackingNumber}`
                : null;

              return (
                <Reanimated.View
                  key={order.id}
                  entering={
                    reducedMotionEnabled
                      ? undefined
                      : FadeInDown
                          .delay(Math.min(index, Motion.list.maxStaggerItems) * Motion.list.staggerStep)
                          .duration(Motion.list.enterDuration)
                  }
                >
                  <AnimatedPressable
                    style={styles.cardGroup}
                    onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                    activeOpacity={0.9}
                    accessibilityRole="button"
                    accessibilityLabel={`Open order ${order.item.title}`}
                    accessibilityHint={`View details for this ${order.status.toLowerCase()} order`}
                  >
                    <View style={styles.orderRow}>
                      <CachedImage uri={getListingCoverUri(order.item.images, 'https://picsum.photos/seed/order-thumb-fallback/300/400')} style={styles.orderThumb} contentFit="cover" />
                      <View style={styles.orderInfo}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={[styles.orderStatus, order.isDone && styles.orderStatusDone]}>{order.status}</Text>
                          {order.buyer && <Text style={styles.buyerText}>to {order.buyer.username}</Text>}
                        </View>
                        <Text style={styles.orderTitle} numberOfLines={1}>{order.item.title}</Text>
                        {trackingSnippet ? <Text style={styles.orderTracking} numberOfLines={1}>Tracking: {trackingSnippet}</Text> : null}
                        <Text style={styles.orderPrice}>{formatFromFiat(order.item.price, 'GBP', { displayMode: 'fiat' })}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                    </View>
                  </AnimatedPressable>
                </Reanimated.View>
              );
            })
          )}
        </AnimatedScrollView>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  
  tabsContainer: { marginHorizontal: 20, backgroundColor: Colors.card, borderRadius: 24, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 12, borderRadius: 20, borderWidth: 0, backgroundColor: 'transparent' },
  activeTabBtn: { backgroundColor: Colors.cardAlt },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted },
  activeTabText: { color: Colors.textPrimary },

  filterStrip: { marginBottom: 16, marginHorizontal: 20, gap: 10 },
  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  activeFilterPill: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  activeFilterText: { color: Colors.background, fontFamily: 'Inter_700Bold' },

  content: { paddingHorizontal: 20, paddingBottom: 40 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginTop: 16 },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, textAlign: 'center', marginTop: 8 },

  cardGroup: { backgroundColor: Colors.card, borderRadius: 24, padding: 16, marginBottom: 16 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  orderThumb: { width: 70, height: 70, borderRadius: 16 },
  orderInfo: { flex: 1, justifyContent: 'center' },
  orderStatus: { fontSize: 13, fontFamily: 'Inter_700Bold', color: Colors.accent, marginBottom: 4, letterSpacing: 0.5 },
  orderStatusDone: { fontSize: 13, fontFamily: 'Inter_700Bold', color: Colors.success, marginBottom: 4, letterSpacing: 0.5 },
  orderTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  orderTracking: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textMuted, marginBottom: 4 },
  orderPrice: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  buyerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted },
});
