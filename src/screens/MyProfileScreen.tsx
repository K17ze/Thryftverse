import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Dimensions,
  Share,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Reanimated, {
  useSharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  FadeInDown,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { MY_USER } from '../data/mockData';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { useStore } from '../store/useStore';
import { getSyndicateMarket } from '../data/tradeHub';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { CachedImage } from '../components/CachedImage';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_HEIGHT = 170;
const AVATAR_SIZE = 82;
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : TEAL;
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const PANEL_SOFT = IS_LIGHT ? '#f4efe7' : '#171717';
const PANEL_ICON = IS_LIGHT ? '#ece5d9' : '#1a1a1a';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';

const COVER_IMAGE = 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&q=80';

interface QuickAccessItem {
  icon: string;
  label: string;
  route: keyof RootStackParamList;
  value?: string;
  color: string;
}

export default function MyProfileScreen() {
  const navigation = useNavigation<NavT>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();
  const customSyndicates = useStore((state) => state.customSyndicates);
  const syndicateRuntime = useStore((state) => state.syndicateRuntime);
  
  const userAvatar = useStore((state) => state.userAvatar);
  const userCover = useStore((state) => state.userCover);
  const updateUserAvatar = useStore((state) => state.updateUserAvatar);
  const updateUserCover = useStore((state) => state.updateUserCover);

  const pickCover = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.8,
    });
    if (!result.canceled) {
      updateUserCover(result.assets[0].uri);
    }
  };

  const pickAvatar = async () => {
    let result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      updateUserAvatar(result.assets[0].uri);
    }
  };

  const myListings = React.useMemo(() => listings.slice(0, 6), [listings]);

  const syndicateHoldings = React.useMemo(() => {
    const marketAssets = getSyndicateMarket(customSyndicates).map((asset) =>
      resolveAssetMarketState(asset, syndicateRuntime[asset.id])
    );
    return marketAssets.filter((asset) => asset.yourUnits > 0);
  }, [customSyndicates, syndicateRuntime]);

  const holdingsValue = React.useMemo(
    () => syndicateHoldings.reduce((sum, asset) => sum + asset.yourUnits * asset.unitPriceGBP, 0),
    [syndicateHoldings]
  );

  const holdingsUnrealized = React.useMemo(
    () =>
      syndicateHoldings.reduce((sum, asset) => {
        const avgEntry = asset.avgEntryPriceGBP ?? asset.unitPriceGBP;
        return sum + (asset.unitPriceGBP - avgEntry) * asset.yourUnits;
      }, 0),
    [syndicateHoldings]
  );

  // ── Parallax scroll for cover ──
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

  const handleShare = async () => {
    try {
      await Share.share({ message: `Check out @${MY_USER.username} on Thryftverse!` });
    } catch { /* ignore */ }
  };

  const quickAccess = React.useMemo<QuickAccessItem[]>(
    () => [
      { icon: 'receipt-outline', label: 'Orders', route: 'MyOrders', color: BRAND },
      {
        icon: 'wallet-outline',
        label: 'Wallet',
        route: 'Wallet',
        value: formatFromFiat(120.5, 'GBP', { displayMode: 'fiat' }),
        color: IS_LIGHT ? '#6a4f2f' : '#d8c6a2',
      },
      {
        icon: 'pie-chart-outline',
        label: 'My Syndicate Holdings',
        route: 'Portfolio',
        value: `${syndicateHoldings.length} assets`,
        color: IS_LIGHT ? '#5c4830' : '#ccb893',
      },
      { icon: 'bookmark-outline', label: 'Wishlist', route: 'Favourites', color: IS_LIGHT ? '#704b3b' : '#e6c8b4' },
      { icon: 'color-palette-outline', label: 'Style', route: 'Personalisation', color: IS_LIGHT ? '#6a5a45' : '#d6c6b4' },
      { icon: 'people-outline', label: 'Invite', route: 'InviteFriends', color: BRAND },
      { icon: 'settings-outline', label: 'Settings', route: 'Settings', color: '#a0a0a0' },
    ],
    [formatFromFiat, syndicateHoldings.length]
  );

  const AnimatedScrollView = Reanimated.createAnimatedComponent(ScrollView);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* Cover photo with parallax */}
      <Reanimated.View style={[styles.coverWrap, coverStyle]}>
        <AnimatedPressable onPress={pickCover} style={{ flex: 1 }} activeOpacity={0.9}>
          <CachedImage uri={userCover || COVER_IMAGE} style={styles.coverImage} contentFit="cover" priority="high" />
          <View style={styles.coverGradient} />
          <View style={styles.editCoverOverlay}>
            <Ionicons name="camera" size={20} color="#fff" />
          </View>
        </AnimatedPressable>
      </Reanimated.View>

      <AnimatedScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: COVER_HEIGHT - 42 }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* ── Profile Hero ── */}
        <View style={styles.heroSection}>
          <View style={styles.heroTop}>
            <AnimatedPressable style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}>
              <CachedImage
                uri={userAvatar || MY_USER.avatar}
                style={styles.heroAvatar}
                containerStyle={styles.heroAvatarContainer}
                contentFit="cover"
              />
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={22} color={BRAND} />
              </View>
              <View style={styles.editAvatarOverlay}>
                <Ionicons name="camera" size={16} color="#fff" />
              </View>
            </AnimatedPressable>
            <View style={styles.heroActionRow}>
              <AnimatedPressable style={styles.shareProfileBtn} onPress={handleShare} activeOpacity={0.8}>
                <Ionicons name="share-outline" size={16} color={Colors.textPrimary} />
              </AnimatedPressable>
              <AnimatedPressable style={styles.settingsBtn} onPress={() => navigation.navigate('Settings')} activeOpacity={0.8}>
                <Ionicons name="ellipsis-horizontal" size={20} color={Colors.textPrimary} />
              </AnimatedPressable>
            </View>
          </View>

          <Text style={styles.heroName}>@{MY_USER.username}</Text>
          <Text style={styles.heroMeta}>
            {MY_USER.location} · {MY_USER.reviewCount} reviews · last seen {MY_USER.lastSeen.toLowerCase()}
          </Text>

          <AnimatedPressable
            activeOpacity={0.8}
            style={styles.editProfileBtn}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Text style={styles.editProfileText}>edit profile</Text>
          </AnimatedPressable>

          {/* Animated Stats row */}
          <Reanimated.View entering={FadeInDown.delay(200).duration(400)} style={styles.statsRow}>
            <AnimatedPressable
              style={styles.statItem}
              onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
              activeOpacity={0.8}
            >
              <AnimatedCounter value={MY_USER.listingCount} style={styles.statNumber} duration={900} />
              <Text style={styles.statLabel}>LISTED</Text>
            </AnimatedPressable>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <AnimatedCounter value={MY_USER.followers} style={styles.statNumber} duration={900} />
              <Text style={styles.statLabel}>FOLLOWERS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <AnimatedCounter value={MY_USER.following} style={styles.statNumber} duration={900} />
              <Text style={styles.statLabel}>FOLLOWING</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{MY_USER.rating}★</Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </Reanimated.View>
        </View>

        {/* ── Quick Access Grid ── */}
        <View style={styles.quickAccessCard}>
          <View style={styles.quickGrid}>
            {quickAccess.map((item) => (
              <AnimatedPressable
                key={item.label}
                style={styles.quickItem}
                activeOpacity={0.8}
                onPress={() => navigation.navigate(item.route as any)}
              >
                <View style={[styles.quickIconCircle, { borderColor: item.color + '40' }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={styles.quickLabel}>{item.label}</Text>
                {item.value && <Text style={styles.quickValue}>{item.value}</Text>}
              </AnimatedPressable>
            ))}
          </View>
        </View>

        {/* ── Syndicate Portfolio Summary ── */}
        <View style={styles.portfolioSummaryCard}>
          <View style={styles.portfolioSummaryTop}>
            <Text style={styles.portfolioSummaryLabel}>MY SYNDICATE HOLDINGS</Text>
            <AnimatedPressable
              style={styles.portfolioSummaryLinkBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Portfolio')}
            >
              <Text style={styles.portfolioSummaryLinkText}>Open</Text>
              <Ionicons name="arrow-forward" size={14} color={TEAL} />
            </AnimatedPressable>
          </View>

          <Text style={styles.portfolioSummaryValue}>{formatFromFiat(holdingsValue, 'GBP')}</Text>

          <View style={styles.portfolioSummaryMetaRow}>
            <Text style={styles.portfolioSummaryMeta}>
              {syndicateHoldings.length} active position{syndicateHoldings.length === 1 ? '' : 's'}
            </Text>
            <Text
              style={[
                styles.portfolioSummaryPnl,
                holdingsUnrealized >= 0 ? styles.portfolioPnlUp : styles.portfolioPnlDown,
              ]}
            >
              Unrealized {holdingsUnrealized >= 0 ? '+' : '-'}
              {formatFromFiat(Math.abs(holdingsUnrealized), 'GBP', { displayMode: 'fiat' })}
            </Text>
          </View>

          {syndicateHoldings.length === 0 && (
            <AnimatedPressable
              style={styles.portfolioSummaryCta}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('SyndicateHub')}
            >
              <Ionicons name="sparkles-outline" size={14} color={Colors.background} />
              <Text style={styles.portfolioSummaryCtaText}>Explore Syndicate Hub</Text>
            </AnimatedPressable>
          )}
        </View>

        {/* ── My Wardrobe Preview (horizontal scroll — original Thryftverse layout) ── */}
        <View style={styles.wardrobeSection}>
          <View style={styles.wardrobeHeader}>
            <View>
              <Text style={styles.wardrobeSectionLabel}>YOUR LISTINGS</Text>
              <Text style={styles.wardrobeTitle}>My Wardrobe</Text>
            </View>
            <AnimatedPressable
              style={styles.viewAllBtn}
              onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Ionicons name="arrow-forward" size={14} color={TEAL} />
            </AnimatedPressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.wardrobeScroll}
          >
            {myListings.map((item) => (
              <AnimatedPressable
                key={item.id}
                style={styles.wardrobeItem}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
              >
                <CachedImage uri={item.images[0]} style={styles.wardrobeImage} containerStyle={styles.wardrobeImageWrap} contentFit="cover" />
                <View style={styles.wardrobeInfo}>
                  <Text style={styles.wardrobePrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
                  <Text style={styles.wardrobeBrand} numberOfLines={1}>@{item.brand.toLowerCase()}</Text>
                </View>
                <View style={styles.wardrobeLikes}>
                  <Ionicons name="heart" size={10} color={Colors.textMuted} />
                  <Text style={styles.wardrobeLikeCount}>{item.likes}</Text>
                </View>
              </AnimatedPressable>
            ))}
          </ScrollView>
        </View>

        {/* ── Badges Section ── */}
        <View style={styles.badgesCard}>
          <Text style={styles.badgesSectionLabel}>ACHIEVEMENTS</Text>
          <Text style={styles.badgesTitle}>Badges</Text>
          <View style={styles.badgeRow}>
            {[
              { icon: 'star-outline', label: 'Top Seller', earned: false },
              { icon: 'camera-outline', label: 'Active', earned: false },
              { icon: 'shield-checkmark-outline', label: 'Verified', earned: true },
            ].map((b) => (
              <View key={b.label} style={styles.badgeItem}>
                <View style={[styles.badgeCircle, b.earned && styles.badgeCircleEarned]}>
                  <Ionicons name={b.icon as any} size={22} color={b.earned ? TEAL : Colors.textMuted} />
                </View>
                <Text style={[styles.badgeLabel, b.earned && styles.badgeLabelEarned]}>{b.label}</Text>
              </View>
            ))}
          </View>
        </View>

      </AnimatedScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 120 },

  // Cover (new — parallax banner)
  coverWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: COVER_HEIGHT,
    zIndex: 0,
    overflow: 'hidden',
  },
  coverImage: { width: '100%', height: '100%' },
  coverGradient: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: IS_LIGHT ? 'rgba(236,234,230,0.25)' : 'rgba(9,9,9,0.4)',
  },
  editCoverOverlay: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 8,
    borderRadius: 20,
  },

  // Hero — enhanced from original
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 28,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: -(AVATAR_SIZE / 2),
    marginBottom: 14,
  },
  avatarWrap: { position: 'relative' },
  heroAvatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: Colors.background,
  },
  heroAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR_SIZE / 2,
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: 0,
    right: -2,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 1,
  },
  editAvatarOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderRadius: AVATAR_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  heroActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  shareProfileBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 60,
    lineHeight: 62,
    fontFamily: Typography.family.extrabold,
    color: Colors.textPrimary,
    marginBottom: 2,
    alignSelf: 'flex-start',
    letterSpacing: -1.9,
  },
  heroMeta: {
    fontSize: 11,
    fontFamily: Typography.family.light,
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 14,
    letterSpacing: 0.24,
  },
  editProfileBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: PANEL_BG,
  },
  editProfileText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.18,
  },

  // Stats — now with animated counters
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 24,
    width: '100%',
    gap: 8,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  statItem: {
    width: '48%',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: PANEL_SOFT,
    paddingVertical: 10,
  },
  statNumber: {
    fontSize: 18,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 10,
    fontFamily: Typography.family.semibold,
    color: Colors.textMuted,
    letterSpacing: 0.55,
  },
  statDivider: {
    display: 'none',
  },

  // Quick Access (original layout preserved)
  quickAccessCard: {
    marginHorizontal: 20,
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickItem: {
    width: '47%',
    alignItems: 'center',
    marginBottom: 20,
    minHeight: 90,
  },
  quickIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: PANEL_ICON,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
  },
  quickLabel: {
    fontSize: 12,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 16,
    letterSpacing: 0.1,
  },
  quickValue: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    marginTop: 2,
    letterSpacing: 0.08,
  },

  // Portfolio Summary (original layout preserved)
  portfolioSummaryCard: {
    marginHorizontal: 20,
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  portfolioSummaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  portfolioSummaryLabel: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    letterSpacing: 0.9,
  },
  portfolioSummaryLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  portfolioSummaryLinkText: {
    fontSize: 12,
    fontFamily: Typography.family.semibold,
    color: BRAND,
  },
  portfolioSummaryValue: {
    fontSize: 26,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.35,
  },
  portfolioSummaryMetaRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  portfolioSummaryMeta: {
    fontSize: 12,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
    letterSpacing: 0.1,
  },
  portfolioSummaryPnl: {
    fontSize: 12,
    fontFamily: Typography.family.semibold,
  },
  portfolioPnlUp: { color: BRAND },
  portfolioPnlDown: { color: '#ff9d9d' },
  portfolioSummaryCta: {
    marginTop: 14,
    borderRadius: 999,
    backgroundColor: Colors.accent,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  portfolioSummaryCtaText: {
    color: Colors.background,
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.16,
  },

  // Wardrobe (original horizontal scroll layout preserved)
  wardrobeSection: {
    marginBottom: 24,
  },
  wardrobeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  wardrobeSectionLabel: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    letterSpacing: 1,
    marginBottom: 4,
  },
  wardrobeTitle: {
    fontSize: 22,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    letterSpacing: -0.25,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewAllText: {
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    letterSpacing: 0.16,
  },
  wardrobeScroll: {
    paddingLeft: 20,
    paddingRight: 8,
    gap: 12,
  },
  wardrobeItem: {
    width: 140,
    position: 'relative',
  },
  wardrobeImageWrap: {
    width: 140,
    height: 180,
    borderRadius: 16,
  },
  wardrobeImage: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
  },
  wardrobeInfo: {
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  wardrobePrice: {
    fontSize: 14,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  wardrobeBrand: {
    fontSize: 12,
    fontFamily: Typography.family.regular,
    color: Colors.textSecondary,
    marginTop: 2,
    letterSpacing: 0.08,
  },
  wardrobeLikes: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  wardrobeLikeCount: {
    fontSize: 10,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
  },

  // Badges (original preserved)
  badgesCard: {
    marginHorizontal: 20,
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  badgesSectionLabel: {
    fontSize: 11,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    letterSpacing: 1,
    marginBottom: 4,
  },
  badgesTitle: {
    fontSize: 20,
    fontFamily: Typography.family.bold,
    color: Colors.textPrimary,
    marginBottom: 20,
    letterSpacing: -0.2,
  },
  badgeRow: { flexDirection: 'row', gap: 16 },
  badgeItem: { alignItems: 'center', gap: 8 },
  badgeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PANEL_ICON,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  badgeCircleEarned: {
    borderColor: BRAND + '50',
    backgroundColor: BRAND + '14',
  },
  badgeLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: Typography.family.medium,
    textAlign: 'center',
    maxWidth: 64,
  },
  badgeLabelEarned: {
    color: BRAND,
  },
});
