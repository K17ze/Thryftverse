import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  Dimensions,
  RefreshControl,
  Modal,
  Pressable,
  ImageStyle,
  StyleProp,
  ViewStyle,
  AppState,
  useWindowDimensions,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
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
// Typography simplified - using direct font names
import { MOCK_USERS } from '../data/mockData';
import { getFreshPosters } from '../data/posters';
import { useNavigation, useScrollToTop } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useTabScroll } from '../context/TabScrollContext';
// Phase 3: Removed AnimatedBadge (badge clutter reduced)
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
// Phase 3: Removed SyncStatusPill (status indicator clutter reduced)
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { ThryftCartIcon } from '../components/icons/ThryftCartIcon';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { MasonryGrid, ProductCardV2 } from '../components/ProductCardV2';
import { DoubleTapHeart } from '../components/DoubleTapHeart';
import { getBackendSyncStatus } from '../utils/syncStatus';
import { isVideoUri } from '../utils/media';
import { AppButton } from '../components/ui/AppButton';
import { Space, Radius } from '../theme/designTokens';
import { T } from '../components/ui/Text';

type NavT = StackNavigationProp<RootStackParamList>;

const HEADER_EXPANDED = 80;
const HEADER_COLLAPSED = 56;
const GRID_GAP = 6;
const SCREEN_WIDTH = Dimensions.get('window').width;

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = Colors.surface;

// Masonry grid: Varied aspect ratios for visual interest
const TILE_RATIO_SEQUENCE = [1.28, 0.94, 1.16, 0.86, 1.06, 1.22] as const;

function resolveTileAspectRatio(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % TILE_RATIO_SEQUENCE.length;
  return TILE_RATIO_SEQUENCE[index];
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

type StoryStatus = 'new-listing' | 'live-auction' | 'co-own-launching' | 'sold-recently';

const STORY_STATUS_LABEL: Record<StoryStatus, string> = {
  'new-listing': 'new listing',
  'live-auction': 'auction',
  'co-own-launching': 'co-own launch',
  'sold-recently': 'sold recently',
};

const STORY_STATUS_GRADIENT: Record<StoryStatus, [string, string]> = {
  'new-listing': [Colors.brand, Colors.brandPressed],
  'live-auction': ['#f3c17c', '#dd6a33'],
  'co-own-launching': ['#d4a94a', '#8f6721'],
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
  sellerId?: string;
  price?: number;
  caption: string;
  aspectRatio: number;
  isSaved?: boolean;
};

type StoryBubble = {
  id: string;
  userId: string;
  username: string;
  avatar: string;
  posterId?: string;
  isNew: boolean;
  status: StoryStatus;
  isSaved?: boolean;
};

interface ExploreGridItemProps {
  item: ExploreTile;
  tileWidth: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  formatPrice: (...args: any[]) => string;
  onPress: (routeId: string | undefined) => void;
  onLongPress: (item: ExploreTile) => void;
  onPressSellerProfile: (sellerId: string) => void;
  onPressSellerMessage: (sellerId: string, listingId: string) => void;
}

const ExploreGridItem = React.memo(function ExploreGridItem({
  item,
  tileWidth,
  formatPrice,
  onPress,
  onLongPress,
  onPressSellerProfile,
  onPressSellerMessage,
}: ExploreGridItemProps) {
  const sharedTag = item.mediaType === 'image' && item.routeId
    ? `image-${item.routeId}-0`
    : undefined;
  const mediaHeight = Math.round(tileWidth * item.aspectRatio);
  const seller = item.sellerId ? MOCK_USERS.find((entry) => entry.id === item.sellerId) : undefined;
  const sellerHandle = seller?.username ?? item.sellerId;
  const canShowSellerActions = Boolean(item.sellerId && item.routeId);

  return (
    <View style={[styles.exploreItemBox, { width: tileWidth }]}>
      <AnimatedPressable
        style={[styles.exploreMediaWrap, { height: mediaHeight }]}
        activeOpacity={0.92}
        onPress={() => onPress(item.routeId)}
        onLongPress={() => onLongPress(item)}
        accessibilityLabel={`${item.caption}, ${formatPrice(item.price ?? 0, 'GBP', { displayMode: 'fiat' })}`}
        accessibilityRole="button"
        accessibilityHint="Opens item details. Long press to preview this listing"
      >
        <DoubleTapHeart
          isLiked={item.isSaved || false}
          onLike={() => {}}
        >
          <SharedTransitionView
            style={styles.exploreSharedMedia}
            sharedTransitionTag={sharedTag}
          >
            <MediaPreview
              uri={item.mediaUri}
              posterUri={item.posterUri}
              style={styles.exploreImage}
              autoPlay={item.mediaType === 'video'}
              loop
              muted
              contentFit="cover"
              isVisible
            />
          </SharedTransitionView>
        </DoubleTapHeart>

        <View style={styles.exploreOverlay}>
          <View style={styles.exploreTag}>
            <ThryftCartIcon size={11} color="#fff" />
            <Text style={styles.exploreTagText}>{formatPrice(item.price ?? 0, 'GBP', { displayMode: 'fiat' })}</Text>
          </View>
        </View>
      </AnimatedPressable>

      {canShowSellerActions ? (
        <View style={styles.exploreSellerRow}>
          <AnimatedPressable
            style={styles.exploreSellerChip}
            onPress={() => onPressSellerProfile(item.sellerId as string)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Open @${sellerHandle ?? 'seller'} profile`}
            accessibilityHint="Shows seller profile details"
          >
            {seller?.avatar ? (
              <CachedImage
                uri={seller.avatar}
                style={styles.exploreSellerAvatar}
                containerStyle={styles.exploreSellerAvatarWrap}
                contentFit="cover"
              />
            ) : (
              <View style={styles.exploreSellerAvatarFallback}>
                <Ionicons name="person" size={10} color={Colors.textMuted} />
              </View>
            )}
            <Text style={styles.exploreSellerText} numberOfLines={1}>@{sellerHandle}</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={styles.exploreMessageBtn}
            onPress={() => onPressSellerMessage(item.sellerId as string, item.routeId as string)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Message @${sellerHandle ?? 'seller'}`}
            accessibilityHint="Opens chat with this seller"
          >
            <Ionicons name="chatbubble-ellipses-outline" size={12} color={Colors.textPrimary} />
          </AnimatedPressable>
        </View>
      ) : null}
    </View>
  );
});

export default function HomeScreen() {
  const navigation = useNavigation<NavT>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const notificationCount = useStore((state) => state.notificationCount);
  const hasSeenPoster = useStore((state) => state.hasSeenPoster);
  const customPosters = useStore((state) => state.customPosters);
  const { formatFromFiat } = useFormattedPrice();
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = React.useState(false);
  const [peekItem, setPeekItem] = React.useState<ExploreTile | null>(null);
  const [newListingIds, setNewListingIds] = React.useState<Set<string>>(() => new Set());

  const scrollY = useSharedValue(0);
  const lastScrollY = useSharedValue(0);
  const { tabBarVisible } = useTabScroll();
  const scrollRef = React.useRef<any>(null);
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

    scrollRef.current?.scrollTo({ y: 0, animated: true });
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
    () => (windowWidth - GRID_GAP * 3) / 2,
    [windowWidth],
  );

  const exploreData = React.useMemo<ExploreTile[]>(() => {
    return listings.map((item): ExploreTile => {
      const primaryMediaUri = item.images[0] ?? 'https://picsum.photos/seed/listing-fallback-home/600/800';
      const posterUri = item.images.find((uri) => !isVideoUri(uri));

      return {
        id: `item_${item.id}`,
        type: 'listing',
        mediaType: isVideoUri(primaryMediaUri) ? 'video' : 'image',
        mediaUri: primaryMediaUri,
        posterUri: isVideoUri(primaryMediaUri) ? posterUri : undefined,
        likes: item.likes,
        price: item.price,
        routeId: item.id,
        sellerId: item.sellerId,
        caption: item.title,
        aspectRatio: resolveTileAspectRatio(item.id),
      };
    });
  }, [listings]);

  const feedGridData = showFeedLoadingSkeleton ? [] : exploreData;

  const masonryColumns = React.useMemo(() => {
    const columns: [ExploreTile[], ExploreTile[]] = [[], []];
    const columnHeights = [0, 0];

    feedGridData.forEach((tile) => {
      const tileHeight = Math.round(gridTileWidth * tile.aspectRatio) + (tile.sellerId && tile.routeId ? 38 : 0);
      const targetIndex = columnHeights[0] <= columnHeights[1] ? 0 : 1;
      columns[targetIndex].push(tile);
      columnHeights[targetIndex] += tileHeight + GRID_GAP;
    });

    return columns;
  }, [feedGridData, gridTileWidth]);

  const closePeek = React.useCallback(() => {
    setPeekItem(null);
  }, []);

  const renderPosters = () => (
    <View style={styles.postersSection}>
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Posters</Text>
        {/* Phase 3: Removed sync status pill - cleaner headers */}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.postersScroll}
      >
        <AnimatedPressable
          style={styles.posterCard}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreatePoster')}
          accessibilityLabel="Create a new poster"
          accessibilityRole="button"
          accessibilityHint="Opens poster creator for auction or promotion posts"
        >
          <View style={styles.posterCreateTile}>
            <View style={styles.posterCreateIcon}>
              <Ionicons name="add" size={24} color={Colors.background} />
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
            accessibilityRole="button"
            accessibilityLabel={`Open poster from @${poster.uploader?.username ?? 'seller'}`}
            accessibilityHint="Opens poster details with countdown and listing context"
          >
            <View style={[styles.posterTile, hasSeenPoster(poster.id) ? styles.posterTileSeen : styles.posterTileUnseen]}>
              {/* Video/Image with auto-play support */}
              {isVideoUri(poster.image) ? (
                <Video
                  source={{ uri: poster.image }}
                  style={styles.posterImage}
                  resizeMode={ResizeMode.COVER}
                  shouldPlay
                  isLooping
                  isMuted
                />
              ) : (
                <CachedImage
                  uri={
                    poster.image
                    || listings.find((listing) => listing.id === poster.listingId)?.images?.[0]
                    || 'https://picsum.photos/seed/poster-fallback-home/400/500'
                  }
                  style={styles.posterImage}
                  contentFit="cover"
                />
              )}
              <View style={styles.posterShade} />

              {/* User PFP overlay in top left corner */}
              <View style={styles.posterAvatarOverlay}>
                <CachedImage
                  uri={poster.uploader?.avatar ?? 'https://picsum.photos/seed/posterUser/60/60'}
                  style={styles.posterAvatarOverlayImage}
                  containerStyle={styles.posterAvatarOverlayWrap}
                  contentFit="cover"
                />
              </View>

              <View style={styles.posterBottomOverlay}>
                <Text style={styles.posterCaption} numberOfLines={2}>{poster.caption}</Text>
              </View>
            </View>

            <View style={styles.posterCardMetaRow}>
              <Text style={hasSeenPoster(poster.id) ? styles.posterSeenMeta : styles.posterFreshMeta}>
                {hasSeenPoster(poster.id) ? 'Seen' : 'New'}
              </Text>
            </View>
          </AnimatedPressable>
        ))}
      </ScrollView>

      {lastError ? (
        <SyncRetryBanner
          message="Sync is unavailable. Showing cached items."
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
        <AppButton
          title={`${newListingIds.size} new ${newListingIds.size === 1 ? 'drop' : 'drops'} ready`}
          variant="primary"
          size="sm"
          align="center"
          style={styles.newListingsBanner}
          contentStyle={styles.newListingsBannerContent}
          titleStyle={styles.newListingsBannerText}
          icon={<Ionicons name="sparkles-outline" size={13} color={Colors.background} />}
          trailingIcon={<Ionicons name="arrow-up" size={13} color={Colors.background} />}
          iconContainerStyle={styles.newListingsBannerIconWrap}
          trailingIconContainerStyle={styles.newListingsBannerIconWrap}
          hapticFeedback="selection"
          onPress={acknowledgeNewListings}
          accessibilityLabel="Jump to new listings"
          accessibilityHint="Scrolls feed focus to newly added listings"
        />
      </View>
    );
  };

  const renderExploreLoadingState = () => (
    <View style={styles.exploreLoadingGrid}>
      <View style={styles.exploreLoadingColumn}>
        {Array.from({ length: 4 }).map((_, index) => {
          const ratio = TILE_RATIO_SEQUENCE[index % TILE_RATIO_SEQUENCE.length];
          return (
            <View key={`feed_loading_left_${index}`}>
              <SkeletonLoader width="100%" height={Math.round(gridTileWidth * ratio)} borderRadius={14} />
            </View>
          );
        })}
      </View>
      <View style={styles.exploreLoadingColumn}>
        {Array.from({ length: 4 }).map((_, index) => {
          const ratio = TILE_RATIO_SEQUENCE[(index + 2) % TILE_RATIO_SEQUENCE.length];
          return (
            <View key={`feed_loading_right_${index}`}>
              <SkeletonLoader width="100%" height={Math.round(gridTileWidth * ratio)} borderRadius={14} />
            </View>
          );
        })}
      </View>
    </View>
  );

  const handleTilePress = React.useCallback((routeId: string | undefined) => {
    if (!routeId) return;
    navigation.push('ItemDetail', { itemId: routeId });
  }, [navigation]);

  const handleTileLongPress = React.useCallback((item: ExploreTile) => {
    setPeekItem(item);
  }, []);

  const handleSellerProfilePress = React.useCallback((sellerId: string) => {
    navigation.navigate('UserProfile', { userId: sellerId });
  }, [navigation]);

  const handleSellerMessagePress = React.useCallback((sellerId: string, listingId: string) => {
    const sellerHandle = MOCK_USERS.find((entry) => entry.id === sellerId)?.username ?? sellerId;
    navigation.navigate('Chat', {
      conversationId: `${sellerId}_${listingId}`,
      focusQuery: sellerHandle,
      partnerUserId: sellerId,
    });
  }, [navigation]);

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <Reanimated.View style={[styles.floatingHeaderShell, headerHeightStyle]}>
        <BlurView
          intensity={IS_LIGHT ? 74 : 58}
          tint={IS_LIGHT ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />

        <View style={[styles.headerForeground, { paddingTop: insets.top + 2, paddingBottom: 8 }]}>
          <Reanimated.View style={[headerTitleStyle, styles.headerTitleWrap]}>
            <Text style={styles.brandTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Thryftverse</Text>
          </Reanimated.View>

          <View style={styles.headerRight}>
            <AnimatedPressable
              style={styles.headerBtn}
              onPress={() => navigation.navigate('GlobalSearch')}
              accessibilityLabel="Search listings"
              accessibilityRole="button"
              accessibilityHint="Opens global search"
            >
              <Ionicons name="search" size={22} color={Colors.textPrimary} />
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.headerBtn}
              onPress={() => navigation.navigate('NotificationsList')}
              accessibilityLabel={notificationCount > 0 ? `Notifications, ${notificationCount} unread` : 'Notifications'}
              accessibilityRole="button"
              accessibilityHint="Opens notifications center"
            >
              <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
              {/* Phase 3: Removed notification badge - less visual clutter */}
            </AnimatedPressable>
          </View>
        </View>
      </Reanimated.View>

      <Reanimated.ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.feedContent, { paddingTop: headerCollapsedHeight + 2 }]}
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
      >
        {renderPosters()}
        {renderNewListingsBanner()}
        {showFeedLoadingSkeleton ? (
          renderExploreLoadingState()
        ) : (
          <View style={styles.masonryGrid}>
            <View style={styles.masonryColumn}>
              {masonryColumns[0].map((item) => (
                <ExploreGridItem
                  key={item.id}
                  item={item}
                  tileWidth={gridTileWidth}
                  formatPrice={formatFromFiat}
                  onPress={handleTilePress}
                  onLongPress={handleTileLongPress}
                  onPressSellerProfile={handleSellerProfilePress}
                  onPressSellerMessage={handleSellerMessagePress}
                />
              ))}
            </View>
            <View style={styles.masonryColumn}>
              {masonryColumns[1].map((item) => (
                <ExploreGridItem
                  key={item.id}
                  item={item}
                  tileWidth={gridTileWidth}
                  formatPrice={formatFromFiat}
                  onPress={handleTilePress}
                  onLongPress={handleTileLongPress}
                  onPressSellerProfile={handleSellerProfilePress}
                  onPressSellerMessage={handleSellerMessagePress}
                />
              ))}
            </View>
          </View>
        )}
      </Reanimated.ScrollView>

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

                <View style={styles.peekActionsRow}>
                  <AppButton
                    title="Close"
                    variant="secondary"
                    size="sm"
                    align="center"
                    style={styles.peekGhostBtn}
                    titleStyle={styles.peekGhostText}
                    onPress={closePeek}
                    accessibilityLabel="Close preview"
                    accessibilityHint="Closes the quick listing preview"
                  />

                  <AppButton
                    title="View Listing"
                    variant="primary"
                    size="sm"
                    align="center"
                    style={styles.peekPrimaryBtn}
                    titleStyle={styles.peekPrimaryText}
                    icon={<Ionicons name="arrow-forward" size={14} color={Colors.background} />}
                    iconContainerStyle={styles.peekPrimaryIconWrap}
                    onPress={() => {
                      if (peekItem.routeId) {
                        navigation.push('ItemDetail', { itemId: peekItem.routeId });
                      }
                      closePeek();
                    }}
                    accessibilityLabel="Open listing details"
                    accessibilityHint="Navigates to full listing details"
                  />
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
    borderBottomColor: Colors.border,
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
    fontSize: 28,
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.6,
    color: Colors.textPrimary,
    lineHeight: 32,
  },
  brandSubtitle: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    letterSpacing: 0.25,
    color: Colors.textSecondary,
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
    backgroundColor: Colors.surface,
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
    minHeight: 40,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: Colors.brand,
    borderWidth: 0,
  },
  newListingsBannerContent: {
    gap: 7,
  },
  newListingsBannerIconWrap: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'transparent',
  },
  newListingsBannerText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.background,
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
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    letterSpacing: -0.1,
  },
  sectionHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    letterSpacing: 0.22,
  },

  storiesSection: {
    paddingTop: 6,
    paddingBottom: 10,
  },
  storiesScroll: {
    paddingHorizontal: 16,
    gap: 14,
  },
  storyCreateWrap: {
    alignItems: 'center',
    width: 68,
  },
  storyCreateRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
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
    backgroundColor: Colors.brand,
    position: 'absolute',
    right: 1,
    top: 1,
    borderWidth: 1,
    borderColor: Colors.background,
  },
  storyName: {
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    width: 66,
    textAlign: 'center',
  },
  storyStatus: {
    marginTop: 2,
    fontSize: 9,
    fontFamily: 'Inter_400Regular',
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
    backgroundColor: Colors.surface,
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
    backgroundColor: Colors.surface,
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
    fontFamily: 'Inter_600SemiBold',
  },
  lookTitle: {
    color: '#fff',
    fontSize: 21,
    fontFamily: 'Inter_800ExtraBold',
    letterSpacing: -0.4,
    lineHeight: 24,
  },
  lookDescription: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
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
    fontFamily: 'Inter_600SemiBold',
  },
  lookTime: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginLeft: 'auto',
  },

  postersSection: {
    marginTop: 0,
    paddingBottom: 8,
  },
  postersScroll: {
    paddingHorizontal: 16,
    gap: 14,
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
    borderColor: Colors.brand,
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
  posterAvatarOverlay: {
    position: 'absolute',
    top: 5,
    left: 5,
    width: 24,
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  posterAvatarOverlayWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  posterAvatarOverlayImage: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
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
    color: Colors.background,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
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
    fontFamily: 'Inter_500Medium',
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
    fontFamily: 'Inter_700Bold',
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
    fontFamily: 'Inter_500Medium',
  },
  posterCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  posterUserName: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  posterFreshMeta: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: Colors.brand,
  },
  posterSeenMeta: {
    fontSize: 9,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },

  masonryGrid: {
    flexDirection: 'row',
    paddingHorizontal: Space.sm,
    gap: Space.sm,
    alignItems: 'flex-start',
  },
  masonryColumn: {
    flex: 1,
    gap: Space.sm,
  },
  exploreItemBox: {
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PANEL_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  exploreMediaWrap: {
    position: 'relative',
  },
  exploreSharedMedia: {
    ...StyleSheet.absoluteFillObject,
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
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.14,
  },
  exploreSellerRow: {
    marginTop: 7,
    marginHorizontal: 8,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  exploreSellerChip: {
    flex: 1,
    minHeight: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  exploreSellerAvatarWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  exploreSellerAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  exploreSellerAvatarFallback: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface,
  },
  exploreSellerText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  exploreMessageBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
    paddingHorizontal: Space.sm,
    gap: Space.sm,
  },
  exploreLoadingColumn: {
    flex: 1,
    gap: Space.sm,
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
    backgroundColor: Colors.surface,
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
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.2,
  },
  peekSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
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
    backgroundColor: 'transparent',
  },
  peekGhostText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  peekPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
  },
  peekPrimaryIconWrap: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  peekPrimaryText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.background,
  },
});
