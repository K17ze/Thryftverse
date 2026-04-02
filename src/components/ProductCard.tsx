import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Dimensions
} from 'react-native';
import { Colors } from '../constants/colors';
import { Listing } from '../data/mockData';
import { useStore } from '../store/useStore';
import { AnimatedHeart } from './AnimatedHeart';
import { AnimatedPressable } from './AnimatedPressable';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { SharedTransitionImage } from './SharedTransitionImage';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2;

interface Props {
  item: Listing;
  onPress: () => void;
}

export function ProductCard({ item, onPress }: Props) {
  const isFav = useStore((state) => state.isWishlisted(item.id));
  const toggleFav = useStore((state) => state.toggleWishlist);
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();

  const handleToggle = () => {
    toggleFav(item.id);
    if (!isFav) {
      show('Added to wishlist ♥', 'success');
    }
  };

  return (
    <AnimatedPressable style={styles.container} onPress={onPress}>
      <View style={styles.imageContainer}>
        <SharedTransitionImage
          source={{ uri: item.images[0] }}
          style={styles.image}
          resizeMode="cover"
          sharedTransitionTag={`image-${item.id}-0`}
        />
        {/* Sold overlay */}
        {item.isSold && (
          <View style={styles.soldOverlay}>
            <Text style={styles.soldText}>SOLD</Text>
          </View>
        )}

        {/* Animated Favourite Button */}
        <View style={styles.favBtn}>
          <AnimatedHeart
            isActive={isFav}
            onToggle={handleToggle}
            size={20}
            activeColor={Colors.danger}
            inactiveColor="#ffffff"
          />
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.price}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        <Text style={styles.brand} numberOfLines={1}>@{item.brand.toLowerCase()}</Text>
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
  imageContainer: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.4,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
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
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    letterSpacing: 2,
  },
  info: {
    paddingTop: 8,
    paddingHorizontal: 4,
  },
  price: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 2,
  },
  brand: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  favBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
