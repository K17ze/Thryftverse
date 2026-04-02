import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  StatusBar,
  TextInput,
  ScrollView,
  Image,
  Dimensions,
  RefreshControl
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedScrollHandler, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProductCard } from '../components/ProductCard';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store/useStore';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const PANEL_ALT = IS_LIGHT ? '#ece4d8' : '#1f1f1f';
const BRAND = IS_LIGHT ? '#2f251b' : TEAL;

// ── Saved Look data ──────────────────────────────────────────
interface SavedLook {
  id: string;
  title: string;
  coverImage: string;
  items: { id: string; label: string; x: number; y: number }[];
  creator: { name: string; avatar: string };
  likes: number;
  comments: number;
  saved: boolean;
}

const SAVED_LOOKS: SavedLook[] = [
  {
    id: 'look1',
    title: 'Winter Layers',
    coverImage: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&q=80',
    items: [
      { id: 'l5', label: 'Off-White Hoodie', x: 0.2, y: 0.3 },
      { id: 'l7', label: 'Cargo Trousers', x: 0.6, y: 0.65 },
      { id: 'l6', label: 'Air Max 90', x: 0.5, y: 0.85 },
    ],
    creator: { name: 'mariefullery', avatar: 'https://picsum.photos/seed/user1/80/80' },
    likes: 234,
    comments: 18,
    saved: true,
  },
  {
    id: 'look2',
    title: 'Minimal Monochrome',
    coverImage: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=600&q=80',
    items: [
      { id: 'l2', label: 'AMI Striped Shirt', x: 0.35, y: 0.25 },
      { id: 'l3', label: 'RL Harrington', x: 0.7, y: 0.4 },
    ],
    creator: { name: 'scott_art', avatar: 'https://picsum.photos/seed/user2/80/80' },
    likes: 156,
    comments: 12,
    saved: true,
  },
  {
    id: 'look3',
    title: 'Streetwear Daily',
    coverImage: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=600&q=80',
    items: [
      { id: 'l4', label: 'Stüssy Logo Tee', x: 0.4, y: 0.3 },
      { id: 'l9', label: 'Represent Hoodie', x: 0.25, y: 0.15 },
      { id: 'l10', label: 'Chuck Taylor', x: 0.6, y: 0.8 },
    ],
    creator: { name: 'dankdunksuk', avatar: 'https://picsum.photos/seed/user3/80/80' },
    likes: 89,
    comments: 7,
    saved: true,
  },
];

// ── Look Card Component ──────────────────────────────────────
function LookCard({ look, onPress }: { look: SavedLook; onPress: () => void }) {
  return (
    <AnimatedPressable style={lookStyles.card} onPress={onPress} activeOpacity={0.92}>
      {/* Cover Image */}
      <View style={lookStyles.imageWrap}>
        <Image source={{ uri: look.coverImage }} style={lookStyles.image} resizeMode="cover" />
        
        {/* Floating item tags */}
        {look.items.map((item, i) => (
          <View
            key={item.id}
            style={[
              lookStyles.itemTag,
              { left: `${item.x * 100}%` as any, top: `${item.y * 100}%` as any },
            ]}
          >
            <View style={lookStyles.tagDot} />
            <Text style={lookStyles.tagLabel} numberOfLines={1}>{item.label}</Text>
          </View>
        ))}

        {/* Gradient overlay at bottom */}
        <View style={lookStyles.gradient} />
      </View>

      {/* Bottom info row */}
      <View style={lookStyles.infoRow}>
        <Image source={{ uri: look.creator.avatar }} style={lookStyles.creatorAvatar} />
        <View style={lookStyles.infoText}>
          <Text style={lookStyles.lookTitle}>{look.title}</Text>
          <Text style={lookStyles.creatorName}>by @{look.creator.name}</Text>
        </View>
        <View style={lookStyles.statsRow}>
          <AnimatedPressable style={lookStyles.statBtn}>
            <Ionicons name="heart" size={18} color={BRAND} />
            <Text style={lookStyles.statCount}>{look.likes}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={lookStyles.statBtn}>
            <Ionicons name="chatbubble-outline" size={16} color={Colors.textSecondary} />
            <Text style={lookStyles.statCount}>{look.comments}</Text>
          </AnimatedPressable>
          <AnimatedPressable style={lookStyles.statBtn}>
            <Ionicons name="bookmark" size={16} color={BRAND} />
          </AnimatedPressable>
        </View>
      </View>
    </AnimatedPressable>
  );
}

// ── Main Screen ──────────────────────────────────────────────
export default function SearchScreen() {
  const [activeTab, setActiveTab] = useState<'SAVED' | 'WISHLIST'>('SAVED');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const navigation = useNavigation<NavT>();
  const wishlistIds = useStore(state => state.wishlist);
  const { listings, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = useState(false);
  const scrollY = useSharedValue(0);

  const wishlistItems = React.useMemo(
    () => listings.filter(l => wishlistIds.includes(l.id)),
    [listings, wishlistIds]
  );

  const listingIdSet = React.useMemo(() => new Set(listings.map((item) => item.id)), [listings]);

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

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  const filteredWishlist = wishlistItems.filter(l =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase()) || l.brand?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLooks = SAVED_LOOKS.filter(l =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const closetTabs = [
    { key: 'SAVED' as const, label: 'Saved', icon: 'layers-outline' as const },
    { key: 'WISHLIST' as const, label: 'Wishlist', icon: 'heart-outline' as const },
  ];

  const resolveLookItemId = React.useCallback(
    (look: SavedLook) => look.items.find((entry) => listingIdSet.has(entry.id))?.id ?? listings[0]?.id,
    [listingIdSet, listings]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerLabel}>YOUR COLLECTION</Text>
          <Text style={styles.hugeTitle}>My Closet</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.itemCount}>{wishlistItems.length + SAVED_LOOKS.length} items</Text>
        </View>
      </View>

      {/* ── Search Bar ── */}
      <View style={styles.searchRow}>
        <View style={[styles.searchBar, isSearchFocused && styles.searchBarFocused]}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search your closet..."
            placeholderTextColor={Colors.textMuted}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            selectionColor={TEAL}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <AnimatedPressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </AnimatedPressable>
          )}
        </View>
      </View>

      {/* ── Segmented Control ── */}
      <View style={styles.tabsContainer}>
        <View style={styles.tabsWrapper}>
          {closetTabs.map(tab => (
            <AnimatedPressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.activeTab]}
              onPress={() => setActiveTab(tab.key)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={tab.icon}
                size={14}
                color={activeTab === tab.key ? Colors.textInverse : Colors.textSecondary}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, activeTab === tab.key && styles.activeTabText]}>{tab.label}</Text>
              <Text style={[styles.tabCount, activeTab === tab.key && styles.tabCountActive]}>
                {tab.key === 'SAVED' ? filteredLooks.length : filteredWishlist.length}
              </Text>
            </AnimatedPressable>
          ))}
        </View>
      </View>

      {/* ── Content ── */}
      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={20} />
        
        {activeTab === 'SAVED' ? (
          filteredLooks.length > 0 ? (
            <AnimatedFlatList
              key="saved-looks"
              data={filteredLooks}
              keyExtractor={(item: any) => item.id}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
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
                <Reanimated.View entering={FadeInDown.delay(Math.min(index, 10) * 50).duration(400)}>
                  <LookCard
                    look={item}
                    onPress={() => {
                      const itemId = resolveLookItemId(item);
                      if (itemId) {
                        navigation.navigate('ItemDetail', { itemId });
                      }
                    }}
                  />
                </Reanimated.View>
              )}
              ListFooterComponent={
                <View style={styles.emptyFooter}>
                  <Text style={styles.footerHint}>
                    Save looks from the Feed to build your collection
                  </Text>
                </View>
              }
            />
          ) : (
            <EmptyState
              icon="layers-outline"
              title="No saved looks yet"
              subtitle={`Browse the Feed and save outfit looks\nto build your style collection`}
            />
          )
        ) : (
          filteredWishlist.length > 0 ? (
            <AnimatedFlatList
              key="wishlist-items"
              data={filteredWishlist}
              keyExtractor={(item: any) => item.id}
              numColumns={2}
              contentContainerStyle={styles.gridContent}
              columnWrapperStyle={styles.gridRow}
              showsVerticalScrollIndicator={false}
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
                <Reanimated.View entering={FadeInDown.delay(Math.min(index, 10) * 50).duration(400)}>
                  <ProductCard
                    item={item}
                    onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
                  />
                </Reanimated.View>
              )}
              ListFooterComponent={
                <View style={styles.emptyFooter}>
                  <Text style={styles.footerHint}>
                    ♡ items while browsing to add them here
                  </Text>
                </View>
              }
            />
          ) : (
            <EmptyState
              icon="heart-outline"
              title="Your wishlist is empty"
              subtitle={`Tap ♡ on items you love and\nthey'll appear here`}
            />
          )
        )}
      </View>
    </SafeAreaView>
  );
}

// ── Look Card Styles ─────────────────────────────────────────
const lookStyles = StyleSheet.create({
  card: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    marginBottom: 20,
    overflow: 'hidden',
  },
  imageWrap: {
    width: '100%',
    height: SCREEN_WIDTH * 1.1,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 100,
    backgroundColor: 'transparent',
    // Simulated gradient with opacity layers
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  itemTag: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 160,
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
    marginRight: 6,
  },
  tagLabel: {
    color: '#fff',
    fontSize: 11,
    fontFamily: Typography.family.medium,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  creatorAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface,
  },
  infoText: {
    flex: 1,
  },
  lookTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.06,
    marginBottom: 2,
  },
  creatorName: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: Typography.family.regular,
    letterSpacing: 0.1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  statBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statCount: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: Typography.family.medium,
  },
});

// ── Main Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  hugeTitle: {
    fontSize: 31,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.35,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  itemCount: {
    fontSize: 13,
    fontFamily: Typography.family.regular,
    letterSpacing: 0.12,
    color: Colors.textSecondary,
  },

  // Search
  searchRow: { paddingHorizontal: 20, paddingBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: PANEL_BG,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchBarFocused: { borderColor: BRAND },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
    fontFamily: Typography.family.medium,
    letterSpacing: 0.08,
  },

  // Tabs
  tabsContainer: { paddingHorizontal: 20, paddingBottom: 12 },
  tabsWrapper: { flexDirection: 'row', backgroundColor: PANEL_BG, borderRadius: 30, padding: 4 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
  },
  activeTab: { backgroundColor: Colors.accent },
  tabText: { fontSize: 11, fontFamily: Typography.family.semibold, color: Colors.textSecondary, letterSpacing: 0.2 },
  activeTabText: { color: Colors.textInverse },
  tabCount: {
    marginLeft: 6,
    minWidth: 20,
    textAlign: 'center',
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
    backgroundColor: PANEL_ALT,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: Typography.family.semibold,
  },
  tabCountActive: {
    backgroundColor: '#d4c5aa',
    color: Colors.background,
  },

  // Lists
  listContent: { paddingHorizontal: 20, paddingBottom: 120 },
  gridContent: { paddingHorizontal: 16, paddingBottom: 120 },
  gridRow: { justifyContent: 'space-between' },

  // Empty states
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: Typography.family.regular,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  emptyFooter: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerHint: {
    fontSize: 13,
    fontFamily: Typography.family.regular,
    color: Colors.textMuted,
    textAlign: 'center',
    letterSpacing: 0.1,
  },
});
