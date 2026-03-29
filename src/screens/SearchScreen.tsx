import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  StatusBar,
  TextInput,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProductCard } from '../components/ProductCard';
import { Colors } from '../constants/colors';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TEAL = '#4ECDC4';

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

// Wishlist items — simulate some favourited listings
const WISHLIST_IDS = ['l1', 'l4', 'l5', 'l7', 'l8', 'l9'];
const WISHLIST_ITEMS = MOCK_LISTINGS.filter(l => WISHLIST_IDS.includes(l.id));

// ── Look Card Component ──────────────────────────────────────
function LookCard({ look, onPress }: { look: SavedLook; onPress: () => void }) {
  return (
    <TouchableOpacity style={lookStyles.card} onPress={onPress} activeOpacity={0.92}>
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
          <TouchableOpacity style={lookStyles.statBtn}>
            <Ionicons name="heart" size={18} color={TEAL} />
            <Text style={lookStyles.statCount}>{look.likes}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={lookStyles.statBtn}>
            <Ionicons name="chatbubble-outline" size={16} color={Colors.textSecondary} />
            <Text style={lookStyles.statCount}>{look.comments}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={lookStyles.statBtn}>
            <Ionicons name="bookmark" size={16} color={TEAL} />
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ──────────────────────────────────────────────
export default function SearchScreen() {
  const [activeTab, setActiveTab] = useState<'SAVED LOOKS' | 'WISHLIST'>('SAVED LOOKS');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const navigation = useNavigation<NavT>();

  const filteredWishlist = WISHLIST_ITEMS.filter(l =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase()) || l.brand?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredLooks = SAVED_LOOKS.filter(l =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.headerLabel}>YOUR COLLECTION</Text>
          <Text style={styles.hugeTitle}>My Closet</Text>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.itemCount}>{WISHLIST_ITEMS.length + SAVED_LOOKS.length} items</Text>
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
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Segmented Control ── */}
      <View style={styles.tabsContainer}>
        <View style={styles.tabsWrapper}>
          {(['SAVED LOOKS', 'WISHLIST'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={tab === 'SAVED LOOKS' ? 'layers-outline' : 'heart-outline'}
                size={14}
                color={activeTab === tab ? Colors.textInverse : Colors.textSecondary}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* ── Content ── */}
      {activeTab === 'SAVED LOOKS' ? (
        filteredLooks.length > 0 ? (
          <FlatList
            data={filteredLooks}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <LookCard
                look={item}
                onPress={() => {/* Navigate to look detail in future */}}
              />
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
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="layers-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No saved looks yet</Text>
            <Text style={styles.emptySubtitle}>
              Browse the Feed and save outfit looks{'\n'}to build your style collection
            </Text>
          </View>
        )
      ) : (
        filteredWishlist.length > 0 ? (
          <FlatList
            data={filteredWishlist}
            keyExtractor={item => item.id}
            numColumns={2}
            contentContainerStyle={styles.gridContent}
            columnWrapperStyle={styles.gridRow}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => (
              <ProductCard
                item={item}
                onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
              />
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
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="heart-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Your wishlist is empty</Text>
            <Text style={styles.emptySubtitle}>
              Tap ♡ on items you love and{'\n'}they'll appear here
            </Text>
          </View>
        )
      )}
    </SafeAreaView>
  );
}

// ── Look Card Styles ─────────────────────────────────────────
const lookStyles = StyleSheet.create({
  card: {
    backgroundColor: '#111',
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
    backgroundColor: TEAL,
    marginRight: 6,
  },
  tagLabel: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
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
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  creatorName: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
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
    fontFamily: 'Inter_500Medium',
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
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hugeTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  itemCount: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },

  // Search
  searchRow: { paddingHorizontal: 20, paddingBottom: 12 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#111',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  searchBarFocused: { borderColor: TEAL },
  searchInput: { flex: 1, fontSize: 15, color: Colors.textPrimary, fontFamily: 'Inter_400Regular' },

  // Tabs
  tabsContainer: { paddingHorizontal: 20, paddingBottom: 12 },
  tabsWrapper: { flexDirection: 'row', backgroundColor: '#111', borderRadius: 30, padding: 4 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 26,
  },
  activeTab: { backgroundColor: Colors.accent },
  tabText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: Colors.textSecondary, letterSpacing: 0.8 },
  activeTabText: { color: Colors.textInverse },

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
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  emptyFooter: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  footerHint: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    textAlign: 'center',
  },
});
