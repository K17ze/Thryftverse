import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MY_USER } from '../data/mockData';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { useStore } from '../store/useStore';
import { getSyndicateMarket } from '../data/tradeHub';
import { resolveAssetMarketState } from '../data/mockSyndicateData';

type NavT = StackNavigationProp<RootStackParamList>;
const TEAL = '#4ECDC4';

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

  const myListings = React.useMemo(() => listings.slice(0, 6), [listings]);

  const syndicateHoldings = React.useMemo(() => {
    const marketAssets = getSyndicateMarket(customSyndicates).map((asset) =>
      resolveAssetMarketState(asset, syndicateRuntime[asset.id])
    );

    return marketAssets.filter((asset) => asset.yourUnits > 0);
  }, [customSyndicates, syndicateRuntime]);

  const holdingsValue = React.useMemo(
    () =>
      syndicateHoldings.reduce(
        (sum, asset) => sum + asset.yourUnits * asset.unitPriceGBP,
        0
      ),
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

  const quickAccess = React.useMemo<QuickAccessItem[]>(
    () => [
      { icon: 'receipt-outline', label: 'Orders', route: 'MyOrders', color: '#4ECDC4' },
      {
        icon: 'wallet-outline',
        label: 'Wallet',
        route: 'Wallet',
        value: formatFromFiat(120.5, 'GBP', { displayMode: 'fiat' }),
        color: '#FFD700',
      },
      {
        icon: 'pie-chart-outline',
        label: 'My Syndicate Holdings',
        route: 'Portfolio',
        value: `${syndicateHoldings.length} assets`,
        color: '#6dd8ff',
      },
      { icon: 'bookmark-outline', label: 'Wishlist', route: 'Favourites', color: '#FF6B6B' },
      { icon: 'color-palette-outline', label: 'Style', route: 'Personalisation', color: '#BB86FC' },
      { icon: 'people-outline', label: 'Invite', route: 'InviteFriends', color: '#4ECDC4' },
      { icon: 'settings-outline', label: 'Settings', route: 'Settings', color: '#a0a0a0' },
    ],
    [formatFromFiat, syndicateHoldings.length]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* ── Profile Hero ── */}
        <View style={styles.heroSection}>
          <View style={styles.heroTop}>
            <View style={styles.avatarWrap}>
              <Image source={{ uri: MY_USER.avatar }} style={styles.heroAvatar} />
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={20} color={TEAL} />
              </View>
            </View>
            <AnimatedPressable 
              style={styles.settingsBtn} 
              onPress={() => navigation.navigate('Settings')}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={Colors.textPrimary} />
            </AnimatedPressable>
          </View>

          <Text style={styles.heroName}>{MY_USER.username}</Text>
          <Text style={styles.heroLocation}>
            <Ionicons name="location-outline" size={12} color={Colors.textMuted} /> {MY_USER.location}
          </Text>

          <AnimatedPressable 
            activeOpacity={0.8}
            style={styles.editProfileBtn}
            onPress={() => navigation.navigate('EditProfile')}
          >
            <Text style={styles.editProfileText}>Edit Profile</Text>
          </AnimatedPressable>

          {/* Stats row */}
          <View style={styles.statsRow}>
            <AnimatedPressable 
              style={styles.statItem}
              onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
              activeOpacity={0.8}
            >
              <Text style={styles.statNumber}>{MY_USER.listingCount}</Text>
              <Text style={styles.statLabel}>LISTED</Text>
            </AnimatedPressable>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{MY_USER.followers}</Text>
              <Text style={styles.statLabel}>FOLLOWERS</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{MY_USER.following}</Text>
              <Text style={styles.statLabel}>FOLLOWING</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{MY_USER.rating}★</Text>
              <Text style={styles.statLabel}>RATING</Text>
            </View>
          </View>
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

        {/* ── My Wardrobe Preview ── */}
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
                <Image source={{ uri: item.images[0] }} style={styles.wardrobeImage} />
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

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { paddingBottom: 120 },

  // Hero
  heroSection: {
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 28,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  avatarWrap: { position: 'relative' },
  heroAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
    borderColor: '#222',
  },
  verifiedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 2,
  },
  settingsBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 4,
    alignSelf: 'flex-start',
  },
  heroLocation: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  editProfileBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: '#111',
  },
  editProfileText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 16,
    marginTop: 24,
    width: '100%',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#2a2a2a',
  },

  // Quick Access
  quickAccessCard: {
    marginHorizontal: 20,
    backgroundColor: '#111',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  quickItem: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 20,
  },
  quickIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    borderWidth: 1,
  },
  quickLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
  },
  quickValue: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
    marginTop: 2,
  },

  // Portfolio Summary
  portfolioSummaryCard: {
    marginHorizontal: 20,
    backgroundColor: '#111',
    borderRadius: 24,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#24313b',
  },
  portfolioSummaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  portfolioSummaryLabel: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: TEAL,
    letterSpacing: 1.2,
  },
  portfolioSummaryLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  portfolioSummaryLinkText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
  },
  portfolioSummaryValue: {
    fontSize: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
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
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  portfolioSummaryPnl: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  portfolioPnlUp: {
    color: '#8de5dc',
  },
  portfolioPnlDown: {
    color: '#ff9d9d',
  },
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
    fontFamily: 'Inter_700Bold',
  },

  // Wardrobe
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
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  wardrobeTitle: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.3,
  },
  viewAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewAllText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
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
  wardrobeImage: {
    width: 140,
    height: 180,
    borderRadius: 16,
    backgroundColor: Colors.surface,
  },
  wardrobeInfo: {
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  wardrobePrice: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  wardrobeBrand: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 2,
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
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },

  // Badges
  badgesCard: {
    marginHorizontal: 20,
    backgroundColor: '#111',
    borderRadius: 24,
    padding: 20,
    marginBottom: 16,
  },
  badgesSectionLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: TEAL,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  badgesTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 20,
  },
  badgeRow: { flexDirection: 'row', gap: 16 },
  badgeItem: { alignItems: 'center', gap: 8 },
  badgeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  badgeCircleEarned: {
    borderColor: TEAL + '60',
    backgroundColor: TEAL + '15',
  },
  badgeLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
    maxWidth: 64,
  },
  badgeLabelEarned: {
    color: TEAL,
  },
});
