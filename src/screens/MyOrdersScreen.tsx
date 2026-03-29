import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MOCK_LISTINGS, MOCK_USERS, Listing, User } from '../data/mockData';

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
  const [activeTab, setActiveTab] = useState<'buying' | 'selling'>('buying');

  // Restored full mock mapping for Buying and Selling tabs
  const buyingOrders: OrderItem[] = [
    { id: 'o1', item: MOCK_LISTINGS[0], status: 'In Transit', isDone: false },
    { id: 'o2', item: MOCK_LISTINGS[2], status: 'Delivered', isDone: true },
  ];

  const sellingOrders: OrderItem[] = [
    { id: 'o3', item: MOCK_LISTINGS[6], status: 'Awaiting Dispatch', isDone: false, buyer: MOCK_USERS[1] },
    { id: 'o4', item: MOCK_LISTINGS[1], status: 'Completed', isDone: true, buyer: MOCK_USERS[2] },
  ];

  const activeOrders = activeTab === 'buying' ? buyingOrders : sellingOrders;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.hugeTitle}>My Orders</Text>
      </View>

      {/* Restored Custom Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'buying' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('buying')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'buying' && styles.activeTabText]}>Buying</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={[styles.tabBtn, activeTab === 'selling' && styles.activeTabBtn]} 
          onPress={() => setActiveTab('selling')}
          activeOpacity={0.8}
        >
          <Text style={[styles.tabText, activeTab === 'selling' && styles.activeTabText]}>Selling</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Pills Horizontal List */}
      <View style={{ marginBottom: 16 }}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false} 
          contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
        >
          {['All', 'In Progress', 'Cancelled', 'Completed'].map(f => (
            <TouchableOpacity 
              key={f} 
              style={styles.filterPill}
              activeOpacity={0.8}
            >
              <Text style={styles.filterText}>{f}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {activeOrders.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="cube-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No tracking data</Text>
            <Text style={styles.emptySub}>When you {activeTab === 'buying' ? 'buy' : 'sell'} items, you'll track them here.</Text>
          </View>
        ) : (
          activeOrders.map((order) => (
            <TouchableOpacity 
              key={order.id} 
              style={styles.cardGroup}
              onPress={() => navigation.navigate('OrderDetail', { orderId: order.id })}
              activeOpacity={0.9}
            >
              <View style={styles.orderRow}>
                <Image source={{ uri: order.item.images[0] }} style={styles.orderThumb} />
                <View style={styles.orderInfo}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={[styles.orderStatus, order.isDone && styles.orderStatusDone]}>{order.status}</Text>
                    {order.buyer && <Text style={styles.buyerText}>to {order.buyer.username}</Text>}
                  </View>
                  <Text style={styles.orderTitle} numberOfLines={1}>{order.item.title}</Text>
                  <Text style={styles.orderPrice}>£{order.item.price.toFixed(2)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  
  tabsContainer: { flexDirection: 'row', marginHorizontal: 20, backgroundColor: '#111', borderRadius: 24, padding: 4, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 20 },
  activeTabBtn: { backgroundColor: '#333' },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted },
  activeTabText: { color: Colors.textPrimary },

  filterPill: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#111', borderWidth: 1, borderColor: '#333' },
  activeFilterPill: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  filterText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  activeFilterText: { color: Colors.background, fontFamily: 'Inter_700Bold' },

  content: { paddingHorizontal: 20, paddingBottom: 40 },
  emptyState: { alignItems: 'center', justifyContent: 'center', marginTop: 60, paddingHorizontal: 40 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginTop: 16 },
  emptySub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, textAlign: 'center', marginTop: 8 },

  cardGroup: { backgroundColor: '#111', borderRadius: 24, padding: 16, marginBottom: 16 },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  orderThumb: { width: 70, height: 70, borderRadius: 16 },
  orderInfo: { flex: 1, justifyContent: 'center' },
  orderStatus: { fontSize: 13, fontFamily: 'Inter_700Bold', color: Colors.accent, marginBottom: 4, letterSpacing: 0.5 },
  orderStatusDone: { fontSize: 13, fontFamily: 'Inter_700Bold', color: Colors.success, marginBottom: 4, letterSpacing: 0.5 },
  orderTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  orderPrice: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  buyerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted },
});
