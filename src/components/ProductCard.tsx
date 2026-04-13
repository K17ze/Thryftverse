import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';
import { Listing, MOCK_USERS } from '../data/mockData';
import { mockFind } from '../utils/mockGate';
import { useStore } from '../store/useStore';
import { AnimatedHeart } from './AnimatedHeart';
import { AnimatedPressable } from './AnimatedPressable';
import { CachedImage } from './CachedImage';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { Ionicons } from '@expo/vector-icons';
import { isVideoUri } from '../utils/media';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;
const IS_LIGHT = ActiveTheme === 'light';
const CHIP_BG = IS_LIGHT ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.6)';
const CHIP_TEXT = IS_LIGHT ? '#3a3028' : '#fff';

interface Props {
  item: Listing;
  onPress: () => void;
  compact?: boolean;
}

export function ProductCard({ item, onPress, compact }: Props) {
  const isFav = useStore((state) => state.isWishlisted(item.id));
  const toggleFav = useStore((state) => state.toggleWishlist);
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const seller = mockFind(MOCK_USERS, (u) => u.id === item.sellerId) || MOCK_USERS[0];
  const hasVideoMedia = item.images.some((uri) => isVideoUri(uri));
  const hasMultipleMedia = item.images.length > 1;

  const handleToggle = () => {
    toggleFav(item.id);
    if (!isFav) {
      show('Added to wishlist ♥', 'success');
    }
  };

  const conditionLabel =
    item.condition === 'New with tags' ? 'NEW' :
    item.condition === 'Very good' ? 'MINT' :
    item.condition === 'Good' ? 'GOOD' : undefined;

  return (
    <AnimatedPressable style={[styles.container, compact && styles.containerCompact]} onPress={onPress} accessibilityLabel={`${item.title} by ${item.brand}, ${formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}${item.isSold ? ', sold' : ''}`}>
      <View style={[styles.imageContainer, compact && styles.imageContainerCompact]}>
        <CachedImage
          uri={item.images[0]}
          style={styles.image}
          contentFit="cover"
          priority={compact ? 'low' : 'normal'}
        />

        {/* Sold overlay */}
        {item.isSold && (
          <View style={styles.soldOverlay}>
            <Text style={styles.soldText}>SOLD</Text>
          </View>
        )}

        {/* Condition chip - top left */}
        {conditionLabel && !item.isSold && (
          <View style={styles.conditionChip}>
            <Text style={styles.conditionText}>{conditionLabel}</Text>
          </View>
        )}

        {/* Multi-image indicator - top right */}
        {(hasMultipleMedia || hasVideoMedia) && (
          <View style={styles.multiImageBadge}>
            <Ionicons name={hasVideoMedia ? 'videocam-outline' : 'images-outline'} size={11} color="#fff" />
          </View>
        )}

        {/* Animated Favourite Button */}
        <View style={styles.favBtn}>
          <AnimatedHeart
            isActive={isFav}
            onToggle={handleToggle}
            size={18}
            activeColor={Colors.danger}
            inactiveColor="#ffffff"
          />
        </View>

        {/* Seller avatar - bottom left */}
        <View style={styles.sellerAvatarWrap}>
          <CachedImage
            uri={seller.avatar}
            style={styles.sellerAvatar}
            containerStyle={styles.sellerAvatarContainer}
            contentFit="cover"
            transition={200}
          />
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.price}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        <Text style={styles.brand} numberOfLines={1}>@{item.brand.toLowerCase()}</Text>
        <View style={styles.engagementRow}>
          <View style={styles.engagementItem}>
            <Ionicons name="heart" size={10} color={Colors.textMuted} />
            <Text style={styles.engagementText}>{item.likes}</Text>
          </View>
          {item.views !== undefined && (
            <View style={styles.engagementItem}>
              <Ionicons name="eye-outline" size={10} color={Colors.textMuted} />
              <Text style={styles.engagementText}>{item.views}</Text>
            </View>
          )}
        </View>
      </View>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    backgroundColor: Colors.background,
    marginBottom: 20,
  },
  containerCompact: {
    marginBottom: 12,
  },
  imageContainer: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.4,
    backgroundColor: Colors.surface,
    borderRadius: 20,
    overflow: 'hidden',
  },
  imageContainerCompact: {
    height: CARD_WIDTH * 1.2,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  soldOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soldText: {
    color: Colors.textPrimary,
    fontFamily: Typography.family.bold,
    fontSize: Typography.size.caption + 2,
    letterSpacing: Typography.tracking.caps,
  },
  conditionChip: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: CHIP_BG,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  conditionText: {
    color: CHIP_TEXT,
    fontSize: Typography.size.micro,
    fontFamily: Typography.family.bold,
    letterSpacing: Typography.tracking.caps,
  },
  multiImageBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  price: {
    color: Colors.textPrimary,
    fontSize: Typography.size.body,
    fontFamily: Typography.family.semibold,
    letterSpacing: Typography.tracking.normal,
    marginBottom: 2,
  },
  brand: {
    color: Colors.textSecondary,
    fontSize: Typography.size.caption,
    fontFamily: Typography.family.regular,
    letterSpacing: Typography.tracking.wide,
  },
  engagementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  engagementItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  engagementText: {
    color: Colors.textMuted,
    fontSize: Typography.size.micro,
    fontFamily: Typography.family.medium,
  },
  favBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerAvatarWrap: {
    position: 'absolute',
    bottom: 8,
    left: 8,
  },
  sellerAvatarContainer: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  sellerAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 13,
  },
});
