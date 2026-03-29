import React from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Colors } from '../constants/colors';
import { Listing } from '../data/mockData';

const { width } = Dimensions.get('window');
const CARD_WIDTH = (width - 48) / 2; // Extra padding around grids

interface Props {
  item: Listing;
  onPress: () => void;
}

export function ProductCard({ item, onPress }: Props) {
  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.9}>
      <View style={styles.imageContainer}>
        <Image
          source={{ uri: item.images[0] }}
          style={styles.image}
          resizeMode="cover"
        />
        {/* Sold overlay */}
        {item.isSold && (
          <View style={styles.soldOverlay}>
            <Text style={styles.soldText}>SOLD</Text>
          </View>
        )}
      </View>

      <View style={styles.info}>
        <Text style={styles.price}>£{item.price.toFixed(2)}</Text>
        <Text style={styles.brand} numberOfLines={1}>@{item.brand.toLowerCase()}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    width: CARD_WIDTH,
    backgroundColor: Colors.background, // Pure black underlying
    marginBottom: 20,
  },
  imageContainer: {
    width: CARD_WIDTH,
    height: CARD_WIDTH * 1.4, // Taller image ratio
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
});
