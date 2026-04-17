import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Dimensions,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import Reanimated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { CachedImage } from '../components/CachedImage';
import { BottomSheet } from '../components/BottomSheet';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useStore } from '../store/useStore';
import { ActiveTheme, Colors } from '../constants/colors';
import { Listing, MOCK_USERS, MY_USER } from '../data/mockData';
import { mockFind } from '../utils/mockGate';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { useToast } from '../context/ToastContext';
import { Typography } from '../constants/typography';
import { AppButton } from '../components/ui/AppButton';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';
import { SharedTransitionView } from '../components/SharedTransitionView';

type Props = StackScreenProps<RootStackParamList, 'UserProfile'>;

const IS_LIGHT = ActiveTheme === 'light';
const ACCENT = IS_LIGHT ? '#2f251b' : Colors.accent;
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const CARD_ALT = IS_LIGHT ? '#f3eee7' : '#1a1a1a';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const { width } = Dimensions.get('window');

const GRID_SPACING = 16;
const ITEM_SIZE = (width - 40 - GRID_SPACING) / 2;
const COVER_HEIGHT = 170;
const COVER_IMAGE = 'https://picsum.photos/seed/profilecoverdefault/1200/800';

type Tab = 'Listings' | 'Reviews' | 'About';

const MOCK_REVIEWS = [
  { id: 'r1', from: 'Thryftverse', rating: 5, text: 'Auto-feedback: Sale completed successfully', time: '6 days ago', auto: true },
  { id: 'r2', from: 'Thryftverse', rating: 5, text: 'Auto-feedback: Sale completed successfully', time: '1 week ago', auto: true },
  { id: 'r3', from: 'alexj92', rating: 5, text: 'Super fast shipping, item exactly as described. Very trustworthy seller!', time: '2 weeks ago', auto: false },
  { id: 'r4', from: 'samrivera', rating: 5, text: 'Great quality item, well packaged. Would buy again.', time: '3 weeks ago', auto: false },
];

type ReviewFilter = 'All' | 'From members' | 'Automatic';

const TAB_OPTIONS: Array<{ value: Tab; label: string; accessibilityLabel: string }> = [
  { value: 'Listings', label: 'Listings', accessibilityLabel: 'Show listings tab' },
  { value: 'Reviews', label: 'Reviews', accessibilityLabel: 'Show reviews tab' },
  { value: 'About', label: 'About', accessibilityLabel: 'Show about tab' },
];

const REVIEW_FILTER_OPTIONS: Array<{ value: ReviewFilter; label: string; accessibilityLabel: string }> = [
  { value: 'All', label: 'All', accessibilityLabel: 'Show all reviews' },
  { value: 'From members', label: 'From members', accessibilityLabel: 'Show member reviews' },
  { value: 'Automatic', label: 'Automatic', accessibilityLabel: 'Show automatic reviews' },
];

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(i => (
        <Ionicons key={i} name={i <= rating ? 'star' : 'star-outline'} size={size} color="#FFD700" />
      ))}
    </View>
  );
}

const AnimatedScrollView = Reanimated.createAnimatedComponent(ScrollView);

export default function UserProfileScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const currentUser = useStore(state => state.currentUser);
  const userAvatar = useStore(state => state.userAvatar);
  const userCover = useStore(state => state.userCover);
  const profileMediaOverrides = useStore(state => state.profileMediaOverrides);
  const { show } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>('Listings');
  const [following, setFollowing] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('All');
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();

  const profileListings = React.useMemo(() => listings.slice(0, 6), [listings]);
  const filteredReviews = MOCK_REVIEWS.filter(r => {
    if (reviewFilter === 'All') return true;
    if (reviewFilter === 'Automatic') return r.auto;
    return !r.auto;
  });

  const profileUser = React.useMemo(
    () =>
      route.params.isMe
        ? MY_USER
        : mockFind(MOCK_USERS, (candidate) => candidate.id === route.params.userId) ?? MY_USER,
    [route.params.isMe, route.params.userId]
  );

  const isSelfProfile =
    route.params.isMe ||
    route.params.userId === currentUser?.id ||
    route.params.userId === MY_USER.id;

  const mediaOverride =
    profileMediaOverrides[route.params.userId]
    ?? profileMediaOverrides[profileUser.id]
    ?? null;

  const displayUsername = isSelfProfile
    ? currentUser?.username ?? MY_USER.username
    : profileUser.username;
  const displayHandle = `@${displayUsername}`;
  const displayAvatar = isSelfProfile
    ? userAvatar || mediaOverride?.avatar || MY_USER.avatar
    : mediaOverride?.avatar || profileUser.avatar;
  const displayCover = isSelfProfile
    ? userCover || mediaOverride?.cover || MY_USER.coverPhoto || COVER_IMAGE
    : mediaOverride?.cover || profileUser.coverPhoto || COVER_IMAGE;

  const handleShare = React.useCallback(async () => {
    try {
      await Share.share({ message: `Check out ${displayHandle} on Thryftverse!` });
    } catch {
      // Ignore share cancellation errors.
    }
  }, [displayHandle]);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const coverStyle = useAnimatedStyle(() => {
    const overscroll = Math.min(scrollY.value, 0);
    const translateY = interpolate(overscroll, [-100, 0], [-50, 0], Extrapolation.CLAMP);
    const scale = interpolate(overscroll, [-100, 0], [1.25, 1], Extrapolation.CLAMP);
    return { transform: [{ translateY }, { scale }] };
  });
  
  const headerOpacityStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [COVER_HEIGHT - 60, COVER_HEIGHT - 10], [0, 1], Extrapolation.CLAMP);
    return { opacity, backgroundColor: BG };
  });

  const renderItem = (item: Listing) => (
    <AnimatedPressable
      key={item.id}
      style={styles.gridItem}
      activeOpacity={0.9}
      onPress={() => {
        if (isSelfProfile) {
          navigation.navigate('ManageListing', { itemId: item.id });
        } else {
          navigation.push('ItemDetail', { itemId: item.id });
        }
      }}
      accessibilityRole="button"
      accessibilityLabel={`Open listing ${item.title}`}
      accessibilityHint={isSelfProfile ? 'Opens listing management' : 'Opens listing details'}
    >
      <View style={styles.gridImageWrap}>
        <SharedTransitionView
          style={styles.gridSharedImage}
          sharedTransitionTag={`image-${item.id}-0`}
        >
          <CachedImage
            uri={item.images[0] || `https://picsum.photos/seed/${item.id}/600/800`}
            style={styles.gridImage}
            contentFit="cover"
          />
        </SharedTransitionView>
        <View style={styles.likeBtnPill}>
          <Ionicons name="heart-outline" size={14} color="#fff" />
        </View>
      </View>
      <View style={styles.gridInfo}>
        <Text style={styles.gridPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        <Text style={styles.gridBrand} numberOfLines={1} ellipsizeMode="tail">{item.brand}</Text>
        <Text style={styles.gridSizeCondition}>{item.size} | {item.condition}</Text>
      </View>
    </AnimatedPressable>
  );

  const groupedListings = [];
  for (let i = 0; i < profileListings.length; i += 2) {
    groupedListings.push([profileListings[i], profileListings[i+1]]);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />

      {/* Floating Translucent Header Layer */}
      <Reanimated.View style={[styles.floatingHeader, { paddingTop: insets.top }, headerOpacityStyle]}>
         <View style={{ flex: 1 }} />
        <Text style={styles.floatingHeaderTitle}>{displayUsername}</Text>
         <View style={{ flex: 1 }} />
      </Reanimated.View>
      
      <View style={[styles.floatingHeaderActions, { top: insets.top }]}>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to previous screen"
        >
          <View style={styles.iconBackdrop}>
             <Ionicons name="arrow-back" size={24} color="#fff" />
          </View>
        </AnimatedPressable>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => setActionSheetVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Open profile actions"
          accessibilityHint="Shows report and block actions"
        >
          <View style={styles.iconBackdrop}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </View>
        </AnimatedPressable>
      </View>

      {/* Cover photo with parallax */}
      <Reanimated.View style={[styles.coverWrap, coverStyle]}>
        <CachedImage uri={displayCover} style={styles.coverImage} contentFit="cover" priority="high" />
        <View style={styles.coverGradient} />
      </Reanimated.View>

      {/* Main Content Area */}
      <AnimatedScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: COVER_HEIGHT - 32 }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        stickyHeaderIndices={[1]} /* Target the Tab Bar index! */
      >
        {/* Index 0: Hero Info */}
        <View style={styles.profileHeader}>
          <View style={styles.heroRow}>
            <View style={[styles.avatarLarge, { overflow: 'hidden' }]}>
              <CachedImage uri={displayAvatar} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroUsername}>{displayUsername}</Text>
              <Text style={styles.heroHandle}>{displayHandle}</Text>
              <View style={styles.heroRatingRow}>
                <StarRating rating={5} size={14} />
                <Text style={styles.heroReviewCount}>(54 reviews)</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.statsCard}>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{profileUser.followers}</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{profileUser.following}</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>{profileUser.listingCount}</Text>
              <Text style={styles.statLabel}>Active Items</Text>
            </View>
          </View>

          <View style={styles.heroActionRow}>
            <AppButton
              title={isSelfProfile ? 'Edit profile' : isBlocked ? 'Blocked' : following ? 'Following' : 'Follow user'}
              variant={following && !isSelfProfile ? 'secondary' : 'primary'}
              size="sm"
              align="center"
              style={[styles.heroActionPrimary, following && !isSelfProfile && styles.heroActionPrimaryActive]}
              titleStyle={[styles.heroActionPrimaryText, following && !isSelfProfile && styles.heroActionPrimaryTextActive]}
              onPress={() => {
                if (isSelfProfile) {
                  navigation.navigate('EditProfile');
                  return;
                }

                if (isBlocked) {
                  show('This user is blocked. Unblock them before following.', 'info');
                  return;
                }

                setFollowing((prev) => !prev);
              }}
              accessibilityLabel={
                isSelfProfile
                  ? 'Edit profile'
                  : isBlocked
                    ? 'Profile blocked'
                    : following
                      ? 'Following user'
                      : 'Follow user'
              }
              accessibilityHint={
                isSelfProfile
                  ? 'Opens profile editor'
                  : isBlocked
                    ? 'User is blocked. Unblock to follow again'
                    : following
                      ? 'Double tap to unfollow this user'
                      : 'Double tap to follow this user'
              }
            />

            <AppButton
              title="Share profile"
              variant="secondary"
              size="sm"
              align="center"
              style={styles.heroActionSecondary}
              titleStyle={styles.heroActionSecondaryText}
              onPress={handleShare}
              accessibilityLabel="Share profile"
              accessibilityHint="Opens share sheet for this user profile"
            />

            <AnimatedPressable
              style={styles.heroActionIcon}
              onPress={() => setActionSheetVisible(true)}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="More profile actions"
              accessibilityHint="Shows report and block options"
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={TEXT} />
            </AnimatedPressable>
          </View>
        </View>

        {/* Index 1: Sticky Tabs */}
        <View style={styles.stickyTabWrapper}>
          <AppSegmentControl
            style={styles.tabBarContainer}
            options={TAB_OPTIONS}
            value={activeTab}
            onChange={setActiveTab}
            fullWidth
            optionStyle={styles.tabPill}
            optionActiveStyle={styles.tabPillActive}
            optionTextStyle={styles.tabText}
            optionTextActiveStyle={styles.tabTextActive}
          />
        </View>

        {/* Index 2: Tab Content */}
        <View style={styles.tabContentArea}>
          {activeTab === 'Listings' && (
            <View style={styles.gridListContent}>
              {groupedListings.map((pair, rowIndex) => (
                <View key={rowIndex} style={styles.rowWrapper}>
                  {pair[0] && renderItem(pair[0])}
                  {pair[1] && renderItem(pair[1])}
                </View>
              ))}
            </View>
          )}

          {activeTab === 'Reviews' && (
            <View style={styles.reviewsContent}>
              <View style={styles.ratingHero}>
                <Text style={styles.ratingBigNumber}>4.8</Text>
                <StarRating rating={5} size={28} />
                <Text style={styles.ratingTotalText}>Based on 54 reviews</Text>
              </View>

              <View style={styles.reviewsFilterRow}>
                <AppSegmentControl
                  style={styles.reviewsFilterStrip}
                  options={REVIEW_FILTER_OPTIONS}
                  value={reviewFilter}
                  onChange={setReviewFilter}
                  fullWidth
                  optionStyle={styles.filterChip}
                  optionActiveStyle={styles.filterChipActive}
                  optionTextStyle={styles.filterChipText}
                  optionTextActiveStyle={styles.filterChipTextActive}
                />
              </View>

              <View style={styles.reviewsList}>
                {filteredReviews.map((r, i) => (
                  <View key={r.id} style={[styles.reviewBlock, i > 0 && { marginTop: 16 }]}>
                    {r.auto ? (
                      <View style={styles.reviewerAvatarAuto}>
                        <Text style={styles.reviewerAvatarAutoText}>T</Text>
                      </View>
                    ) : (
                      <View style={styles.reviewerAvatar}>
                        <Ionicons name="person" size={20} color={MUTED} />
                      </View>
                    )}
                    <View style={styles.reviewBlockInfo}>
                      <View style={styles.reviewSenderRow}>
                        <Text style={styles.reviewSenderName}>{r.auto ? 'Thryftverse System' : r.from}</Text>
                        <Text style={styles.reviewTime}>{r.time}</Text>
                      </View>
                      <StarRating rating={r.rating} size={14} />
                      <Text style={styles.reviewBody}>{r.text}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}

          {activeTab === 'About' && (
            <View style={styles.aboutContent}>
              <View style={[styles.aboutBannerImage, { overflow: 'hidden' }]}>
                <CachedImage uri={displayCover} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              </View>
              
              <Text style={styles.aboutBigName}>{displayUsername}</Text>
              
              <View style={styles.aboutInfoCard}>
                <Text style={styles.aboutSectionHeading}>Verified Details</Text>
                <View style={styles.aboutRow}>
                  <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
                  <Text style={styles.aboutRowText}>Facebook Connected</Text>
                </View>
                <View style={styles.aboutRow}>
                  <Ionicons name="checkmark-circle" size={20} color={ACCENT} />
                  <Text style={styles.aboutRowText}>Email Verified</Text>
                </View>
              </View>

              <View style={styles.aboutInfoCard}>
                <Text style={styles.aboutSectionHeading}>Location & Activity</Text>
                <View style={styles.aboutRow}>
                  <Ionicons name="location" size={20} color={MUTED} />
                  <Text style={styles.aboutRowText}>{profileUser.location}</Text>
                </View>
                <View style={styles.aboutRow}>
                  <Ionicons name="time" size={20} color={MUTED} />
                  <Text style={styles.aboutRowText}>Last seen {profileUser.lastSeen}</Text>
                </View>
              </View>

              <View style={{ height: 40 }} />
            </View>
          )}
        </View>
      </AnimatedScrollView>

      {/* Flagship Bottom Sheet Overrides */}
      <BottomSheet visible={actionSheetVisible} onDismiss={() => setActionSheetVisible(false)} snapPoint={0.3}>
        <View style={{ paddingVertical: 10 }}>
          <Text style={{ fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 20 }}>User Actions</Text>

          <AnimatedPressable
            style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: BORDER, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            onPress={() => {
              setActionSheetVisible(false);
              setTimeout(() => navigation.navigate('Report', { type: 'user' }), 200);
            }}
            accessibilityRole="button"
            accessibilityLabel="Report user"
            accessibilityHint="Opens report flow for this user"
          >
            <Ionicons name="flag-outline" size={20} color={TEXT} />
            <Text style={{ fontSize: 16, fontFamily: 'Inter_500Medium', color: TEXT }}>Report user</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={{ paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            onPress={() => {
              setActionSheetVisible(false);
              if (isSelfProfile) {
                show('You cannot block your own profile.', 'info');
                return;
              }

              setIsBlocked(true);
              setFollowing(false);
              show('User blocked. You will not receive new messages from them.', 'success');
            }}
            accessibilityRole="button"
            accessibilityLabel="Block user"
            accessibilityHint="Blocks this user and disables future messages"
          >
            <Ionicons name="ban-outline" size={20} color={Colors.danger} />
            <Text style={{ fontSize: 16, fontFamily: 'Inter_500Medium', color: Colors.danger }}>Block user</Text>
          </AnimatedPressable>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  
  floatingHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  floatingHeaderTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT, textTransform: 'uppercase', letterSpacing: 1 },
  
  floatingHeaderActions: {
    position: 'absolute', left: 0, right: 0,
    zIndex: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 4,
  },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  iconBackdrop: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center', alignItems: 'center'
  },

  coverWrap: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    height: COVER_HEIGHT,
    zIndex: 0,
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  coverGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
  },
  
  scrollContent: {
    minHeight: '100%',
  },

  profileHeader: {
    paddingHorizontal: 20, 
    paddingBottom: 24,
    backgroundColor: BG,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 24,
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  avatarLarge: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: CARD_ALT,
    alignItems: 'center', justifyContent: 'center',
  },
  heroInfo: { flex: 1 },
  heroUsername: { fontSize: 24, fontFamily: 'Inter_700Bold', color: TEXT, letterSpacing: -0.5, marginBottom: 6 },
  heroHandle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED, marginBottom: 7 },
  heroRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroReviewCount: { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  
  statsCard: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderRadius: 24,
    paddingVertical: 18,
    marginBottom: 28,
    shadowColor: Colors.textPrimary,
    shadowOpacity: IS_LIGHT ? 0.04 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: Typography.size.title, fontFamily: Typography.family.bold, color: TEXT, marginBottom: 2 },
  statLabel: { fontSize: Typography.size.caption, fontFamily: Typography.family.medium, color: MUTED },
  statDivider: { width: 6, backgroundColor: 'transparent' },
  
  heroActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  heroActionPrimary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
  },
  heroActionPrimaryActive: {
    backgroundColor: 'transparent',
  },
  heroActionPrimaryText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textInverse,
    letterSpacing: 0.15,
  },
  heroActionPrimaryTextActive: {
    color: TEXT,
  },
  heroActionSecondary: {
    flex: 1,
    minHeight: 44,
    borderRadius: 14,
  },
  heroActionSecondaryText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: TEXT,
    letterSpacing: 0.15,
  },
  heroActionIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stickyTabWrapper: {
    backgroundColor: BG,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  tabBarContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  tabPill: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: CARD_ALT,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: Colors.accent },
  tabText: { fontSize: Typography.size.body, fontFamily: Typography.family.medium, color: MUTED },
  tabTextActive: { color: Colors.textInverse, fontFamily: Typography.family.bold },

  tabContentArea: {
    backgroundColor: BG,
    minHeight: width,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // Grid / Listings
  gridListContent: { paddingHorizontal: 20 },
  rowWrapper: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22 },
  gridItem: { width: ITEM_SIZE },
  gridImageWrap: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.3,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: CARD,
    marginBottom: 12,
  },
  gridSharedImage: {
    ...StyleSheet.absoluteFillObject,
  },
  gridImage: { width: '100%', height: '100%' },
  likeBtnPill: {
    position: 'absolute', top: 10, right: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  gridInfo: { paddingHorizontal: 4, minHeight: 56 },
  gridPrice: { color: TEXT, fontSize: Typography.size.bodyLarge, fontFamily: Typography.family.bold, marginBottom: 2 },
  gridBrand: { color: Colors.textSecondary, fontSize: Typography.size.caption - 1, fontFamily: Typography.family.bold, textTransform: 'uppercase', letterSpacing: Typography.tracking.caps, marginBottom: 3 },
  gridSizeCondition: { color: MUTED, fontSize: Typography.size.caption + 1, fontFamily: Typography.family.medium },

  // Reviews Tab
  reviewsContent: { paddingHorizontal: 0 },
  ratingHero: { alignItems: 'center', paddingVertical: 40 },
  ratingBigNumber: { fontSize: Typography.size.giant, fontFamily: Typography.family.bold, color: TEXT, letterSpacing: -2, lineHeight: 80 },
  ratingTotalText: { fontSize: Typography.size.body, fontFamily: Typography.family.medium, color: MUTED, marginTop: 12 },
  
  reviewsFilterRow: { paddingHorizontal: 20, marginBottom: 24 },
  reviewsFilterStrip: { gap: 10 },
  filterChip: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, backgroundColor: CARD_ALT },
  filterChipActive: { backgroundColor: Colors.accent },
  filterChipText: { fontSize: Typography.size.body, fontFamily: Typography.family.medium, color: MUTED },
  filterChipTextActive: { color: Colors.textInverse, fontFamily: Typography.family.bold },
  
  reviewsList: { paddingHorizontal: 20 },
  reviewBlock: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 24,
    gap: 16,
    shadowColor: Colors.textPrimary,
    shadowOpacity: IS_LIGHT ? 0.03 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  reviewerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: CARD_ALT, alignItems: 'center', justifyContent: 'center' },
  reviewerAvatarAuto: { width: 44, height: 44, borderRadius: 22, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  reviewerAvatarAutoText: { fontSize: Typography.size.bodyLarge, fontFamily: Typography.family.bold, color: Colors.textInverse },
  reviewBlockInfo: { flex: 1 },
  reviewSenderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  reviewSenderName: { fontSize: Typography.size.body, fontFamily: Typography.family.bold, color: TEXT },
  reviewTime: { fontSize: Typography.size.caption + 1, fontFamily: Typography.family.regular, color: MUTED },
  reviewBody: { fontSize: Typography.size.body, fontFamily: Typography.family.regular, color: TEXT, marginTop: 8, lineHeight: 22 },

  // About Tab
  aboutContent: { paddingHorizontal: 20 },
  aboutBannerImage: {
    height: 200,
    backgroundColor: CARD,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  aboutBigName: { fontSize: Typography.size.heading, fontFamily: Typography.family.bold, color: TEXT, letterSpacing: -1, marginBottom: 32 },
  
  aboutInfoCard: {
    backgroundColor: CARD,
    borderRadius: 24,
    padding: 28,
    marginBottom: 20,
    shadowColor: Colors.textPrimary,
    shadowOpacity: IS_LIGHT ? 0.03 : 0,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  aboutSectionHeading: { fontSize: Typography.size.caption + 1, fontFamily: Typography.family.bold, color: MUTED, textTransform: 'uppercase', letterSpacing: Typography.tracking.caps, marginBottom: 20 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  aboutRowText: { fontSize: Typography.size.body, fontFamily: Typography.family.medium, color: TEXT },
});


