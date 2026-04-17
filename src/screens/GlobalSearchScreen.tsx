import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import Reanimated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Motion } from '../constants/motion';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useBackendData } from '../context/BackendDataContext';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { getBackendSyncStatus } from '../utils/syncStatus';
import { CachedImage } from '../components/CachedImage';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { AppButton } from '../components/ui/AppButton';

type Props = StackScreenProps<RootStackParamList, 'GlobalSearch'>;

const RECENT_SEARCHES = ['stussy hoodie', 'arcteryx alpha sv', 'carhartt detroit', 'vintage levis 501'];
const TRENDING_TAGS = ['#y2k', '#gorpcore', 'archive', 'japanese denim', 'techwear', '#streetwear'];
const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface RankedListing {
  id: string;
  title: string;
  brand: string;
  size: string;
  condition: 'New with tags' | 'Very good' | 'Good' | 'Satisfactory';
  image: string;
  price: number;
  likes: number;
  createdAt?: string;
  score: number;
  reason: string;
}

type BrowseSortOption = 'Recommended' | 'Newest' | 'Price: Low to High' | 'Price: High to Low';

const DISCOVER_SORT_OPTIONS: BrowseSortOption[] = [
  'Recommended',
  'Newest',
  'Price: Low to High',
  'Price: High to Low',
];

function buildAffinitySet(values: string[]) {
  const counts = new Map<string, number>();

  values.forEach((value) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([value]) => value),
  );
}

function getRecencyBoost(createdAt?: string) {
  if (!createdAt) {
    return 0;
  }

  const createdTs = Date.parse(createdAt);
  if (Number.isNaN(createdTs)) {
    return 0;
  }

  const ageHours = (Date.now() - createdTs) / (1000 * 60 * 60);
  return Math.max(0, 16 - ageHours / 8);
}

export default function GlobalSearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const browseFilters = useStore((state) => state.browseFilters);
  const updateBrowseFilters = useStore((state) => state.updateBrowseFilters);
  const resetBrowseFilters = useStore((state) => state.resetBrowseFilters);
  const wishlistIds = useStore((state) => state.wishlist);
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();
  const { formatFromFiat } = useFormattedPrice();
  const focusProgress = useSharedValue(0);

  const normalizedQuery = query.trim().toLowerCase();
  const queryTokens = useMemo(
    () => normalizedQuery.split(/\s+/).filter(Boolean),
    [normalizedQuery],
  );

  const wishlistListings = useMemo(
    () => listings.filter((listing) => wishlistIds.includes(listing.id)),
    [listings, wishlistIds],
  );

  const affinityProfile = useMemo(
    () => ({
      brandSet: buildAffinitySet(wishlistListings.map((listing) => listing.brand)),
      categorySet: buildAffinitySet(wishlistListings.map((listing) => listing.category)),
      subcategorySet: buildAffinitySet(wishlistListings.map((listing) => listing.subcategory)),
    }),
    [wishlistListings],
  );

  const rankedListings = useMemo<RankedListing[]>(() => {
    return listings
      .filter((listing) => !wishlistIds.includes(listing.id))
      .map((listing) => {
        const title = listing.title.toLowerCase();
        const brand = listing.brand.toLowerCase();
        const category = listing.category.toLowerCase();
        const subcategory = listing.subcategory.toLowerCase();

        let score = Math.min(listing.likes, 120) * 0.22;
        score += getRecencyBoost(listing.createdAt);

        const reasons: string[] = [];

        if (affinityProfile.brandSet.has(brand)) {
          score += 16;
          reasons.push('Matches brands you save often');
        }

        if (affinityProfile.categorySet.has(category)) {
          score += 11;
          reasons.push('Aligned with your closet categories');
        }

        if (affinityProfile.subcategorySet.has(subcategory)) {
          score += 8;
          reasons.push('Close to items in your wishlist');
        }

        const matchedTokens = queryTokens.filter(
          (token) =>
            title.includes(token)
            || brand.includes(token)
            || category.includes(token)
            || subcategory.includes(token),
        );

        if (queryTokens.length > 0) {
          if (matchedTokens.length > 0) {
            score += 22 + matchedTokens.length * 7;
            reasons.unshift(`Matches your search for "${matchedTokens[0]}"`);
          } else {
            score -= 18;
          }
        }

        return {
          id: listing.id,
          title: listing.title,
          brand: listing.brand,
          size: listing.size,
          condition: listing.condition,
          image: listing.images[0] ?? `https://picsum.photos/seed/${listing.id}/500/600`,
          price: listing.price,
          likes: listing.likes,
          createdAt: listing.createdAt,
          score,
          reason: reasons[0] ?? 'Recommended from current market momentum',
        };
      })
      .filter((listing) => {
        if (!queryTokens.length) {
          return true;
        }

        return listing.score > 0;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [affinityProfile.brandSet, affinityProfile.categorySet, affinityProfile.subcategorySet, listings, queryTokens, wishlistIds]);

  const trendingTags = useMemo(() => {
    const affinityBrands = [...affinityProfile.brandSet];
    const queryBoost = normalizedQuery ? [normalizedQuery] : [];
    return [...new Set([...queryBoost, ...affinityBrands, ...TRENDING_TAGS])].slice(0, 8);
  }, [affinityProfile.brandSet, normalizedQuery]);

  const activeFilterCount =
    browseFilters.brands.length
    + browseFilters.sizes.length
    + (browseFilters.condition !== 'Any' ? 1 : 0);

  const hasActiveDiscoverFilters = activeFilterCount > 0;

  const discoverListings = useMemo(() => {
    const selectedBrands = new Set(browseFilters.brands.map((brand) => brand.toLowerCase()));
    const selectedSizes = new Set(browseFilters.sizes.map((size) => size.toLowerCase()));

    const filtered = rankedListings.filter((listing) => {
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

    const sorted = [...filtered];
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
        sorted.sort((a, b) => b.score - a.score || b.likes - a.likes);
        break;
    }

    return sorted.slice(0, 8);
  }, [browseFilters.brands, browseFilters.condition, browseFilters.sizes, browseFilters.sort, rankedListings]);

  // Auto-focus the search bar when the screen mounts
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    focusProgress.value = withTiming(isSearchFocused ? 1 : 0, { duration: Motion.timing.focus });
  }, [focusProgress, isSearchFocused]);

  const animatedSearchShellStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [Colors.glassBorder, Colors.accent],
    );

    const backgroundColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [Colors.card, Colors.cardAlt],
    );

    return {
      borderColor,
      backgroundColor,
      transform: [{ scale: 1 + focusProgress.value * 0.012 }],
    };
  });

  const handleSearchSubmit = () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    updateBrowseFilters({
      query: trimmedQuery,
    });

    navigation.navigate('Browse', {
      categoryId: 'search',
      title: `Search: "${trimmedQuery}"`,
      searchQuery: trimmedQuery,
    });
  };

  const handlePillPress = (tag: string) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;

    updateBrowseFilters({
      query: normalizedTag,
    });

    navigation.navigate('Browse', {
      categoryId: 'search',
      title: `Search: "${normalizedTag}"`,
      searchQuery: normalizedTag,
    });
  };

  const searchStatus = React.useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
        labels: {
          syncing: 'Refreshing index',
          live: 'Live index',
          error: 'Offline index',
          fallback: 'Cached index',
        },
      }),
    [isSyncing, lastError, source],
  );

  const showSearchLoadingSkeleton = isSyncing && source === 'mock' && listings.length === 0 && !lastError;

  const handleCycleSort = () => {
    const activeSortIndex = DISCOVER_SORT_OPTIONS.indexOf(browseFilters.sort);
    const nextSort = DISCOVER_SORT_OPTIONS[(activeSortIndex + 1) % DISCOVER_SORT_OPTIONS.length];
    updateBrowseFilters({ sort: nextSort, query: normalizedQuery });
  };

  const handleOpenFilter = () => {
    updateBrowseFilters({ query: normalizedQuery });
    navigation.navigate('Filter', {
      categoryId: 'search',
      title: 'Discover',
    });
  };

  const handleClearDiscoverFilters = () => {
    const preservedQuery = normalizedQuery;
    resetBrowseFilters();
    updateBrowseFilters({ query: preservedQuery });
  };

  const handleOpenRecommendation = (listingId: string) => {
    navigation.push('ItemDetail', { itemId: listingId });
  };

  const renderSearchLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      <View style={styles.loadingSection}>
        <SkeletonLoader width="32%" height={14} borderRadius={7} style={{ marginBottom: 12 }} />
        <View style={styles.loadingTagsRow}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonLoader key={`search_tag_loading_${index}`} width={96} height={36} borderRadius={18} />
          ))}
        </View>
      </View>

      <View style={styles.loadingSection}>
        <SkeletonLoader width="44%" height={14} borderRadius={7} style={{ marginBottom: 14 }} />
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={`search_recent_loading_${index}`} style={styles.loadingRecentRow}>
            <SkeletonLoader width={20} height={20} borderRadius={10} />
            <SkeletonLoader width="62%" height={13} borderRadius={6} style={{ marginLeft: 12 }} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* Hero Search Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color={Colors.textPrimary} />
        </AnimatedPressable>

        <Reanimated.View style={[styles.inputContainer, animatedSearchShellStyle]}>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search listings, brands, sellers"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearchSubmit}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            returnKeyType="search"
            autoCapitalize="none"
            selectionColor={Colors.accent}
          />
          {query.length > 0 && (
            <AnimatedPressable style={styles.clearBtn} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={20} color={Colors.textSecondary} />
            </AnimatedPressable>
          )}
        </Reanimated.View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusMeta}>{listings.length} listings indexed</Text>
        <SyncStatusPill tone={searchStatus.tone} label={searchStatus.label} compact />
      </View>

      {lastError ? (
        <SyncRetryBanner
          message="Search indexing is delayed. Results may be stale."
          onRetry={() => void refreshListings()}
          isRetrying={isSyncing}
          telemetryContext="global_search_sync"
          containerStyle={styles.syncRetryBanner}
        />
      ) : null}

      <View style={styles.controlRail}>
        <AppButton
          title={`Sort: ${browseFilters.sort}`}
          icon={<Ionicons name="swap-vertical-outline" size={14} color={Colors.textPrimary} />}
          variant="secondary"
          size="sm"
          style={styles.controlBtn}
          iconContainerStyle={styles.controlBtnIconWrap}
          titleStyle={styles.controlBtnText}
          onPress={handleCycleSort}
          accessibilityLabel="Cycle discover sort"
          accessibilityHint="Cycles between recommended, newest, and price sorting"
        />
        <AppButton
          title={hasActiveDiscoverFilters ? `Filter (${activeFilterCount})` : 'Filter'}
          icon={<Ionicons name="options-outline" size={14} color={Colors.textPrimary} />}
          variant="secondary"
          size="sm"
          style={styles.controlBtn}
          iconContainerStyle={styles.controlBtnIconWrap}
          titleStyle={styles.controlBtnText}
          onPress={handleOpenFilter}
          accessibilityLabel="Open discover filters"
          accessibilityHint="Open brand size and condition filters"
        />
      </View>

      {hasActiveDiscoverFilters ? (
        <View style={styles.controlMetaRow}>
          <Text style={styles.controlMetaText}>Active filters: {activeFilterCount}</Text>
          <AppButton
            title="Clear"
            variant="secondary"
            size="sm"
            style={styles.controlClearBtn}
            titleStyle={styles.controlClearText}
            onPress={handleClearDiscoverFilters}
            accessibilityLabel="Clear discover filters"
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {showSearchLoadingSkeleton ? (
          renderSearchLoadingState()
        ) : (
          <>
            <View style={styles.recoSection}>
              <View style={styles.recoHeaderRow}>
                <Text style={[styles.sectionTitle, { paddingHorizontal: 0, marginBottom: 0 }]}>{normalizedQuery ? 'Smart Matches' : 'For You'}</Text>
                <Text style={styles.recoHeaderMeta}>{discoverListings.length} picks</Text>
              </View>

              {discoverListings.length > 0 ? (
                <View style={styles.recoGrid}>
                  {discoverListings.map((listing) => (
                    <AnimatedPressable
                      key={listing.id}
                      style={styles.recoCard}
                      activeOpacity={0.9}
                      onPress={() => handleOpenRecommendation(listing.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`${listing.title}, ${formatFromFiat(listing.price, 'GBP', { displayMode: 'fiat' })}`}
                      accessibilityHint="Opens item detail"
                    >
                      <SharedTransitionView
                        style={styles.recoImageContainer}
                        sharedTransitionTag={`image-${listing.id}-0`}
                      >
                        <CachedImage
                          uri={listing.image}
                          style={styles.recoImage}
                          contentFit="cover"
                        />
                      </SharedTransitionView>
                      <View style={styles.recoBody}>
                        <Text style={styles.recoReason} numberOfLines={1}>{listing.reason}</Text>
                        <Text style={styles.recoTitle} numberOfLines={2}>{listing.title}</Text>
                        <View style={styles.recoMetaRow}>
                          <Text style={styles.recoBrand} numberOfLines={1}>{listing.brand}</Text>
                          <Text style={styles.recoPrice}>{formatFromFiat(listing.price, 'GBP', { displayMode: 'fiat' })}</Text>
                        </View>
                      </View>
                    </AnimatedPressable>
                  ))}
                </View>
              ) : (
                <View style={styles.recoEmptyState}>
                  <Ionicons name="sparkles-outline" size={18} color={Colors.textMuted} />
                  <Text style={styles.recoEmptyText}>
                    {hasActiveDiscoverFilters
                      ? 'No picks match your current filters. Adjust or clear them.'
                      : 'No ranked results yet. Try a shorter keyword.'}
                  </Text>
                </View>
              )}
            </View>

            {/* Trending Tags Row */}
            <Text style={styles.sectionTitle}>Trending</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.trendingRow}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
            >
              {trendingTags.map((tag, idx) => (
                <AnimatedPressable key={idx} style={styles.trendingPill} activeOpacity={0.8} onPress={() => handlePillPress(tag)}>
                  <Text style={styles.trendingPillText}>{tag}</Text>
                </AnimatedPressable>
              ))}
            </ScrollView>

            {/* Recent Searches */}
            <View style={styles.recentSection}>
              <Text style={[styles.sectionTitle, { paddingHorizontal: 0, marginBottom: 16 }]}>Recent Searches</Text>
              {RECENT_SEARCHES.map((term, idx) => (
                <AnimatedPressable key={idx} style={styles.recentRow} activeOpacity={0.7} onPress={() => handlePillPress(term)}>
                  <Ionicons name="time-outline" size={20} color={Colors.textMuted} />
                  <Text style={styles.recentText}>{term}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </AnimatedPressable>
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    paddingHorizontal: 20,
    height: 56,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  clearBtn: {
    padding: 4,
    marginLeft: 8,
  },

  content: { paddingTop: 20 },
  statusRow: {
    paddingHorizontal: 20,
    marginTop: -4,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  syncRetryBanner: {
    marginHorizontal: 20,
    marginBottom: 14,
  },
  controlRail: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  controlBtn: {
    flex: 1,
    minHeight: 38,
    borderRadius: 14,
    borderColor: Colors.glassBorder,
    backgroundColor: Colors.card,
  },
  controlBtnIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  controlBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  controlMetaRow: {
    marginHorizontal: 20,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  controlMetaText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  controlClearBtn: {
    minHeight: 30,
    borderRadius: 14,
    borderColor: Colors.glassBorder,
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
  },
  controlClearText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  loadingStateWrap: {
    paddingHorizontal: 20,
    gap: 26,
  },
  loadingSection: {
    gap: 8,
  },
  loadingTagsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  loadingRecentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
    marginBottom: 2,
  },
  
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    letterSpacing: 0.25,
    paddingHorizontal: 20,
    marginBottom: 12,
  },

  recoSection: {
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  recoHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 8,
  },
  recoHeaderMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  recoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  recoCard: {
    width: (SCREEN_WIDTH - 52) / 2,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    backgroundColor: Colors.card,
  },
  recoImageContainer: {
    width: '100%',
    height: 140,
  },
  recoImage: {
    width: '100%',
    height: '100%',
  },
  recoBody: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 5,
  },
  recoReason: {
    color: Colors.accent,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  recoTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 18,
    minHeight: 36,
  },
  recoMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  recoBrand: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  recoPrice: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  recoEmptyState: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: Colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recoEmptyText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },

  trendingRow: {
    marginBottom: 40,
  },
  trendingPill: {
    backgroundColor: ActiveTheme === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  trendingPillText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },

  recentSection: {
    paddingHorizontal: 20,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recentText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
    marginLeft: 14,
  },
});
