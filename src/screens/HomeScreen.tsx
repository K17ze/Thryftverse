import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  FlatList,
  Dimensions,
  RefreshControl,
  Modal,
  Pressable,
  ViewToken,
  ImageStyle,
  StyleProp,
  ViewStyle,
  AppState,
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
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as haptic from 'expo-haptics';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode } from 'expo-av';
import { ImageContentFit } from 'expo-image';
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
import { SharedTransitionImage } from '../components/SharedTransitionImage';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { SkeletonLoader, StoriesRowSkeleton } from '../components/SkeletonLoader';
import { ThryftCartIcon } from '../components/icons/ThryftCartIcon';
import { getBackendSyncStatus } from '../utils/syncStatus';
import { DEFAULT_FEED_LOOKS, FeedLook, fetchFeedLooksWithFallback } from '../services/feedLooksApi';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');

const HEADER_EXPANDED = 116;
const HEADER_COLLAPSED = 68;
const GRID_GAP = 6;
const GRID_TILE_WIDTH = (SCREEN_WIDTH - GRID_GAP * 3) / 2;

const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const SOCIAL_RING = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const STAGGERED_RATIOS = [0.9, 1.2, 1.4, 1.0] as const;
const VIDEO_EXT_RE = /\.(mp4|mov|m4v|webm)(\?.*)?$/i;

function isVideoUri(uri: string) {
  return VIDEO_EXT_RE.test(uri);
}

interface MediaPreviewProps {
  uri: string;
  posterUri?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  isVisible?: boolean;
  sharedTransitionTag?: string;
}

function MediaPreview({
  uri,
  posterUri,
  style,
  containerStyle,
  contentFit = 'cover',
  autoPlay = false,
  muted = true,
  loop = true,
  isVisible = true,
  sharedTransitionTag,
}: MediaPreviewProps) {
  const resizeMode =
    contentFit === 'contain' || contentFit === 'scale-down' || contentFit === 'none'
      ? 'contain'
      : contentFit === 'fill'
        ? 'stretch'
        : 'cover';

  if (isVideoUri(uri)) {
    return (
      <Video
        source={{ uri }}
        style={style as StyleProp<ViewStyle>}
        resizeMode={ResizeMode.COVER}
        shouldPlay={autoPlay}
        isMuted={muted}
        isLooping={loop}
        usePoster={!!posterUri}
        posterSource={posterUri ? { uri: posterUri } : undefined}
      />
    );
  }

  if (sharedTransitionTag) {
    return (
      <View style={containerStyle}>
        <SharedTransitionImage
          source={{ uri }}
          style={style}
          resizeMode={resizeMode}
          sharedTransitionTag={sharedTransitionTag}
        />
      </View>
    );
  }

  return (
    <CachedImage
      uri={uri}
      style={style}
      containerStyle={containerStyle}
      contentFit={contentFit}
      isVisible={isVisible}
    />
  );
}

type StoryStatus = 'new-listing' | 'live-auction' | 'syndicate-launching' | 'sold-recently';

const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  'new-listing': 'new listing',
  'live-auction': 'live auction',
  'syndicate-launching': 'syndicate launch',
  'sold-recently': 'sold recently',
};

const STORY_STATUS_GRADIENT: Record<StoryStatus, [string, string]> = {
  'new-listing': ['#e8dcc8', '#d4a94a'],
  'live-auction': ['#f3c17c', '#dd6a33'],
  'syndicate-launching': ['#d4a94a', '#8f6721'],
  'sold-recently': ['#f2ddaa', '#d69044'],
};

const TREND_CLIPS = [
  {
    id: 'v1',
    videoUri: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    posterUri: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80',
    title: 'Fit transition',
    likes: 402,
  },
  {
    id: 'v2',
    videoUri: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
    posterUri: 'https://images.unsplash.com/photo-1485231183945-ef89e404cf89?w=800&q=80',
    title: 'Weekend styling',
    likes: 355,
  },
];

type ExploreTile = {
  id: string;
  type: 'look' | 'listing' | 'clip';
  mediaType: 'image' | 'video';
  mediaUri: string;
  posterUri?: string;
  likes: number;
  routeId?: string;
  price?: number;
  caption: string;
  aspectRatio: number;
};

type ExploreRow =
  | {
      id: string;
      type: 'pair';
      left: ExploreTile;
      right?: ExploreTile;
    }
  | {
      id: string;
      type: 'look';
      look: ExploreTile;
    };

type StoryBubble = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  posterId?: string;
  isNew: boolean;
  status: StoryStatus;
};

export default function HomeScreen() {
  const navigation = useNavigation<NavT>();
  const notificationCount = useStore((state) => state.notificationCount);
  const hasSeenPoster = useStore((state) => state.hasSeenPoster);
  const customPosters = useStore((state) => state.customPosters);
  const { formatFromFiat } = useFormattedPrice();
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = React.useState(false);
  const [feedLooks, setFeedLooks] = React.useState<FeedLook[]>(DEFAULT_FEED_LOOKS);
  const [peekItem, setPeekItem] = React.useState<ExploreTile | null>(null);
  const [visibleTileIds, setVisibleTileIds] = React.useState<Set<string>>(() => new Set());
  const [newListingIds, setNewListingIds] = React.useState<Set<string>>(() => new Set());

  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const { tabBarVisible } = useTabScroll();
  const scrollRef = useAnimatedRef<FlatList<ExploreRow>>();
  const knownListingIdsRef = React.useRef<Set<string>>(new Set());
  const seededKnownListingIdsRef = React.useRef(false);

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

  const headerHeightStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, 120],
      [HEADER_EXPANDED, HEADER_COLLAPSED],
      Extrapolation.CLAMP,
    );

    return { height };
  });

  const headerTitleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 70], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, 90], [0, -10], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const syncFeedLooks = React.useCallback(async () => {
    const result = await fetchFeedLooksWithFallback();
    setFeedLooks(result.looks);
  }, []);

  React.useEffect(() => {
    void syncFeedLooks();
  }, [syncFeedLooks]);

  React.useEffect(() => {
    if (!seededKnownListingIdsRef.current) {
      if (listings.length === 0) {
        return;
      }

      knownListingIdsRef.current = new Set(listings.map((listing) => listing.id));
      seededKnownListingIdsRef.current = true;
      return;
    }

    const unseenListingIds = listings
      .map((listing) => listing.id)
      .filter((listingId) => !knownListingIdsRef.current.has(listingId));

    if (unseenListingIds.length === 0) {
      return;
    }

    setNewListingIds((previous) => {
      const merged = new Set(previous);
      unseenListingIds.forEach((id) => merged.add(id));
      return merged;
    });
  }, [listings]);

  React.useEffect(() => {
    let pollingTimer: ReturnType<typeof setInterval> | null = null;

    const runSilentRefresh = () => {
      if (refreshing) {
        return;
      }

      void refreshListings();
    };

    pollingTimer = setInterval(() => {
      if (AppState.currentState === 'active') {
        runSilentRefresh();
      }
    }, 55000);

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        runSilentRefresh();
      }
    });

    return () => {
      if (pollingTimer) {
        clearInterval(pollingTimer);
      }
      appStateSubscription.remove();
    };
  }, [refreshListings, refreshing]);

  const acknowledgeNewListings = React.useCallback(() => {
    setNewListingIds((previous) => {
      if (previous.size === 0) {
        return previous;
      }

      previous.forEach((id) => {
        knownListingIdsRef.current.add(id);
      });

      return new Set();
    });

    scrollRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, [scrollRef]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshListings(), syncFeedLooks()]);
    acknowledgeNewListings();
    setTimeout(() => setRefreshing(false), 380);
  };

  const freshPosters = React.useMemo(
    () => getFreshPosters(Date.now(), 24, customPosters),
    [customPosters],
  );

  const feedStatus = React.useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
      }),
    [isSyncing, lastError, source],
  );

  const showFeedLoadingSkeleton = isSyncing && source === 'mock' && !lastError;

  const storyBubbles = React.useMemo<StoryBubble[]>(() => {
    const statusCycle: StoryStatus[] = ['new-listing', 'live-auction', 'syndicate-launching', 'sold-recently'];

    const fromPosters = freshPosters.map((poster, index) => ({
      id: `poster_${poster.id}`,
      userId: poster.uploaderId,
      username: poster.uploader?.username ?? `style_${index + 1}`,
      avatar: poster.uploader?.avatar ?? `https://picsum.photos/seed/story_${index}/120/120`,
      posterId: poster.id,
      isNew: !hasSeenPoster(poster.id),
      status: statusCycle[index % statusCycle.length],
    }));

    const fallbackUsers = MOCK_USERS.map((user, index) => ({
      id: `fallback_${user.id}`,
      userId: user.id,
      username: user.username,
      avatar: user.avatar,
      isNew: index % 2 === 0,
      status: statusCycle[(index + fromPosters.length) % statusCycle.length],
    }));

    const merged = [...fromPosters, ...fallbackUsers];
    const seen = new Set<string>();

    return merged.filter((entry) => {
      if (seen.has(entry.userId)) {
        return false;
      }

      seen.add(entry.userId);
      return true;
    }).slice(0, 10);
  }, [freshPosters, hasSeenPoster]);

  const listingById = React.useMemo(
    () => new Map(listings.map((listing) => [listing.id, listing])),
    [listings],
  );

  const fallbackListingId = listings[0]?.id;

  const exploreData = React.useMemo<ExploreTile[]>(() => {
    let ratioCursor = 0;

    const nextRatio = () => {
      const ratio = STAGGERED_RATIOS[ratioCursor % STAGGERED_RATIOS.length];
      ratioCursor += 1;
      return ratio;
    };

    const listingTiles = listings.map((item): ExploreTile => ({
      id: `item_${item.id}`,
      type: 'listing',
      mediaType: 'image',
      mediaUri: item.images[0],
      likes: item.likes,
      price: item.price,
      routeId: item.id,
      caption: item.title,
      aspectRatio: nextRatio(),
    }));

    const clipTiles = TREND_CLIPS.map((clip, index): ExploreTile => ({
      id: `clip_${clip.id}`,
      type: 'clip',
      mediaType: 'video',
      mediaUri: clip.videoUri,
      posterUri: clip.posterUri,
      likes: clip.likes,
      routeId: listings[index % Math.max(1, listings.length)]?.id ?? fallbackListingId,
      caption: clip.title,
      aspectRatio: nextRatio(),
    }));

    const editorialTiles = feedLooks.map((look): ExploreTile => ({
      id: `look_${look.id}`,
      type: 'look',
      mediaType: 'image',
      mediaUri: look.coverImage,
      likes: look.likes,
      routeId: look.items.find((entry) => listingById.has(entry.id))?.id ?? fallbackListingId,
      caption: look.title,
      aspectRatio: 3 / 4,
    }));

    const baseTiles: ExploreTile[] = [];
    const maxLen = Math.max(listingTiles.length, clipTiles.length);

    for (let index = 0; index < maxLen; index += 1) {
      if (index < listingTiles.length) {
        baseTiles.push(listingTiles[index]);
      }

      if (index < clipTiles.length) {
        baseTiles.push(clipTiles[index]);
      }
    }

    const sequence: ExploreTile[] = [];
    let editorialIndex = 0;

    baseTiles.forEach((tile, index) => {
      sequence.push(tile);
      if ((index + 1) % 4 === 0 && editorialIndex < editorialTiles.length) {
        sequence.push(editorialTiles[editorialIndex]);
        editorialIndex += 1;
      }
    });

    while (editorialIndex < editorialTiles.length) {
      sequence.push(editorialTiles[editorialIndex]);
      editorialIndex += 1;
    }

    return sequence;
  }, [fallbackListingId, feedLooks, listingById, listings]);

  const exploreRows = React.useMemo<ExploreRow[]>(() => {
    const rows: ExploreRow[] = [];
    let pending: ExploreTile[] = [];

    exploreData.forEach((tile) => {
      if (tile.type === 'look') {
        if (pending.length > 0) {
          rows.push({
            id: `row_${pending[0].id}_${pending[1]?.id ?? 'solo'}`,
            type: 'pair',
            left: pending[0],
            right: pending[1],
          });
          pending = [];
        }

        rows.push({
          id: `row_${tile.id}`,
          type: 'look',
          look: tile,
        });
        return;
      }

      pending.push(tile);
      if (pending.length === 2) {
        rows.push({
          id: `row_${pending[0].id}_${pending[1].id}`,
          type: 'pair',
          left: pending[0],
          right: pending[1],
        });
        pending = [];
      }
    });

    if (pending.length > 0) {
      rows.push({
        id: `row_${pending[0].id}_solo`,
        type: 'pair',
        left: pending[0],
      });
    }

    return rows;
  }, [exploreData]);

  const feedGridData = showFeedLoadingSkeleton ? [] : exploreRows;

  const viewabilityConfig = React.useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 120,
  }).current;

  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const nextVisible = new Set<string>();

      viewableItems.forEach((token) => {
        const row = token.item as ExploreRow | undefined;
        if (token.isViewable && row) {
          if (row.type === 'look') {
            nextVisible.add(row.look.id);
            return;
          }

          nextVisible.add(row.left.id);
          if (row.right) {
            nextVisible.add(row.right.id);
          }
        }
      });

      setVisibleTileIds(nextVisible);
    },
  ).current;

  const closePeek = React.useCallback(() => {
    setPeekItem(null);
  }, []);

  const renderStoriesRow = () => (
    <View style={styles.storiesSection}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Pulse</Text>
        <Text style={styles.sectionHint}>who is active now</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.storiesScroll}
      >
        <AnimatedPressable
          style={styles.storyCreateWrap}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('CreatePoster')}
        >
          <View style={styles.storyCreateRing}>
            <Ionicons name="add" size={20} color={Colors.textInverse} />
          </View>
          <Text style={styles.storyName}>Create</Text>
        </AnimatedPressable>

        {storyBubbles.map((story) => (
          <AnimatedPressable
            key={story.id}
            style={styles.storyItem}
            activeOpacity={0.85}
            onPress={() => {
              if (story.posterId) {
                navigation.navigate('PosterViewer', { posterId: story.posterId });
                return;
              }

              navigation.navigate('UserProfile', { userId: story.userId, isMe: false });
            }}
          >
              <LinearGradient
                colors={STORY_STATUS_GRADIENT[story.status]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.storyRingGradient, !story.isNew && styles.storyRingGradientMuted]}
              >
                <View style={styles.storyRingInner}>
                  <CachedImage
                    uri={story.avatar}
                    style={styles.storyAvatar}
                    containerStyle={styles.storyAvatarWrap}
                    contentFit="cover"
                  />
                </View>
                {story.isNew ? <View style={styles.storyPulseDot} /> : null}
              </LinearGradient>
            <Text style={styles.storyName} numberOfLines={1}>@{story.username}</Text>
              <Text style={styles.storyStatus} numberOfLines={1}>{STORY_STATUS_LABEL[story.status]}</Text>
          </AnimatedPressable>
        ))}
      </ScrollView>
    </View>
  );

  const renderLooksRail = () => (
    <View style={styles.looksSection}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Looks</Text>
        <Text style={styles.sectionHint}>swipe for editorial picks</Text>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        decelerationRate="fast"
        snapToInterval={SCREEN_WIDTH * 0.86}
        snapToAlignment="start"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.looksRail}
      >
        {feedLooks.map((look) => (
          <AnimatedPressable
            key={look.id}
            style={styles.lookCard}
            activeOpacity={0.92}
            onPress={() => navigation.navigate('ItemDetail', { itemId: look.items[0]?.id ?? fallbackListingId })}
          >
            <CachedImage
              uri={look.coverImage}
              style={styles.lookImage}
              containerStyle={styles.lookImageWrap}
              contentFit="cover"
            />
            <View style={styles.lookOverlay}>
              <View style={styles.lookOwnerRow}>
                <CachedImage
                  uri={look.creator.avatar}
                  style={styles.lookOwnerAvatar}
                  containerStyle={styles.lookOwnerAvatarWrap}
                  contentFit="cover"
                />
                <Text style={styles.lookOwnerName}>@{look.creator.name}</Text>
                {look.creator.isVerified ? (
                  <Ionicons name="checkmark-circle" size={14} color={SOCIAL_RING} />
                ) : null}
              </View>

              <Text style={styles.lookTitle}>{look.title}</Text>
              <Text style={styles.lookDescription} numberOfLines={1}>{look.description}</Text>

              <View style={styles.lookMetaRow}>
                <View style={styles.lookMetaPill}>
                  <Ionicons name="heart" size={12} color="#fff" />
                  <Text style={styles.lookMetaText}>{look.likes}</Text>
                </View>
                <View style={styles.lookMetaPill}>
                  <Ionicons name="chatbubble-outline" size={12} color="#fff" />
                  <Text style={styles.lookMetaText}>{look.comments}</Text>
                </View>
                <Text style={styles.lookTime}>{look.timeAgo}</Text>
              </View>
            </View>
          </AnimatedPressable>
        ))}
      </ScrollView>
    </View>
  );

  const renderPosters = () => (
    <View style={styles.postersSection}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Fresh Posters</Text>
        <SyncStatusPill tone={feedStatus.tone} label={feedStatus.label} compact />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.postersScroll}
      >
        <AnimatedPressable
          style={styles.posterCard}
          activeOpacity={0.86}
          onPress={() => navigation.navigate('CreatePoster')}
        >
          <View style={styles.posterCreateTile}>
            <View style={styles.posterCreateIcon}>
              <Ionicons name="add" size={24} color={Colors.textInverse} />
            </View>
            <Text style={styles.posterCreateLabel}>Create Poster</Text>
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
              <View style={styles.posterShade} />

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

      {lastError ? (
        <SyncRetryBanner
          message="Live sync is unavailable. Showing cached items."
          onRetry={() => void handleRefresh()}
          isRetrying={isSyncing || refreshing}
          telemetryContext="home_feed_sync"
          containerStyle={styles.feedStatusBanner}
        />
      ) : null}
    </View>
  );

  const renderNewListingsBanner = () => {
    if (newListingIds.size === 0) {
      return null;
    }

    return (
      <View style={styles.newListingsBannerWrap}>
        <AnimatedPressable
          style={styles.newListingsBanner}
          activeOpacity={0.9}
          onPress={acknowledgeNewListings}
          hapticFeedback="selection"
        >
          <Ionicons name="sparkles-outline" size={13} color={Colors.textInverse} />
          <Text style={styles.newListingsBannerText}>
            {newListingIds.size} new {newListingIds.size === 1 ? 'drop' : 'drops'} ready
          </Text>
          <Ionicons name="arrow-up" size={13} color={Colors.textInverse} />
        </AnimatedPressable>
      </View>
    );
  };

  const renderExploreLoadingState = () => (
    <View>
      <View style={styles.exploreLoadingGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={`feed_pair_loading_${index}`} style={styles.exploreLoadingItem}>
            <SkeletonLoader width="100%" height={index % 2 === 0 ? 258 : 214} borderRadius={14} />
          </View>
        ))}
      </View>

      <View style={styles.lookFeedRow}>
        <SkeletonLoader width="100%" height={328} borderRadius={18} />
      </View>

      <View style={styles.exploreLoadingGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={`feed_pair_loading_tail_${index}`} style={styles.exploreLoadingItem}>
            <SkeletonLoader width="100%" height={index % 2 === 0 ? 222 : 274} borderRadius={14} />
          </View>
        ))}
      </View>
      <View style={styles.lookFeedRow}>
        <SkeletonLoader width="100%" height={288} borderRadius={18} />
      </View>
      <View style={styles.exploreLoadingGrid}>
        {Array.from({ length: 2 }).map((_, index) => (
          <View key={`feed_pair_loading_final_${index}`} style={styles.exploreLoadingItem}>
            <SkeletonLoader width="100%" height={index % 2 === 0 ? 246 : 206} borderRadius={14} />
          </View>
        ))}
      </View>
    </View>
  );

  const ExploreGridItem = ({ item, index, isVisible }: { item: ExploreTile; index: number; isVisible: boolean }) => {
    const bigHeartOpacity = useSharedValue(0);
    const bigHeartScale = useSharedValue(0);
    const [localLikes, setLocalLikes] = React.useState(item.likes);

    const onDoubleTap = () => {
      haptic.impactAsync(haptic.ImpactFeedbackStyle.Medium);
      setLocalLikes((prev) => prev + 1);

      bigHeartOpacity.value = withSequence(
        withTiming(1, { duration: 120 }),
        withTiming(1, { duration: 320 }),
        withTiming(0, { duration: 260 }),
      );
      bigHeartScale.value = withSequence(
        withTiming(1.3, { duration: 220 }),
        withTiming(1, { duration: 220 }),
        withTiming(0, { duration: 260 }),
      );
    };

    const onOpenPeek = () => {
      setPeekItem(item);
    };

    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        runOnJS(onDoubleTap)();
      });

    const singleTap = Gesture.Tap().onEnd(() => {
      if (item.routeId) {
        runOnJS(navigation.navigate as any)('ItemDetail', { itemId: item.routeId });
      }
    });

    const longPress = Gesture.LongPress()
      .minDuration(280)
      .onStart(() => {
        runOnJS(onOpenPeek)();
      });

    const combinedGesture = Gesture.Exclusive(doubleTap, longPress, singleTap);

    const bigHeartStyle = useAnimatedStyle(() => ({
      opacity: bigHeartOpacity.value,
      transform: [{ scale: bigHeartScale.value }],
    }));

    return (
      <Reanimated.View
        entering={FadeInDown.delay(Math.min(index, 12) * 36).duration(360)}
        style={[styles.exploreItemBox, { aspectRatio: item.aspectRatio }]}
      >
        <GestureDetector gesture={combinedGesture}>
          <View style={styles.exploreMediaWrap}>
            <MediaPreview
              uri={item.mediaUri}
              posterUri={item.posterUri}
              style={styles.exploreImage}
              autoPlay={isVisible && !peekItem}
              loop
              muted
              contentFit="cover"
              isVisible={isVisible}
              sharedTransitionTag={item.type === 'listing' && item.routeId ? `image-${item.routeId}-0` : undefined}
            />

            <View style={styles.exploreOverlay}>
              {item.type === 'listing' ? (
                <View style={styles.exploreTag}>
                  <ThryftCartIcon size={12} color="#fff" />
                  <Text style={styles.exploreTagText}>{formatFromFiat(item.price ?? 0, 'GBP', { displayMode: 'fiat' })}</Text>
                </View>
              ) : (
                <View style={styles.exploreTag}>
                  <Ionicons name="heart" size={12} color="#fff" />
                  <Text style={styles.exploreTagText}>{localLikes}</Text>
                </View>
              )}
            </View>

            {item.mediaType === 'video' ? (
              <View style={styles.videoBadge}>
                <Ionicons name="play" size={12} color="#fff" />
              </View>
            ) : null}

            <Reanimated.View style={[StyleSheet.absoluteFill, styles.bigHeartLayer, bigHeartStyle]}>
              <Ionicons
                name="heart"
                size={100}
                color="#fff"
                style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.34, shadowRadius: 12 }}
              />
            </Reanimated.View>
          </View>
        </GestureDetector>
      </Reanimated.View>
    );
  };

  const renderExploreItem = ({ item, index }: { item: ExploreTile; index: number }) => {
    const isVisible = visibleTileIds.has(item.id);
    return <ExploreGridItem item={item} index={index} isVisible={isVisible} />;
  };

  const renderEditorialLookRow = (look: ExploreTile) => {
    const lookSource = feedLooks.find((entry) => `look_${entry.id}` === look.id);

    return (
      <AnimatedPressable
        style={styles.lookFeedCard}
        activeOpacity={0.92}
        onPress={() => {
          if (look.routeId) {
            navigation.navigate('ItemDetail', { itemId: look.routeId });
          }
        }}
      >
        <CachedImage
          uri={look.mediaUri}
          style={styles.lookImage}
          containerStyle={styles.lookFeedImageWrap}
          contentFit="cover"
        />

        <View style={styles.lookOverlay}>
          {lookSource ? (
            <>
              <View style={styles.lookOwnerRow}>
                <CachedImage
                  uri={lookSource.creator.avatar}
                  style={styles.lookOwnerAvatar}
                  containerStyle={styles.lookOwnerAvatarWrap}
                  contentFit="cover"
                />
                <Text style={styles.lookOwnerName}>@{lookSource.creator.name}</Text>
                {lookSource.creator.isVerified ? <Ionicons name="checkmark-circle" size={14} color={SOCIAL_RING} /> : null}
              </View>
              <Text style={styles.lookTitle}>{lookSource.title}</Text>
              <Text style={styles.lookDescription} numberOfLines={1}>{lookSource.description}</Text>
              <View style={styles.lookMetaRow}>
                <View style={styles.lookMetaPill}>
                  <Ionicons name="heart" size={12} color="#fff" />
                  <Text style={styles.lookMetaText}>{lookSource.likes}</Text>
                </View>
                <View style={styles.lookMetaPill}>
                  <Ionicons name="chatbubble-outline" size={12} color="#fff" />
                  <Text style={styles.lookMetaText}>{lookSource.comments}</Text>
                </View>
                <Text style={styles.lookTime}>{lookSource.timeAgo}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.lookTitle}>{look.caption}</Text>
          )}
        </View>
      </AnimatedPressable>
    );
  };

  const renderExploreRow = ({ item, index }: { item: ExploreRow; index: number }) => {
    if (item.type === 'look') {
      return (
        <View style={styles.lookFeedRow}>
          {renderEditorialLookRow(item.look)}
        </View>
      );
    }

    return (
      <View style={styles.gridRow}>
        {renderExploreItem({ item: item.left, index: index * 2 })}
        {item.right ? renderExploreItem({ item: item.right, index: index * 2 + 1 }) : <View style={styles.gridSpacer} />}
      </View>
    );
  };

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList<ExploreRow>);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <Reanimated.View style={[styles.floatingHeaderShell, headerHeightStyle]}>
        <BlurView
          intensity={IS_LIGHT ? 58 : 42}
          tint={IS_LIGHT ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />

        <View style={styles.headerForeground}>
          <Reanimated.View style={headerTitleStyle}>
            <Text style={styles.brandTitle}>Thryftverse</Text>
            <Text style={styles.brandSubtitle}>Looks first. Listings second.</Text>
          </Reanimated.View>

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
      </Reanimated.View>

      <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={HEADER_EXPANDED - 14} />

      <AnimatedFlatList
        ref={scrollRef}
        key="explore-roi-feed"
        data={feedGridData}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.feedContent}
        ListHeaderComponent={
          <View>
            {showFeedLoadingSkeleton ? <StoriesRowSkeleton count={6} /> : renderStoriesRow()}
            {renderPosters()}
            {renderNewListingsBanner()}
          </View>
        }
        ListEmptyComponent={showFeedLoadingSkeleton ? renderExploreLoadingState : null}
        renderItem={renderExploreRow}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
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

      <Modal
        transparent
        visible={Boolean(peekItem)}
        animationType="fade"
        onRequestClose={closePeek}
      >
        <Pressable style={styles.peekBackdrop} onPress={closePeek}>
          <BlurView intensity={44} tint={IS_LIGHT ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />

          {peekItem ? (
            <Pressable style={styles.peekCard} onPress={(event) => event.stopPropagation()}>
              <View style={styles.peekMediaWrap}>
                <MediaPreview
                  uri={peekItem.mediaUri}
                  posterUri={peekItem.posterUri}
                  style={styles.peekMedia}
                  autoPlay
                  loop
                  muted
                  contentFit="cover"
                />
              </View>

              <View style={styles.peekMeta}>
                <Text style={styles.peekTitle} numberOfLines={1}>{peekItem.caption}</Text>
                <Text style={styles.peekSubtitle}>
                  {peekItem.type === 'listing' ? 'Tap to open listing' : 'Hold released: quick preview'}
                </Text>

                <View style={styles.peekActionsRow}>
                  <AnimatedPressable style={styles.peekGhostBtn} onPress={closePeek} activeOpacity={0.9}>
                    <Text style={styles.peekGhostText}>Close</Text>
                  </AnimatedPressable>

                  <AnimatedPressable
                    style={styles.peekPrimaryBtn}
                    activeOpacity={0.9}
                    onPress={() => {
                      if (peekItem.routeId) {
                        navigation.navigate('ItemDetail', { itemId: peekItem.routeId });
                      }
                      closePeek();
                    }}
                  >
                    <Text style={styles.peekPrimaryText}>View Listing</Text>
                    <Ionicons name="arrow-forward" size={14} color={Colors.textInverse} />
                  </AnimatedPressable>
                </View>
              </View>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  floatingHeaderShell: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    overflow: 'hidden',
    borderBottomWidth: 1,
    borderBottomColor: IS_LIGHT ? 'rgba(20,20,20,0.12)' : 'rgba(255,255,255,0.08)',
  },
  headerForeground: {
    flex: 1,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandTitle: {
    fontSize: 52,
    fontFamily: Typography.family.extrabold,
    letterSpacing: -1.5,
    color: Colors.textPrimary,
    lineHeight: 54,
  },
  brandSubtitle: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: Typography.family.light,
    letterSpacing: 0.3,
    color: Colors.textMuted,
  },
  headerRight: {
    flexDirection: 'row',
    gap: 8,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  feedContent: {
    paddingTop: HEADER_EXPANDED + 8,
    paddingBottom: 120,
  },
  newListingsBannerWrap: {
    marginTop: 6,
    marginBottom: 14,
    paddingHorizontal: 16,
  },
  newListingsBanner: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: 'rgba(232, 220, 200, 0.45)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  newListingsBannerText: {
    fontSize: 12,
    fontFamily: Typography.family.semibold,
    color: Colors.textInverse,
    letterSpacing: 0.2,
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
    letterSpacing: 0.1,
  },
  sectionHint: {
    fontSize: 11,
    fontFamily: Typography.family.light,
    color: Colors.textMuted,
    letterSpacing: 0.22,
    textTransform: 'uppercase',
  },

  storiesSection: {
    paddingTop: 6,
    paddingBottom: 10,
  },
  storiesScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  storyCreateWrap: {
    alignItems: 'center',
    width: 68,
  },
  storyCreateRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.background,
    marginBottom: 6,
  },
  storyItem: {
    alignItems: 'center',
    width: 68,
  },
  storyRingGradient: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
    position: 'relative',
  },
  storyRingGradientMuted: {
    opacity: 0.64,
  },
  storyRingInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
  },
  storyAvatarWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
  },
  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 27,
  },
  storyPulseDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: SOCIAL_RING,
    position: 'absolute',
    right: 1,
    top: 1,
    borderWidth: 1,
    borderColor: Colors.background,
  },
  storyName: {
    fontSize: 10,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
    width: 66,
    textAlign: 'center',
  },
  storyStatus: {
    marginTop: 2,
    fontSize: 9,
    fontFamily: Typography.family.light,
    color: Colors.textMuted,
    width: 66,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.24,
  },

  looksSection: {
    marginTop: 4,
    marginBottom: 12,
  },
  looksRail: {
    paddingHorizontal: 16,
    gap: 12,
  },
  lookCard: {
    width: SCREEN_WIDTH * 0.82,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  lookImageWrap: {
    width: '100%',
    height: 280,
  },
  lookFeedRow: {
    paddingHorizontal: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  lookFeedCard: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  lookFeedImageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
  },
  lookImage: {
    width: '100%',
    height: '100%',
  },
  lookOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  lookOwnerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  lookOwnerAvatarWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  lookOwnerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  lookOwnerName: {
    color: '#fff',
    fontSize: 11,
    fontFamily: Typography.family.semibold,
  },
  lookTitle: {
    color: '#fff',
    fontSize: 21,
    fontFamily: Typography.family.extrabold,
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  lookDescription: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: Typography.family.medium,
    marginTop: 2,
  },
  lookMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  lookMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.34)',
  },
  lookMetaText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: Typography.family.semibold,
  },
  lookTime: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontFamily: Typography.family.medium,
    marginLeft: 'auto',
  },

  postersSection: {
    marginTop: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  postersScroll: {
    paddingHorizontal: 16,
    gap: 12,
  },
  feedStatusBanner: {
    marginTop: 10,
    marginHorizontal: 16,
    marginBottom: 2,
  },
  posterCard: {
    width: 126,
  },
  posterTile: {
    width: 126,
    height: 150,
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 6,
    position: 'relative',
    backgroundColor: Colors.surface,
  },
  posterTileUnseen: {
    borderWidth: 2,
    borderColor: SOCIAL_RING,
  },
  posterTileSeen: {
    borderWidth: 1,
    borderColor: Colors.border,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  posterCreateTile: {
    width: 126,
    height: 150,
    borderRadius: 14,
    marginBottom: 6,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  posterCreateIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterCreateLabel: {
    color: Colors.textInverse,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    textAlign: 'center',
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
    backgroundColor: 'rgba(0,0,0,0.44)',
  },
  posterCaption: {
    color: '#fff',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Typography.family.medium,
  },
  posterCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  posterUserName: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  posterFreshMeta: {
    fontSize: 10,
    fontFamily: Typography.family.bold,
    color: SOCIAL_RING,
  },
  posterSeenMeta: {
    fontSize: 10,
    fontFamily: Typography.family.medium,
    color: Colors.textMuted,
  },

  gridColumn: {
    paddingHorizontal: GRID_GAP,
    justifyContent: 'space-between',
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridRow: {
    flexDirection: 'row',
    paddingHorizontal: GRID_GAP,
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
    justifyContent: 'space-between',
  },
  gridSpacer: {
    width: GRID_TILE_WIDTH,
  },
  exploreItemBox: {
    width: GRID_TILE_WIDTH,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  exploreMediaWrap: {
    flex: 1,
    position: 'relative',
  },
  exploreImage: {
    width: '100%',
    height: '100%',
  },
  exploreOverlay: {
    position: 'absolute',
    left: 8,
    bottom: 8,
  },
  exploreTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 10,
  },
  exploreTagText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.14,
  },
  videoBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigHeartLayer: {
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
    zIndex: 4,
  },
  exploreLoadingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: GRID_GAP,
    gap: GRID_GAP,
  },
  exploreLoadingItem: {
    width: GRID_TILE_WIDTH,
    marginBottom: GRID_GAP,
  },

  peekBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  peekCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  peekMediaWrap: {
    width: '100%',
    height: 340,
    backgroundColor: Colors.surface,
  },
  peekMedia: {
    width: '100%',
    height: '100%',
  },
  peekMeta: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  peekTitle: {
    fontSize: 19,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  peekSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: Typography.family.regular,
    color: Colors.textSecondary,
  },
  peekActionsRow: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 10,
  },
  peekGhostBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  peekGhostText: {
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  peekPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: Colors.accent,
  },
  peekPrimaryText: {
    fontSize: 13,
    fontFamily: Typography.family.bold,
    color: Colors.textInverse,
  },
});
