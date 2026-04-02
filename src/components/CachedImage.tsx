import React, { useState } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, ImageStyle } from 'react-native';
import { Image, ImageContentFit } from 'expo-image';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';

interface CachedImageProps {
  uri: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
  blurhash?: string;
  priority?: 'low' | 'normal' | 'high';
}

const AnimatedLinearGradient = Reanimated.createAnimatedComponent(LinearGradient);

export function CachedImage({
  uri,
  style,
  containerStyle,
  contentFit = 'cover',
  transition = 280,
  blurhash,
  priority = 'normal',
}: CachedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const shimmerX = useSharedValue(-1);

  React.useEffect(() => {
    shimmerX.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(-1, { duration: 0 })
      ),
      -1,
      false
    );
  }, [shimmerX]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value * 120 }],
    opacity: loaded ? 0 : 0.55,
  }));

  return (
    <View style={[styles.container, containerStyle]}>
      {/* Shimmer placeholder */}
      {!loaded && (
        <View style={[StyleSheet.absoluteFill, styles.shimmerBase]}>
          <AnimatedLinearGradient
            colors={['transparent', 'rgba(255,255,255,0.06)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[StyleSheet.absoluteFill, shimmerStyle]}
          />
        </View>
      )}

      <Image
        source={{ uri }}
        style={[styles.image, style]}
        contentFit={contentFit}
        transition={transition}
        placeholder={blurhash ? { blurhash } : undefined}
        cachePolicy="memory-disk"
        priority={priority}
        onLoad={() => setLoaded(true)}
        recyclingKey={uri}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
  shimmerBase: {
    backgroundColor: Colors.card,
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
