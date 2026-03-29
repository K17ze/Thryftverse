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
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'AddCard'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

export default function AddCardScreen({ navigation }: Props) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');

  const formatCardNumber = (val: string) =>
    val.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();

  const formatExpiry = (val: string) => {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    return clean.length >= 2 ? clean.slice(0, 2) + '/' + clean.slice(2) : clean;
  };

  const isComplete = cardNumber.replace(/\s/g, '').length === 16 && expiry.length === 5 && cvv.length >= 3 && name.length >= 2;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add card</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Card Preview */}
          <View style={styles.cardPreview}>
            <Text style={styles.cardPreviewNumber}>
              {cardNumber || '•••• •••• •••• ••••'}
            </Text>
            <View style={styles.cardPreviewBottom}>
              <View>
                <Text style={styles.cardPreviewLabel}>CARDHOLDER</Text>
                <Text style={styles.cardPreviewValue}>{name || 'YOUR NAME'}</Text>
              </View>
              <View>
                <Text style={styles.cardPreviewLabel}>EXPIRES</Text>
                <Text style={styles.cardPreviewValue}>{expiry || 'MM/YY'}</Text>
              </View>
            </View>
          </View>

          {/* Form Fields */}
          <Text style={styles.sectionLabel}>CARD DETAILS</Text>
          <View style={styles.card}>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Card number</Text>
              <TextInput
                style={styles.fieldInput}
                value={cardNumber}
                onChangeText={v => setCardNumber(formatCardNumber(v))}
                placeholder="0000 0000 0000 0000"
                placeholderTextColor={MUTED}
                keyboardType="number-pad"
                selectionColor={TEAL}
                maxLength={19}
              />
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRowHalf}>
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>Expiry date</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={expiry}
                  onChangeText={v => setExpiry(formatExpiry(v))}
                  placeholder="MM/YY"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                  selectionColor={TEAL}
                  maxLength={5}
                />
              </View>
              <View style={styles.halfDivider} />
              <View style={styles.halfField}>
                <Text style={styles.fieldLabel}>CVV</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={cvv}
                  onChangeText={v => setCvv(v.replace(/\D/g, '').slice(0, 4))}
                  placeholder="•••"
                  placeholderTextColor={MUTED}
                  keyboardType="number-pad"
                  selectionColor={TEAL}
                  secureTextEntry
                  maxLength={4}
                />
              </View>
            </View>
            <View style={styles.divider} />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Name on card</Text>
              <TextInput
                style={styles.fieldInput}
                value={name}
                onChangeText={setName}
                placeholder="As it appears on card"
                placeholderTextColor={MUTED}
                autoCapitalize="words"
                selectionColor={TEAL}
              />
            </View>
          </View>

          <View style={styles.secureRow}>
            <Ionicons name="lock-closed-outline" size={14} color={MUTED} />
            <Text style={styles.secureText}>Your card details are encrypted and secure</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, !isComplete && { opacity: 0.4 }]}
            disabled={!isComplete}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.saveBtnText}>Save card</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20, paddingBottom: 40 },
  cardPreview: {
    backgroundColor: '#1a2a1a',
    borderRadius: 20,
    padding: 24,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: TEAL + '44',
    height: 180,
    justifyContent: 'space-between',
  },
  cardPreviewNumber: { fontSize: 22, fontWeight: '700', color: TEXT, letterSpacing: 2 },
  cardPreviewBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  cardPreviewLabel: { fontSize: 10, color: MUTED, letterSpacing: 1.5, marginBottom: 4 },
  cardPreviewValue: { fontSize: 14, fontWeight: '600', color: TEXT },
  sectionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  card: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 16 },
  fieldRow: { paddingHorizontal: 18, paddingVertical: 14 },
  fieldRowHalf: { flexDirection: 'row' },
  halfField: { flex: 1, paddingHorizontal: 18, paddingVertical: 14 },
  halfDivider: { width: 1, backgroundColor: '#1c1c1c' },
  fieldLabel: { fontSize: 11, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  fieldInput: { fontSize: 16, color: TEXT, fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#1c1c1c' },
  secureRow: { flexDirection: 'row', alignItems: 'center', gap: 6, justifyContent: 'center' },
  secureText: { fontSize: 12, color: MUTED },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  saveBtn: { backgroundColor: TEAL, borderRadius: 30, paddingVertical: 16, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#0a0a0a' },
});
