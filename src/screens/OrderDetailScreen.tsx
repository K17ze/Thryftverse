import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS } from '../data/mockData';

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

export default function OrderDetailScreen() {
  const navigation = useNavigation<NavT>();
  const route = useRoute<RouteT>();
  const { orderId } = route.params;

  // Find order from mock data  
  const listing = MOCK_LISTINGS[0];
  const seller = MOCK_USERS[0];

  const trackingSteps: TrackingStep[] = [
    {
      id: 's1',
      label: 'Order confirmed',
      subtitle: 'Payment received. Seller has been notified.',
      date: '19 Mar 2026',
      done: true,
    },
    {
      id: 's2',
      label: 'Seller preparing',
      subtitle: `${seller.username} is packing your order.`,
      date: '20 Mar 2026',
      done: true,
    },
    {
      id: 's3',
      label: 'In transit',
      subtitle: 'Your parcel is on the way.',
      date: '21 Mar 2026',
      done: true,
      active: true,
    },
    {
      id: 's4',
      label: 'Out for delivery',
      subtitle: 'Your parcel will arrive today.',
      done: false,
    },
    {
      id: 's5',
      label: 'Delivered',
      subtitle: 'You have 2 days to raise any issues.',
      done: false,
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Details</Text>
        <TouchableOpacity style={styles.moreBtn}>
          <Ionicons name="ellipsis-horizontal" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

        {/* ── Item Card ── */}
        <TouchableOpacity
          style={styles.itemCard}
          onPress={() => navigation.navigate('ItemDetail', { itemId: listing.id })}
          activeOpacity={0.88}
        >
          <Image source={{ uri: listing.images[0] }} style={styles.itemThumb} />
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle} numberOfLines={2}>{listing.title}</Text>
            <Text style={styles.itemMeta}>{listing.size} · {listing.condition}</Text>
            <Text style={styles.itemPrice}>£{listing.price.toFixed(2)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* ── Status Banner ── */}
        <View style={styles.statusBanner}>
          <Ionicons name="cube-outline" size={20} color={Colors.accent} />
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>In Transit</Text>
            <Text style={styles.statusSub}>{seller.username} has to send it by 26 Mar. We'll keep you updated.</Text>
          </View>
        </View>

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
        <TouchableOpacity
          style={styles.sellerCard}
          onPress={() => navigation.navigate('UserProfile', { userId: seller.id })}
          activeOpacity={0.88}
        >
          <Image source={{ uri: seller.avatar }} style={styles.sellerAvatar} />
          <View style={styles.sellerInfo}>
            <Text style={styles.sellerName}>{seller.username}</Text>
            <View style={styles.sellerMeta}>
              <Ionicons name="star" size={13} color="#F5A623" />
              <Text style={styles.sellerRating}>{seller.rating} ({seller.reviewCount} reviews)</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.msgBtn}
            onPress={() => navigation.navigate('Chat', { conversationId: 'c1' })}
          >
            <Text style={styles.msgBtnText}>Message</Text>
          </TouchableOpacity>
        </TouchableOpacity>

        {/* ── Transaction Info ── */}
        <Text style={styles.sectionTitle}>Transaction</Text>
        <View style={styles.txCard}>
          <TxRow label="Item price" value={`£${listing.price.toFixed(2)}`} />
          <TxRow label="Buyer protection" value={`£${(listing.price * 0.05 + 0.7).toFixed(2)}`} />
          <TxRow label="Postage" value="from £2.89" />
          <View style={styles.txDivider} />
          <TxRow label="Total paid" value={`£${(listing.price + listing.price * 0.05 + 0.7 + 2.89).toFixed(2)}`} bold />
        </View>

        {/* ── Actions ── */}
        <View style={styles.actionsRow}>
          <TouchableOpacity 
            style={styles.actionBtnSecondary} 
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Report', { type: 'item' })}
          >
            <Ionicons name="alert-circle-outline" size={18} color={Colors.textPrimary} />
            <Text style={styles.actionBtnSecondaryText}>Report issue</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.actionBtnPrimary} 
            activeOpacity={0.85}
            onPress={() => navigation.navigate('WriteReview', { orderId: listing.id })}
          >
            <Text style={styles.actionBtnPrimaryText}>Mark as received</Text>
          </TouchableOpacity>
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
    backgroundColor: '#111', alignItems: 'center', justifyContent: 'center',
  },
  moreBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#111', alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.textPrimary,
  },

  content: { paddingHorizontal: 20, paddingTop: 8 },

  itemCard: {
    flexDirection: 'row',
    backgroundColor: '#111',
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
    backgroundColor: '#0d2020',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    alignItems: 'flex-start',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#1a3a3a',
  },
  statusLabel: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.accent, marginBottom: 4 },
  statusSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 20 },

  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 14,
  },

  // Timeline
  timelineCard: { backgroundColor: '#111', borderRadius: 20, padding: 20, marginBottom: 28 },
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
  dotInactive: { backgroundColor: '#333' },
  line: { width: 2, flex: 1, backgroundColor: Colors.accent, marginVertical: 4, minHeight: 24 },
  lineInactive: { backgroundColor: '#222' },
  timelineContent: { flex: 1, paddingBottom: 20 },
  timelineTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  stepLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  stepLabelInactive: { color: Colors.textMuted },
  stepDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted },
  stepSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 18 },
  stepSubInactive: { color: '#333' },

  // Seller card
  sellerCard: {
    flexDirection: 'row',
    backgroundColor: '#111',
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
  txCard: { backgroundColor: '#111', borderRadius: 20, paddingHorizontal: 20, paddingVertical: 8, marginBottom: 28 },
  txDivider: { height: 1, backgroundColor: '#222', marginVertical: 6 },

  // Actions
  actionsRow: { flexDirection: 'row', gap: 12 },
  actionBtnSecondary: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, borderRadius: 20,
    backgroundColor: '#111',
  },
  actionBtnSecondaryText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  actionBtnPrimary: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 20,
    backgroundColor: Colors.accent,
  },
  actionBtnPrimaryText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.background },
});
