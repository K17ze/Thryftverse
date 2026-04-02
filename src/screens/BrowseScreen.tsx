import React, { useEffect, useMemo, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  FlatList,
  StatusBar,
  Dimensions,
  Image,
  ScrollView,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { useSharedValue, useAnimatedScrollHandler, FadeInDown } from 'react-native-reanimated';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

const { width } = Dimensions.get('window');
const GRID_SPACING = 16;
// 2 column grid with margins
const ITEM_WIDTH = (width - 40 - GRID_SPACING) / 2;

type BrowseRoute = RouteProp<RootStackParamList, 'Browse'>;

const toKey = (value: string) => value.trim().toLowerCase();

function getSubcategoryToken(categoryId: string, subcategoryId?: string, title?: string) {
  if (subcategoryId) {
    return subcategoryId
      .toLowerCase()
      .replace(/^[^-]+-/, '')
      .replace(/-/g, ' ')
      .trim();
  }

  if (!title) {
    return '';
  }

  const loweredTitle = title.toLowerCase().replace(/["']/g, '').trim();
  if (loweredTitle.startsWith('all ')) {
    return '';
  }

  const cleanedCategoryId = categoryId.toLowerCase();
  if (loweredTitle.startsWith(cleanedCategoryId)) {
    return loweredTitle.slice(cleanedCategoryId.length).trim();
  }

  return loweredTitle;
}

export default function BrowseScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<BrowseRoute>();
  const { title, categoryId, subcategoryId, searchQuery } = route.params || { title: 'Browse All', categoryId: 'search' };
  const wishlist = useStore((state) => state.wishlist);
  const toggleWishlist = useStore((state) => state.toggleWishlist);
  const browseFilters = useStore((state) => state.browseFilters);
  const updateBrowseFilters = useStore((state) => state.updateBrowseFilters);
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);

  useEffect(() => {
    if (categoryId === 'search' && searchQuery && browseFilters.query !== searchQuery) {
      updateBrowseFilters({ query: searchQuery });
      return;
    }

    if (categoryId !== 'search' && browseFilters.query) {
      updateBrowseFilters({ query: '' });
    }
  }, [categoryId, searchQuery, browseFilters.query, updateBrowseFilters]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshListings();
    setTimeout(() => setRefreshing(false), 400);
  };

  const hasActiveFilters =
    browseFilters.brands.length > 0 ||
    browseFilters.sizes.length > 0 ||
    browseFilters.condition !== 'Any';

  const dataToRender = useMemo(() => {
    const normalizedCategory = toKey(categoryId);
    const normalizedSubcategory = getSubcategoryToken(categoryId, subcategoryId, title);
    const normalizedQuery = browseFilters.query.trim().toLowerCase();
    const selectedBrands = new Set(browseFilters.brands.map((brand) => brand.toLowerCase()));
    const selectedSizes = new Set(browseFilters.sizes.map((size) => size.toLowerCase()));

    const baseList = listings.filter((listing) => {
      if (normalizedCategory !== 'search' && listing.category.toLowerCase() !== normalizedCategory) {
        return false;
      }

      if (normalizedCategory !== 'search' && normalizedSubcategory) {
        return listing.subcategory.toLowerCase().includes(normalizedSubcategory);
      }

      return true;
    });

    const filteredList = baseList.filter((listing) => {
      if (normalizedQuery) {
        const searchable = [
          listing.title,
          listing.brand,
          listing.description,
          listing.category,
          listing.subcategory,
        ]
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(normalizedQuery)) {
          return false;
        }
      }

      if (selectedBrands.size > 0 && !selectedBrands.has(listing.brand.toLowerCase())) {
        return false;
      }

      if (selectedSizes.size > 0 && !selectedSizes.has(listing.size.toLowerCase())) {
        return false;
      }

      if (browseFilters.condition !== 'Any' && listing.condition !== browseFilters.condition) {
        return false;
      }

      return true;
    });

    const sorted = [...filteredList];
    switch (browseFilters.sort) {
      case 'Price: Low to High':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'Price: High to Low':
        sorted.sort((a, b) => b.price - a.price);
        break;
      case 'Newest':
        sorted.sort((a, b) => {
          const aDate = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bDate = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bDate - aDate;
        });
        break;
      case 'Recommended':
      default:
        sorted.sort((a, b) => b.likes - a.likes);
        break;
    }

    return sorted;
  }, [browseFilters, categoryId, listings, subcategoryId, title]);

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      {/* Heavy Typography Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <AnimatedPressable style={styles.searchBtn} activeOpacity={0.8} onPress={() => navigation.navigate('GlobalSearch')}>
          <Ionicons name="search" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <View style={styles.titleContainer}>
        <Text style={styles.hugeTitle}>{title}</Text>
        <Text style={styles.itemCountText}>{dataToRender.length} items found</Text>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <AnimatedPressable
            style={styles.filterPill}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
          >
            <Ionicons name="options-outline" size={16} color={Colors.background} />
            <Text style={styles.filterPillTextActive}>{hasActiveFilters ? 'Filter on' : 'Filter'}</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.filterPillOutline}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
          >
            <Text style={styles.filterPillText}>
              {browseFilters.brands.length > 0 ? `Brand (${browseFilters.brands.length})` : 'Brand'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.filterPillOutline}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
          >
            <Text style={styles.filterPillText}>
              {browseFilters.sizes.length > 0 ? `Size (${browseFilters.sizes.length})` : 'Size'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.filterPillOutline}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
          >
            <Text style={styles.filterPillText}>
              {browseFilters.condition !== 'Any' ? browseFilters.condition : 'Condition'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />
          </AnimatedPressable>
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
              <AnimatedPressable 
                style={{ flex: 1 }}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
              >
            <View style={styles.imageWrap}>
              <Image source={{ uri: item.images[0] }} style={styles.gridImage} resizeMode="cover" />
              <AnimatedPressable
                style={styles.likeBtn}
                activeOpacity={0.8}
                onPress={(event) => {
                  event.stopPropagation();
                  const isCurrentlyWishlisted = wishlist.includes(item.id);
                  toggleWishlist(item.id);
                  if (!isCurrentlyWishlisted) {
                    show('Added to wishlist ♥', 'success');
                  }
                }}
              >
                <Ionicons name={wishlist.includes(item.id) ? 'heart' : 'heart-outline'} size={20} color="#fff" />
              </AnimatedPressable>
            </View>
            <View style={styles.infoWrap}>
              <View style={styles.priceRow}>
                <Text style={styles.priceText}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
                <Text style={styles.brandText}>{item.brand}</Text>
              </View>
              <Text style={styles.sizeText}>{item.size} • {item.condition}</Text>
            </View>
              </AnimatedPressable>
            </Reanimated.View>
          )}
          ListEmptyComponent={
            <EmptyState
              icon="search-outline"
              title="No matches found"
              subtitle="Try clearing filters or searching for another keyword."
              ctaLabel="Clear filters"
              onCtaPress={() =>
                updateBrowseFilters({
                  query: '',
                  sort: 'Recommended',
                  brands: [],
                  sizes: [],
                  condition: 'Any',
                })
              }
            />
          }
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
