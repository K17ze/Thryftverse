import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'MakeOffer'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

export default function MakeOfferScreen({ navigation, route }: Props) {
  const { price, title } = route.params;
  const [offerPrice, setOfferPrice] = useState(String(price));
  
  const numericOffer = parseFloat(offerPrice) || 0;
  const buyerProtectionFee = +(numericOffer * 0.05 + 0.7).toFixed(2);
  const total = +(numericOffer + buyerProtectionFee).toFixed(2);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />

      {/* Editorial Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} activeOpacity={0.8}>
          <Ionicons name="close" size={28} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Make Offer</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Item Info Context */}
        <View style={styles.itemCard}>
          <View style={styles.itemThumb}>
            <Ionicons name="shirt-outline" size={24} color={MUTED} />
          </View>
          <View>
            <Text style={styles.itemTitle} numberOfLines={1}>{title}</Text>
            <Text style={styles.itemListingPrice}>Listed at £{price.toFixed(2)}</Text>
          </View>
        </View>

        {/* Floating Input Block */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your offer</Text>
          <View style={styles.priceInputRow}>
            <Text style={styles.currencySymbol}>£</Text>
            <TextInput
              style={styles.priceInput}
              value={offerPrice}
              onChangeText={setOfferPrice}
              keyboardType="decimal-pad"
              selectionColor={TEAL}
              placeholderTextColor={MUTED}
              placeholder="0.00"
            />
          </View>
        </View>

        {/* Spaced Anti-list Buyer Protection */}
        <Text style={styles.sectionLabel}>Summary</Text>
        <View style={styles.protectionCard}>
          <View style={styles.protectionRow}>
            <Ionicons name="shield-checkmark" size={18} color={TEAL} />
            <Text style={styles.protectionLabel}>Buyer Protection</Text>
            <Text style={styles.protectionValue}>£{buyerProtectionFee.toFixed(2)}</Text>
          </View>
          
          <View style={[styles.protectionRow, { marginTop: 12 }]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>£{total.toFixed(2)}</Text>
          </View>
          
          <Text style={styles.protectionNote}>
            Includes our Buyer Protection fee. You're covered if the item doesn't arrive or isn't as described.
          </Text>
        </View>

        {/* Tip Pill */}
        <View style={styles.tipCard}>
          <View style={styles.tipIconBox}>
            <Ionicons name="bulb" size={16} color={BG} />
          </View>
          <Text style={styles.tipText}>
            Offers within 10% of the listing price are <Text style={{ fontFamily: 'Inter_700Bold', color: TEXT }}>3x</Text> more likely to be accepted.
          </Text>
        </View>
      </ScrollView>

      {/* Floating CTA matches CheckoutScreen */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.sendBtn, numericOffer <= 0 && { opacity: 0.5 }]}
          disabled={numericOffer <= 0}
          onPress={() => navigation.goBack()}
          activeOpacity={0.9}
        >
          <Text style={styles.sendBtnText}>Send offer · £{total.toFixed(2)}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
  },
  headerBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_800ExtraBold', color: TEXT, textTransform: 'uppercase', letterSpacing: 1 },
  
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
    marginBottom: 32,
    gap: 14,
  },
  itemThumb: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 4, maxWidth: '90%' },
  itemListingPrice: { fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
  
  section: { marginBottom: 32 },
  sectionLabel: { 
    fontSize: 14, 
    fontFamily: 'Inter_700Bold', 
    color: MUTED, 
    marginBottom: 12, 
    textTransform: 'uppercase', 
    letterSpacing: 1 
  },
  
  priceInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 24,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderWidth: 2,
    borderColor: '#333',
  },
  currencySymbol: { fontSize: 48, fontFamily: 'Inter_800ExtraBold', color: TEAL, marginRight: 12, marginBottom: 4 },
  priceInput: { 
    flex: 1, 
    fontSize: 56, 
    fontFamily: 'Inter_800ExtraBold', 
    color: TEXT, 
    paddingVertical: 12,
    letterSpacing: -2,
  },
  
  protectionCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
  },
  protectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  protectionLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
  protectionValue: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT },
  
  totalLabel: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT },
  totalValue: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: TEAL },
  
  protectionNote: { 
    fontSize: 13, 
    fontFamily: 'Inter_400Regular', 
    color: MUTED, 
    lineHeight: 20, 
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#222'
  },
  
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TEAL,
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  tipIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: BG, lineHeight: 20 },
  
  footer: { 
    paddingHorizontal: 20, 
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: 'rgba(10, 10, 10, 0.9)',
  },
  sendBtn: {
    backgroundColor: TEXT,
    borderRadius: 30,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { 
    fontSize: 18, 
    fontFamily: 'Inter_800ExtraBold', 
    color: BG,
    letterSpacing: -0.5,
  },
});
