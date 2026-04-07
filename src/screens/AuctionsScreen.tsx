import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  Modal,
  TextInput
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import {
  AuctionMarketItem,
  AuctionViewModel,
  formatCompact,
  formatCountdown,
  getAuctionMarket,
  getUserLabel,
} from '../data/tradeHub';
import { getFreshPosters } from '../data/posters';
import { useToast } from '../context/ToastContext';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store/useStore';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { parseApiError } from '../lib/apiClient';
import {
  convertDisplayToGbpAmount,
  getSuggestedBidDisplayAmount,
  sanitizeDecimalInput,
} from '../utils/currencyAuthoringFlows';
import { listAuctions, placeAuctionBid as placeAuctionBidRemote } from '../services/marketApi';

type NavT = StackNavigationProp<RootStackParamList>;
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_MUTED_BG = IS_LIGHT ? '#f1ede6' : '#151515';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2f2f2f';
const PANEL_BORDER_STRONG = IS_LIGHT ? '#cec5b8' : '#3a342b';
const PANEL_TINT_BG = IS_LIGHT ? '#ece4d8' : '#1b1712';
const PANEL_TINT_BORDER = IS_LIGHT ? '#d0c3af' : '#4f4638';

export default function AuctionsScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const currentUser = useStore((state) => state.currentUser);
  const customPosters = useStore((state) => state.customPosters);
  const customAuctions = useStore((state) => state.customAuctions);
  const auctionRuntime = useStore((state) => state.auctionRuntime);
  const settleExpiredAuctions = useStore((state) => state.settleExpiredAuctions);

  const actingUserId = currentUser?.id ?? 'u1';

  const [nowTs, setNowTs] = React.useState(Date.now());
  const [refreshing, setRefreshing] = React.useState(false);
  const [bidComposerVisible, setBidComposerVisible] = React.useState(false);
  const [selectedBidAuction, setSelectedBidAuction] = React.useState<AuctionViewModel | null>(null);
  const [bidInput, setBidInput] = React.useState('');
  const [remoteAuctions, setRemoteAuctions] = React.useState<AuctionMarketItem[]>([]);
  const [isSyncingAuctions, setIsSyncingAuctions] = React.useState(false);
  const [syncError, setSyncError] = React.useState<string | null>(null);
  const [isSubmittingBid, setIsSubmittingBid] = React.useState(false);
  const [buyNowAuctionId, setBuyNowAuctionId] = React.useState<string | null>(null);
  const [watchedAuctionIds, setWatchedAuctionIds] = React.useState<Set<string>>(() => new Set());

  const syncAuctions = React.useCallback(async () => {
    setIsSyncingAuctions(true);
    try {
      const items = await listAuctions({ limit: 120 });
      const mapped: AuctionMarketItem[] = items.map((item) => ({
        id: item.id,
        listingId: item.listingId,
        sellerId: item.sellerId,
        title: item.title,
        image: item.imageUrl ?? `https://picsum.photos/seed/${item.id}/500/700`,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        startingBid: item.startingBidGbp,
        currentBid: item.currentBidGbp,
        bidCount: item.bidCount,
        buyNowPrice: item.buyNowPriceGbp ?? undefined,
      }));
      setRemoteAuctions(mapped);
      setSyncError(null);
    } catch (error) {
      setSyncError((error as Error).message || 'Unable to sync auctions feed');
      // Keep local market state when backend sync is unavailable.
    } finally {
      setIsSyncingAuctions(false);
    }
  }, []);

  React.useEffect(() => {
    const intervalId = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);

  React.useEffect(() => {
    void syncAuctions();
  }, [syncAuctions]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setNowTs(Date.now());
    await syncAuctions();
    setRefreshing(false);
  };

  const baseAuctions = React.useMemo(() => {
    const merged = new Map<string, AuctionMarketItem>();

    for (const item of remoteAuctions) {
      merged.set(item.id, item);
    }

    for (const item of customAuctions) {
      merged.set(item.id, item);
    }

    return [...merged.values()];
  }, [customAuctions, remoteAuctions]);

  const marketAuctions = React.useMemo(() => getAuctionMarket(nowTs, baseAuctions), [baseAuctions, nowTs]);

  const auctions = React.useMemo(
    () =>
      marketAuctions.map((item) => {
        const runtime = auctionRuntime[item.id];
        if (!runtime) {
          return item;
        }

        const isClosed = !!runtime.closedAtMs;
        return {
          ...item,
          lifecycle: isClosed ? 'ended' : item.lifecycle,
          msToEnd: isClosed ? 0 : item.msToEnd,
          progress: isClosed ? 1 : item.progress,
          currentBid: runtime.currentBid,
          bidCount: runtime.bidCount,
        };
      }),
    [auctionRuntime, marketAuctions]
  );

  React.useEffect(() => {
    settleExpiredAuctions(auctions);
  }, [auctions, settleExpiredAuctions]);

  const liveAuctions = React.useMemo(
    () => auctions.filter((item) => item.lifecycle === 'live'),
    [auctions]
  );

  const upcomingAuctions = React.useMemo(
    () => auctions.filter((item) => item.lifecycle === 'upcoming'),
    [auctions]
  );

  const totalLiveBids = React.useMemo(
    () => liveAuctions.reduce((sum, item) => sum + item.bidCount, 0),
    [liveAuctions]
  );

  const adPosters = React.useMemo(() => {
    const upcomingListingIds = new Set(upcomingAuctions.map((item) => item.listingId));
    return getFreshPosters(nowTs, 24, customPosters).filter((poster) => upcomingListingIds.has(poster.listingId));
  }, [customPosters, nowTs, upcomingAuctions]);

  const marketStatus = React.useMemo(() => {
    if (isSyncingAuctions) {
      return {
        tone: 'syncing' as const,
        label: 'Syncing',
      };
    }

    if (syncError) {
      return {
        tone: 'offline' as const,
        label: 'Reconnecting',
      };
    }

    if (remoteAuctions.length > 0) {
      return {
        tone: 'live' as const,
        label: 'Live backend',
      };
    }

    if (auctions.length > 0) {
      return {
        tone: 'offline' as const,
        label: 'Local mode',
      };
    }

    return {
      tone: 'offline' as const,
      label: 'No feed yet',
    };
  }, [auctions.length, isSyncingAuctions, remoteAuctions.length, syncError]);

  const openBidComposer = (auction: AuctionViewModel) => {
    const suggestedDisplayBid = getSuggestedBidDisplayAmount(
      auction.currentBid,
      currencyCode,
      goldRates
    );
    setSelectedBidAuction(auction);
    setBidInput(suggestedDisplayBid.toFixed(2));
    setBidComposerVisible(true);
  };

  const handleToggleWatch = (auction: AuctionViewModel) => {
    const isWatching = watchedAuctionIds.has(auction.id);
    setWatchedAuctionIds((current) => {
      const next = new Set(current);
      if (next.has(auction.id)) {
        next.delete(auction.id);
      } else {
        next.add(auction.id);
      }
      return next;
    });

    show(
      isWatching ? `Removed ${auction.title} from watchlist` : `Watching ${auction.title}`,
      'info'
    );
  };

  const closeBidComposer = () => {
    setBidComposerVisible(false);
    setSelectedBidAuction(null);
    setBidInput('');
  };

  const bumpBid = (pct: number) => {
    if (!selectedBidAuction) {
      return;
    }

    const base = Number(bidInput);
    const current = Number.isFinite(base) && base > 0 ? base : selectedBidAuction.currentBid;
    const nextValue = Number((current * (1 + pct)).toFixed(2));
    setBidInput(nextValue.toFixed(2));
  };

  const submitBid = async () => {
    if (!selectedBidAuction) {
      return;
    }

    if (isSubmittingBid) {
      return;
    }

    const amount = Number(bidInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      show('Enter a valid bid amount', 'error');
      return;
    }

    const amountInGbp = convertDisplayToGbpAmount(amount, currencyCode, goldRates);
    if (!Number.isFinite(amountInGbp) || amountInGbp <= 0) {
      show('Enter a valid bid amount', 'error');
      return;
    }

    if (amountInGbp <= selectedBidAuction.currentBid) {
      show(
        `Bid must be above ${formatFromFiat(selectedBidAuction.currentBid, 'GBP', { displayMode: 'fiat' })}`,
        'error'
      );
      return;
    }

    const roundedAmount = Number(amountInGbp.toFixed(2));
    setIsSubmittingBid(true);

    try {
      const remoteResult = await placeAuctionBidRemote(selectedBidAuction.id, {
        bidderId: actingUserId,
        amountGbp: roundedAmount,
      });

      await syncAuctions();
      setNowTs(Date.now());
      show(
        `Bid placed on ${selectedBidAuction.title} at ${formatFromFiat(roundedAmount, 'GBP', { displayMode: 'fiat' })}`,
        'success'
      );

      if (remoteResult.aml?.alertId) {
        show('Bid is flagged for AML review.', 'info');
      }

      closeBidComposer();
    } catch (error) {
      const parsedError = parseApiError(error, 'Unable to place bid');
      show(parsedError.message, 'error');
    } finally {
      setIsSubmittingBid(false);
    }
  };

  const handleBuyNow = async (auction: AuctionViewModel) => {
    if (!auction.buyNowPrice || buyNowAuctionId) {
      return;
    }

    setBuyNowAuctionId(auction.id);

    try {
      const remoteResult = await placeAuctionBidRemote(auction.id, {
        bidderId: actingUserId,
        amountGbp: Number(auction.buyNowPrice.toFixed(2)),
      });

      await syncAuctions();
      show(`You won ${auction.title}`, 'success');

      if (remoteResult.aml?.alertId) {
        show('Buy now is flagged for AML review.', 'info');
      }

      navigation.navigate('Checkout', { itemId: auction.listingId });
    } catch (error) {
      const parsedError = parseApiError(error, 'Unable to complete buy now');
      show(parsedError.message, 'error');
    } finally {
      setBuyNowAuctionId(null);
    }
  };

  const renderPosterAds = () => {
    if (!adPosters.length) {
      return null;
    }

    return (
      <View style={styles.sectionWrap}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Upcoming Auction Posters</Text>
          <Text style={styles.sectionHint}>Story-style ad placements</Text>
        </View>

        <FlatList
          data={adPosters}
          horizontal
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.posterListContent}
          renderItem={({ item }) => (
            <AnimatedPressable
              style={styles.posterCard}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('PosterViewer', { posterId: item.id })}
            >
              <CachedImage uri={item.image} style={styles.posterImage} containerStyle={{ width: 56, height: 56, borderRadius: 10 }} contentFit="cover" />
              <View style={styles.posterOverlay}>
                <Text style={styles.posterSeller} numberOfLines={1}>
                  @{item.uploader?.username ?? 'seller'}
                </Text>
                <Text style={styles.posterTime}>{item.remainingHours}h</Text>
              </View>
            </AnimatedPressable>
          )}
        />
      </View>
    );
  };

  const renderUpcomingStrip = () => {
    if (!upcomingAuctions.length) {
      return null;
    }

    return (
      <View style={styles.sectionWrap}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Starting Soon</Text>
          <Text style={styles.sectionHint}>6h windows</Text>
        </View>

        <FlatList
          data={upcomingAuctions}
          horizontal
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.upcomingListContent}
          renderItem={({ item }) => (
            <AnimatedPressable
              style={styles.upcomingCard}
              activeOpacity={0.9}
              onPress={() => navigation.navigate('ItemDetail', { itemId: item.listingId })}
            >
              <CachedImage uri={item.image} style={styles.upcomingImage} containerStyle={{ width: '100%', height: 120, borderRadius: 14 }} contentFit="cover" />
              <View style={styles.upcomingMeta}>
                <Text style={styles.upcomingTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.upcomingTimer}>Starts in {formatCountdown(item.msToStart)}</Text>
                <Text style={styles.upcomingBid}>
                  Starting bid {formatFromFiat(item.startingBid, 'GBP', { displayMode: 'fiat' })}
                </Text>
              </View>
            </AnimatedPressable>
          )}
        />
      </View>
    );
  };

  const renderHeader = () => (
    <View>
      <View style={styles.heroCard}>
        <View style={styles.heroTitleRow}>
          <Ionicons name="flash-outline" size={16} color={BRAND} />
          <Text style={styles.heroTitle}>Auctions Arena</Text>
        </View>
        <Text style={styles.heroSubtitle}>
          Timed 6-hour drops with live bids, instant buyouts, and transparent market tape settlement.
        </Text>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{liveAuctions.length}</Text>
          <Text style={styles.metricLabel}>Live</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{upcomingAuctions.length}</Text>
          <Text style={styles.metricLabel}>Upcoming</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricValue}>{formatCompact(totalLiveBids)}</Text>
          <Text style={styles.metricLabel}>Bids</Text>
        </View>
      </View>

      <View style={styles.rulesCard}>
        <Ionicons name="timer-outline" size={16} color={BRAND} />
        <Text style={styles.rulesText}>Auctions are timed fiat bidding windows (6h). Winning bids include a 3% platform charge. For fractional 1ze trading, switch to Syndicate.</Text>
      </View>

      <View style={styles.launchRow}>
        <View>
          <Text style={styles.launchTitle}>Seller Studio</Text>
          <Text style={styles.launchHint}>Launch a 6-hour auction from your listing</Text>
        </View>

        <AnimatedPressable
          style={styles.launchBtn}
          activeOpacity={0.9}
          onPress={() => navigation.navigate('CreateAuction')}
        >
          <Ionicons name="add" size={15} color={Colors.background} />
          <Text style={styles.launchBtnText}>Launch</Text>
        </AnimatedPressable>
      </View>

      {syncError ? (
        <SyncRetryBanner
          message="Live auction sync is delayed. Showing cached auction activity."
          onRetry={() => void syncAuctions()}
          isRetrying={isSyncingAuctions}
          telemetryContext="auctions_market_sync"
          containerStyle={styles.syncBanner}
          actionStyle={styles.syncBannerBtn}
        />
      ) : null}

      {renderPosterAds()}
      {renderUpcomingStrip()}

      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>Live Auctions</Text>
        <SyncStatusPill tone={marketStatus.tone} label={marketStatus.label} compact />
      </View>
    </View>
  );

  const renderLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      {Array.from({ length: 3 }).map((_, index) => (
        <View key={`auction_loading_${index}`} style={styles.loadingCard}>
          <SkeletonLoader width="100%" height={160} borderRadius={14} />
          <View style={styles.loadingCardBody}>
            <SkeletonLoader width="55%" height={14} borderRadius={7} />
            <SkeletonLoader width="35%" height={11} borderRadius={6} style={{ marginTop: 8 }} />
            <SkeletonLoader width="40%" height={18} borderRadius={9} style={{ marginTop: 12 }} />
            <SkeletonLoader width="100%" height={5} borderRadius={4} style={{ marginTop: 10 }} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderLiveAuction = ({ item }: { item: AuctionViewModel }) => {
    const isWatching = watchedAuctionIds.has(item.id);

    return (
    <AnimatedPressable
      style={styles.liveCard}
      activeOpacity={0.95}
      onPress={() => navigation.navigate('ItemDetail', { itemId: item.listingId })}
    >
      <CachedImage uri={item.image} style={styles.liveImage} containerStyle={{ width: '100%', height: 160, borderTopLeftRadius: 18, borderTopRightRadius: 18 }} contentFit="cover" />

      <View style={styles.liveBody}>
        <View style={styles.liveTopRow}>
          <View style={styles.lifecyclePill}>
            <View style={styles.liveDot} />
            <Text style={styles.lifecycleText}>LIVE</Text>
          </View>
          <Text style={styles.timerText}>{formatCountdown(item.msToEnd)}</Text>
        </View>

        <Text style={styles.liveTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.liveSeller}>by {getUserLabel(item.sellerId)}</Text>

        <View style={styles.bidRow}>
          <Text style={styles.bidLabel}>Current bid</Text>
          <Text style={styles.bidValue}>{formatFromFiat(item.currentBid, 'GBP', { displayMode: 'fiat' })}</Text>
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(6, item.progress * 100)}%` }]} />
        </View>

        <View style={styles.bidRow}>
          <Text style={styles.bidMeta}>{item.bidCount} bids</Text>
          {item.buyNowPrice ? (
            <Text style={styles.buyNowMeta}>
              Buy now {formatFromFiat(item.buyNowPrice, 'GBP', { displayMode: 'fiat' })}
            </Text>
          ) : null}
        </View>

        <View style={styles.actionRow}>
          <AnimatedPressable
            style={[styles.bidBtn, (isSubmittingBid || !!buyNowAuctionId) && styles.actionBtnDisabled]}
            onPress={() => openBidComposer(item)}
            activeOpacity={0.9}
            disabled={isSubmittingBid || !!buyNowAuctionId}
          >
            <Ionicons name="hammer-outline" size={14} color={Colors.background} />
            <Text style={styles.bidBtnText}>Place Bid</Text>
          </AnimatedPressable>

          {item.buyNowPrice ? (
            <AnimatedPressable
              style={[styles.buyBtn, buyNowAuctionId === item.id && styles.actionBtnDisabled]}
              onPress={() => void handleBuyNow(item)}
              activeOpacity={0.9}
              disabled={buyNowAuctionId === item.id || isSubmittingBid}
            >
              <Text style={styles.buyBtnText}>{buyNowAuctionId === item.id ? 'Buying...' : 'Buy Now'}</Text>
            </AnimatedPressable>
          ) : (
            <AnimatedPressable
              style={[styles.watchBtn, isWatching && styles.watchBtnActive]}
              onPress={() => handleToggleWatch(item)}
              activeOpacity={0.9}
            >
              <Text style={[styles.watchBtnText, isWatching && styles.watchBtnTextActive]}>
                {isWatching ? 'Watching' : 'Watch'}
              </Text>
            </AnimatedPressable>
          )}
        </View>
      </View>
    </AnimatedPressable>
    );
  };

  const renderBidComposer = () => {
    if (!selectedBidAuction) {
      return null;
    }

    return (
      <Modal
        visible={bidComposerVisible}
        transparent
        animationType="fade"
        onRequestClose={closeBidComposer}
      >
        <View style={styles.bidModalOverlay}>
          <AnimatedPressable style={styles.bidModalDismissLayer} activeOpacity={1} onPress={closeBidComposer} />

          <View style={styles.bidModalCard}>
            <Text style={styles.bidModalLabel}>BID COMPOSER</Text>
            <Text style={styles.bidModalTitle} numberOfLines={1}>{selectedBidAuction.title}</Text>
            <Text style={styles.bidModalHint}>
              Current bid {formatFromFiat(selectedBidAuction.currentBid, 'GBP', { displayMode: 'fiat' })}
            </Text>

            <View style={styles.bidInputWrap}>
              <Text style={styles.bidCurrency}>{currencyCode}</Text>
              <TextInput
                style={styles.bidInput}
                value={bidInput}
                onChangeText={(value) => setBidInput(sanitizeDecimalInput(value))}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
              />
            </View>

            <View style={styles.bumpRow}>
              {[0.01, 0.03, 0.05].map((pct) => (
                <AnimatedPressable
                  key={pct}
                  style={styles.bumpChip}
                  onPress={() => bumpBid(pct)}
                  activeOpacity={0.9}
                >
                  <Text style={styles.bumpChipText}>+{Math.round(pct * 100)}%</Text>
                </AnimatedPressable>
              ))}
            </View>

            <View style={styles.bidModalActions}>
              <AnimatedPressable style={styles.bidCancelBtn} onPress={closeBidComposer} activeOpacity={0.9}>
                <Text style={styles.bidCancelText}>Cancel</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.bidSubmitBtn, isSubmittingBid && styles.actionBtnDisabled]}
                onPress={() => void submitBid()}
                activeOpacity={0.9}
                disabled={isSubmittingBid}
              >
                <Text style={styles.bidSubmitText}>{isSubmittingBid ? 'Submitting...' : 'Submit Bid'}</Text>
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  return (
    <>
      <FlatList
        data={liveAuctions}
        keyExtractor={(item) => item.id}
        renderItem={renderLiveAuction}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={
          isSyncingAuctions ? (
            renderLoadingState()
          ) : (
            <EmptyState
              icon="hourglass-outline"
              title="No live auctions right now"
              subtitle="Upcoming auctions are listed above and open automatically when their 6-hour window begins."
            />
          )
        }
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={styles.liveSeparator} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={BRAND}
            colors={[BRAND]}
            progressBackgroundColor={PANEL_SOFT_BG}
          />
        }
      />
      {renderBidComposer()}
    </>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    paddingBottom: 130,
  },
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER_STRONG,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.15,
  },
  heroSubtitle: {
    marginTop: 6,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: 'Inter_500Medium',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  metricCard: {
    flex: 1,
    backgroundColor: PANEL_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingVertical: 12,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  metricValue: {
    color: Colors.textPrimary,
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
  },
  metricLabel: {
    marginTop: 2,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  rulesCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    backgroundColor: PANEL_TINT_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rulesText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    flex: 1,
    lineHeight: 17,
  },
  launchRow: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  launchTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  launchHint: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  launchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 14,
    backgroundColor: Colors.accent,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  launchBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  syncBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderColor: PANEL_BORDER,
    backgroundColor: IS_LIGHT ? '#f5ece2' : '#1a1a1a',
  },
  syncBannerBtn: {
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
  },
  sectionWrap: {
    marginBottom: 14,
  },
  sectionTitleRow: {
    paddingHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  posterListContent: {
    paddingHorizontal: 16,
    gap: 8,
  },
  posterCard: {
    width: 96,
    height: 126,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  posterSeller: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  posterTime: {
    marginTop: 2,
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
  },
  upcomingListContent: {
    paddingHorizontal: 16,
    gap: 10,
  },
  upcomingCard: {
    width: 208,
    backgroundColor: PANEL_BG,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  upcomingImage: {
    width: '100%',
    height: 110,
  },
  upcomingMeta: {
    padding: 10,
  },
  upcomingTitle: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  upcomingTimer: {
    marginTop: 6,
    color: BRAND,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  upcomingBid: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  liveSeparator: {
    height: 10,
  },
  loadingStateWrap: {
    paddingHorizontal: 16,
    gap: 10,
  },
  loadingCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    overflow: 'hidden',
  },
  loadingCardBody: {
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  liveCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
  },
  liveImage: {
    width: '100%',
    height: 172,
  },
  liveBody: {
    padding: 12,
  },
  liveTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  lifecyclePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PANEL_TINT_BG,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: BRAND,
  },
  lifecycleText: {
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  timerText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  liveTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  liveSeller: {
    marginTop: 4,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  bidRow: {
    marginTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bidLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  bidValue: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
  },
  progressTrack: {
    marginTop: 8,
    height: 5,
    borderRadius: 4,
    backgroundColor: IS_LIGHT ? '#ddd4c7' : '#1e1e1e',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: BRAND,
  },
  bidMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  buyNowMeta: {
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  actionRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  bidBtn: {
    flex: 1,
    backgroundColor: Colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  bidBtnText: {
    color: Colors.textInverse,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  buyBtn: {
    flex: 1,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyBtnText: {
    color: Colors.textInverse,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  watchBtn: {
    flex: 1,
    backgroundColor: PANEL_SOFT_BG,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watchBtnActive: {
    backgroundColor: PANEL_TINT_BG,
    borderColor: PANEL_TINT_BORDER,
  },
  watchBtnText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  watchBtnTextActive: {
    color: BRAND,
    fontFamily: 'Inter_700Bold',
  },
  bidModalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  bidModalDismissLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bidModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  bidModalLabel: {
    color: BRAND,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.8,
  },
  bidModalTitle: {
    marginTop: 5,
    color: Colors.textPrimary,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  bidModalHint: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  bidInputWrap: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 12,
    backgroundColor: PANEL_SOFT_BG,
    paddingHorizontal: 10,
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bidCurrency: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  bidInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    paddingVertical: 0,
  },
  bumpRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  bumpChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_TINT_BORDER,
    backgroundColor: PANEL_TINT_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bumpChipText: {
    color: BRAND,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  bidModalActions: {
    marginTop: 14,
    flexDirection: 'row',
    gap: 8,
  },
  bidCancelBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: PANEL_MUTED_BG,
  },
  bidCancelText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  bidSubmitBtn: {
    flex: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: Colors.accent,
  },
  bidSubmitText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
});
