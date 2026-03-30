import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MOCK_LISTINGS, Listing } from '../data/mockData';
import { useStore } from '../store/useStore';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 40 - 12) / 2;

export default function FavouritesScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const favouritesIds = useStore(state => state.favourites);
  const toggleFav = useStore(state => state.toggleFavourite);

  const savedItems = MOCK_LISTINGS.filter(item => favouritesIds.includes(item.id));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.hugeTitle}>Favourites</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {savedItems.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="heart-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No favourites yet</Text>
            <Text style={styles.emptySubtitle}>Tap the heart on items you love to save them for later</Text>
            
            <TouchableOpacity 
              style={styles.browseBtn} 
              onPress={() => navigation.navigate('MainTabs')}
            >
              <Text style={styles.browseBtnText}>Start Browsing</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.grid}>
            {savedItems.map(item => (
              <TouchableOpacity 
                key={item.id} 
                style={styles.favCard} 
                activeOpacity={0.9}
                onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
              >
                <View style={styles.imageWrap}>
                  <Image source={{ uri: item.images[0] }} style={styles.favImage} />
                  <TouchableOpacity 
                    style={styles.heartPill}
                    activeOpacity={0.7}
                    onPress={() => toggleFav(item.id)}
                  >
                    <Ionicons name="heart" size={16} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.favPrice}>£{item.price.toFixed(2)}</Text>
                <Text style={styles.favBrand}>{item.brand}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#111',
    alignItems: 'center', justifyContent: 'center',
  },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  favCard: {
    width: ITEM_WIDTH,
    marginBottom: 8,
  },
  imageWrap: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH * 1.3,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#111',
    position: 'relative',
    marginBottom: 10,
  },
  favImage: { width: '100%', height: '100%' },
  heartPill: {
    position: 'absolute',
    top: 10, right: 10,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 6,
    borderRadius: 20,
  },
  favPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 2 },
  favBrand: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary },

  // Empty State
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  emptyTitle: { fontSize: 20, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 8 },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  browseBtn: { backgroundColor: Colors.textPrimary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 24 },
  browseBtnText: { color: Colors.background, fontSize: 15, fontFamily: 'Inter_700Bold' },
});
