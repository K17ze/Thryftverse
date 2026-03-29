import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Image, Platform } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MOCK_LISTINGS, MOCK_USERS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';

type RouteT = RouteProp<RootStackParamList, 'Checkout'>;

export default function CheckoutScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteT>();
  const { itemId } = route.params;

  const item = MOCK_LISTINGS.find(l => l.id === itemId) || MOCK_LISTINGS[0];
  const seller = MOCK_USERS.find(u => u.id === item.sellerId) || MOCK_USERS[0];

  const PROTECTION_FEE = parseFloat((item.price * 0.05 + 0.7).toFixed(2));
  const POSTAGE_FEE = 2.89;
  const TOTAL = (item.price + PROTECTION_FEE + POSTAGE_FEE).toFixed(2);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* Item Summary Card */}
        <View style={styles.itemCard}>
          <Image source={{ uri: item.images[0] }} style={styles.itemThumb} />
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.itemSeller}>from {seller.username}</Text>
            <Text style={styles.itemPrice}>£{item.price.toFixed(2)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Delivery</Text>
        <TouchableOpacity style={styles.blockBtn} activeOpacity={0.8} onPress={() => navigation.navigate('AddAddress')}>
          <View style={styles.blockLeft}>
            <Ionicons name="location-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>Add delivery address</Text>
              <Text style={styles.blockSub}>Required for postage</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.blockBtn} activeOpacity={0.8} onPress={() => navigation.navigate('Postage')}>
          <View style={styles.blockLeft}>
            <Ionicons name="cube-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>Evri Standard</Text>
              <Text style={styles.blockSub}>2-3 working days</Text>
            </View>
          </View>
          <Text style={styles.blockRightPrice}>£{POSTAGE_FEE}</Text>
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Payment</Text>
        <TouchableOpacity style={styles.blockBtn} activeOpacity={0.8} onPress={() => navigation.navigate('Payments')}>
          <View style={styles.blockLeft}>
            <Ionicons name="card-outline" size={24} color={Colors.textPrimary} />
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>Add payment method</Text>
              <Text style={styles.blockSub}>Card, Apple Pay, or Google Pay</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.sectionTitle}>Order Summary</Text>
        <View style={styles.summaryCard}>
          <SummaryRow label="Item price" value={`£${item.price.toFixed(2)}`} />
          <SummaryRow label="Buyer protection fee" value={`£${PROTECTION_FEE.toFixed(2)}`} info />
          <SummaryRow label="Postage" value={`£${POSTAGE_FEE.toFixed(2)}`} />
          <View style={styles.divider} />
          <SummaryRow label="Total" value={`£${TOTAL}`} bold />
        </View>

        <Text style={styles.termsText}>
          By tapping "Pay", you agree to our Terms of Sale and Privacy Policy. You have 2 days to report an issue after delivery.
        </Text>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Sticky Bottom Footer */}
      <View style={styles.footer}>
        <View style={styles.footerPriceCol}>
          <Text style={styles.footerTotalLabel}>Total</Text>
          <Text style={styles.footerTotalPrice}>£{TOTAL}</Text>
        </View>
        <TouchableOpacity 
          style={styles.payBtn} 
          activeOpacity={0.9} 
          onPress={() => navigation.replace('Success')}
        >
          <Text style={styles.payBtnText}>Pay</Text>
        </TouchableOpacity>
      </View>
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

  itemCard: { flexDirection: 'row', backgroundColor: '#111', borderRadius: 16, padding: 12, marginBottom: 32, gap: 16, alignItems: 'center' },
  itemThumb: { width: 64, height: 64, borderRadius: 12 },
  itemInfo: { flex: 1, justifyContent: 'center' },
  itemTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  itemSeller: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginBottom: 4 },
  itemPrice: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  blockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', padding: 16, borderRadius: 16, marginBottom: 16 },
  blockLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  blockTextCol: { justifyContent: 'center' },
  blockTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  blockSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  blockRightPrice: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  summaryCard: { backgroundColor: '#111', padding: 24, borderRadius: 20, marginBottom: 24 },
  divider: { height: 1, backgroundColor: '#222', marginVertical: 12 },

  termsText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, lineHeight: 18, textAlign: 'center', paddingHorizontal: 16 },

  footer: { 
    position: 'absolute', bottom: 0, left: 0, right: 0, 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    backgroundColor: 'rgba(10, 10, 10, 0.95)', 
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 24,
  },
  footerPriceCol: { flex: 1 },
  footerTotalLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },
  footerTotalPrice: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  payBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, paddingHorizontal: 48, alignItems: 'center', justifyContent: 'center' },
  payBtnText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' }
});
