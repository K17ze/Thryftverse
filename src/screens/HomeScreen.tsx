import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  FlatList,
  Dimensions,
  LayoutChangeEvent,
  RefreshControl,
  Modal,
  Pressable,
  ViewToken,
  ImageStyle,
  StyleProp,
  ViewStyle,
  AppState,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useAnimatedStyle,
  withSpring,
  withTiming,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Video, ResizeMode } from 'expo-av';
import { ImageContentFit } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { MOCK_USERS } from '../data/mockData';
import { getFreshPosters } from '../data/posters';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useTabScroll } from '../context/TabScrollContext';
import { AnimatedBadge } from '../components/AnimatedBadge';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { ThryftCartIcon } from '../components/icons/ThryftCartIcon';
import { getBackendSyncStatus } from '../utils/syncStatus';

type NavT = StackNavigationProp<RootStackParamList>;

const HEADER_EXPANDED = 80;
const HEADER_COLLAPSED = 56;
const GRID_GAP = 6;
const TAB_BAR_BASE_HEIGHT = 62;
const GRID_MIN_HEIGHT = 136;
const GRID_MAX_HEIGHT = 250;
const SCREEN_WIDTH = Dimensions.get('window').width;

const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const SOCIAL_RING = IS_LIGHT ? '#2f251b' : '#e8dcc8';
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
}: MediaPreviewProps) {
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
  type: 'listing' | 'clip';
  mediaType: 'image' | 'video';
  mediaUri: string;
  posterUri?: string;
  likes: number;
  routeId?: string;
  price?: number;
  caption: string;
  aspectRatio: number;
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
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const notificationCount = useStore((state) => state.notificationCount);
  const hasSeenPoster = useStore((state) => state.hasSeenPoster);
  const customPosters = useStore((state) => state.customPosters);
  const { formatFromFiat } = useFormattedPrice();
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = React.useState(false);
  const [peekItem, setPeekItem] = React.useState<ExploreTile | null>(null);
  const [visibleTileIds, setVisibleTileIds] = React.useState<Set<string>>(() => new Set());
  const [newListingIds, setNewListingIds] = React.useState<Set<string>>(() => new Set());
  const [listHeaderHeight, setListHeaderHeight] = React.useState(0);

  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const { tabBarVisible } = useTabScroll();
  const scrollRef = useAnimatedRef<FlatList<ExploreTile>>();
  const knownListingIdsRef = React.useRef<Set<string>>(new Set());
  const seededKnownListingIdsRef = React.useRef(false);

  const headerExpandedHeight = React.useMemo(() => HEADER_EXPANDED + insets.top, [insets.top]);
  const headerCollapsedHeight = React.useMemo(() => HEADER_COLLAPSED + insets.top, [insets.top]);

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
      [headerExpandedHeight, headerCollapsedHeight],
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
    await refreshListings();
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

  const gridTileWidth = React.useMemo(
    () => (windowWidth - GRID_GAP * 4) / 3,
    [windowWidth],
  );

  const gridTileHeight = React.useMemo(() => {
    const tabBarHeight = TAB_BAR_BASE_HEIGHT + Math.max(insets.bottom, 8);
    const rawViewportHeight =
      windowHeight - (headerCollapsedHeight + 2) - listHeaderHeight - tabBarHeight - 10;
    const boundedViewportHeight = Math.max(rawViewportHeight, GRID_MIN_HEIGHT * 2 + GRID_GAP);
    const rawTileHeight = (boundedViewportHeight - GRID_GAP) / 2;
    return Math.max(GRID_MIN_HEIGHT, Math.min(GRID_MAX_HEIGHT, Math.round(rawTileHeight)));
  }, [headerCollapsedHeight, insets.bottom, listHeaderHeight, windowHeight]);

  const exploreData = React.useMemo<ExploreTile[]>(() => {
    return listings.map((item): ExploreTile => ({
      id: `item_${item.id}`,
      type: 'listing',
      mediaType: 'image',
      mediaUri: item.images[0],
      likes: item.likes,
      price: item.price,
      routeId: item.id,
      caption: item.title,
      // Fixed tile geometry keeps feed density near strict 3x2 in the viewport.
      aspectRatio: 1,
    }));
  }, [listings]);

  const feedGridData = showFeedLoadingSkeleton ? [] : exploreData;

  const viewabilityConfig = React.useRef({
    itemVisiblePercentThreshold: 70,
    minimumViewTime: 120,
  }).current;

  const onViewableItemsChanged = React.useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const nextVisible = new Set<string>();

      viewableItems.forEach((token) => {
        const tile = token.item as ExploreTile | undefined;
        if (token.isViewable && tile) {
          nextVisible.add(tile.id);
        }
      });

      setVisibleTileIds(nextVisible);
    },
  ).current;

  const closePeek = React.useCallback(() => {
    setPeekItem(null);
  }, []);

  const handleListHeaderLayout = React.useCallback((event: LayoutChangeEvent) => {
    const measuredHeight = Math.round(event.nativeEvent.layout.height);
    setListHeaderHeight((previous) => (Math.abs(previous - measuredHeight) > 1 ? measuredHeight : previous));
  }, []);

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
              <CachedImage
                uri={
                  poster.image ||
                  listings.find((listing) => listing.id === poster.listingId)?.images?.[0] ||
                  'https://picsum.photos/seed/poster-fallback-home/400/500'
                }
                style={styles.posterImage}
                contentFit="cover"
              />
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
    <View style={styles.exploreLoadingGrid}>
      {Array.from({ length: 8 }).map((_, index) => (
        <View key={`feed_pair_loading_${index}`} style={[styles.exploreLoadingItem, { width: gridTileWidth }]}>
          <SkeletonLoader width="100%" height={gridTileHeight} borderRadius={14} />
        </View>
      ))}
    </View>
  );

  const ExploreGridItem = ({ item, isVisible }: { item: ExploreTile; isVisible: boolean }) => (
    <View style={[styles.exploreItemBox, { width: gridTileWidth, height: gridTileHeight }]}>
      <AnimatedPressable
        style={styles.exploreMediaWrap}
        activeOpacity={0.92}
        onPress={() => {
          if (!item.routeId) {
            return;
          }

          navigation.navigate('ItemDetail', { itemId: item.routeId });
        }}
        onLongPress={() => setPeekItem(item)}
      >
        <MediaPreview
          uri={item.mediaUri}
          posterUri={item.posterUri}
          style={styles.exploreImage}
          autoPlay={isVisible && !peekItem}
          loop
          muted
          contentFit="cover"
          isVisible={isVisible}
        />

        <View style={styles.exploreOverlay}>
          <View style={styles.exploreTag}>
            <ThryftCartIcon size={11} color="#fff" />
            <Text style={styles.exploreTagText}>{formatFromFiat(item.price ?? 0, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
        </View>
      </AnimatedPressable>
    </View>
  );

  const renderExploreItem = ({ item }: { item: ExploreTile }) => {
    const isVisible = visibleTileIds.has(item.id);
    return <ExploreGridItem item={item} isVisible={isVisible} />;
  };

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList<ExploreTile>);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <Reanimated.View style={[styles.floatingHeaderShell, headerHeightStyle]}>
        <BlurView
          intensity={IS_LIGHT ? 58 : 42}
          tint={IS_LIGHT ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />

        <View style={[styles.headerForeground, { paddingTop: insets.top + 2, paddingBottom: 8 }]}>
          <Reanimated.View style={[headerTitleStyle, styles.headerTitleWrap]}>
            <Text style={styles.brandTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Thryftverse</Text>
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

      <AnimatedFlatList
        ref={scrollRef}
        key="explore-roi-feed"
        data={feedGridData}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.feedContent, { paddingTop: headerCollapsedHeight + 2 }]}
        ListHeaderComponent={
          <View onLayout={handleListHeaderLayout}>
            {renderPosters()}
            {renderNewListingsBanner()}
          </View>
        }
        ListEmptyComponent={showFeedLoadingSkeleton ? renderExploreLoadingState : null}
        renderItem={renderExploreItem}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        windowSize={5}
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
  headerTitleWrap: {
    flex: 1,
    paddingRight: 10,
  },
  brandTitle: {
    fontSize: 30,
    fontFamily: Typography.family.extrabold,
    letterSpacing: -0.6,
    color: Colors.textPrimary,
    lineHeight: 32,
  },
  brandSubtitle: {
    marginTop: 1,
    fontSize: 10,
    fontFamily: Typography.family.light,
    letterSpacing: 0.25,
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
    marginBottom: 8,
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
    marginTop: 0,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  postersScroll: {
    paddingHorizontal: 16,
    gap: 9,
  },
  feedStatusBanner: {
    marginTop: 10,
    marginHorizontal: 16,
    marginBottom: 2,
  },
  posterCard: {
    width: 108,
  },
  posterTile: {
    width: 108,
    height: 128,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 5,
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
    width: 108,
    height: 128,
    borderRadius: 12,
    marginBottom: 5,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  posterCreateIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterCreateLabel: {
    color: Colors.textInverse,
    fontSize: 10,
    fontFamily: Typography.family.semibold,
    textAlign: 'center',
  },
  posterTopRow: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
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
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  posterOwnerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 7,
  },
  posterOwnerName: {
    color: '#fff',
    fontSize: 8,
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
    fontSize: 9,
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
    fontSize: 9,
    lineHeight: 12,
    fontFamily: Typography.family.medium,
  },
  posterCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  posterUserName: {
    fontSize: 10,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  posterFreshMeta: {
    fontSize: 9,
    fontFamily: Typography.family.bold,
    color: SOCIAL_RING,
  },
  posterSeenMeta: {
    fontSize: 9,
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
  exploreItemBox: {
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
