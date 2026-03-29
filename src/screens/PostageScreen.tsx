import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'Postage'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

const CARRIERS = [
  { key: 'evri', label: 'Evri', price: 'from £2.89', selected: true },
  { key: 'royal', label: 'Royal Mail', price: 'from £3.35', selected: false },
  { key: 'dpd', label: 'DPD', price: 'from £4.50', selected: false },
  { key: 'inpost', label: 'InPost', price: 'from £2.99', selected: false },
];

export default function PostageScreen({ navigation }: Props) {
  const [carriers, setCarriers] = useState(CARRIERS);
  const [freeShipping, setFreeShipping] = useState(false);
  const [bundleDiscount, setBundleDiscount] = useState(true);

  const selectCarrier = (key: string) =>
    setCarriers(prev => prev.map(c => ({ ...c, selected: c.key === key })));

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Postage</Text>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.saveBtn}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>DEFAULT CARRIER</Text>
        <View style={styles.card}>
          {carriers.map((c, idx) => (
            <View key={c.key}>
              <TouchableOpacity style={styles.row} onPress={() => selectCarrier(c.key)}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{c.label}</Text>
                  <Text style={styles.rowSubtitle}>{c.price}</Text>
                </View>
                <View style={[styles.radio, c.selected && styles.radioSelected]}>
                  {c.selected && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
              {idx < carriers.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.sectionLabel}>SHIPPING OPTIONS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Offer free shipping</Text>
              <Text style={styles.rowSubtitle}>You'll cover the postage cost for buyers</Text>
            </View>
            <Switch
              value={freeShipping}
              onValueChange={setFreeShipping}
              trackColor={{ false: '#333', true: TEAL }}
              thumbColor={TEXT}
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>Bundle discount on postage</Text>
              <Text style={styles.rowSubtitle}>Buyers save when buying multiple items</Text>
            </View>
            <Switch
              value={bundleDiscount}
              onValueChange={setBundleDiscount}
              trackColor={{ false: '#333', true: TEAL }}
              thumbColor={TEXT}
            />
          </View>
        </View>

        <Text style={styles.footerNote}>
          These are your default settings. You can override postage for individual items when listing.
        </Text>
      </ScrollView>
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  saveBtn: { fontSize: 15, fontWeight: '600', color: TEAL },
  content: { padding: 20 },
  sectionLabel: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 2 },
  rowSubtitle: { fontSize: 12, color: MUTED },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 18 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: TEAL },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: TEAL },
  footerNote: { fontSize: 12, color: MUTED, lineHeight: 18, paddingHorizontal: 4 },
});
