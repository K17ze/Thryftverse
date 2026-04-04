import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Confetti } from '../components/Confetti';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { CachedImage } from '../components/CachedImage';
import { MY_USER } from '../data/mockData';
import { getBackendSyncStatus } from '../utils/syncStatus';

type Props = StackScreenProps<RootStackParamList, 'ListingSuccess'>;

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = Colors.card;
const PANEL_ALT_BG = Colors.cardAlt;
const PANEL_BORDER = Colors.border;
const BADGE_BG = Colors.accent;
const BADGE_TEXT = Colors.textInverse;

export default function ListingSuccessScreen({ navigation, route }: Props) {
  const { formatFromFiat } = useFormattedPrice();
  const { source, isSyncing, lastError, refreshListings } = useBackendData();
  const bumpFeeLabel = formatFromFiat(1.99, 'GBP', { displayMode: 'fiat' });
  const listingTitle = route.params?.title || 'Your listing';
  const listingPrice =
    typeof route.params?.price === 'number'
      ? formatFromFiat(route.params.price, 'GBP', { displayMode: 'fiat' })
      : null;
  const listingCategory = route.params?.categoryId;
  const listingPhoto = route.params?.photoUri;

  const publishStatus = React.useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
        labels: {
          syncing: 'Syncing feed',
          live: 'Live in feed',
          error: 'Queued locally',
        },
      }),
    [isSyncing, lastError, source],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      <Confetti />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Celebration Header */}
        <View style={styles.heroSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark" size={64} color={Colors.accent} />
          </View>
          <Text style={styles.heroBigText}>It's Live.</Text>
          <Text style={styles.heroSubText}>Your item is now visible to the community.</Text>
        </View>

        <View style={styles.syncCard}>
          <View style={styles.syncTopRow}>
            <SyncStatusPill tone={publishStatus.tone} label={publishStatus.label} compact />
          </View>
          <Text style={styles.syncHint}>
            {lastError
              ? 'Feed indexing is delayed. The listing remains saved and will sync automatically once connected.'
              : 'Your listing status updates automatically as marketplace sync completes.'}
          </Text>
          {lastError ? (
            <SyncRetryBanner
              message="Retry feed sync now to publish this listing faster."
              onRetry={() => void refreshListings()}
              isRetrying={isSyncing}
              telemetryContext="listing_success_publish_sync"
              containerStyle={styles.syncRetryBanner}
            />
          ) : null}
        </View>

        <View style={styles.summaryCard}>
          {listingPhoto ? (
            <CachedImage
              uri={listingPhoto}
              style={styles.summaryImage}
              containerStyle={styles.summaryImageWrap}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.summaryImageWrap, styles.summaryImageFallback]}>
              <Ionicons name="bag-handle-outline" size={20} color={Colors.textMuted} />
            </View>
          )}
          <View style={styles.summaryBody}>
            <Text style={styles.summaryLabel}>Published listing</Text>
            <Text style={styles.summaryTitle} numberOfLines={2}>
              {listingTitle}
            </Text>
            <Text style={styles.summaryMeta}>
              {listingPrice || 'Price pending'}
              {listingCategory ? ` • ${listingCategory}` : ''}
            </Text>
          </View>
        </View>

        {/* Promotion Upsell Card */}
        <View style={styles.promoCard}>
          <View style={styles.promoBadge}>
            <Ionicons name="flash" size={12} color={BADGE_TEXT} />
            <Text style={styles.promoBadgeText}>Sell 3x Faster</Text>
          </View>
          <Text style={styles.promoTitle}>Bump your listing</Text>
          <Text style={styles.promoDesc}>
            Push your item to the top of the feed and search results for 3 days.
          </Text>

          <AnimatedPressable
            style={styles.bumpBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('CreatePoster')}
          >
            <Text style={styles.bumpBtnText}>Promote for {bumpFeeLabel}</Text>
          </AnimatedPressable>
        </View>

        {/* Standard Actions */}
        <AnimatedPressable 
          style={styles.actionRowBtn} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('UserProfile', { userId: MY_USER.id, isMe: true })}
        >
          <View style={styles.actionLeft}>
            <View style={styles.actionIconBox}>
              <Ionicons name="eye-outline" size={20} color={Colors.textPrimary} />
            </View>
            <Text style={styles.actionText}>View my listing</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

        <AnimatedPressable 
          style={styles.actionRowBtn} 
          activeOpacity={0.8}
          onPress={() => navigation.replace('MainTabs')}
        >
          <View style={styles.actionLeft}>
            <View style={styles.actionIconBox}>
              <Ionicons name="home-outline" size={20} color={Colors.textPrimary} />
            </View>
            <Text style={styles.actionText}>Back to Home</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  
  content: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 60 },

  heroSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: PANEL_ALT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  heroBigText: {
    fontSize: 48,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -2,
    marginBottom: 8,
  },
  heroSubText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
  syncCard: {
    marginBottom: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  syncTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  syncHint: {
    marginTop: 8,
    fontSize: 12,
    lineHeight: 17,
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
  },
  syncRetryBanner: {
    marginTop: 10,
  },
  summaryCard: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 24,
  },
  summaryImageWrap: {
    width: 62,
    height: 78,
    borderRadius: 12,
    backgroundColor: PANEL_ALT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  summaryImage: {
    width: '100%',
    height: '100%',
  },
  summaryImageFallback: {
    backgroundColor: PANEL_ALT_BG,
  },
  summaryBody: {
    flex: 1,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryTitle: {
    marginTop: 4,
    color: Colors.textPrimary,
    fontSize: 15,
    lineHeight: 20,
    fontFamily: 'Inter_700Bold',
  },
  summaryMeta: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },

  promoCard: {
    backgroundColor: PANEL_BG,
    borderRadius: 24,
    padding: 24,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  promoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: BADGE_BG,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  promoBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: BADGE_TEXT, textTransform: 'uppercase', letterSpacing: 0.5 },
  promoTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  promoDesc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, lineHeight: 22, marginBottom: 24 },
  
  bumpBtn: {
    backgroundColor: Colors.textPrimary,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bumpBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },

  actionRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: PANEL_ALT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
});
