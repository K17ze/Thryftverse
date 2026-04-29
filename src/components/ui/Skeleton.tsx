/**
 * Skeleton Loading Component
 * Instagram-style shimmer loading states
 * Replaces spinners with placeholder content
 */

import React from 'react';
import { View, StyleSheet, ViewStyle, DimensionValue } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import { Space, Radius, Duration, Layout } from '../../theme/designTokens';
import { Colors } from '../../constants/colors';

interface SkeletonProps {
  /** Visual variant */
  variant?: 'text' | 'circular' | 'rectangular' | 'card' | 'image';
  /** Width (number = px, string = percentage) */
  width?: DimensionValue;
  /** Height (number = px, string = percentage) */
  height?: DimensionValue;
  /** Border radius override */
  borderRadius?: number;
  /** Enable shimmer animation */
  animate?: boolean;
  /** Custom style */
  style?: ViewStyle;
}

const AnimatedView = Animated.createAnimatedComponent(View);

export const Skeleton: React.FC<SkeletonProps> = ({
  variant = 'rectangular',
  width = '100%',
  height,
  borderRadius,
  animate = true,
  style,
}) => {
  const shimmerPosition = useSharedValue(0);

  // Start shimmer animation
  React.useEffect(() => {
    if (animate) {
      shimmerPosition.value = withRepeat(
        withTiming(1, { duration: 1500 }),
        -1,
        false
      );
    }
  }, [animate]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          shimmerPosition.value,
          [0, 1],
          [-200, 200]
        ),
      },
    ],
  }));

  // Default dimensions based on variant
  const defaultDimensions = {
    text: { height: 14, borderRadius: Radius.sm },
    circular: { height: 44, borderRadius: Radius.full },
    rectangular: { height: 100, borderRadius: Radius.md },
    card: { height: 200, borderRadius: Radius.lg },
    image: { height: Layout.gridItemWidth, borderRadius: Radius.none },
  };

  const resolvedHeight = height ?? defaultDimensions[variant].height;
  const resolvedBorderRadius = borderRadius ?? defaultDimensions[variant].borderRadius;

  return (
    <View
      style={[
        styles.container,
        {
          width,
          height: resolvedHeight,
          borderRadius: resolvedBorderRadius,
        },
        style,
      ]}
    >
      {animate && (
        <AnimatedView style={[styles.shimmer, shimmerStyle]} />
      )}
    </View>
  );
};

// ============================================================================
// SKELETON PRESETS (Common patterns)
// ============================================================================

/** Skeleton for product cards in grid */
export const ProductCardSkeleton: React.FC<{ index?: number }> = ({ index = 0 }) => {
  // Varied heights for masonry effect
  const heights = [150, 200, 180, 220, 160];
  const height = heights[index % heights.length];

  return (
    <View style={styles.productCard}>
      <Skeleton variant="image" height={height} />
      <View style={styles.productInfo}>
        <Skeleton variant="text" width={60} />
        <Skeleton variant="text" width={40} style={{ marginTop: Space.xs }} />
      </View>
    </View>
  );
};

/** Skeleton for user profile header */
export const ProfileHeaderSkeleton: React.FC = () => (
  <View style={styles.profileHeader}>
    <Skeleton variant="circular" width={80} height={80} />
    <View style={styles.profileInfo}>
      <Skeleton variant="text" width={120} />
      <Skeleton variant="text" width={80} style={{ marginTop: Space.sm }} />
    </View>
  </View>
);

/** Skeleton for list items */
export const ListItemSkeleton: React.FC = () => (
  <View style={styles.listItem}>
    <Skeleton variant="rectangular" width={60} height={60} borderRadius={Radius.md} />
    <View style={styles.listItemContent}>
      <Skeleton variant="text" width="70%" />
      <Skeleton variant="text" width="40%" style={{ marginTop: Space.xs }} />
    </View>
  </View>
);

/** Skeleton for feed posts (Instagram style) */
export const FeedPostSkeleton: React.FC = () => (
  <View style={styles.feedPost}>
    <View style={styles.feedHeader}>
      <Skeleton variant="circular" width={32} height={32} />
      <Skeleton variant="text" width={100} style={{ marginLeft: Space.sm }} />
    </View>
    <Skeleton variant="image" height={Layout.screenWidth} />
    <View style={styles.feedActions}>
      <View style={styles.actionRow}>
        <Skeleton variant="circular" width={24} height={24} />
        <Skeleton variant="circular" width={24} height={24} style={{ marginLeft: Space.sm }} />
        <Skeleton variant="circular" width={24} height={24} style={{ marginLeft: Space.sm }} />
      </View>
      <Skeleton variant="text" width="60%" />
    </View>
  </View>
);

/** Grid of skeleton cards (for loading states) */
interface SkeletonGridProps {
  count?: number;
  columns?: number;
}

export const SkeletonGrid: React.FC<SkeletonGridProps> = ({ count = 6, columns = 2 }) => (
  <View style={[styles.grid, { gap: Space.sm }]}>
    {Array.from({ length: count }).map((_, i) => (
      <ProductCardSkeleton key={i} index={i} />
    ))}
  </View>
);

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.cardAlt,
    overflow: 'hidden',
  },
  shimmer: {
    width: 100,
    height: '200%',
    backgroundColor: 'rgba(255,255,255,0.2)',
    transform: [{ rotate: '15deg' }],
    position: 'absolute',
    top: -50,
  },
  
  // Product card preset
  productCard: {
    flex: 1,
  },
  productInfo: {
    padding: Space.sm,
    gap: Space.xs,
  },
  
  // Profile header preset
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.md,
  },
  profileInfo: {
    marginLeft: Space.md,
    flex: 1,
  },
  
  // List item preset
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.md,
  },
  listItemContent: {
    marginLeft: Space.md,
    flex: 1,
  },
  
  // Feed post preset
  feedPost: {
    marginBottom: Space.md,
  },
  feedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Space.md,
  },
  feedActions: {
    padding: Space.md,
    gap: Space.sm,
  },
  actionRow: {
    flexDirection: 'row',
  },
  
  // Grid
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: Space.md,
  },
});

export default Skeleton;
