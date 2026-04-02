import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  ScrollView,
  StatusBar,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { CURRENCIES } from '../constants/currencies';
import {
  calculateOfferSummaryFromDisplay,
  convertGbpToDisplayAmount,
  sanitizeDecimalInput,
} from '../utils/currencyAuthoringFlows';

type Props = StackScreenProps<RootStackParamList, 'MakeOffer'>;

const IS_LIGHT = ActiveTheme === 'light';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const CARD_ALT = IS_LIGHT ? '#f3eee7' : '#1a1a1a';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#333333';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const TIP_BG = IS_LIGHT ? '#ece4d8' : '#2f291f';
const TIP_BORDER = IS_LIGHT ? '#d0c3af' : '#4f4638';
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.94)' : 'rgba(10,10,10,0.9)';

export default function MakeOfferScreen({ navigation, route }: Props) {
  const { price, title } = route.params;
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const currencySymbol = CURRENCIES[currencyCode].symbol;
  const [offerPrice, setOfferPrice] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  React.useEffect(() => {
    const defaultOffer = convertGbpToDisplayAmount(price, currencyCode, goldRates);
    setOfferPrice((Number.isFinite(defaultOffer) ? defaultOffer : price).toFixed(2));
  }, [currencyCode, goldRates, price]);
  
  const numericOffer = parseFloat(offerPrice) || 0;
  const {
    offerGbp: numericOfferGbp,
    buyerProtectionFeeGbp: buyerProtectionFee,
    totalGbp: total,
  } = calculateOfferSummaryFromDisplay(numericOffer, currencyCode, goldRates);

  const handleOfferChange = (value: string) => {
    setOfferPrice(sanitizeDecimalInput(value));
    if (errorMsg) {
      setErrorMsg('');
    }
  };

  const handleSendOffer = () => {
    if (!numericOffer || !Number.isFinite(numericOfferGbp) || numericOfferGbp <= 0) {
      setErrorMsg('Enter a valid offer amount.');
      return;
    }

    if (numericOfferGbp > price * 2) {
      setErrorMsg('Offer seems too high. Please review the amount.');
      return;
    }

    setErrorMsg('');
    navigation.navigate('MainTabs', { screen: 'Inbox' } as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />

      {/* Editorial Header */}
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()} style={styles.headerBtn} activeOpacity={0.8}>
          <Ionicons name="close" size={28} color={TEXT} />
        </AnimatedPressable>
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
            <Text style={styles.itemListingPrice}>Listed at {formatFromFiat(price, 'GBP')}</Text>
          </View>
        </View>

        {/* Floating Input Block */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your offer</Text>
          <View style={styles.priceInputRow}>
            <Text style={styles.currencySymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.priceInput}
              value={offerPrice}
              onChangeText={handleOfferChange}
              keyboardType="decimal-pad"
              selectionColor={BRAND}
              placeholderTextColor={MUTED}
              placeholder="0.00"
            />
          </View>
        </View>

        {/* Spaced Anti-list Buyer Protection */}
        <Text style={styles.sectionLabel}>Summary</Text>
        <View style={styles.protectionCard}>
          <View style={styles.protectionRow}>
            <Ionicons name="shield-checkmark" size={18} color={BRAND} />
            <Text style={styles.protectionLabel}>Buyer Protection</Text>
            <Text style={styles.protectionValue}>{formatFromFiat(buyerProtectionFee, 'GBP')}</Text>
          </View>
          
          <View style={[styles.protectionRow, { marginTop: 12 }]}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{formatFromFiat(total, 'GBP')}</Text>
          </View>
          
          <Text style={styles.protectionNote}>
            Includes our Buyer Protection fee. You're covered if the item doesn't arrive or isn't as described.
          </Text>
        </View>

        {/* Tip Pill */}
        <View style={styles.tipCard}>
          <View style={styles.tipIconBox}>
            <Ionicons name="bulb" size={16} color={Colors.textInverse} />
          </View>
          <Text style={styles.tipText}>
            Offers within 10% of the listing price are <Text style={{ fontFamily: 'Inter_700Bold', color: TEXT }}>3x</Text> more likely to be accepted.
          </Text>
        </View>

        {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
      </ScrollView>

      {/* Floating CTA matches CheckoutScreen */}
      <View style={styles.footer}>
        <AnimatedPressable
          style={[styles.sendBtn, numericOffer <= 0 && { opacity: 0.5 }]}
          disabled={numericOffer <= 0}
          onPress={handleSendOffer}
          activeOpacity={0.9}
        >
          <Text style={styles.sendBtnText}>Send offer · {formatFromFiat(total, 'GBP')}</Text>
        </AnimatedPressable>
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
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT, textTransform: 'uppercase', letterSpacing: 1 },
  
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 16,
    marginBottom: 32,
    gap: 14,
  },
  itemThumb: {
    width: 60,
    height: 60,
    borderRadius: 16,
    backgroundColor: CARD_ALT,
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
    borderColor: BORDER,
  },
  currencySymbol: { fontSize: 48, fontFamily: 'Inter_700Bold', color: BRAND, marginRight: 12, marginBottom: 4 },
  priceInput: { 
    flex: 1, 
    fontSize: 56, 
    fontFamily: 'Inter_700Bold', 
    color: TEXT, 
    paddingVertical: 12,
    letterSpacing: -2,
  },
  
  protectionCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    padding: 24,
    marginBottom: 24,
  },
  protectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  protectionLabel: { flex: 1, fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED },
  protectionValue: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: TEXT },
  
  totalLabel: { flex: 1, fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT },
  totalValue: { fontSize: 22, fontFamily: 'Inter_700Bold', color: BRAND },
  
  protectionNote: { 
    fontSize: 13, 
    fontFamily: 'Inter_400Regular', 
    color: MUTED, 
    lineHeight: 20, 
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER
  },
  
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: TIP_BG,
    borderWidth: 1,
    borderColor: TIP_BORDER,
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  tipIconBox: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: BRAND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, lineHeight: 20 },
  errorText: {
    marginTop: 14,
    color: Colors.danger,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  
  footer: { 
    paddingHorizontal: 20, 
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: FOOTER_BG,
  },
  sendBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 30,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { 
    fontSize: 18, 
    fontFamily: 'Inter_700Bold', 
    color: Colors.textInverse,
    letterSpacing: -0.5,
  },
});
