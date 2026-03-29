import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Dimensions, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MOCK_CATEGORIES, MOCK_LISTINGS } from '../data/mockData';

const { width } = Dimensions.get('window');
const GRID_SPACING = 2;
const ITEM_SIZE = (width - (GRID_SPACING * 2)) / 3;

export default function CategoryDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { categoryId } = route.params || {};
  
  const category = MOCK_CATEGORIES.find((c) => c.id === categoryId) || MOCK_CATEGORIES[0];
  // Filter listings based on the selected category instead of using dummy mock data
  const gridData = MOCK_LISTINGS.filter(l => l.category.toLowerCase() === category.name.toLowerCase() || categoryId === 'cat1');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Heavy Typography Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.hugeTitle}>{category.name}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Horizontal Subcategory Pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {category.subItems?.map((sub, idx) => (
            <TouchableOpacity 
              key={idx} style={styles.chip}
              onPress={() => navigation.navigate('Browse', { categoryId: category.id, subcategoryId: sub.id, title: sub.name })}
            >
              <Text style={styles.chipText}>{sub.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Dense Grid - Restored Navigation & Real Data Mapping */}
        <View style={styles.grid}>
          {gridData.map((item) => (
            <TouchableOpacity 
              key={item.id} 
              style={styles.gridItem} 
              activeOpacity={0.9}
              onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
            >
              <Image source={{ uri: item.images[0] }} style={styles.gridImage} resizeMode="cover" />
              <View style={styles.pricePill}>
                <Text style={styles.priceText}>£{item.price}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        {gridData.length === 0 && (
          <Text style={{color: Colors.textMuted, textAlign: 'center', marginTop: 40}}>No items found in this category.</Text>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 16 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingBottom: 40 },
  chipsScroll: { paddingHorizontal: 20, gap: 8, paddingBottom: 24 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: '#111' },
  chipText: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_SPACING },
  gridItem: { width: ITEM_SIZE, height: ITEM_SIZE * 1.25, backgroundColor: Colors.card, position: 'relative' },
  gridImage: { width: '100%', height: '100%' },
  pricePill: { position: 'absolute', bottom: 6, left: 6, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 },
  priceText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },
});
