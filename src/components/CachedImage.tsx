import React, { useState } from 'react';
import { View, StyleSheet, ViewStyle, StyleProp, ImageStyle, Image as NativeImage } from 'react-native';
import { Image as ExpoImage, ImageContentFit } from 'expo-image';
import Reanimated, {
  cancelAnimation,
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { useReducedMotion } from '../hooks/useReducedMotion';

interface CachedImageProps {
  uri: string;
  previewUri?: string;
  style?: StyleProp<ImageStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
  blurhash?: string;
  priority?: 'low' | 'normal' | 'high';
  isVisible?: boolean;
}

const AnimatedLinearGradient = Reanimated.createAnimatedComponent(LinearGradient);

export function CachedImage({
  uri,
  previewUri,
  style,
  containerStyle,
  contentFit = 'cover',
  transition = 280,
  blurhash,
  priority = 'normal',
  isVisible = true,
}: CachedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const reducedMotionEnabled = useReducedMotion();
  const shimmerX = useSharedValue(-1);
  const imageOpacity = useSharedValue(0);
  const previewOpacity = useSharedValue(previewUri ? 1 : 0);

  React.useEffect(() => {
    setLoaded(false);
    imageOpacity.value = 0;
    previewOpacity.value = previewUri ? 1 : 0;
  }, [imageOpacity, previewOpacity, previewUri, uri]);

  React.useEffect(() => {
    if (loaded || reducedMotionEnabled) {
      cancelAnimation(shimmerX);
      shimmerX.value = -1;
      return;
    }

    shimmerX.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.ease) }),
        withTiming(-1, { duration: 0 })
      ),
      -1,
      false
    );
  }, [loaded, reducedMotionEnabled, shimmerX]);

  const imageStyle = useAnimatedStyle(() => ({
    opacity: imageOpacity.value,
  }));

  const previewStyle = useAnimatedStyle(() => ({
    opacity: previewOpacity.value,
  }));

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmerX.value * 120 }],
    opacity: loaded ? 0 : 0.55,
  }));

  const effectivePriority = isVisible ? priority : 'low';
  const effectiveTransition = reducedMotionEnabled ? 0 : transition;
  const useNativeImage = /^content:\/\//i.test(uri);

  const nativeResizeMode = React.useMemo(() => {
    switch (contentFit) {
      case 'contain':
        return 'contain';
      case 'fill':
        return 'stretch';
      case 'none':
        return 'center';
      case 'scale-down':
        return 'contain';
      case 'cover':
      default:
        return 'cover';
    }
  }, [contentFit]);

  const handleLoad = React.useCallback(() => {
    setLoaded(true);
    imageOpacity.value = withTiming(1, { duration: reducedMotionEnabled ? 0 : 200 });
    previewOpacity.value = withTiming(0, { duration: reducedMotionEnabled ? 0 : 180 });
  }, [imageOpacity, previewOpacity, reducedMotionEnabled]);

  const handleError = React.useCallback(() => {
    setLoaded(true);
    imageOpacity.value = withTiming(1, { duration: 0 });
    previewOpacity.value = withTiming(0, { duration: 80 });
  }, [imageOpacity, previewOpacity]);

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

      {previewUri && !loaded && (
        <Reanimated.View pointerEvents="none" style={[StyleSheet.absoluteFill, previewStyle]}>
          <ExpoImage
            source={{ uri: previewUri }}
            style={[styles.image, style]}
            contentFit={contentFit}
            transition={0}
            cachePolicy="memory-disk"
            priority={effectivePriority}
            recyclingKey={`preview-${uri}`}
          />
        </Reanimated.View>
      )}

      <Reanimated.View style={[StyleSheet.absoluteFill, imageStyle]}>
        {useNativeImage ? (
          <NativeImage
            source={{ uri }}
            style={[styles.image, style]}
            resizeMode={nativeResizeMode}
            onLoad={handleLoad}
            onError={handleError}
          />
        ) : (
          <ExpoImage
            source={{ uri }}
            style={[styles.image, style]}
            contentFit={contentFit}
            transition={effectiveTransition}
            placeholder={blurhash ? { blurhash } : undefined}
            cachePolicy="memory-disk"
            priority={effectivePriority}
            onLoad={handleLoad}
            onError={handleError}
            recyclingKey={uri}
          />
        )}
      </Reanimated.View>
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
