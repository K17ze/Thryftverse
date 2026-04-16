import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Platform,
  Dimensions,
  Pressable
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useBackendData } from '../context/BackendDataContext';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { getBackendSyncStatus } from '../utils/syncStatus';
import { AppButton } from '../components/ui/AppButton';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';

const { height, width } = Dimensions.get('window');
const SNAP_HALF = height * 0.5;
const SNAP_FULL = height * 0.1;
const IS_LIGHT = ActiveTheme === 'light';
const OVERLAY_BG = IS_LIGHT ? 'rgba(14, 12, 10, 0.34)' : 'rgba(0,0,0,0.6)';
const SHEET_BG = Colors.surface;
const HANDLE_BG = Colors.borderLight;
const CHIP_BG = Colors.card;
const CHIP_BORDER = Colors.border;
const DIVIDER_COLOR = Colors.border;
const RETRY_BANNER_BG = IS_LIGHT ? 'rgba(255,255,255,0.95)' : 'rgba(26,26,26,0.95)';
const RETRY_BUTTON_BG = IS_LIGHT ? Colors.cardAlt : '#111';
const FOOTER_BG = IS_LIGHT ? 'rgba(247, 245, 241, 0.96)' : 'rgba(10, 10, 10, 0.95)';
const APPLY_DISABLED_BG = IS_LIGHT ? Colors.borderLight : '#333';

type SortOption = 'Recommended' | 'Newest' | 'Price: Low to High' | 'Price: High to Low';
type ConditionOption = 'Any' | 'New with tags' | 'Very good' | 'Good' | 'Satisfactory';
type FilterRoute = RouteProp<RootStackParamList, 'Filter'>;

const SORT_OPTIONS: Array<{ value: SortOption; label: string; accessibilityLabel: string }> = [
  { value: 'Recommended', label: 'Recommended', accessibilityLabel: 'Sort by recommended' },
  { value: 'Newest', label: 'Newest', accessibilityLabel: 'Sort by newest items' },
  { value: 'Price: Low to High', label: 'Price: Low to High', accessibilityLabel: 'Sort by price low to high' },
  { value: 'Price: High to Low', label: 'Price: High to Low', accessibilityLabel: 'Sort by price high to low' },
];

const CONDITION_OPTIONS: Array<{ value: ConditionOption; label: string; accessibilityLabel: string }> = [
  { value: 'Any', label: 'Any', accessibilityLabel: 'Filter any condition' },
  { value: 'New with tags', label: 'New with tags', accessibilityLabel: 'Filter new with tags' },
  { value: 'Very good', label: 'Very good', accessibilityLabel: 'Filter very good condition' },
  { value: 'Good', label: 'Good', accessibilityLabel: 'Filter good condition' },
  { value: 'Satisfactory', label: 'Satisfactory', accessibilityLabel: 'Filter satisfactory condition' },
];

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

export default function FilterScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<FilterRoute>();
  const browseFilters = useStore((state) => state.browseFilters);
  const updateBrowseFilters = useStore((state) => state.updateBrowseFilters);
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();

  const categoryId = route.params?.categoryId ?? 'search';
  const title = route.params?.title;
  const subcategoryId = route.params?.subcategoryId;

  const [activeSort, setActiveSort] = useState<SortOption>(browseFilters.sort);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(browseFilters.brands);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(browseFilters.sizes);
  const [selectedCondition, setSelectedCondition] = useState<ConditionOption>(browseFilters.condition);
  const [showAllBrands, setShowAllBrands] = useState(false);

  const translateY = useSharedValue(height);
  const contextY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(SNAP_HALF, { damping: 20, stiffness: 200 });
  }, []);

  const closeBottomSheet = () => {
    translateY.value = withSpring(height, { damping: 20, stiffness: 200 }, () => {
      runOnJS(navigation.goBack)();
    });
  };

  const gesture = Gesture.Pan()
    .onStart(() => {
      contextY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(SNAP_FULL, contextY.value + e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 100 && e.velocityY > 500) {
        runOnJS(closeBottomSheet)();
      } else if (translateY.value > SNAP_HALF + 100) {
        runOnJS(closeBottomSheet)();
      } else if (translateY.value < SNAP_HALF - 50) {
        // Snap to full (90% height)
        translateY.value = withSpring(SNAP_FULL, { damping: 20, stiffness: 200 });
      } else {
        // Snap back to half
        translateY.value = withSpring(SNAP_HALF, { damping: 20, stiffness: 200 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const overlayStyle = useAnimatedStyle(() => {
    const opacity = interpolate(translateY.value, [SNAP_FULL, height], [0.6, 0], Extrapolation.CLAMP);
    return { opacity };
  });

  const MOCK_BRANDS = ['Nike', 'Adidas', 'Stussy', 'Carhartt', 'Arc\'teryx', 'Levi\'s', 'Off-White', 'Zara'];
  const MOCK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

  const brandOptions = React.useMemo(() => {
    const derived = Array.from(
      new Set(
        listings
          .map((listing) => listing.brand?.trim())
          .filter((brand): brand is string => Boolean(brand)),
      ),
    );

    return derived.length > 0 ? derived : MOCK_BRANDS;
  }, [listings]);

  const visibleBrandOptions = React.useMemo(() => {
    if (showAllBrands) {
      return brandOptions;
    }

    return brandOptions.slice(0, 8);
  }, [brandOptions, showAllBrands]);

  const sizeOptions = React.useMemo(() => {
    const derived = Array.from(
      new Set(
        listings
          .map((listing) => listing.size?.trim())
          .filter((size): size is string => Boolean(size)),
      ),
    );

    return derived.length > 0 ? derived : MOCK_SIZES;
  }, [listings]);

  const filterStatus = React.useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
        labels: {
          live: 'Live data',
        },
      }),
    [isSyncing, lastError, source],
  );

  const showFilterLoadingState = isSyncing && source === 'mock' && listings.length === 0 && !lastError;

  const renderLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      <View style={styles.loadingSection}>
        <SkeletonLoader width="32%" height={14} borderRadius={7} style={{ marginBottom: 12 }} />
        <View style={styles.loadingChipRow}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonLoader key={`filter_sort_loading_${index}`} width={120} height={42} borderRadius={21} />
          ))}
        </View>
      </View>

      <View style={styles.loadingSection}>
        <SkeletonLoader width="24%" height={14} borderRadius={7} style={{ marginBottom: 12 }} />
        <View style={styles.loadingChipWrap}>
          {Array.from({ length: 8 }).map((_, index) => (
            <SkeletonLoader key={`filter_brand_loading_${index}`} width={104} height={42} borderRadius={21} />
          ))}
        </View>
      </View>
    </View>
  );

  const toggleBrand = (b: string) => {
    setSelectedBrands(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  };
  
  const toggleSize = (s: string) => {
    setSelectedSizes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const getResultsCount = () => {
    const normalizedCategory = toKey(categoryId);
    const normalizedSubcategory = getSubcategoryToken(categoryId, subcategoryId, title);
    const query = browseFilters.query.trim().toLowerCase();
    const selectedBrandKeys = new Set(selectedBrands.map((brand) => brand.toLowerCase()));
    const selectedSizeKeys = new Set(selectedSizes.map((size) => size.toLowerCase()));

    return listings.filter((listing) => {
      if (normalizedCategory !== 'search' && listing.category.toLowerCase() !== normalizedCategory) {
        return false;
      }

      if (normalizedCategory !== 'search' && normalizedSubcategory) {
        if (!listing.subcategory.toLowerCase().includes(normalizedSubcategory)) {
          return false;
        }
      }

      if (query) {
        const searchable = [
          listing.title,
          listing.brand,
          listing.description,
          listing.category,
          listing.subcategory,
        ]
          .join(' ')
          .toLowerCase();

        if (!searchable.includes(query)) {
          return false;
        }
      }

      if (selectedBrandKeys.size > 0 && !selectedBrandKeys.has(listing.brand.toLowerCase())) {
        return false;
      }

      if (selectedSizeKeys.size > 0 && !selectedSizeKeys.has(listing.size.toLowerCase())) {
        return false;
      }

      if (selectedCondition !== 'Any' && listing.condition !== selectedCondition) {
        return false;
      }

      return true;
    }).length;
  };

  const handleClear = () => {
    setActiveSort('Recommended');
    setSelectedBrands([]);
    setSelectedSizes([]);
    setSelectedCondition('Any');
  };

  const handleApply = () => {
    updateBrowseFilters({
      sort: activeSort,
      brands: selectedBrands,
      sizes: selectedSizes,
      condition: selectedCondition,
    });
    closeBottomSheet();
  };

  const resultCount = getResultsCount();
  const applyLabel = showFilterLoadingState ? 'Loading options...' : `Show ${resultCount} items`;

  return (
    <View style={styles.container}>
      <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: OVERLAY_BG }, overlayStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={closeBottomSheet} />
      </Reanimated.View>

      <GestureDetector gesture={gesture}>
        <Reanimated.View style={[styles.sheet, sheetStyle]}>
          {/* Drag Handle */}
          <View style={styles.handleContainer}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <Text style={styles.headerTitle}>Filter & Sort</Text>
            <AppButton
              title="Clear"
              onPress={handleClear}
              variant="secondary"
              size="sm"
              style={styles.clearBtn}
              titleStyle={styles.clearText}
              accessibilityLabel="Clear selected filters"
            />
          </View>

          <View style={styles.statusRow}>
            <Text style={styles.statusMeta}>{resultCount} matches currently</Text>
            <SyncStatusPill tone={filterStatus.tone} label={filterStatus.label} compact />
          </View>

          {lastError ? (
            <SyncRetryBanner
              message="Live filter data is delayed. Showing cached catalog options."
              onRetry={() => void refreshListings()}
              isRetrying={isSyncing}
              telemetryContext="filter_sync"
              containerStyle={styles.syncRetryBanner}
              actionStyle={styles.syncRetryBtn}
            />
          ) : null}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
            {showFilterLoadingState ? (
              renderLoadingState()
            ) : (
              <>
                {/* Sort Section */}
                <Text style={styles.sectionHeading}>Sort By</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  <AppSegmentControl
                    options={SORT_OPTIONS}
                    value={activeSort}
                    onChange={setActiveSort}
                    optionStyle={styles.chip}
                    optionActiveStyle={styles.chipActive}
                    optionTextStyle={styles.chipText}
                    optionTextActiveStyle={styles.chipTextActive}
                  />
                </ScrollView>

                <View style={styles.sectionDivider} />

                {/* Brand Section */}
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionHeading}>Brand</Text>
                  {brandOptions.length > 8 ? (
                    <AppButton
                      title={showAllBrands ? 'Show less' : 'See all'}
                      onPress={() => setShowAllBrands((current) => !current)}
                      variant="secondary"
                      size="sm"
                      style={styles.seeAllBtn}
                      titleStyle={styles.seeAllText}
                      accessibilityLabel={showAllBrands ? 'Show fewer brand options' : 'Show all brand options'}
                    />
                  ) : null}
                </View>
                <View style={styles.wrapContainer}>
                  {visibleBrandOptions.map(b => {
                    const isActive = selectedBrands.includes(b);
                    return (
                      <AppButton
                        key={b}
                        title={b}
                        variant="secondary"
                        size="sm"
                        style={[styles.chip, isActive && styles.chipActive]}
                        titleStyle={[styles.chipText, isActive && styles.chipTextActive]}
                        onPress={() => toggleBrand(b)}
                        accessibilityLabel={`Toggle brand filter ${b}`}
                      />
                    );
                  })}
                </View>

                <View style={styles.sectionDivider} />

                {/* Size Section */}
                <Text style={styles.sectionHeading}>Size</Text>
                <View style={styles.wrapContainer}>
                  {sizeOptions.map(s => {
                    const isActive = selectedSizes.includes(s);
                    return (
                      <AppButton
                        key={s}
                        title={s}
                        variant="secondary"
                        size="sm"
                        style={[styles.chip, styles.sizeChip, isActive && styles.chipActive]}
                        titleStyle={[styles.chipText, isActive && styles.chipTextActive]}
                        onPress={() => toggleSize(s)}
                        accessibilityLabel={`Toggle size filter ${s}`}
                      />
                    );
                  })}
                </View>

                <View style={styles.sectionDivider} />

                {/* Condition Section */}
                <Text style={styles.sectionHeading}>Condition</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
                  <AppSegmentControl
                    options={CONDITION_OPTIONS}
                    value={selectedCondition}
                    onChange={setSelectedCondition}
                    optionStyle={styles.chip}
                    optionActiveStyle={styles.chipActive}
                    optionTextStyle={styles.chipText}
                    optionTextActiveStyle={styles.chipTextActive}
                  />
                </ScrollView>
              </>
            )}

            {/* Sticky Bottom Action */}
            <View style={styles.footer}>
              <AppButton
                style={[styles.applyBtn, showFilterLoadingState && styles.applyBtnDisabled]}
                title={applyLabel}
                titleStyle={[styles.applyBtnText, showFilterLoadingState && styles.applyBtnTextDisabled]}
                onPress={handleApply}
                disabled={showFilterLoadingState}
                variant="contrast"
                size="lg"
                align="center"
                accessibilityLabel={applyLabel}
              />
            </View>
          </ScrollView>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'transparent' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    width: width,
    height: height, // allow scroll but cut off below screen
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 20,
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: HANDLE_BG,
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: Typography.size.heading, fontFamily: Typography.family.bold, color: Colors.textPrimary, letterSpacing: Typography.tracking.tight },
  clearBtn: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  clearText: { color: Colors.accent, fontSize: Typography.size.body, fontFamily: Typography.family.semibold },
  statusRow: {
    paddingHorizontal: 24,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusMeta: {
    color: Colors.textMuted,
    fontSize: Typography.size.caption,
    fontFamily: Typography.family.medium,
  },
  syncRetryBanner: {
    marginHorizontal: 24,
    marginBottom: 10,
    backgroundColor: RETRY_BANNER_BG,
  },
  syncRetryBtn: {
    backgroundColor: RETRY_BUTTON_BG,
  },

  scrollContent: { paddingTop: 10, paddingBottom: 40 },
  loadingStateWrap: {
    paddingHorizontal: 20,
    gap: 22,
  },
  loadingSection: {
    gap: 8,
  },
  loadingChipRow: {
    flexDirection: 'row',
    gap: 10,
  },
  loadingChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  
  sectionHeading: {
    fontSize: Typography.size.bodyLarge,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    paddingHorizontal: 20,
    marginBottom: 16,
    letterSpacing: Typography.tracking.tight,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingRight: 20,
    marginBottom: 16,
  },
  seeAllBtn: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  seeAllText: { color: Colors.accent, fontSize: Typography.size.body, fontFamily: Typography.family.semibold },

  hScroll: { paddingHorizontal: 20, gap: 10 },
  
  wrapContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
  },

  chip: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 21,
    backgroundColor: CHIP_BG,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
  },
  sizeChip: { minWidth: 64, alignItems: 'center' },
  chipActive: { backgroundColor: Colors.textPrimary, borderColor: Colors.textPrimary },
  
  chipText: { fontSize: Typography.size.body, fontFamily: Typography.family.semibold, color: Colors.textPrimary },
  chipTextActive: { color: Colors.background, fontFamily: Typography.family.bold },

  sectionDivider: {
    height: 1,
    backgroundColor: DIVIDER_COLOR,
    marginVertical: 24,
    marginHorizontal: 20,
  },

  footer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: FOOTER_BG,
    borderTopWidth: 1,
    borderTopColor: DIVIDER_COLOR,
  },
  applyBtn: {
    width: '100%',
    minHeight: 60,
    borderRadius: 30,
  },
  applyBtnDisabled: {
    opacity: 0.6,
  },
  applyBtnText: {
    color: Colors.textInverse,
    fontSize: Typography.size.bodyLarge,
    fontFamily: Typography.family.bold,
    letterSpacing: Typography.tracking.wide,
  },
  applyBtnTextDisabled: {
    color: Colors.textMuted,
  },
});

