import React, { useEffect, useMemo, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  StatusBar,
  Dimensions,
  ScrollView,
  RefreshControl
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CachedImage } from '../components/CachedImage';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withSequence, withDelay, useAnimatedScrollHandler, FadeInDown, runOnJS } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ActiveTheme, Colors } from '../constants/colors';
import { Motion } from '../constants/motion';
import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute, useScrollToTop } from '@react-navigation/native';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { EmptyState } from '../components/EmptyState';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { getBackendSyncStatus } from '../utils/syncStatus';
import { useHaptic } from '../hooks/useHaptic';
import { AppButton } from '../components/ui/AppButton';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { useReducedMotion } from '../hooks/useReducedMotion';

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

const BrowseGridItem = ({ item, index, navigation, wishlist, toggleWishlist, showToast, formatPrice, reducedMotionEnabled }: any) => {
  const isWishlisted = wishlist.includes(item.id);
  const haptic = useHaptic();
  const heartScale = useSharedValue(0);
  const likeBtnScale = useSharedValue(1);

  const performLikeSequence = () => {
    haptic.heavy();
    
    // Bubble big heart overlaid on image
    heartScale.value = withSequence(
      withSpring(1.2, Motion.spring.flagshipPop),
      withSpring(1, Motion.spring.flagship),
      withDelay(600, withSpring(0, Motion.spring.flagship))
    );

    // Spring the mini corner button
    likeBtnScale.value = withSequence(
      withSpring(1.35, Motion.spring.flagshipPop),
      withSpring(1, Motion.spring.flagship)
    );

    if (!isWishlisted) {
      toggleWishlist(item.id);
      showToast('Added to wishlist ♥', 'success');
    }
  };

  const handleDoubleTap = () => {
    performLikeSequence();
  };

  const taps = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      runOnJS(handleDoubleTap)();
    });

  const singleTap = Gesture.Tap()
    .onEnd(() => {
      runOnJS(navigation.push as any)('ItemDetail', { itemId: item.id });
    });

  const combinedGesture = Gesture.Exclusive(taps, singleTap);

  const bigHeartStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
    opacity: heartScale.value,
  }));

  const likeCornerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: likeBtnScale.value }],
  }));

  return (
    <Reanimated.View 
      entering={
        reducedMotionEnabled
          ? undefined
          : FadeInDown
              .delay(Math.min(index, Motion.list.maxStaggerItems) * Motion.list.staggerStep)
              .duration(Motion.list.enterDuration)
      }
      style={[styles.gridItem, index % 2 === 0 ? { marginTop: 0 } : { marginTop: 24 }]}
    >
      <View style={styles.imageWrap}>
        <GestureDetector gesture={combinedGesture}>
          <View style={{ flex: 1 }}>
            <SharedTransitionView
              style={styles.sharedImageLayer}
              sharedTransitionTag={`image-${item.id}-0`}
            >
              <CachedImage uri={item.images[0]} style={styles.gridImage} containerStyle={{ width: '100%', height: 180, borderRadius: 12 }} contentFit="cover" />
            </SharedTransitionView>

            <Reanimated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }, bigHeartStyle]}>
              <Ionicons name="heart" size={60} color="#fff" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 }} />
            </Reanimated.View>
          </View>
        </GestureDetector>

        <Reanimated.View style={[styles.likeBtn, likeCornerStyle]}>
          <AnimatedPressable
            style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}
            activeOpacity={0.8}
            accessibilityLabel={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            onPress={() => {
              haptic.light();
              toggleWishlist(item.id);
              if (!isWishlisted) showToast('Added to wishlist ♥', 'success');
            }}
          >
            <Ionicons name={isWishlisted ? 'heart' : 'heart-outline'} size={20} color={isWishlisted ? Colors.danger : "#fff"} />
          </AnimatedPressable>
        </Reanimated.View>
      </View>
      <AnimatedPressable activeOpacity={0.8} onPress={() => navigation.push('ItemDetail', { itemId: item.id })}>
        <View style={styles.infoWrap}>
          <View style={styles.priceRow}>
            <Text style={styles.priceText}>{formatPrice(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.brandText}>{item.brand}</Text>
          </View>
          <Text style={styles.sizeText}>{item.size} • {item.condition}</Text>
        </View>
      </AnimatedPressable>
    </Reanimated.View>
  );
};

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
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();
  const reducedMotionEnabled = useReducedMotion();

  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);
  const scrollRef = React.useRef<any>(null);

  useScrollToTop(scrollRef);

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

  const browseStatus = useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
      }),
    [isSyncing, lastError, source],
  );

  const showBrowseLoadingSkeleton = isSyncing && source === 'mock' && dataToRender.length === 0 && !lastError;

  const renderBrowseLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      {Array.from({ length: 6 }).map((_, index) => (
        <View key={`browse_loading_${index}`} style={[styles.loadingCard, index % 2 === 1 && styles.loadingCardOffset]}>
          <SkeletonLoader width="100%" height={ITEM_WIDTH * 1.35} borderRadius={12} />
          <View style={styles.loadingCardBody}>
            <SkeletonLoader width="58%" height={12} borderRadius={6} />
            <SkeletonLoader width="40%" height={11} borderRadius={6} style={{ marginTop: 6 }} />
          </View>
        </View>
      ))}
    </View>
  );

  const AnimatedFlashList = Reanimated.createAnimatedComponent(FlashList);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      {/* Heavy Typography Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <AnimatedPressable style={styles.searchBtn} activeOpacity={0.8} onPress={() => navigation.navigate('GlobalSearch')} accessibilityLabel="Search listings">
          <Ionicons name="search" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>
      </View>

      <View style={styles.titleContainer}>
        <Text style={styles.hugeTitle}>{title}</Text>
        <View style={styles.titleMetaRow}>
          <Text style={styles.itemCountText}>{dataToRender.length} items found</Text>
          <SyncStatusPill tone={browseStatus.tone} label={browseStatus.label} compact />
        </View>
      </View>

      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <AppButton
            style={styles.filterPill}
            variant="contrast"
            size="sm"
            align="center"
            title={hasActiveFilters ? 'Filter on' : 'Filter'}
            titleStyle={styles.filterPillTextActive}
            icon={<Ionicons name="options-outline" size={16} color={Colors.textInverse} />}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
            accessibilityLabel="Open filters"
          />
          <AppButton
            style={styles.filterPillOutline}
            variant="secondary"
            size="sm"
            align="center"
            title={browseFilters.brands.length > 0 ? `Brand (${browseFilters.brands.length})` : 'Brand'}
            titleStyle={styles.filterPillText}
            icon={<Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
            accessibilityLabel="Filter by brand"
          />
          <AppButton
            style={styles.filterPillOutline}
            variant="secondary"
            size="sm"
            align="center"
            title={browseFilters.sizes.length > 0 ? `Size (${browseFilters.sizes.length})` : 'Size'}
            titleStyle={styles.filterPillText}
            icon={<Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
            accessibilityLabel="Filter by size"
          />
          <AppButton
            style={styles.filterPillOutline}
            variant="secondary"
            size="sm"
            align="center"
            title={browseFilters.condition !== 'Any' ? browseFilters.condition : 'Condition'}
            titleStyle={styles.filterPillText}
            icon={<Ionicons name="chevron-down" size={14} color={Colors.textPrimary} />}
            onPress={() => navigation.navigate('Filter', { categoryId, subcategoryId, title })}
            accessibilityLabel="Filter by condition"
          />
        </ScrollView>
      </View>

      {lastError ? (
        <SyncRetryBanner
          message="Live browse sync is unavailable. Showing cached listings."
          onRetry={() => void refreshListings()}
          isRetrying={isSyncing}
          telemetryContext="browse_sync"
          containerStyle={styles.syncRetryBanner}
        />
      ) : null}

      {/* Spacious 2-Column Grid */}
      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={40} />
        
        <AnimatedFlashList
          ref={scrollRef}
          data={dataToRender}
          keyExtractor={(item: any) => item.id}
          numColumns={2}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.gridContent}
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
            <BrowseGridItem 
              item={item} 
              index={index} 
              navigation={navigation} 
              wishlist={wishlist} 
              toggleWishlist={toggleWishlist} 
              showToast={show} 
              formatPrice={formatFromFiat} 
              reducedMotionEnabled={reducedMotionEnabled}
            />
          )}
          ListEmptyComponent={
            showBrowseLoadingSkeleton ? (
              renderBrowseLoadingState()
            ) : (
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
            )
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
  searchBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  
  titleContainer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 20,
  },
  hugeTitle: { 
    fontSize: 44, 
    fontFamily: 'Inter_700Bold', 
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
  titleMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },

  filterBar: { paddingBottom: 20 },
  filterRow: { paddingHorizontal: 20, gap: 10 },
  filterPill: { 
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 24, 
  },
  filterPillTextActive: { color: Colors.textInverse, fontSize: 13, fontFamily: 'Inter_700Bold' },
  filterPillOutline: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 24, 
  },
  filterPillText: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  syncRetryBanner: {
    marginHorizontal: 20,
    marginBottom: 14,
  },

  gridContent: { paddingHorizontal: 20, paddingBottom: 100 },
  rowWrapper: { justifyContent: 'space-between', marginBottom: 32 },
  loadingStateWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    rowGap: 32,
  },
  loadingCard: {
    width: ITEM_WIDTH,
  },
  loadingCardOffset: {
    marginTop: 24,
  },
  loadingCardBody: {
    marginTop: 10,
    paddingHorizontal: 4,
  },
  
  gridItem: { width: ITEM_WIDTH },
  imageWrap: {
    width: ITEM_WIDTH,
    height: ITEM_WIDTH * 1.35,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    marginBottom: 12,
  },
  gridImage: { width: '100%', height: '100%' },
  sharedImageLayer: {
    ...StyleSheet.absoluteFillObject,
  },
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
