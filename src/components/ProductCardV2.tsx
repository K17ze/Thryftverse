/**
 * ProductCard V2 - Depop Style (Minimal, No Container)
 * Image is the card - no border radius on images
 * Price-first hierarchy like Vinted/Depop
 */

import React from 'react';
import { View, StyleSheet, Dimensions, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Space, Radius, Layout } from '../theme/designTokens';
import { T, Price } from './ui/Text';
import { AnimatedPressable } from './AnimatedPressable';
import { CachedImage } from './CachedImage';
import { AnimatedHeart } from './AnimatedHeart';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { Listing, MOCK_USERS } from '../data/mockData';
import { mockFind } from '../utils/mockGate';
import { isVideoUri } from '../utils/media';

const ASPECT_RATIOS = [0.75, 1.0, 1.25, 1.5]; // Masonry varied heights

interface ProductCardV2Props {
  item: Listing;
  onPress: () => void;
  index?: number;
  showSeller?: boolean;
}

export function ProductCardV2({ item, onPress, index = 0, showSeller = false }: ProductCardV2Props) {
  const isFav = useStore((state) => state.isWishlisted(item.id));
  const toggleFav = useStore((state) => state.toggleWishlist);
  const { show } = useToast();
  const seller = mockFind(MOCK_USERS, (u) => u.id === item.sellerId);

  // Deterministic aspect ratio based on item id
  const aspectRatio = ASPECT_RATIOS[item.id.charCodeAt(0) % ASPECT_RATIOS.length];
  const hasVideo = item.images.some((uri) => isVideoUri(uri));
  const hasMultiple = item.images.length > 1;

  const handleToggleFav = () => {
    toggleFav(item.id);
    if (!isFav) show('Added to wishlist', 'success');
  };

  return (
    <View style={styles.container}>
      {/* Image - Full bleed, no border radius */}
      <AnimatedPressable onPress={onPress} style={styles.imageWrap}>
        <CachedImage
          uri={item.images[0]}
          style={[styles.image, { aspectRatio }]}
          contentFit="cover"
          transition={300}
        />

        {/* Sold overlay */}
        {item.isSold && (
          <View style={styles.soldOverlay}>
            <T.BodyEmphasis color={Colors.textInverse}>SOLD</T.BodyEmphasis>
          </View>
        )}

        {/* Media indicator */}
        {(hasMultiple || hasVideo) && (
          <View style={styles.mediaBadge}>
            <Ionicons
              name={hasVideo ? 'videocam' : 'images'}
              size={12}
              color={Colors.textInverse}
            />
          </View>
        )}

        {/* Favorite button */}
        <View style={styles.favBtn}>
          <AnimatedHeart
            isActive={isFav}
            onToggle={handleToggleFav}
            size={20}
            activeColor={Colors.danger}
            inactiveColor={Colors.textInverse}
          />
        </View>
      </AnimatedPressable>

      {/* Info - Tight padding like Depop */}
      <View style={styles.info}>
        <View style={styles.priceRow}>
          <Price amount={item.price} />
          {item.likes > 0 && (
            <View style={styles.likes}>
              <Ionicons name="heart" size={10} color={Colors.textMuted} />
              <T.Caption>{item.likes}</T.Caption>
            </View>
          )}
        </View>

        <T.Caption numberOfLines={1}>{item.size}</T.Caption>

        {showSeller && seller && (
          <View style={styles.sellerRow}>
            <CachedImage
              uri={seller.avatar}
              style={styles.sellerAvatar}
              contentFit="cover"
            />
            <Text style={{ fontSize: 9, color: Colors.textSecondary, fontFamily: 'Inter_500Medium' }}>@{seller.username}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

// ============================================================================
// MASONRY GRID
// ============================================================================

interface MasonryGridProps {
  items: Listing[];
  onPressItem: (item: Listing) => void;
  numColumns?: number;
}

export function MasonryGrid({ items, onPressItem, numColumns = 2 }: MasonryGridProps) {
  // Split items into columns for masonry effect
  const columns: Listing[][] = Array.from({ length: numColumns }, () => []);
  items.forEach((item, index) => {
    columns[index % numColumns].push(item);
  });

  return (
    <View style={styles.grid}>
      {columns.map((columnItems, colIndex) => (
        <View key={colIndex} style={styles.column}>
          {columnItems.map((item, index) => (
            <ProductCardV2
              key={item.id}
              item={item}
              onPress={() => onPressItem(item)}
              index={colIndex * items.length + index}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginBottom: Space.md,
  },

  // Image - No border radius, full bleed
  imageWrap: {
    position: 'relative',
  },
  image: {
    width: '100%',
    borderRadius: Radius.none, // Sharp corners like Depop
  },

  // Overlays
  soldOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaBadge: {
    position: 'absolute',
    top: Space.sm,
    right: Space.sm,
    backgroundColor: 'rgba(0,0,0,0.5)',
    width: 24,
    height: 24,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  favBtn: {
    position: 'absolute',
    bottom: Space.sm,
    right: Space.sm,
  },

  // Info - Tight padding
  info: {
    padding: Space.sm,
    gap: Space.xs,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  likes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
  },
  sellerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    marginTop: Space.xs,
  },
  sellerAvatar: {
    width: 16,
    height: 16,
    borderRadius: Radius.full,
  },

  // Grid
  grid: {
    flexDirection: 'row',
    paddingHorizontal: Space.sm,
    gap: Space.sm,
  },
  column: {
    flex: 1,
    gap: 0,
  },
});

export default ProductCardV2;
