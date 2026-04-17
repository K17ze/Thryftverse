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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { getCoOwnMarket } from '../data/tradeHub';
import { resolveAssetMarketState } from '../data/mockSyndicateData';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { AnimatedCounter } from '../components/AnimatedCounter';
import { CachedImage } from '../components/CachedImage';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { useToast } from '../context/ToastContext';
import { AppButton } from '../components/ui/AppButton';
import { useReducedMotion } from '../hooks/useReducedMotion';
import {
  setStoredUserAvatar,
  setStoredUserAvatarForUser,
  setStoredUserCover,
  setStoredUserCoverForUser,
} from '../preferences/profileMediaPreferences';
import { persistProfileMediaUri } from '../utils/profileMediaAsset';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COVER_HEIGHT = 170;
const AVATAR_SIZE = 82;
const HERO_MEDIA_GAP = 6;
const HERO_MEDIA_TILE = (SCREEN_WIDTH - 40 - HERO_MEDIA_GAP * 2) / 3;
const ACCENT = Colors.accent;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : ACCENT;
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const PANEL_SOFT = IS_LIGHT ? '#f4efe7' : '#171717';
const PANEL_ICON = IS_LIGHT ? '#ece5d9' : '#1a1a1a';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';

const COVER_IMAGE = MY_USER.coverPhoto || 'https://picsum.photos/seed/profilecoverdefault/1200/800';

interface QuickAccessItem {
  icon: string;
  label: string;
  route: keyof RootStackParamList;
  value?: string;
  color: string;
}

export default function MyProfileScreen() {
  const navigation = useNavigation<NavT>();
  const insets = useSafeAreaInsets();
  const reducedMotionEnabled = useReducedMotion();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();
  const customCoOwns = useStore((state) => state.customCoOwns);
  const coOwnRuntime = useStore((state) => state.coOwnRuntime);
  
  const userAvatar = useStore((state) => state.userAvatar);
  const userCover = useStore((state) => state.userCover);
  const currentUser = useStore((state) => state.currentUser);
  const profileMediaOverrides = useStore((state) => state.profileMediaOverrides);
  const updateUserAvatar = useStore((state) => state.updateUserAvatar);
  const updateUserCover = useStore((state) => state.updateUserCover);

  React.useEffect(() => {
    let canceled = false;

    const migrateStoredProfileMediaUris = async () => {
      if (userCover) {
        const persistedCoverUri = await persistProfileMediaUri(userCover, 'cover');
        if (!canceled && persistedCoverUri !== userCover) {
          updateUserCover(persistedCoverUri);
          Promise.all([
            setStoredUserCover(persistedCoverUri),
            setStoredUserCoverForUser(MY_USER.id, persistedCoverUri),
            currentUser?.id
              ? setStoredUserCoverForUser(currentUser.id, persistedCoverUri)
              : Promise.resolve(),
          ]).catch(() => {
            // Keep UX responsive when local persistence fails.
          });
        }
      }

      if (userAvatar) {
        const persistedAvatarUri = await persistProfileMediaUri(userAvatar, 'avatar');
        if (!canceled && persistedAvatarUri !== userAvatar) {
          updateUserAvatar(persistedAvatarUri);
          Promise.all([
            setStoredUserAvatar(persistedAvatarUri),
            setStoredUserAvatarForUser(MY_USER.id, persistedAvatarUri),
            currentUser?.id
              ? setStoredUserAvatarForUser(currentUser.id, persistedAvatarUri)
              : Promise.resolve(),
          ]).catch(() => {
            // Keep UX responsive when local persistence fails.
          });
        }
      }
    };

    migrateStoredProfileMediaUris().catch(() => {
      // Silent fallback: upload flow still works even when migration fails.
    });

    return () => {
      canceled = true;
    };
  }, [currentUser?.id, updateUserAvatar, updateUserCover, userAvatar, userCover]);

  const pickCover = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      show('Allow photo library access to upload cover', 'error');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.86,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const nextCoverUri = await persistProfileMediaUri(result.assets[0].uri, 'cover');
        updateUserCover(nextCoverUri);
        Promise.all([
          setStoredUserCover(nextCoverUri),
          setStoredUserCoverForUser(MY_USER.id, nextCoverUri),
          currentUser?.id ? setStoredUserCoverForUser(currentUser.id, nextCoverUri) : Promise.resolve(),
        ]).catch(() => {
          // Keep UX responsive when local persistence fails.
        });
        show('Cover updated', 'success');
      }
    } catch {
      show('Unable to open gallery right now', 'error');
    }
  };

  const pickAvatar = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      show('Allow photo library access to upload avatar', 'error');
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.86,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const nextAvatarUri = await persistProfileMediaUri(result.assets[0].uri, 'avatar');
        updateUserAvatar(nextAvatarUri);
        Promise.all([
          setStoredUserAvatar(nextAvatarUri),
          setStoredUserAvatarForUser(MY_USER.id, nextAvatarUri),
          currentUser?.id ? setStoredUserAvatarForUser(currentUser.id, nextAvatarUri) : Promise.resolve(),
        ]).catch(() => {
          // Keep UX responsive when local persistence fails.
        });
        show('Avatar updated', 'success');
      }
    } catch {
      show('Unable to open gallery right now', 'error');
    }
  };

  const profileUserId = currentUser?.id ?? MY_USER.id;
  const profileMediaOverride =
    profileMediaOverrides[profileUserId] ?? profileMediaOverrides[MY_USER.id] ?? null;
  const displayCover = userCover || profileMediaOverride?.cover || MY_USER.coverPhoto || COVER_IMAGE;
  const displayAvatar = userAvatar || profileMediaOverride?.avatar || MY_USER.avatar;

  const myListings = React.useMemo(() => {
    const owned = listings.filter((item) => item.sellerId === profileUserId);
    if (owned.length > 0) {
      return owned.slice(0, 6);
    }

    return listings.slice(0, 6);
  }, [listings, profileUserId]);

  const heroMediaListings = React.useMemo(
    () => myListings.filter((item) => item.images.length > 0),
    [myListings]
  );

  const coOwnHoldings = React.useMemo(() => {
    const marketAssets = getCoOwnMarket(customCoOwns).map((asset) =>
      resolveAssetMarketState(asset, coOwnRuntime[asset.id])
    );
    return marketAssets.filter((asset) => asset.yourUnits > 0);
  }, [customCoOwns, coOwnRuntime]);

  const holdingsValue = React.useMemo(
    () => coOwnHoldings.reduce((sum, asset) => sum + asset.yourUnits * asset.unitPriceGBP, 0),
    [coOwnHoldings]
  );

  const holdingsUnrealized = React.useMemo(
    () =>
      coOwnHoldings.reduce((sum, asset) => {
        const avgEntry = asset.avgEntryPriceGBP ?? asset.unitPriceGBP;
        return sum + (asset.unitPriceGBP - avgEntry) * asset.yourUnits;
      }, 0),
    [coOwnHoldings]
  );

  // Parallax scroll for cover
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

  const topUtilityStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, 80], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, 80], [0, -8], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
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
        label: 'Co-Own',
        route: 'Portfolio',
        value: `${coOwnHoldings.length} assets`,
        color: IS_LIGHT ? '#5c4830' : '#ccb893',
      },
      { icon: 'bookmark-outline', label: 'Wishlist', route: 'Favourites', color: IS_LIGHT ? '#704b3b' : '#e6c8b4' },
      { icon: 'settings-outline', label: 'Settings', route: 'Settings', color: '#a0a0a0' },
    ],
    [formatFromFiat, coOwnHoldings.length]
  );

  const AnimatedScrollView = Reanimated.createAnimatedComponent(ScrollView);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* Cover photo with parallax */}
      <Reanimated.View style={[styles.coverWrap, coverStyle]}>
        <CachedImage key={displayCover} uri={displayCover} style={styles.coverImage} contentFit="cover" priority="high" />
        <View style={styles.coverGradient} />
      </Reanimated.View>

      <View pointerEvents="box-none" style={styles.coverActionLayer}>
        <Reanimated.View style={[styles.topUtilityRow, { top: Math.max(insets.top + 6, 14) }, topUtilityStyle]}>
          <AnimatedPressable
            style={styles.topUtilityIconBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Personalisation')}
            accessibilityLabel="Open personalisation settings"
            accessibilityRole="button"
            accessibilityHint="Opens your style and experience preferences"
          >
            <Ionicons name="apps-outline" size={18} color="#fff" />
          </AnimatedPressable>

          <View style={styles.topUtilityRight}>
            <AppButton
              title="Cover"
              icon={<Ionicons name="camera" size={16} color="#fff" />}
              onPress={pickCover}
              variant="secondary"
              size="sm"
              style={styles.topUtilityPillBtn}
              titleStyle={styles.topUtilityPillText}
              iconContainerStyle={styles.topUtilityPillIconWrap}
              accessibilityLabel="Change cover photo"
              accessibilityHint="Opens photo picker to update your cover photo"
            />
          </View>
        </Reanimated.View>
      </View>

      <AnimatedScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingTop: COVER_HEIGHT - 42 }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* Profile Hero */}
        <View style={styles.heroSection}>
          <View style={styles.heroTop}>
            <AnimatedPressable style={styles.avatarWrap} onPress={pickAvatar} activeOpacity={0.85}
          accessibilityLabel="Change profile photo"
          accessibilityRole="button"
          accessibilityHint="Opens photo picker to update your avatar"
        >
              <CachedImage
                uri={displayAvatar}
                style={styles.heroAvatar}
                containerStyle={styles.heroAvatarContainer}
                contentFit="cover"
              />
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={22} color={BRAND} />
              </View>
              <View style={styles.editAvatarChip}>
                <Ionicons name="camera" size={16} color="#fff" />
              </View>
            </AnimatedPressable>
          </View>

          <Text style={styles.heroName} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{MY_USER.username.toUpperCase()}</Text>
          <Text style={styles.heroHandle}>@{MY_USER.username}</Text>
          <Text style={styles.heroMeta}>
            {MY_USER.location} | {MY_USER.reviewCount} reviews | last seen {MY_USER.lastSeen.toLowerCase()}
          </Text>

          <View style={styles.profileActionRow}>
            <AppButton
              title="Edit profile"
              variant="primary"
              size="sm"
              onPress={() => navigation.navigate('EditProfile')}
              style={styles.profileActionPrimary}
              titleStyle={styles.profileActionPrimaryText}
              accessibilityLabel="Edit your profile"
              accessibilityHint="Opens profile editor for username, bio, and preferences"
            />

            <AppButton
              title="Share profile"
              variant="secondary"
              size="sm"
              onPress={handleShare}
              style={styles.profileActionSecondary}
              titleStyle={styles.profileActionSecondaryText}
              accessibilityLabel="Share your profile"
              accessibilityHint="Opens share sheet with your profile link"
            />

            <AnimatedPressable
              style={styles.profileActionIcon}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.8}
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              accessibilityHint="Opens account and app settings"
            >
              <Ionicons name="settings-outline" size={18} color={Colors.textPrimary} />
            </AnimatedPressable>
          </View>

          <Reanimated.View
            entering={
              reducedMotionEnabled
                ? undefined
                : FadeInDown.delay(200).duration(400)
            }
            style={styles.statsRow}
          >
            <AnimatedPressable
              style={styles.statItem}
              onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
              activeOpacity={0.8}
              accessibilityLabel={`${MY_USER.listingCount} listings. Tap to view full profile.`}
              accessibilityRole="button"
              accessibilityHint="Opens your complete public profile"
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
              <Text style={styles.statNumber}>{MY_USER.rating}*</Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </Reanimated.View>

          <View style={styles.quickAccessCard}>
            <View style={styles.quickGrid}>
              {quickAccess.map((item, index) => (
                <AnimatedPressable
                  key={item.label}
                  style={[styles.quickItem, (index + 1) % 3 === 0 && styles.quickItemLastInRow]}
                  activeOpacity={0.8}
                  onPress={() => navigation.navigate(item.route as any)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.label}`}
                  accessibilityHint={item.value ? `Shows ${item.label.toLowerCase()} with ${item.value}` : `Navigates to ${item.label.toLowerCase()}`}
                >
                  <View style={styles.quickIconCircle}>
                    <Ionicons name={item.icon as any} size={18} color={item.color} />
                  </View>
                  <Text style={styles.quickLabel}>{item.label}</Text>
                  {item.value && <Text style={styles.quickValue}>{item.value}</Text>}
                </AnimatedPressable>
              ))}
            </View>
          </View>

          <View style={styles.mediaGrid}>
            {heroMediaListings.slice(0, 6).map((item, index) => (
              <AnimatedPressable
                key={`hero_media_${item.id}_${index}`}
                style={[styles.mediaTile, (index + 1) % 3 === 0 && styles.mediaTileLast]}
                activeOpacity={0.9}
                onPress={() => navigation.push('ItemDetail', { itemId: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`Open listing ${item.title}`}
                accessibilityHint="Opens the item detail page"
              >
                <SharedTransitionView
                  style={styles.mediaThumbWrap}
                  sharedTransitionTag={`image-${item.id}-0`}
                >
                  <CachedImage
                    uri={item.images[0]}
                    style={styles.mediaThumb}
                    containerStyle={{ width: '100%', height: '100%', borderRadius: 10 }}
                    contentFit="cover"
                  />
                </SharedTransitionView>
                <View style={styles.mediaTilePricePill}>
                  <Text style={styles.mediaTilePriceText}>
                    {formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}
                  </Text>
                </View>
              </AnimatedPressable>
            ))}
          </View>
        </View>

        {/* ── Co-Own Portfolio Summary ── */}
        <View style={styles.portfolioSummaryCard}>
          <View style={styles.portfolioSummaryTop}>
            <Text style={styles.portfolioSummaryLabel}>MY CO-OWN HOLDINGS</Text>
            <AnimatedPressable
              style={styles.portfolioSummaryLinkBtn}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Portfolio')}
              accessibilityRole="button"
              accessibilityLabel="Open co-own portfolio"
              accessibilityHint="Navigates to your portfolio holdings"
            >
              <Text style={styles.portfolioSummaryLinkText}>Open</Text>
              <Ionicons name="arrow-forward" size={14} color={ACCENT} />
            </AnimatedPressable>
          </View>

          <Text style={styles.portfolioSummaryValue}>{formatFromFiat(holdingsValue, 'GBP')}</Text>

          <View style={styles.portfolioSummaryMetaRow}>
            <Text style={styles.portfolioSummaryMeta}>
              {coOwnHoldings.length} active position{coOwnHoldings.length === 1 ? '' : 's'}
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

          {coOwnHoldings.length === 0 && (
            <AnimatedPressable
              style={styles.portfolioSummaryCta}
              activeOpacity={0.85}
              onPress={() => navigation.navigate('CoOwnHub')}
              accessibilityRole="button"
              accessibilityLabel="Explore co-own hub"
              accessibilityHint="Navigates to co-own opportunities"
            >
              <Ionicons name="sparkles-outline" size={14} color={Colors.background} />
              <Text style={styles.portfolioSummaryCtaText}>Explore Co-Own Hub</Text>
            </AnimatedPressable>
          )}
        </View>

        {/* My Wardrobe Preview */}
        <View style={styles.wardrobeSection}>
          <View style={styles.wardrobeHeader}>
            <View>
              <Text style={styles.wardrobeSectionLabel}>YOUR LISTINGS</Text>
              <Text style={styles.wardrobeTitle}>My Wardrobe</Text>
            </View>
            <AnimatedPressable
              style={styles.viewAllBtn}
              onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
              accessibilityRole="button"
              accessibilityLabel="View all listings"
              accessibilityHint="Opens your complete wardrobe listings"
            >
              <Text style={styles.viewAllText}>View All</Text>
              <Ionicons name="arrow-forward" size={14} color={ACCENT} />
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
                onPress={() => navigation.push('ItemDetail', { itemId: item.id })}
                accessibilityRole="button"
                accessibilityLabel={`Open wardrobe listing ${item.title}`}
                accessibilityHint="Opens listing details"
              >
                <SharedTransitionView
                  style={styles.wardrobeImageWrap}
                  sharedTransitionTag={`image-${item.id}-0`}
                >
                  <CachedImage uri={item.images[0]} style={styles.wardrobeImage} containerStyle={{ width: '100%', height: '100%', borderRadius: 16 }} contentFit="cover" />
                </SharedTransitionView>
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

        {/* Badges Section */}
        <View style={styles.badgesCard}>
          <Text style={styles.badgesTitle}>Badges</Text>
          <View style={styles.badgeRow}>
            {[
              { icon: 'star-outline', label: 'Top Seller', earned: false },
              { icon: 'camera-outline', label: 'Active', earned: false },
              { icon: 'shield-checkmark-outline', label: 'Verified', earned: true },
            ].map((b) => (
              <View key={b.label} style={styles.badgeItem}>
                <View style={[styles.badgeCircle, b.earned && styles.badgeCircleEarned]}>
                  <Ionicons name={b.icon as any} size={22} color={b.earned ? ACCENT : Colors.textMuted} />
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

  // Cover (parallax banner)
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
  coverActionLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: COVER_HEIGHT,
    zIndex: 8,
  },
  topUtilityRow: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  topUtilityRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  topUtilityIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topUtilityPillBtn: {
    backgroundColor: 'rgba(0,0,0,0.58)',
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  topUtilityPillIconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'transparent',
  },
  topUtilityPillText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 24,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
  },
  heroTop: {
    alignItems: 'center',
    marginTop: -(AVATAR_SIZE + 8),
    marginBottom: 12,
  },
  avatarWrap: { position: 'relative' },
  heroAvatarContainer: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 3,
    borderColor: Colors.background,
    overflow: 'hidden',
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
  editAvatarChip: {
    position: 'absolute',
    right: -3,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1c1c1c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 36,
    lineHeight: 40,
    fontFamily: Typography.family.extrabold,
    color: Colors.textPrimary,
    marginBottom: 2,
    alignSelf: 'center',
    letterSpacing: -0.7,
    maxWidth: '100%',
    textAlign: 'center',
  },
  heroHandle: {
    fontSize: 16,
    lineHeight: 18,
    fontFamily: Typography.family.semibold,
    color: Colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.12,
  },
  heroMeta: {
    fontSize: 11,
    fontFamily: Typography.family.light,
    color: Colors.textMuted,
    alignSelf: 'center',
    marginBottom: 12,
    letterSpacing: 0.24,
    textAlign: 'center',
  },
  profileActionRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  profileActionPrimary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
  },
  profileActionPrimaryText: {
    color: Colors.background,
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.15,
  },
  profileActionSecondary: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
  },
  profileActionSecondaryText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.18,
  },
  profileActionIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaGrid: {
    marginTop: 16,
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  mediaTile: {
    width: HERO_MEDIA_TILE,
    marginRight: HERO_MEDIA_GAP,
    marginBottom: HERO_MEDIA_GAP,
    position: 'relative',
  },
  mediaTileLast: {
    marginRight: 0,
  },
  mediaThumbWrap: {
    width: HERO_MEDIA_TILE,
    height: HERO_MEDIA_TILE * 1.15,
    borderRadius: 10,
  },
  mediaThumb: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  mediaTilePricePill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  mediaTilePriceText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.08,
  },

  statsHeaderRow: {
    marginTop: 16,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  statsTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  statsHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: Typography.family.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
    borderRadius: 20,
    paddingHorizontal: 0,
    paddingVertical: 4,
    marginTop: 8,
    width: '100%',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: 'transparent',
    paddingVertical: 6,
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
    width: 4,
    backgroundColor: 'transparent',
  },

  // Quick Access (original layout preserved)
  quickAccessCard: {
    width: '100%',
    marginTop: 10,
    backgroundColor: 'transparent',
    borderRadius: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  quickAccessHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  quickAccessTitle: {
    fontSize: 13,
    fontFamily: Typography.family.semibold,
    color: Colors.textPrimary,
  },
  quickAccessHint: {
    fontSize: 9,
    fontFamily: Typography.family.medium,
    color: Colors.textMuted,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  quickItem: {
    width: '31.2%',
    alignItems: 'center',
    marginRight: '3.2%',
    marginBottom: 6,
    minHeight: 66,
    borderRadius: 10,
    backgroundColor: 'transparent',
    paddingHorizontal: 6,
    paddingVertical: 7,
  },
  quickItemLastInRow: {
    marginRight: 0,
  },
  quickIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  quickLabel: {
    fontSize: 9,
    fontFamily: Typography.family.medium,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 12,
    letterSpacing: 0.08,
  },
  quickValue: {
    fontSize: 8,
    fontFamily: Typography.family.semibold,
    color: BRAND,
    marginTop: 1,
    letterSpacing: 0.06,
  },

  // Portfolio Summary (original layout preserved)
  portfolioSummaryCard: {
    marginHorizontal: 20,
    backgroundColor: 'transparent',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
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
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    marginBottom: 16,
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
    marginBottom: 14,
    letterSpacing: -0.2,
  },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  badgeItem: { alignItems: 'center', gap: 6 },
  badgeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
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


