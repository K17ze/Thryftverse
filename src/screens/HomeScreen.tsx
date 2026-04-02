import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  FlatList,
  Dimensions,
  RefreshControl,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  runOnJS,
  FadeInDown,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as haptic from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { MOCK_USERS } from '../data/mockData';
import { getFreshPosters } from '../data/posters';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { useTabScroll } from '../context/TabScrollContext';
import { AnimatedBadge } from '../components/AnimatedBadge';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const HEADER_BG = IS_LIGHT ? 'rgba(247,245,241,0.96)' : 'rgba(10, 10, 10, 0.95)';
const BRAND = IS_LIGHT ? '#2f251b' : TEAL;

// ── Feed Look data ──
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
  const scrollRef = useAnimatedRef<FlatList>();

  useScrollToTop(scrollRef);

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

  // ── Fresh Posters (Thryftverse editorial square cards) ──
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
            <View style={styles.posterCreateIcon}>
              <Ionicons name="add" size={24} color={Colors.background} />
            </View>
            <Text style={styles.posterCreateLabel}>Create{'\n'}Poster</Text>
          </View>
        </AnimatedPressable>

        {freshPosters.map((poster) => (
          <AnimatedPressable
            key={poster.id}
            style={styles.posterCard}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('PosterViewer', { posterId: poster.id })}
          >
            <View style={[styles.posterTile, hasSeenPoster(poster.id) ? styles.posterTileSeen : styles.posterTileUnseen]}>
              <CachedImage uri={poster.image} style={styles.posterImage} contentFit="cover" />

              <View style={styles.posterTopRow}>
                <View style={styles.posterOwnerPill}>
                  <CachedImage
                    uri={poster.uploader?.avatar ?? 'https://picsum.photos/seed/posterUser/60/60'}
                    style={styles.posterOwnerAvatar}
                    containerStyle={styles.posterOwnerAvatarWrap}
                    contentFit="cover"
                  />
                  <Text style={styles.posterOwnerName} numberOfLines={1}>@{poster.uploader?.username ?? 'seller'}</Text>
                </View>
                <View style={styles.posterExpiryPill}>
                  <Ionicons name="time-outline" size={11} color="#fff" />
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
    const gridItems = [
      ...FEED_LOOKS.map(l => ({
        type: 'look' as const,
        id: `l_${l.id}`,
        cover: l.coverImage,
        likes: l.likes,
        routeId: l.items.find((lookItem) => listingById.has(lookItem.id))?.id ?? fallbackListingId,
        imageCount: l.items.length,
      })),
      ...listings.map(i => ({
        type: 'listing' as const,
        id: `i_${i.id}`,
        cover: i.images[0],
        likes: i.likes,
        price: i.price,
        routeId: i.id,
        imageCount: i.images.length,
      }))
    ].sort(() => Math.random() - 0.5);

    // Intersperse editorial cards every 9 items
    const result: any[] = [];
    let lookIdx = 0;
    gridItems.forEach((item, i) => {
      result.push(item);
      if ((i + 1) % 9 === 0 && lookIdx < FEED_LOOKS.length) {
        result.push({
          type: 'editorial' as const,
          id: `ed_${FEED_LOOKS[lookIdx].id}`,
          look: FEED_LOOKS[lookIdx],
        });
        lookIdx++;
      }
    });

    return result;
  }, [fallbackListingId, listingById, listings]);

  // ── Full-width editorial look card (Thryftverse original — shoppable outfit card) ──
  const renderEditorialCard = (look: FeedLook) => (
    <Reanimated.View entering={FadeInDown.duration(400)} style={styles.editorialCard}>
      <AnimatedPressable
        activeOpacity={0.95}
        onPress={() => navigation.navigate('ItemDetail', { itemId: look.items[0]?.id ?? fallbackListingId })}
      >
        <CachedImage uri={look.coverImage} style={styles.editorialImage} containerStyle={styles.editorialImageWrap} contentFit="cover" />

        {/* Shoppable tags on image */}
        <View style={styles.editorialTagsOverlay}>
          {look.items.slice(0, 2).map((tag) => (
            <View key={tag.id} style={styles.editorialTag}>
              <Ionicons name="pricetag" size={10} color="#fff" />
              <Text style={styles.editorialTagText}>{tag.label}</Text>
            </View>
          ))}
        </View>
      </AnimatedPressable>

      <View style={styles.editorialMeta}>
        <View style={styles.editorialCreatorRow}>
          <CachedImage
            uri={look.creator.avatar}
            style={styles.editorialCreatorAvatar}
            containerStyle={styles.editorialCreatorAvatarWrap}
            contentFit="cover"
          />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.editorialCreatorName}>@{look.creator.name}</Text>
              {look.creator.isVerified && <Ionicons name="checkmark-circle" size={13} color={BRAND} />}
            </View>
            <Text style={styles.editorialDescription} numberOfLines={1}>{look.description}</Text>
          </View>
        </View>

        <View style={styles.editorialEngagement}>
          <View style={styles.editorialStat}>
            <Ionicons name="heart" size={13} color={Colors.textMuted} />
            <Text style={styles.editorialStatText}>{look.likes}</Text>
          </View>
          <View style={styles.editorialStat}>
            <Ionicons name="chatbubble-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.editorialStatText}>{look.comments}</Text>
          </View>
          <Text style={styles.editorialTimeAgo}>{look.timeAgo}</Text>
        </View>
      </View>
    </Reanimated.View>
  );

  const ExploreGridItem = ({ item, index }: { item: any, index: number }) => {
    const bigHeartOpacity = useSharedValue(0);
    const bigHeartScale = useSharedValue(0.5);
    const [localLikes, setLocalLikes] = useState(item.likes);

    const onDoubleTap = () => {
      haptic.impactAsync(haptic.ImpactFeedbackStyle.Heavy);
      setLocalLikes((prev: number) => prev + 1);
      
      bigHeartOpacity.value = 1;
      bigHeartScale.value = withSequence(
        withSpring(1.4, { damping: 12 }),
        withTiming(1.4, { duration: 400 }),
        withTiming(0, { duration: 150 })
      );
    };

    const taps = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        runOnJS(onDoubleTap)();
      });

    const singleTap = Gesture.Tap()
      .onEnd(() => {
        if (item.routeId) {
          runOnJS(navigation.navigate as any)('ItemDetail', { itemId: item.routeId });
        }
      });

    const combinedGesture = Gesture.Exclusive(taps, singleTap);

    const bigHeartStyle = useAnimatedStyle(() => ({
      opacity: bigHeartOpacity.value,
      transform: [{ scale: bigHeartScale.value }],
    }));

    return (
      <Reanimated.View
        entering={FadeInDown.delay(Math.min(index, 12) * 40).duration(350)}
        style={styles.exploreItemBox}
      >
        <GestureDetector gesture={combinedGesture}>
          <AnimatedPressable style={{ flex: 1 }} activeOpacity={0.9}>
            <CachedImage uri={item.cover} style={styles.exploreImage} contentFit="cover" />

            <View style={styles.exploreOverlay}>
              {item.type === 'listing' ? (
                <View style={styles.exploreTag}>
                  <Ionicons name="pricetag" size={10} color="#fff" />
                  <Text style={styles.exploreTagText}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
                </View>
              ) : (
                <View style={styles.exploreTag}>
                  <Ionicons name="heart" size={12} color="#fff" />
                  <Text style={styles.exploreTagText}>{localLikes}</Text>
                </View>
              )}
            </View>

            {/* Multi-image indicator */}
            {item.imageCount > 1 && (
              <View style={styles.multiImageDot}>
                <Ionicons name="copy-outline" size={11} color="#fff" />
              </View>
            )}

            {/* Big animated heart overlay */}
            <Reanimated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }, bigHeartStyle]}>
              <Ionicons name="heart" size={50} color="#fff" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 }} />
            </Reanimated.View>
          </AnimatedPressable>
        </GestureDetector>
      </Reanimated.View>
    );
  };

  const renderExploreItem = ({ item, index }: { item: any, index: number }) => {
    if (item.type === 'editorial') {
      return renderEditorialCard(item.look);
    }
    return <ExploreGridItem item={item} index={index} />;
  };

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
        ref={scrollRef}
        key="explore-grid-3"
        data={EXPLORE_DATA}
        keyExtractor={(item: any) => item.id}
        numColumns={3}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        columnWrapperStyle={EXPLORE_DATA.length > 0 ? { gap: 2 } : undefined}
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
    paddingVertical: 10,
    backgroundColor: HEADER_BG,
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  brandTitle: {
    fontSize: 24,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.6,
  },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },

  // Posters (Thryftverse original — editorial square cards)
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
    width: 120,
  },
  posterTile: {
    width: 120,
    height: 150,
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
    width: 120,
    height: 150,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  posterCreateIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterCreateLabel: {
    color: Colors.background,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    textAlign: 'center',
    lineHeight: 15,
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
    gap: 4,
  },
  posterOwnerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 12,
    flex: 1,
    gap: 4,
  },
  posterOwnerAvatarWrap: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  posterOwnerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 8,
  },
  posterOwnerName: {
    color: '#fff',
    fontSize: 9,
    fontFamily: Typography.family.medium,
    flex: 1,
  },
  posterExpiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  posterExpiryText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Typography.family.bold,
  },
  posterBottomOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 7,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  posterCaption: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Typography.family.medium,
  },
  sharedBadge: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sharedBadgeText: {
    color: TEAL,
    fontSize: 9,
    fontFamily: Typography.family.semibold,
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
    fontFamily: Typography.family.bold,
    color: TEAL,
  },
  posterSeenMeta: {
    fontSize: 10,
    fontFamily: Typography.family.medium,
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
  multiImageDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Editorial cards (Thryftverse original — shoppable outfit look)
  editorialCard: {
    width: SCREEN_WIDTH,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    marginBottom: 2,
  },
  editorialImageWrap: {
    width: SCREEN_WIDTH,
    height: SCREEN_WIDTH * 0.75,
  },
  editorialImage: {
    width: '100%',
    height: '100%',
  },
  editorialTagsOverlay: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    flexDirection: 'row',
    gap: 6,
  },
  editorialTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  editorialTagText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Typography.family.semibold,
  },
  editorialMeta: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  editorialCreatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  editorialCreatorAvatarWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  editorialCreatorAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  editorialCreatorName: {
    fontSize: 12,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
  },
  editorialDescription: {
    fontSize: 12,
    fontFamily: Typography.family.regular,
    color: Colors.textSecondary,
    marginTop: 1,
  },
  editorialEngagement: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  editorialStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  editorialStatText: {
    fontSize: 11,
    fontFamily: Typography.family.medium,
    color: Colors.textMuted,
  },
  editorialTimeAgo: {
    fontSize: 11,
    fontFamily: Typography.family.regular,
    color: Colors.textMuted,
    marginLeft: 'auto',
  },
});
