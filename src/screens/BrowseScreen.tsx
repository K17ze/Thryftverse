import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, StatusBar, Dimensions, Image, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { useSharedValue, useAnimatedScrollHandler, FadeInDown } from 'react-native-reanimated';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { MOCK_LISTINGS } from '../data/mockData';
import { RefreshIndicator } from '../components/RefreshIndicator';

const { width } = Dimensions.get('window');
const GRID_SPACING = 16;
// 2 column grid with margins
const ITEM_WIDTH = (width - 40 - GRID_SPACING) / 2;

export default function BrowseScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { title, categoryId } = route.params || { title: 'Browse All' };

  const listData = categoryId 
    ? MOCK_LISTINGS.filter(l => l.category === title.toLowerCase() || l.subcategory === title)
    : MOCK_LISTINGS;

  const dataToRender = listData.length > 0 ? listData : MOCK_LISTINGS;

  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 2000);
  };

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Heavy Typography Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.searchBtn} activeOpacity={0.8}>
          <Ionicons name="search" size={20} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.titleContainer}>
        <Text style={styles.hugeTitle}>{title}</Text>
        <Text style={styles.itemCountText}>{dataToRender.length} items found</Text>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <TouchableOpacity style={styles.filterPill} activeOpacity={0.8} onPress={() => navigation.navigate('Filter')}>
            <Ionicons name="options-outline" size={16} color={Colors.background} />
            <Text style={styles.filterPillTextActive}>Filter</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterPillOutline} activeOpacity={0.8} onPress={() => navigation.navigate('Filter')}>
            <Text style={styles.filterPillText}>Brand</Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterPillOutline} activeOpacity={0.8} onPress={() => navigation.navigate('Filter')}>
            <Text style={styles.filterPillText}>Size</Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.filterPillOutline} activeOpacity={0.8} onPress={() => navigation.navigate('Filter')}>
            <Text style={styles.filterPillText}>Condition</Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Spacious 2-Column Grid */}
      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={40} />
        
        <AnimatedFlatList
          data={dataToRender}
          keyExtractor={(item: any) => item.id}
          numColumns={2}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.gridContent}
          columnWrapperStyle={styles.rowWrapper}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
          renderItem={({ item, index }: any) => (
            <Reanimated.View 
              entering={FadeInDown.delay(Math.min(index, 10) * 50).duration(400)}
              style={[styles.gridItem, index % 2 === 0 ? { marginTop: 0 } : { marginTop: 24 }]}
            >
              <TouchableOpacity 
                style={{ flex: 1 }}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
              >
            <View style={styles.imageWrap}>
              <Image source={{ uri: item.images[0] }} style={styles.gridImage} resizeMode="cover" />
              <TouchableOpacity style={styles.likeBtn} activeOpacity={0.8}>
                <Ionicons name="heart-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
            <View style={styles.infoWrap}>
              <View style={styles.priceRow}>
                <Text style={styles.priceText}>£{item.price}</Text>
                <Text style={styles.brandText}>{item.brand}</Text>
              </View>
              <Text style={styles.sizeText}>{item.size} • {item.condition}</Text>
            </View>
              </TouchableOpacity>
            </Reanimated.View>
          )}
        />
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
    paddingBottom: 4,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  
  titleContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  hugeTitle: { 
    fontSize: 44, 
    fontFamily: 'Inter_800ExtraBold', 
    color: Colors.textPrimary, 
    letterSpacing: -1.5,
    textTransform: 'uppercase',
    lineHeight: 48,
  },
  itemCountText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
    marginTop: 8,
  },

  filterBar: { paddingBottom: 20 },
  filterRow: { paddingHorizontal: 20, gap: 10 },
  filterPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6, 
    paddingHorizontal: 18, 
    paddingVertical: 10, 
    borderRadius: 24, 
    backgroundColor: Colors.textPrimary 
  },
  filterPillTextActive: { color: Colors.background, fontSize: 13, fontFamily: 'Inter_700Bold' },
  filterPillOutline: {
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 6, 
    paddingHorizontal: 18, 
    paddingVertical: 10, 
    borderRadius: 24, 
    borderWidth: 1,
    borderColor: '#333',
  },
  filterPillText: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  gridContent: { paddingHorizontal: 20, paddingBottom: 100 },
  rowWrapper: { justifyContent: 'space-between', marginBottom: 32 },
  
  gridItem: { width: ITEM_WIDTH },
  imageWrap: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH * 1.35,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
    marginBottom: 12,
  },
  gridImage: { width: '100%', height: '100%' },
  likeBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  
  infoWrap: { paddingHorizontal: 4 },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  priceText: { color: Colors.textPrimary, fontSize: 18, fontFamily: 'Inter_700Bold' },
  brandText: { color: Colors.textSecondary, fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase' },
  sizeText: { color: Colors.textMuted, fontSize: 13, fontFamily: 'Inter_500Medium' },
});
