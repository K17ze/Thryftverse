import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, StatusBar, Image, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MOCK_LISTINGS } from '../data/mockData';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 40 - 12) / 2;

export default function FavouritesScreen() {
  const navigation = useNavigation();

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
        <View style={styles.grid}>
          {MOCK_LISTINGS.slice(0, 4).map(item => (
            <TouchableOpacity key={item.id} style={styles.favCard} activeOpacity={0.9}>
              <View style={styles.imageWrap}>
                <Image source={{ uri: item.images[0] }} style={styles.favImage} />
                <View style={styles.heartPill}>
                  <Ionicons name="heart" size={16} color={Colors.accent} />
                </View>
              </View>
              <Text style={styles.favPrice}>£{item.price.toFixed(2)}</Text>
              <Text style={styles.favBrand}>{item.brand}</Text>
            </TouchableOpacity>
          ))}
        </View>
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
});
