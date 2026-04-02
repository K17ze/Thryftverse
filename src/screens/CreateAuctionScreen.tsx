import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  Image,
  FlatList
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import type { AuctionMarketItem } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useCurrencyContext } from '../context/CurrencyContext';
import { toFiat, toIze } from '../utils/currency';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;

const AUCTION_WINDOW_HOURS = 6;
const START_WINDOWS = [
  { label: 'Now', minutes: 0 },
  { label: '30m', minutes: 30 },
  { label: '1h', minutes: 60 },
  { label: '3h', minutes: 180 },
];

export default function CreateAuctionScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { currencyCode, goldRates } = useCurrencyContext();
  const { listings } = useBackendData();

  const currentUser = useStore((state) => state.currentUser);
  const addAuction = useStore((state) => state.addAuction);

  const sellerId = currentUser?.id ?? MOCK_USERS[0]?.id ?? 'u1';

  const sellerListings = React.useMemo(() => {
    const sourceListings = listings.length ? listings : MOCK_LISTINGS;
    const own = sourceListings.filter((item) => item.sellerId === sellerId);
    return own.length ? own : sourceListings.slice(0, 12);
  }, [listings, sellerId]);

  const [selectedListingId, setSelectedListingId] = React.useState(sellerListings[0]?.id ?? '');
  const [startInMinutes, setStartInMinutes] = React.useState(0);
  const [startingBidInput, setStartingBidInput] = React.useState('');
  const [buyNowEnabled, setBuyNowEnabled] = React.useState(true);
  const [buyNowInput, setBuyNowInput] = React.useState('');

  const fromGbpToDisplay = React.useCallback(
    (amountGbp: number) => {
      if (currencyCode === 'GBP') {
        return amountGbp;
      }
      const amountIze = toIze(amountGbp, 'GBP', goldRates);
      return toFiat(amountIze, currencyCode, goldRates);
    },
    [currencyCode, goldRates]
  );

  const fromDisplayToGbp = React.useCallback(
    (amountDisplay: number) => {
      if (currencyCode === 'GBP') {
        return amountDisplay;
      }
      const amountIze = toIze(amountDisplay, currencyCode, goldRates);
      return toFiat(amountIze, 'GBP', goldRates);
    },
    [currencyCode, goldRates]
  );

  React.useEffect(() => {
    if (!sellerListings.length) {
      return;
    }

    if (!sellerListings.some((item) => item.id === selectedListingId)) {
      setSelectedListingId(sellerListings[0].id);
    }
  }, [selectedListingId, sellerListings]);

  const selectedListing = React.useMemo(
    () => sellerListings.find((item) => item.id === selectedListingId),
    [selectedListingId, sellerListings]
  );

  React.useEffect(() => {
    if (!selectedListing) {
      return;
    }

    if (!startingBidInput) {
      const defaultStartingBid = Math.max(1, Math.round(selectedListing.price * 0.8));
      const defaultStartingBidDisplay = fromGbpToDisplay(defaultStartingBid);
      setStartingBidInput((Number.isFinite(defaultStartingBidDisplay) ? defaultStartingBidDisplay : defaultStartingBid).toFixed(2));
    }

    if (!buyNowInput) {
      const buyNowDisplay = fromGbpToDisplay(selectedListing.price);
      setBuyNowInput((Number.isFinite(buyNowDisplay) ? buyNowDisplay : selectedListing.price).toFixed(2));
    }
  }, [buyNowInput, fromGbpToDisplay, selectedListing, startingBidInput]);

  const launchAuction = () => {
    if (!selectedListing) {
      show('Select a listing to launch', 'error');
      return;
    }

    const startingBidDisplay = Number(startingBidInput);
    const startingBid = fromDisplayToGbp(startingBidDisplay);
    if (!Number.isFinite(startingBid) || startingBid <= 0) {
      show('Enter a valid starting bid', 'error');
      return;
    }

    let buyNowPrice: number | undefined;
    if (buyNowEnabled) {
      buyNowPrice = fromDisplayToGbp(Number(buyNowInput));
      if (!Number.isFinite(buyNowPrice) || buyNowPrice <= startingBid) {
        show('Buy now must be greater than starting bid', 'error');
        return;
      }
    }

    const now = Date.now();
    const startsAtMs = now + startInMinutes * 60 * 1000;
    const endsAtMs = startsAtMs + AUCTION_WINDOW_HOURS * 60 * 60 * 1000;

    const newAuction: AuctionMarketItem = {
      id: `a_user_${now}`,
      listingId: selectedListing.id,
      sellerId,
      title: selectedListing.title,
      image: selectedListing.images[0] ?? 'https://picsum.photos/seed/new-auction/500/700',
      startsAt: new Date(startsAtMs).toISOString(),
      endsAt: new Date(endsAtMs).toISOString(),
      startingBid,
      currentBid: startingBid,
      bidCount: 0,
      ...(buyNowPrice ? { buyNowPrice } : {}),
    };

    addAuction(newAuction);
    show(startInMinutes > 0 ? 'Auction scheduled successfully' : 'Auction is now live', 'success');
    navigation.goBack();
  };

  const renderListingCard = ({ item }: { item: Listing }) => {
    const selected = item.id === selectedListingId;

    return (
      <AnimatedPressable
        style={[styles.listingCard, selected && styles.listingCardSelected]}
        onPress={() => setSelectedListingId(item.id)}
        activeOpacity={0.9}
      >
        <Image source={{ uri: item.images[0] }} style={styles.listingImage} />
        <View style={styles.listingMeta}>
          <Text style={styles.listingTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.listingPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        </View>
        {selected ? (
          <View style={styles.selectedTick}>
            <Ionicons name="checkmark" size={12} color={Colors.background} />
          </View>
        ) : null}
      </AnimatedPressable>
    );
  };

  const previewImage = selectedListing?.images[0] ?? 'https://picsum.photos/seed/auction-preview/500/700';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.closeBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="close" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>

        <View>
          <Text style={styles.headerLabel}>SELLER STUDIO</Text>
          <Text style={styles.headerTitle}>Launch Auction</Text>
        </View>

        <AnimatedPressable style={styles.launchBtn} onPress={launchAuction} activeOpacity={0.9}>
          <Text style={styles.launchBtnText}>Launch</Text>
        </AnimatedPressable>
      </View>

      <View style={styles.content}>
        <View style={styles.previewCard}>
          <Image source={{ uri: previewImage }} style={styles.previewImage} />
          <View style={styles.previewOverlay}>
            <Text style={styles.previewTitle} numberOfLines={1}>{selectedListing?.title ?? 'Select listing'}</Text>
            <Text style={styles.previewMeta}>Window: {AUCTION_WINDOW_HOURS}h</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Auction Start</Text>
          <View style={styles.windowRow}>
            {START_WINDOWS.map((window) => {
              const active = startInMinutes === window.minutes;
              return (
                <AnimatedPressable
                  key={window.label}
                  style={[styles.windowChip, active && styles.windowChipActive]}
                  activeOpacity={0.9}
                  onPress={() => setStartInMinutes(window.minutes)}
                >
                  <Text style={[styles.windowChipText, active && styles.windowChipTextActive]}>{window.label}</Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <Text style={styles.inputLabel}>Starting Bid ({currencyCode})</Text>
          <TextInput
            style={styles.input}
            value={startingBidInput}
            onChangeText={setStartingBidInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
          />

          <View style={styles.buyNowRow}>
            <Text style={styles.inputLabel}>Enable Buy Now</Text>
            <View style={styles.toggleWrap}>
              <AnimatedPressable
                style={[styles.toggleBtn, buyNowEnabled && styles.toggleBtnActive]}
                onPress={() => setBuyNowEnabled(true)}
                activeOpacity={0.9}
              >
                <Text style={[styles.toggleText, buyNowEnabled && styles.toggleTextActive]}>On</Text>
              </AnimatedPressable>
              <AnimatedPressable
                style={[styles.toggleBtn, !buyNowEnabled && styles.toggleBtnActive]}
                onPress={() => setBuyNowEnabled(false)}
                activeOpacity={0.9}
              >
                <Text style={[styles.toggleText, !buyNowEnabled && styles.toggleTextActive]}>Off</Text>
              </AnimatedPressable>
            </View>
          </View>

          {buyNowEnabled ? (
            <>
              <Text style={styles.inputLabel}>Buy Now Price ({currencyCode})</Text>
              <TextInput
                style={styles.input}
                value={buyNowInput}
                onChangeText={setBuyNowInput}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={Colors.textMuted}
              />
            </>
          ) : null}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Attach Listing</Text>
            <Text style={styles.sectionHint}>{sellerListings.length} available</Text>
          </View>

          <FlatList
            data={sellerListings}
            horizontal
            keyExtractor={(item) => item.id}
            renderItem={renderListingCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listingsContent}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  headerLabel: {
    color: '#e8dcc8',
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  launchBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  launchBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  previewCard: {
    height: 188,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 16,
    backgroundColor: '#121212',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  previewTitle: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  previewMeta: {
    marginTop: 3,
    color: '#8fdcd4',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  section: {
    marginBottom: 15,
  },
  sectionHeaderRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  windowRow: {
    flexDirection: 'row',
    gap: 8,
  },
  windowChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2d2d2d',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#141414',
  },
  windowChipActive: {
    borderColor: '#e8dcc8',
    backgroundColor: '#162523',
  },
  windowChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  windowChipTextActive: {
    color: '#e8dcc8',
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: '#2d2d2d',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    backgroundColor: '#111111',
    marginBottom: 10,
  },
  buyNowRow: {
    marginTop: 2,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleWrap: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#2d2d2d',
    borderRadius: 12,
    overflow: 'hidden',
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#131313',
  },
  toggleBtnActive: {
    backgroundColor: Colors.accent,
  },
  toggleText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  toggleTextActive: {
    color: Colors.background,
  },
  listingsContent: {
    gap: 8,
  },
  listingCard: {
    width: 156,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2d2d2d',
    backgroundColor: '#121212',
  },
  listingCardSelected: {
    borderColor: '#e8dcc8',
    backgroundColor: '#15201f',
  },
  listingImage: {
    width: '100%',
    height: 92,
  },
  listingMeta: {
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  listingTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  listingPrice: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  selectedTick: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
});
