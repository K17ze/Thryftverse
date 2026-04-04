import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Dimensions
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
  FadeInDown,
} from 'react-native-reanimated';
import { CachedImage } from '../components/CachedImage';
import { BottomSheet } from '../components/BottomSheet';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useStore } from '../store/useStore';
import { ActiveTheme, Colors } from '../constants/colors';
import { Listing } from '../data/mockData';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

type Props = StackScreenProps<RootStackParamList, 'UserProfile'>;

const IS_LIGHT = ActiveTheme === 'light';
const TEAL = IS_LIGHT ? '#2f251b' : '#e8dcc8';
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
const COVER_IMAGE = 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&q=80';

type Tab = 'Listings' | 'Reviews' | 'About';

const MOCK_REVIEWS = [
  { id: 'r1', from: 'Thryftverse', rating: 5, text: 'Auto-feedback: Sale completed successfully', time: '6 days ago', auto: true },
  { id: 'r2', from: 'Thryftverse', rating: 5, text: 'Auto-feedback: Sale completed successfully', time: '1 week ago', auto: true },
  { id: 'r3', from: 'alexj92', rating: 5, text: 'Super fast shipping, item exactly as described. Very trustworthy seller!', time: '2 weeks ago', auto: false },
  { id: 'r4', from: 'samrivera', rating: 5, text: 'Great quality item, well packaged. Would buy again.', time: '3 weeks ago', auto: false },
];

type ReviewFilter = 'All' | 'From members' | 'Automatic';

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
  const userAvatar = useStore(state => state.userAvatar);
  const userCover = useStore(state => state.userCover);
  const [activeTab, setActiveTab] = useState<Tab>('Listings');
  const [following, setFollowing] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('All');
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();

  const profileListings = React.useMemo(() => listings.slice(0, 6), [listings]);
  const tabs: Tab[] = ['Listings', 'Reviews', 'About'];

  const filteredReviews = MOCK_REVIEWS.filter(r => {
    if (reviewFilter === 'All') return true;
    if (reviewFilter === 'Automatic') return r.auto;
    return !r.auto;
  });

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

  const renderItem = (item: Listing, index: number) => (
    <AnimatedPressable
      key={item.id}
      style={[styles.gridItem, index % 2 === 0 ? { marginTop: 0 } : { marginTop: 24 }]}
      activeOpacity={0.9}
      onPress={() => {
        if (route.params?.isMe) {
          navigation.navigate('ManageListing', { itemId: item.id });
        } else {
          navigation.navigate('ItemDetail', { itemId: item.id });
        }
      }}
    >
      <View style={styles.gridImageWrap}>
        <CachedImage uri={item.images[0]} style={styles.gridImage} contentFit="cover" />
        <View style={styles.likeBtnPill}>
          <Ionicons name="heart-outline" size={14} color="#fff" />
        </View>
      </View>
      <View style={styles.gridInfo}>
        <Text style={styles.gridPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        <Text style={styles.gridBrand} numberOfLines={1} ellipsizeMode="tail">{item.brand}</Text>
        <Text style={styles.gridSizeCondition}>{item.size} • {item.condition}</Text>
      </View>
    </AnimatedPressable>
  );

  const groupedListings = [];
  for (let i = 0; i < profileListings.length; i += 2) {
    groupedListings.push([profileListings[i], profileListings[i+1]]);
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Floating Translucent Header Layer */}
      <Reanimated.View style={[styles.floatingHeader, { paddingTop: insets.top }, headerOpacityStyle]}>
         <View style={{ flex: 1 }} />
         <Text style={styles.floatingHeaderTitle}>mariefullery</Text>
         <View style={{ flex: 1 }} />
      </Reanimated.View>
      
      <View style={[styles.floatingHeaderActions, { top: insets.top }]}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <View style={styles.iconBackdrop}>
             <Ionicons name="arrow-back" size={24} color="#fff" />
          </View>
        </AnimatedPressable>
        <AnimatedPressable style={styles.backBtn} onPress={() => setActionSheetVisible(true)}>
          <View style={styles.iconBackdrop}>
            <Ionicons name="ellipsis-horizontal" size={22} color="#fff" />
          </View>
        </AnimatedPressable>
      </View>

      {/* Cover photo with parallax */}
      <Reanimated.View style={[styles.coverWrap, coverStyle]}>
        <CachedImage uri={userCover || COVER_IMAGE} style={styles.coverImage} contentFit="cover" priority="high" />
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
              {route.params.isMe && userAvatar ? (
                <CachedImage uri={userAvatar} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <Ionicons name="person" size={32} color={MUTED} />
              )}
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.heroUsername}>mariefullery</Text>
              <View style={styles.heroRatingRow}>
                <StarRating rating={5} size={14} />
                <Text style={styles.heroReviewCount}>(54 reviews)</Text>
              </View>
            </View>
          </View>
          
          <View style={styles.statsCard}>
            <View style={styles.statCol}>
              <Text style={styles.statValue}>10</Text>
              <Text style={styles.statLabel}>Followers</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>0</Text>
              <Text style={styles.statLabel}>Following</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCol}>
              <Text style={styles.statValue}>26</Text>
              <Text style={styles.statLabel}>Active Items</Text>
            </View>
          </View>

          <AnimatedPressable
            style={[styles.followCta, following && styles.followCtaActive]}
            onPress={() => setFollowing(p => !p)}
            activeOpacity={0.85}
          >
            <Text style={[styles.followCtaText, following && styles.followCtaTextActive]}>
              {following ? 'Following' : 'Follow user'}
            </Text>
          </AnimatedPressable>
        </View>

        {/* Index 1: Sticky Tabs */}
        <View style={styles.stickyTabWrapper}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContainer}>
            {tabs.map(tab => (
              <AnimatedPressable
                key={tab}
                style={[styles.tabPill, activeTab === tab && styles.tabPillActive]}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.8}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab}
                </Text>
              </AnimatedPressable>
            ))}
          </ScrollView>
        </View>

        {/* Index 2: Tab Content */}
        <View style={styles.tabContentArea}>
          {activeTab === 'Listings' && (
            <View style={styles.gridListContent}>
              {groupedListings.map((pair, rowIndex) => (
                <View key={rowIndex} style={styles.rowWrapper}>
                  {pair[0] && renderItem(pair[0], rowIndex * 2)}
                  {pair[1] && renderItem(pair[1], rowIndex * 2 + 1)}
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
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                  {(['All', 'From members', 'Automatic'] as ReviewFilter[]).map(f => (
                    <AnimatedPressable
                      key={f}
                      style={[styles.filterChip, reviewFilter === f && styles.filterChipActive]}
                      onPress={() => setReviewFilter(f)}
                    >
                      <Text style={[styles.filterChipText, reviewFilter === f && styles.filterChipTextActive]}>{f}</Text>
                    </AnimatedPressable>
                  ))}
                </ScrollView>
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
                {route.params.isMe && userCover ? (
                  <CachedImage uri={userCover} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                ) : (
                  <Ionicons name="image-outline" size={48} color={MUTED} />
                )}
              </View>
              
              <Text style={styles.aboutBigName}>mariefullery</Text>
              
              <View style={styles.aboutInfoCard}>
                <Text style={styles.aboutSectionHeading}>Verified Details</Text>
                <View style={styles.aboutRow}>
                  <Ionicons name="checkmark-circle" size={20} color={TEAL} />
                  <Text style={styles.aboutRowText}>Facebook Connected</Text>
                </View>
                <View style={styles.aboutRow}>
                  <Ionicons name="checkmark-circle" size={20} color={TEAL} />
                  <Text style={styles.aboutRowText}>Email Verified</Text>
                </View>
              </View>

              <View style={styles.aboutInfoCard}>
                <Text style={styles.aboutSectionHeading}>Location & Activity</Text>
                <View style={styles.aboutRow}>
                  <Ionicons name="location" size={20} color={MUTED} />
                  <Text style={styles.aboutRowText}>South Elmsall, United Kingdom</Text>
                </View>
                <View style={styles.aboutRow}>
                  <Ionicons name="time" size={20} color={MUTED} />
                  <Text style={styles.aboutRowText}>Last seen 2 hours ago</Text>
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
          >
            <Ionicons name="flag-outline" size={20} color={TEXT} />
            <Text style={{ fontSize: 16, fontFamily: 'Inter_500Medium', color: TEXT }}>Report user</Text>
          </AnimatedPressable>

          <AnimatedPressable 
            style={{ paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}
            onPress={() => {
              setActionSheetVisible(false);
            }}
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
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    alignItems: 'center', justifyContent: 'center',
  },
  heroInfo: { flex: 1 },
  heroUsername: { fontSize: 24, fontFamily: 'Inter_700Bold', color: TEXT, letterSpacing: -0.5, marginBottom: 6 },
  heroRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroReviewCount: { fontSize: 14, fontFamily: 'Inter_500Medium', color: MUTED },
  
  statsCard: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    paddingVertical: 16,
    marginBottom: 24,
  },
  statCol: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 2 },
  statLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  statDivider: { width: 1, backgroundColor: BORDER },
  
  followCta: {
    backgroundColor: Colors.accent,
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
  },
  followCtaActive: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER },
  followCtaText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textInverse },
  followCtaTextActive: { color: TEXT },

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
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
  },
  tabPillActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  tabText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED },
  tabTextActive: { color: Colors.textInverse, fontFamily: 'Inter_700Bold' },

  tabContentArea: {
    backgroundColor: BG,
    minHeight: width,
    paddingTop: 16,
    paddingBottom: 100,
  },

  // Grid / Listings
  gridListContent: { paddingHorizontal: 20 },
  rowWrapper: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  gridItem: { width: ITEM_SIZE },
  gridImageWrap: {
    width: ITEM_SIZE,
    height: ITEM_SIZE * 1.35,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 12,
  },
  gridImage: { width: '100%', height: '100%' },
  likeBtnPill: {
    position: 'absolute', top: 10, right: 10,
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center', justifyContent: 'center',
  },
  gridInfo: { paddingHorizontal: 4, minHeight: 56 },
  gridPrice: { color: TEXT, fontSize: 18, fontFamily: 'Inter_700Bold', marginBottom: 2 },
  gridBrand: { color: Colors.textSecondary, fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.25, marginBottom: 3 },
  gridSizeCondition: { color: MUTED, fontSize: 13, fontFamily: 'Inter_500Medium' },

  // Reviews Tab
  reviewsContent: { paddingHorizontal: 0 },
  ratingHero: { alignItems: 'center', paddingVertical: 40 },
  ratingBigNumber: { fontSize: 72, fontFamily: 'Inter_700Bold', color: TEXT, letterSpacing: -2, lineHeight: 80 },
  ratingTotalText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 12 },
  
  reviewsFilterRow: { paddingHorizontal: 20, marginBottom: 24 },
  filterChip: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD },
  filterChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  filterChipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: MUTED },
  filterChipTextActive: { color: Colors.textInverse, fontFamily: 'Inter_700Bold' },
  
  reviewsList: { paddingHorizontal: 20 },
  reviewBlock: {
    flexDirection: 'row',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  reviewerAvatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: BORDER, backgroundColor: CARD_ALT, alignItems: 'center', justifyContent: 'center' },
  reviewerAvatarAuto: { width: 44, height: 44, borderRadius: 22, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  reviewerAvatarAutoText: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.textInverse },
  reviewBlockInfo: { flex: 1 },
  reviewSenderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  reviewSenderName: { fontSize: 15, fontFamily: 'Inter_700Bold', color: TEXT },
  reviewTime: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  reviewBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: TEXT, marginTop: 8, lineHeight: 22 },

  // About Tab
  aboutContent: { paddingHorizontal: 20 },
  aboutBannerImage: {
    height: 180,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  aboutBigName: { fontSize: 32, fontFamily: 'Inter_700Bold', color: TEXT, letterSpacing: -1, marginBottom: 32 },
  
  aboutInfoCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 24,
    marginBottom: 16,
  },
  aboutSectionHeading: { fontSize: 13, fontFamily: 'Inter_700Bold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 },
  aboutRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  aboutRowText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT },
});
