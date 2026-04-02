import React, { useState, useEffect } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
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
import { Colors } from '../constants/colors';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useBackendData } from '../context/BackendDataContext';

const { height, width } = Dimensions.get('window');
const SNAP_HALF = height * 0.5;
const SNAP_FULL = height * 0.1;

type SortOption = 'Recommended' | 'Newest' | 'Price: Low to High' | 'Price: High to Low';
type ConditionOption = 'Any' | 'New with tags' | 'Very good' | 'Good' | 'Satisfactory';
type FilterRoute = RouteProp<RootStackParamList, 'Filter'>;

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
  const { listings } = useBackendData();

  const categoryId = route.params?.categoryId ?? 'search';
  const title = route.params?.title;
  const subcategoryId = route.params?.subcategoryId;

  const [activeSort, setActiveSort] = useState<SortOption>(browseFilters.sort);
  const [selectedBrands, setSelectedBrands] = useState<string[]>(browseFilters.brands);
  const [selectedSizes, setSelectedSizes] = useState<string[]>(browseFilters.sizes);
  const [selectedCondition, setSelectedCondition] = useState<ConditionOption>(browseFilters.condition);

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

  const MOCK_BRANDS = ['Nike', 'Adidas', 'Stüssy', 'Carhartt', 'Arc\'teryx', 'Levi\'s', 'Off-White', 'Zara'];
  const MOCK_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const MOCK_CONDITIONS: ConditionOption[] = ['Any', 'New with tags', 'Very good', 'Good', 'Satisfactory'];

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

  return (
    <View style={styles.container}>
      <Reanimated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }, overlayStyle]}>
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
            <AnimatedPressable hitSlop={15} onPress={handleClear} activeOpacity={0.8}>
              <Text style={styles.clearText}>Clear</Text>
            </AnimatedPressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        
        {/* Sort Section */}
        <Text style={styles.sectionHeading}>Sort By</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {(['Recommended', 'Newest', 'Price: Low to High', 'Price: High to Low'] as SortOption[]).map((s) => (
            <AnimatedPressable 
              key={s} 
              style={[styles.chip, activeSort === s && styles.chipActive]}
              activeOpacity={0.8}
              onPress={() => setActiveSort(s)}
            >
              <Text style={[styles.chipText, activeSort === s && styles.chipTextActive]}>{s}</Text>
            </AnimatedPressable>
          ))}
        </ScrollView>

        <View style={styles.sectionDivider} />

        {/* Brand Section */}
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>Brand</Text>
          <AnimatedPressable activeOpacity={0.7}><Text style={styles.seeAllText}>See all</Text></AnimatedPressable>
        </View>
        <View style={styles.wrapContainer}>
          {MOCK_BRANDS.map(b => {
            const isActive = selectedBrands.includes(b);
            return (
              <AnimatedPressable
                key={b}
                style={[styles.chip, isActive && styles.chipActive]}
                activeOpacity={0.8}
                onPress={() => toggleBrand(b)}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{b}</Text>
              </AnimatedPressable>
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
              <AnimatedPressable
                key={s}
                style={[styles.chip, styles.sizeChip, isActive && styles.chipActive]}
                activeOpacity={0.8}
                onPress={() => toggleSize(s)}
              >
                <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{s}</Text>
              </AnimatedPressable>
            );
          })}
        </View>

        <View style={styles.sectionDivider} />

        {/* Condition Section */}
        <Text style={styles.sectionHeading}>Condition</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {MOCK_CONDITIONS.map(c => (
            <AnimatedPressable 
              key={c} 
              style={[styles.chip, selectedCondition === c && styles.chipActive]}
              activeOpacity={0.8}
              onPress={() => setSelectedCondition(c)}
            >
              <Text style={[styles.chipText, selectedCondition === c && styles.chipTextActive]}>{c}</Text>
            </AnimatedPressable>
          ))}
        </ScrollView>

            {/* Sticky Bottom Action */}
            <View style={styles.footer}>
              <AnimatedPressable style={styles.applyBtn} onPress={handleApply} activeOpacity={0.9}>
                <Text style={styles.applyBtnText}>Show {getResultsCount()} items</Text>
              </AnimatedPressable>
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
    backgroundColor: Colors.background,
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
    backgroundColor: '#333',
  },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_800ExtraBold', color: Colors.textPrimary, letterSpacing: -0.5 },
  clearText: { color: '#4ECDC4', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

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
