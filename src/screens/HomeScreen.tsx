import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  FlatList,
  Image,
  Dimensions,
  RefreshControl
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedScrollHandler, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { MOCK_USERS } from '../data/mockData';
import { getFreshPosters } from '../data/posters';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { useTabScroll } from '../context/TabScrollContext';
import { AnimatedBadge } from '../components/AnimatedBadge';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const HEADER_BG = IS_LIGHT ? 'rgba(247,245,241,0.96)' : 'rgba(10, 10, 10, 0.95)';

// ── Feed Mock Data ──────────────────────────────────────────
interface FeedLook {
  id: string;
  creator: { id: string; name: string; avatar: string; isVerified?: boolean };
  title: string;
  description: string;
  coverImage: string;
  items: { id: string; label: string; x: number; y: number }[];
  likes: number;
  comments: number;
  timeAgo: string;
}

const FEED_LOOKS: FeedLook[] = [
  {
    id: 'f1',
    creator: { id: 'u1', name: 'mariefullery', avatar: MOCK_USERS[0].avatar, isVerified: true },
    title: 'Winter Layers in the City',
    description: 'Mixing high and low, keeping it cozy. ❄️',
    coverImage: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80',
    items: [
      { id: 'l5', label: 'Off-White Hoodie', x: 0.2, y: 0.3 },
      { id: 'l7', label: 'Cargo Trousers', x: 0.6, y: 0.65 },
      { id: 'l6', label: 'Air Max 90', x: 0.5, y: 0.85 },
    ],
    likes: 245,
    comments: 18,
    timeAgo: '2h ago',
  },
  {
    id: 'f2',
    creator: { id: 'u2', name: 'scott_art', avatar: MOCK_USERS[1].avatar },
    title: 'Minimal Monochrome',
    description: 'Clean lines for the weekend.',
    coverImage: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80',
    items: [
      { id: 'l2', label: 'AMI Striped Shirt', x: 0.35, y: 0.25 },
      { id: 'l3', label: 'RL Harrington', x: 0.7, y: 0.4 },
    ],
    likes: 156,
    comments: 12,
    timeAgo: '5h ago',
  },
  {
    id: 'f3',
    creator: { id: 'u3', name: 'dankdunksuk', avatar: MOCK_USERS[2].avatar, isVerified: true },
    title: 'Streetwear Daily',
    description: 'Latest pickups. Those Chucks never get old.',
    coverImage: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80',
    items: [
      { id: 'l4', label: 'Stüssy Logo Tee', x: 0.4, y: 0.3 },
      { id: 'l9', label: 'Represent Hoodie', x: 0.25, y: 0.15 },
      { id: 'l10', label: 'Chuck Taylor', x: 0.6, y: 0.8 },
    ],
    likes: 89,
    comments: 7,
    timeAgo: '1d ago',
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<NavT>();
  const notificationCount = useStore(state => state.notificationCount);
  const hasSeenPoster = useStore(state => state.hasSeenPoster);
  const customPosters = useStore(state => state.customPosters);
  const { formatFromFiat } = useFormattedPrice();
  const { listings, source, refreshListings } = useBackendData();
  const [refreshing, setRefreshing] = useState(false);

  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const { tabBarVisible } = useTabScroll();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
      if (e.contentOffset.y > lastScrollY.value + 5 && e.contentOffset.y > 80) {
        tabBarVisible.value = false;
      } else if (e.contentOffset.y < lastScrollY.value - 5 || e.contentOffset.y <= 0) {
        tabBarVisible.value = true;
      }
      lastScrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshListings();
    setTimeout(() => setRefreshing(false), 400);
  };

  const freshPosters = React.useMemo(
    () => getFreshPosters(Date.now(), 24, customPosters),
    [refreshing, customPosters]
  );

  const renderPosters = () => (
    <View style={styles.postersContainer}>
      <View style={styles.postersHeaderRow}>
        <Text style={styles.postersTitle}>Fresh Posters</Text>
        <Text style={styles.postersHint}>{source === 'api' ? 'Live API listings active' : 'Mock fallback active'}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.postersScroll}>
        <AnimatedPressable
          style={styles.posterCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('CreatePoster')}
        >
          <View style={styles.posterCreateTile}>
            <Ionicons name="add" size={26} color={Colors.background} />
          </View>
          <Text style={styles.posterUserName}>Create Poster</Text>
          <Text style={styles.posterMeta}>Set expiry before posting</Text>
        </AnimatedPressable>

        {freshPosters.map((poster) => (
          <AnimatedPressable
            key={poster.id}
            style={styles.posterCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('PosterViewer', { posterId: poster.id })}
          >
            <View style={[styles.posterTile, hasSeenPoster(poster.id) ? styles.posterTileSeen : styles.posterTileUnseen]}>
              <Image source={{ uri: poster.image }} style={styles.posterImage} />

              <View style={styles.posterTopRow}>
                <View style={styles.posterOwnerPill}>
                  <Image source={{ uri: poster.uploader?.avatar ?? 'https://picsum.photos/seed/posterUser/60/60' }} style={styles.posterOwnerAvatar} />
                  <Text style={styles.posterOwnerName} numberOfLines={1}>@{poster.uploader?.username ?? 'seller'}</Text>
                </View>
                <View style={styles.posterExpiryPill}>
                  <Ionicons name="time-outline" size={12} color="#fff" />
                  <Text style={styles.posterExpiryText}>{poster.remainingHours}h</Text>
                </View>
              </View>

              <View style={styles.posterBottomOverlay}>
                <Text style={styles.posterCaption} numberOfLines={2}>{poster.caption}</Text>
                {poster.sharedFrom ? (
                  <View style={styles.sharedBadge}>
                    <Ionicons name="repeat-outline" size={11} color={TEAL} />
                    <Text style={styles.sharedBadgeText} numberOfLines={1}>Shared for @{poster.sharedFrom.username}</Text>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.posterCardMetaRow}>
              <Text style={styles.posterUserName} numberOfLines={1}>@{poster.uploader?.username ?? 'seller'}</Text>
              <Text style={hasSeenPoster(poster.id) ? styles.posterSeenMeta : styles.posterFreshMeta}>
                {hasSeenPoster(poster.id) ? 'Seen' : 'New'}
              </Text>
            </View>
          </AnimatedPressable>
        ))}
      </ScrollView>
    </View>
  );

  // ── Explore Grid Mix ──
  const listingById = React.useMemo(
    () => new Map(listings.map((listing) => [listing.id, listing])),
    [listings]
  );

  const fallbackListingId = listings[0]?.id;

  const EXPLORE_DATA = React.useMemo(() => {
    return [
      ...FEED_LOOKS.map(l => ({
        type: 'look',
        id: `l_${l.id}`,
        cover: l.coverImage,
        likes: l.likes,
        routeId: l.items.find((lookItem) => listingById.has(lookItem.id))?.id ?? fallbackListingId,
      })),
      ...listings.map(i => ({ type: 'listing', id: `i_${i.id}`, cover: i.images[0], likes: Math.floor(Math.random() * 50) + 1, price: i.price, routeId: i.id }))
    ].sort(() => Math.random() - 0.5);
  }, [fallbackListingId, listingById, listings]);

  const renderExploreItem = ({ item, index }: { item: any, index: number }) => (
    <Reanimated.View
      entering={FadeInDown.delay(Math.min(index, 12) * 50).duration(400)}
      style={styles.exploreItemBox}
    >
      <AnimatedPressable
        style={{ flex: 1 }}
        activeOpacity={0.9}
        onPress={() => item.routeId ? navigation.navigate('ItemDetail', { itemId: item.routeId }) : null}
      >
        <Image source={{ uri: item.cover }} style={styles.exploreImage} resizeMode="cover" />
        <View style={styles.exploreOverlay}>
          {item.type === 'listing' ? (
            <View style={styles.exploreTag}>
              <Ionicons name="pricetag" size={10} color="#fff" />
              <Text style={styles.exploreTagText}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
            </View>
          ) : (
            <View style={styles.exploreTag}>
              <Ionicons name="eye" size={12} color="#fff" />
              <Text style={styles.exploreTagText}>{item.likes}k</Text>
            </View>
          )}
        </View>
      </AnimatedPressable>
    </Reanimated.View>
  );

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* ── Floating Header ── */}
      <View style={styles.header}>
        <Text style={styles.brandTitle}>Thryftverse</Text>
        <View style={styles.headerRight}>
          <AnimatedPressable style={styles.headerBtn} onPress={() => navigation.navigate('GlobalSearch')}>
            <Ionicons name="search" size={22} color={Colors.textPrimary} />
          </AnimatedPressable>
          <AnimatedPressable style={styles.headerBtn} onPress={() => navigation.navigate('NotificationsList')}>
            <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
            <AnimatedBadge count={notificationCount} size={16} />
          </AnimatedPressable>
        </View>
      </View>

      <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={80} />

      <AnimatedFlatList
        key="explore-grid-3"
        data={EXPLORE_DATA}
        keyExtractor={(item: any) => item.id}
        numColumns={3}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        columnWrapperStyle={{ gap: 2 }}
        ListHeaderComponent={renderPosters}
        renderItem={renderExploreItem}
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
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: HEADER_BG,
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  brandTitle: {
    fontSize: 23,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerRight: { flexDirection: 'row', gap: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notiBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notiBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },

  // Posters
  postersContainer: {
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingTop: 14,
    paddingBottom: 16,
    marginBottom: 8,
  },
  postersHeaderRow: {
    paddingHorizontal: 16,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  postersTitle: {
    fontSize: 16,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.1,
    color: Colors.textPrimary,
  },
  postersHint: {
    fontSize: 11,
    fontFamily: Typography.family.regular,
    letterSpacing: 0.12,
    color: Colors.textMuted,
  },
  postersScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  posterCard: {
    width: 116,
  },
  posterTile: {
    width: 116,
    height: 146,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    marginBottom: 6,
    position: 'relative',
  },
  posterTileUnseen: {
    borderWidth: 2,
    borderColor: TEAL,
  },
  posterTileSeen: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
  posterCreateTile: {
    width: 116,
    height: 146,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterImage: {
    width: '100%',
    height: '100%',
    backgroundColor: Colors.surface,
  },
  posterTopRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  posterOwnerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 12,
    flex: 1,
    gap: 4,
  },
  posterOwnerAvatar: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  posterOwnerName: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Typography.family.medium,
    flex: 1,
  },
  posterExpiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  posterExpiryText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
  posterBottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  posterCaption: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Typography.family.medium,
  },
  sharedBadge: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sharedBadgeText: {
    color: TEAL,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    flex: 1,
  },
  posterUserName: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  posterCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  posterFreshMeta: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: TEAL,
  },
  posterSeenMeta: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
  posterMeta: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: Typography.family.regular,
    color: Colors.textMuted,
  },

  // Explore Grid
  exploreItemBox: {
    width: (SCREEN_WIDTH - 4) / 3,
    aspectRatio: 0.8,
    backgroundColor: PANEL_BG,
    marginBottom: 2,
    position: 'relative',
  },
  exploreImage: {
    width: '100%',
    height: '100%',
  },
  exploreOverlay: {
    position: 'absolute',
    bottom: 6,
    left: 6,
  },
  exploreTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  exploreTagText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.14,
  },
});
