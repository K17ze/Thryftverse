import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type Props = StackScreenProps<RootStackParamList, 'Payments'>;

export default function PaymentsScreen({ navigation }: Props) {
  const [useBalance, setUseBalance] = useState(true);
  const savedPaymentMethod = useStore((state) => state.savedPaymentMethod);
  const { formatFromFiat } = useFormattedPrice();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Payments</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Restored Balance usage toggle */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.cardGroup}>
          <View style={styles.paymentRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.paymentTitle}>Use Thryftverse Balance</Text>
              <Text style={styles.paymentSub}>Automatically apply {formatFromFiat(120.5, 'GBP', { displayMode: 'fiat' })} to purchases</Text>
            </View>
            <AnimatedPressable onPress={() => setUseBalance(!useBalance)}>
              <Ionicons 
                name={useBalance ? "toggle" : "toggle-outline"} 
                size={36} 
                color={useBalance ? Colors.success : Colors.textMuted} 
              />
            </AnimatedPressable>
          </View>
        </View>

        {/* Restored Complete Payment Methods View */}
        <Text style={styles.sectionTitle}>Cards</Text>
        <View style={styles.cardGroup}>
          {savedPaymentMethod?.type === 'card' ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="card" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>{savedPaymentMethod.label}</Text>
                <Text style={styles.paymentSub}>{savedPaymentMethod.details ?? 'Saved card'}</Text>
              </View>
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultText}>Default</Text>
              </View>
            </View>
          ) : (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="card-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>No saved cards</Text>
                <Text style={styles.paymentSub}>Add a card to pay instantly at checkout</Text>
              </View>
            </View>
          )}
          <AnimatedPressable style={styles.addBtn} onPress={() => navigation.navigate('AddCard')}>
            <Ionicons name="add" size={20} color={Colors.textPrimary} />
            <Text style={styles.addText}>Add new card</Text>
          </AnimatedPressable>
        </View>

        <Text style={styles.sectionTitle}>Bank Accounts</Text>
        <View style={styles.cardGroup}>
          {savedPaymentMethod?.type === 'bank_account' ? (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="business" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>{savedPaymentMethod.label}</Text>
                <Text style={styles.paymentSub}>{savedPaymentMethod.details ?? 'Saved bank account'}</Text>
              </View>
            </View>
          ) : (
            <View style={styles.paymentRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="business-outline" size={20} color={Colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.paymentTitle}>No linked bank accounts</Text>
                <Text style={styles.paymentSub}>Add one for withdrawals and payouts</Text>
              </View>
            </View>
          )}
          <AnimatedPressable style={styles.addBtn} onPress={() => navigation.navigate('AddBankAccount')}>
            <Ionicons name="add" size={20} color={Colors.textPrimary} />
            <Text style={styles.addText}>Add new bank account</Text>
          </AnimatedPressable>
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginLeft: 8, marginBottom: 12, marginTop: 24 },
  cardGroup: { backgroundColor: '#111', borderRadius: 24, paddingVertical: 8, paddingHorizontal: 16 },
  paymentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#222' },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', marginRight: 16 },
  paymentTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  paymentSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, paddingRight: 10 },
  
  defaultBadge: { backgroundColor: '#222', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  defaultText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  addBtn: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, gap: 12 },
  addText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
});
