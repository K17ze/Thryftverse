import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  StatusBar,
  Dimensions,
  FlatList,
  Share
} from 'react-native';
import Reanimated, {
  useAnimatedScrollHandler,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  withSpring,
  withTiming,
  withSequence,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, useNavigation } from '@react-navigation/native';
import { ActiveTheme, Colors } from '../constants/colors';
import { MOCK_LISTINGS, MOCK_USERS, Listing, User } from '../data/mockData';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { ImageViewer } from '../components/ImageViewer';
import { AnimatedHeart } from '../components/AnimatedHeart';
import { useToast } from '../context/ToastContext';
import { useHaptic } from '../hooks/useHaptic';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

const { width, height } = Dimensions.get('window');
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_ALT_BG = IS_LIGHT ? '#f3eee7' : '#1a1a1a';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.97)' : 'rgba(10,10,10,0.95)';
const TOP_SCRIM_BG = IS_LIGHT ? 'rgba(236,234,230,0.46)' : 'rgba(0,0,0,0.35)';

export default function ItemDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  
  const isFav = useStore(state => state.isWishlisted(route.params?.itemId));
  const toggleFav = useStore(state => state.toggleWishlist);
  const { listings } = useBackendData();

  const { itemId } = route.params || {};
  const fallbackItem = listings[0] || MOCK_LISTINGS[0];
  const item: Listing = listings.find(l => l.id === itemId) || fallbackItem;
  const seller: User = MOCK_USERS.find(u => u.id === item.sellerId) || MOCK_USERS[0];
  const sellerItems = listings.filter(l => l.sellerId === seller.id && l.id !== item.id);

  const { show } = useToast();
  const haptic = useHaptic();
  const { formatFromFiat } = useFormattedPrice();

  const handleToggleFav = () => {
    toggleFav(item.id);
    if (!isFav) {
      show('Added to wishlist ♥', 'success');
    }
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out ${item.title} on Thryftverse for ${formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}.`,
      });
    } catch {
      show('Unable to open share sheet right now.', 'error');
    }
  };

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const heroStyle = useAnimatedStyle(() => {
    const translateY = interpolate(scrollY.value, [-100, 0, height * 0.65], [-50, 0, height * 0.65 * 0.5], Extrapolation.CLAMP);
    const scale = interpolate(scrollY.value, [-100, 0], [1.2, 1], Extrapolation.CLAMP);
    return {
      transform: [{ translateY }, { scale }],
    };
  });

  // Big heart for double tap animation
  const bigHeartScale = useSharedValue(0);
  const bigHeartOpacity = useSharedValue(0);

  const handleDoubleTap = () => {
    haptic.heavy();
    if (!isFav) {
      toggleFav(item.id);
      show('Added to wishlist ♥', 'success');
    }
    
    bigHeartOpacity.value = 1;
    bigHeartScale.value = withSequence(
      withSpring(1.5, { damping: 12 }),
      withTiming(1.5, { duration: 400 }),
      withTiming(0, { duration: 200 })
    );
  };

  const bigHeartStyle = useAnimatedStyle(() => ({
    opacity: bigHeartOpacity.value,
    transform: [{ scale: bigHeartScale.value }],
  }));

  return (
    <View style={styles.container}>
      <StatusBar translucent backgroundColor="transparent" barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} />

      <Reanimated.ScrollView 
        showsVerticalScrollIndicator={false} 
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 126 }}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        
        {/* ── Image Carousel ── */}
        <Reanimated.View style={[styles.heroContainer, heroStyle]}>
          <ImageViewer images={item.images} height={height * 0.65} onDoubleTap={handleDoubleTap} itemId={item.id} />

          <View style={styles.heroTopScrim} />

          <Reanimated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 5 }, bigHeartStyle]}>
            <Ionicons name="heart" size={100} color="#fff" style={{ shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 10 }} />
          </Reanimated.View>

          {item.isSold && (
            <View style={styles.soldOverlay}>
              <Text style={styles.soldText}>SOLD</Text>
            </View>
          )}

          <View style={[styles.floatingHeader, { paddingTop: Math.max(insets.top, 20) }]}>
            <AnimatedPressable style={styles.blurBtn} onPress={() => navigation.goBack()}>
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </AnimatedPressable>
            <View style={styles.headerRight}>
              <AnimatedPressable style={styles.blurBtn} onPress={handleShare}>
                <Ionicons name="share-outline" size={24} color="#fff" />
              </AnimatedPressable>
              <View style={styles.blurBtn}>
                <AnimatedHeart
                  isActive={isFav}
                  onToggle={handleToggleFav}
                  size={24}
                  activeColor={Colors.danger}
                  inactiveColor="#fff"
                />
              </View>
            </View>
          </View>
        </Reanimated.View>

        <View style={styles.detailsContainer}>
          <Text style={styles.price}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
          <Text style={styles.brand} numberOfLines={1} ellipsizeMode="tail">{item.brand}</Text>
          {item.priceWithProtection && (
            <Text style={styles.protectionText}>
              incl. {formatFromFiat(item.priceWithProtection - item.price, 'GBP', { displayMode: 'fiat' })} Buyer Protection fee
            </Text>
          )}

          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.sizeCondition}>{item.size} • {item.condition}</Text>

          <View style={styles.descriptionBox}>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.timePosted}>Posted 2 hours ago in {seller.location}</Text>
            <View style={styles.statsRow}>
              <Ionicons name="eye-outline" size={16} color={Colors.textMuted} />
              <Text style={styles.statsText}>{item.likes * 12} Views</Text>
              <Ionicons name="heart-outline" size={16} color={Colors.textMuted} style={{ marginLeft: 12 }} />
              <Text style={styles.statsText}>{item.likes} Likes</Text>
            </View>
          </View>

          {/* ── Seller Card ── */}
          <AnimatedPressable style={styles.sellerCard} onPress={() => navigation.navigate('UserProfile', { userId: seller.id })} activeOpacity={0.8}>
            <Image source={{ uri: seller.avatar }} style={styles.sellerAvatar} />
            <View style={styles.sellerInfo}>
              <Text style={styles.sellerName}>{seller.username}</Text>
              <Text style={styles.sellerStats}>{seller.rating} ★ • {seller.reviewCount} Reviews</Text>
              <Text style={styles.sellerLastSeen}>Last seen: {seller.lastSeen}</Text>
            </View>
            <AnimatedPressable style={styles.followBtn} onPress={(e) => { e.stopPropagation(); navigation.navigate('Chat', { conversationId: `${seller.id}_${item.id}` }); }}>
              <Text style={styles.followBtnText}>Message</Text>
            </AnimatedPressable>
          </AnimatedPressable>

          {/* Restored Similar Items Feature */}
          {sellerItems.length > 0 && (
            <View style={styles.sellerItemsSection}>
              <Text style={styles.sectionTitle}>More from {seller.username}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
                {sellerItems.map(sItem => (
                  <AnimatedPressable 
                    key={sItem.id} 
                    style={styles.sellerItemCard}
                    onPress={() => navigation.push('ItemDetail', { itemId: sItem.id })}
                  >
                    <Image source={{ uri: sItem.images[0] }} style={styles.sellerItemImg} />
                    <Text style={styles.sellerItemPrice}>{formatFromFiat(sItem.price, 'GBP', { displayMode: 'fiat' })}</Text>
                  </AnimatedPressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </Reanimated.ScrollView>

      {/* ── Floating Buy Bar ── */}
      {!item.isSold && (
        <Reanimated.View style={[styles.floatingBuyBar, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <AnimatedPressable
            style={styles.buyBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('Checkout', { itemId: item.id })}
          >
            <Text style={styles.buyBtnText}>Buy Now</Text>
          </AnimatedPressable>
          <AnimatedPressable
            style={styles.offerBtn}
            activeOpacity={0.9}
            onPress={() => navigation.navigate('MakeOffer', { itemId: item.id, price: item.price, title: item.title })}
          >
            <Text style={styles.offerBtnText}>Offer</Text>
          </AnimatedPressable>
        </Reanimated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heroContainer: { width: width, height: height * 0.65, position: 'relative', backgroundColor: Colors.surface },
  heroTopScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 132, backgroundColor: TOP_SCRIM_BG },
  heroImage: { width: width, height: '100%' },
  soldOverlay: { position: 'absolute', bottom: 32, left: 20, backgroundColor: Colors.success, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  soldText: { color: Colors.textInverse, fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  floatingHeader: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, zIndex: 10 },
  headerRight: { flexDirection: 'row', gap: 12 },
  blurBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
  detailsContainer: { paddingHorizontal: 20, paddingTop: 24 },
  price: { fontSize: 40, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -1.2, marginBottom: 2 },
  brand: { fontSize: 15, fontFamily: 'Inter_700Bold', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 },
  protectionText: { fontSize: 12, color: Colors.textSecondary, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  title: { fontSize: 20, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginBottom: 12, lineHeight: 28 },
  sizeCondition: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  descriptionBox: { marginTop: 24, backgroundColor: PANEL_BG, borderWidth: 1, borderColor: PANEL_BORDER, padding: 20, borderRadius: 24 },
  description: { fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 24 },
  timePosted: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textMuted, marginTop: 12 },
  statsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  statsText: { fontSize: 12, color: Colors.textSecondary, marginLeft: 6, fontFamily: 'Inter_500Medium' },
  sellerCard: { flexDirection: 'row', alignItems: 'center', marginTop: 26, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: PANEL_BORDER, borderRadius: 20, backgroundColor: PANEL_BG, gap: 16 },
  sellerAvatar: { width: 56, height: 56, borderRadius: 28 },
  sellerInfo: { flex: 1 },
  sellerName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  sellerStats: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textMuted, marginTop: 4 },
  sellerLastSeen: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginTop: 2 },
  followBtn: { backgroundColor: PANEL_ALT_BG, borderWidth: 1, borderColor: PANEL_BORDER, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  followBtnText: { color: Colors.textPrimary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  sellerItemsSection: { marginTop: 24, paddingBottom: 32 },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 16 },
  sellerItemCard: { width: 100 },
  sellerItemImg: { width: 100, height: 130, borderRadius: 16, marginBottom: 8 },
  sellerItemPrice: { fontSize: 14, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  floatingBuyBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    backgroundColor: FOOTER_BG,
  },
  buyBtn: {
    flex: 2,
    backgroundColor: Colors.accent,
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buyBtnText: { color: Colors.textInverse, fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  offerBtn: {
    flex: 1,
    backgroundColor: PANEL_ALT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offerBtnText: { color: Colors.textPrimary, fontSize: 15, fontFamily: 'Inter_700Bold' },
});
