import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type Props = StackScreenProps<RootStackParamList, 'Postage'>;

const IS_LIGHT = ActiveTheme === 'light';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const DIVIDER = IS_LIGHT ? '#e4ded3' : '#1c1c1c';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';

const CARRIERS = [
  { key: 'evri', label: 'Evri', priceFromGBP: 2.89, selected: true },
  { key: 'royal', label: 'Royal Mail', priceFromGBP: 3.35, selected: false },
  { key: 'dpd', label: 'DPD', priceFromGBP: 4.5, selected: false },
  { key: 'inpost', label: 'InPost', priceFromGBP: 2.99, selected: false },
];

export default function PostageScreen({ navigation }: Props) {
  const { formatFromFiat } = useFormattedPrice();
  const [carriers, setCarriers] = useState(CARRIERS);
  const [freeShipping, setFreeShipping] = useState(false);
  const [bundleDiscount, setBundleDiscount] = useState(true);

  const selectCarrier = (key: string) =>
    setCarriers(prev => prev.map(c => ({ ...c, selected: c.key === key })));

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Postage</Text>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Text style={styles.saveBtn}>Save</Text>
        </AnimatedPressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>DEFAULT CARRIER</Text>
        <View style={styles.card}>
          {carriers.map((c, idx) => (
            <View key={c.key}>
              <AnimatedPressable style={styles.row} onPress={() => selectCarrier(c.key)}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{c.label}</Text>
                  <Text style={styles.rowSubtitle}>from {formatFromFiat(c.priceFromGBP, 'GBP', { displayMode: 'fiat' })}</Text>
                </View>
                <View style={[styles.radio, c.selected && styles.radioSelected]}>
                  {c.selected && <View style={styles.radioDot} />}
                </View>
              </AnimatedPressable>
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
              trackColor={{ false: BORDER, true: BRAND }}
              thumbColor={Colors.textInverse}
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
              trackColor={{ false: BORDER, true: BRAND }}
              thumbColor={Colors.textInverse}
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
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  saveBtn: { fontSize: 15, fontWeight: '600', color: BRAND },
  content: { padding: 20 },
  sectionLabel: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 2 },
  rowSubtitle: { fontSize: 12, color: MUTED },
  divider: { height: 1, backgroundColor: DIVIDER, marginHorizontal: 18 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: MUTED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: BRAND },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: BRAND },
  footerNote: { fontSize: 12, color: MUTED, lineHeight: 18, paddingHorizontal: 4 },
});

