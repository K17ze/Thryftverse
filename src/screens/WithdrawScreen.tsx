import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { CURRENCIES } from '../constants/currencies';
import {
  convertDisplayToGbpAmount,
  getDefaultWithdrawDisplayAmount,
  sanitizeDecimalInput,
} from '../utils/currencyAuthoringFlows';

export default function WithdrawScreen() {
  const navigation = useNavigation<any>();
  const [amount, setAmount] = useState('');
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const currencySymbol = CURRENCIES[currencyCode].symbol;

  const availableBalance = 120.5;

  React.useEffect(() => {
    const displayAmount = getDefaultWithdrawDisplayAmount(availableBalance, currencyCode, goldRates);
    setAmount(displayAmount.toFixed(2));
  }, [currencyCode, goldRates]);

  const numericAmountDisplay = Number(amount) || 0;
  const numericAmount = convertDisplayToGbpAmount(numericAmountDisplay, currencyCode, goldRates);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Withdraw Balance</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={styles.content} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 100 }}>
          
          <View style={styles.amountWrap}>
            <Text style={styles.currencySymbol}>{currencySymbol}</Text>
            <TextInput
              style={styles.amountInput}
              value={amount}
              onChangeText={(value) => setAmount(sanitizeDecimalInput(value))}
              keyboardType="decimal-pad"
              autoFocus
              selectionColor={Colors.accent}
            />
          </View>
          <Text style={styles.availableText}>Available: {formatFromFiat(availableBalance, 'GBP', { displayMode: 'fiat' })}</Text>

          <Text style={styles.sectionTitle}>Transfer to</Text>
          <AnimatedPressable style={styles.bankCard} activeOpacity={0.8}>
            <View style={styles.bankLeft}>
              <View style={styles.bankIcon}>
                <Ionicons name="business" size={24} color={Colors.textPrimary} />
              </View>
              <View>
                <Text style={styles.bankName}>Barclays Bank PLC</Text>
                <Text style={styles.bankDetails}>sort code 20-**-**</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </AnimatedPressable>

          <AnimatedPressable style={styles.addBankBtn} onPress={() => navigation.navigate('AddBankAccount')}>
            <Ionicons name="add" size={18} color={Colors.accent} />
            <Text style={styles.addBankText}>Add a new bank account</Text>
          </AnimatedPressable>

        </ScrollView>

        <View style={styles.footer}>
          <Text style={styles.feeText}>Withdrawals take 3-5 working days. No fees apply.</Text>
          <AnimatedPressable 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={() => {
              // Simulate success and return
              navigation.goBack();
            }}
          >
            <Text style={styles.primaryText}>Withdraw {formatFromFiat(numericAmount, 'GBP', { displayMode: 'fiat' })}</Text>
          </AnimatedPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  content: { flex: 1, paddingHorizontal: 20 },
  
  amountWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 40, marginBottom: 12 },
  currencySymbol: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginRight: 8 },
  amountInput: { fontSize: 56, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, minWidth: 150 },
  availableText: { textAlign: 'center', fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, marginBottom: 40 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  bankCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', padding: 16, borderRadius: 16, marginBottom: 12 },
  bankLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  bankIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#222', alignItems: 'center', justifyContent: 'center' },
  bankName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  bankDetails: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },

  addBankBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  addBankText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.accent },

  footer: { paddingVertical: 20, borderTopWidth: 1, borderTopColor: '#1A1A1A', backgroundColor: Colors.background },
  feeText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, textAlign: 'center', marginBottom: 16 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
