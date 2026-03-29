import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useNavigation } from '@react-navigation/native';

export default function FilterScreen() {
  const navigation = useNavigation<any>();

  const [activeSort, setActiveSort] = useState('Recommended');
  const [selectedBrands, setSelectedBrands] = useState<string[]>(['Nike', 'Stüssy']);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(['M', 'L']);
  const [selectedCondition, setSelectedCondition] = useState('Any');

  const MOCK_BRANDS = ['Nike', 'Adidas', 'Stüssy', 'Carhartt', 'Arc\'teryx', 'Levi\'s'];
  const MOCK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const MOCK_CONDITIONS = ['Any', 'New with tags', 'Like new', 'Good', 'Satisfactory'];

  const toggleBrand = (b: string) => {
    setSelectedBrands(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  };
  
  const toggleSize = (s: string) => {
    setSelectedSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const getResultsCount = () => {
    // Dummy random logic for UI feedback
    const base = 254;
    return base - (selectedBrands.length * 15) - (selectedSizes.length * 5);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="close" size={28} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Filter & Sort</Text>
        <TouchableOpacity style={styles.iconBtn} onPress={() => { setSelectedBrands([]); setSelectedSizes([]); setSelectedCondition('Any'); }} activeOpacity={0.8}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* Sort Section */}
        <Text style={styles.sectionHeading}>Sort By</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {['Recommended', 'Newest', 'Price: Low to High', 'Price: High to Low'].map(s => (
            <TouchableOpacity 
              key={s} 
              style={[styles.chip, activeSort === s && styles.chipActive]}
              activeOpacity={0.8}
              onPress={() => setActiveSort(s)}
            >
              <Text style={[styles.chipText, activeSort === s && styles.chipTextActive]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={styles.sectionDivider} />

        {/* Brand Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Brand</Text>
          <TouchableOpacity activeOpacity={0.7}><Text style={styles.seeAllText}>See all</Text></TouchableOpacity>
        </View>
        <View style={styles.wrapContainer}>
          {MOCK_BRANDS.map(b => {
            const isActive = selectedBrands.includes(b);
            return (
              <TouchableOpacity
                key={b}
                style={[styles.chip, isActive && styles.chipActive]}
                activeOpacity={0.8}
                onPress={() => toggleBrand(b)}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{b}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sectionDivider} />

        {/* Size Section */}
        <Text style={styles.sectionHeading}>Size</Text>
        <View style={styles.wrapContainer}>
          {MOCK_SIZES.map(s => {
            const isActive = selectedSizes.includes(s);
            return (
              <TouchableOpacity
                key={s}
                style={[styles.chip, styles.sizeChip, isActive && styles.chipActive]}
                activeOpacity={0.8}
                onPress={() => toggleSize(s)}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{s}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.sectionDivider} />

        {/* Condition Section */}
        <Text style={styles.sectionHeading}>Condition</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {MOCK_CONDITIONS.map(c => (
            <TouchableOpacity 
              key={c} 
              style={[styles.chip, selectedCondition === c && styles.chipActive]}
              activeOpacity={0.8}
              onPress={() => setSelectedCondition(c)}
            >
              <Text style={[styles.chipText, selectedCondition === c && styles.chipTextActive]}>{c}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* Sticky Bottom Action */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.applyBtn} onPress={() => navigation.goBack()} activeOpacity={0.9}>
          <Text style={styles.applyBtnText}>Show {getResultsCount()} items</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  iconBtn: { width: 60, height: 44, justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  clearText: { color: '#4ECDC4', fontSize: 15, fontFamily: 'Inter_600SemiBold', textAlign: 'right' },

  scrollContent: { paddingTop: 10, paddingBottom: 40 },
  
  sectionHeading: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    paddingHorizontal: 20,
    marginBottom: 16,
    letterSpacing: -0.2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 20,
    marginBottom: 16,
  },
  seeAllText: { color: '#4ECDC4', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  hScroll: { paddingHorizontal: 20, gap: 10 },
  
  wrapContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
  },

  chip: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
  },
  sizeChip: { minWidth: 64, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  
  chipText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  chipTextActive: { color: Colors.background, fontFamily: 'Inter_700Bold' },

  sectionDivider: {
    height: 1,
    backgroundColor: '#1A1A1A',
    marginVertical: 24,
    marginHorizontal: 20,
  },

  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  applyBtn: {
    backgroundColor: Colors.textPrimary,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnText: {
    color: Colors.background,
    fontSize: 18,
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.5,
  },
});
