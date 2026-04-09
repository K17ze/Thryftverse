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
import { RefreshIndicator } from '../components/RefreshIndicator';
import { EmptyState } from '../components/EmptyState';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { useStore } from '../store/useStore';
import { listUserOrders } from '../services/commerceApi';
import { CachedImage } from '../components/CachedImage';
import { getListingCoverUri } from '../utils/media';

const { width } = Dimensions.get('window');

type OrderItem = {
  id: string;
  item: Listing;
  status: string;
  isDone: boolean;
  buyer?: User;
};

export default function MyOrdersScreen() {
  const navigation = useNavigation<any>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings, refreshListings } = useBackendData();
  const currentUser = useStore((state) => state.currentUser);
  const viewerId = currentUser?.id ?? 'u1';
  const [activeTab, setActiveTab] = useState<'buying' | 'selling'>('buying');
  const [backendOrders, setBackendOrders] = useState<
    Array<{
      id: string;
      buyerId: string;
      sellerId: string;
      listingId: string;
      listingTitle: string;
      listingImageUrl: string | null;
      status: string;
      totalGbp: number;
      createdAt: string;
    }>
  >([]);

  const listingPool = React.useMemo(() => (listings.length ? listings : MOCK_LISTINGS), [listings]);

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
        ? [{ id: 'o3', item: awaitingDispatchItem, status: 'Awaiting Dispatch', isDone: false, buyer: MOCK_USERS[1] }]
        : []),
      ...(completedItem
        ? [{ id: 'o4', item: completedItem, status: 'Completed', isDone: true, buyer: MOCK_USERS[2] }]
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

      return {
        id: order.id,
        item: fallbackListing,
        status: statusLabelByState[order.status] ?? 'In progress',
        isDone: order.status === 'delivered' || order.status === 'cancelled',
        buyer: MOCK_USERS.find((user) => user.id === order.buyerId),
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
  const [statusFilter, setStatusFilter] = useState<'All' | 'In Progress' | 'Cancelled' | 'Completed'>('All');
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
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>My Orders</Text>
      </View>

      {/* Restored Custom Tabs */}
      <View style={styles.tabsContainer}>
        <AnimatedPressable 
          style={[styles.tabBtn, activeTab === 'buying' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('buying')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'buying' && styles.activeTabText]}>Buying</Text>
        </AnimatedPressable>
        <AnimatedPressable 
          style={[styles.tabBtn, activeTab === 'selling' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('selling')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'selling' && styles.activeTabText]}>Selling</Text>
        </AnimatedPressable>
      </View>

      {/* Filter Pills Horizontal List */}
      <View style={{ marginBottom: 16 }}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        >
          {['All', 'In Progress', 'Cancelled', 'Completed'].map(f => (
            <AnimatedPressable 
              key={f} 
              style={[styles.filterPill, statusFilter === f && styles.activeFilterPill]}
              activeOpacity={0.8}
              onPress={() => setStatusFilter(f as 'All' | 'In Progress' | 'Cancelled' | 'Completed')}
            >
              <Text style={[styles.filterText, statusFilter === f && styles.activeFilterText]}>{f}</Text>
            </AnimatedPressable>
          ))}
        </ScrollView>
      </View>

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
            filteredOrders.map((order, index) => (
              <Reanimated.View key={order.id} entering={FadeInDown.delay(index * 60).duration(400)}>
                <AnimatedPressable 
                  style={styles.cardGroup}
                  onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
                  activeOpacity={0.9}
                >
                  <View style={styles.orderRow}>
                    <CachedImage uri={getListingCoverUri(order.item.images, 'https://picsum.photos/seed/order-thumb-fallback/300/400')} style={styles.orderThumb} contentFit="cover" />
                    <View style={styles.orderInfo}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={[styles.orderStatus, order.isDone && styles.orderStatusDone]}>{order.status}</Text>
                        {order.buyer && <Text style={styles.buyerText}>to {order.buyer.username}</Text>}
                      </View>
                      <Text style={styles.orderTitle} numberOfLines={1}>{order.item.title}</Text>
                      <Text style={styles.orderPrice}>{formatFromFiat(order.item.price, 'GBP', { displayMode: 'fiat' })}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  </View>
                </AnimatedPressable>
              </Reanimated.View>
            ))
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
  
  tabsContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: Colors.card, borderRadius: 24, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 20 },
  activeTabBtn: { backgroundColor: Colors.cardAlt },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted },
  activeTabText: { color: Colors.textPrimary },

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
  orderPrice: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  buyerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted },
});
