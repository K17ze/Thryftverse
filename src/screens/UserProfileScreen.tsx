import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  StatusBar,
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Alert, Image } from 'react-native';
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

// 2-column grid spacing (aligns with Phase 21 BrowseScreen)
const GRID_SPACING = 16;
const ITEM_SIZE = (width - 40 - GRID_SPACING) / 2;

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

export default function UserProfileScreen({ navigation, route }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('Listings');
  const [following, setFollowing] = useState(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('All');
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();

  const profileListings = React.useMemo(() => listings.slice(0, 6), [listings]);

  const tabs: Tab[] = ['Listings', 'Reviews', 'About'];

  const filteredReviews = MOCK_REVIEWS.filter(r => {
    if (reviewFilter === 'All') return true;
    if (reviewFilter === 'Automatic') return r.auto;
    return !r.auto;
  });

  const renderItem = ({ item, index }: { item: Listing; index: number }) => (
    <AnimatedPressable
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
        <Image 
          source={{ uri: item.images[0] }} 
          style={styles.gridImage} 
          resizeMode="cover"
        />
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />

      {/* Hero Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>mariefullery</Text>
        <AnimatedPressable style={styles.backBtn} onPress={() => {
          Alert.alert('Report or Block', 'What would you like to do?', [
            { text: 'Report user', onPress: () => navigation.navigate('Report', { type: 'user' }) },
            { text: 'Block user', style: 'destructive', onPress: () => {} },
            { text: 'Cancel', style: 'cancel' },
          ]);
        }}>
          <Ionicons name="ellipsis-horizontal" size={22} color={TEXT} />
        </AnimatedPressable>
      </View>

      {/* Floating Pill Tabs */}
      <View style={styles.tabBarContainer}>
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
      </View>

      {/* Tab Content */}
      {activeTab === 'Listings' && (
        <FlatList
          data={profileListings}
          renderItem={renderItem}
          keyExtractor={i => i.id}
          numColumns={2}
          columnWrapperStyle={styles.rowWrapper}
          contentContainerStyle={styles.gridListContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.profileHeader}>
              <View style={styles.heroRow}>
                <View style={styles.avatarLarge}>
                  <Ionicons name="person" size={32} color={MUTED} />
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
          }
        />
      )}

      {activeTab === 'Reviews' && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.reviewsContent}>
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
        </ScrollView>
      )}

      {activeTab === 'About' && (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.aboutContent}>
          <View style={styles.aboutBannerImage}>
            <Ionicons name="image-outline" size={48} color={MUTED} />
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
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT, textTransform: 'uppercase', letterSpacing: 1 },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  
  tabBarContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 16,
  },
  tabPill: {
    flex: 1,
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

  // Grid / Listings
  profileHeader: { paddingHorizontal: 20, paddingBottom: 32 },
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

  gridListContent: { paddingBottom: 100 },
  rowWrapper: { justifyContent: 'space-between', marginBottom: 32, paddingHorizontal: 20 },
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
  gridImagePlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  reviewsContent: { paddingBottom: 40 },
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
  aboutContent: { paddingHorizontal: 20, paddingBottom: 40 },
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
