import React, { useCallback, useRef } from 'react';
import { View, Dimensions, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  FlatList,
} from 'react-native-gesture-handler';
import { SharedTransitionImage } from './SharedTransitionImage';

const { width: W } = Dimensions.get('window');
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

interface ImagePageProps {
  uri: string;
  onDoubleTap?: () => void;
  sharedTransitionTag?: string;
}

function ImagePage({ uri, onDoubleTap, sharedTransitionTag }: ImagePageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      const newScale = savedScale.value * e.scale;
      scale.value = Math.min(Math.max(newScale, MIN_ZOOM), MAX_ZOOM);
    })
    .onEnd(() => {
      if (scale.value < MIN_ZOOM) {
        scale.value = withSpring(MIN_ZOOM);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedScale.value = MIN_ZOOM;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (savedScale.value > 1) {
        const maxTransX = (W * (savedScale.value - 1)) / 2;
        const maxTransY = (W * (savedScale.value - 1)) / 2;
        translateX.value = Math.max(-maxTransX, Math.min(maxTransX, savedTranslateX.value + e.translationX));
        translateY.value = Math.max(-maxTransY, Math.min(maxTransY, savedTranslateY.value + e.translationY));
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1, { damping: 15 });
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
        savedScale.value = 1;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
      } else {
        scale.value = withSpring(2.5, { damping: 12 });
        savedScale.value = 2.5;
        if (onDoubleTap) runOnJS(onDoubleTap)();
      }
    });

  const composed = Gesture.Simultaneous(
    Gesture.Race(doubleTap, panGesture),
    pinchGesture
  );

  const animStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Reanimated.View style={[styles.page, animStyle]}>
        <SharedTransitionImage
          source={{ uri }}
          style={styles.image}
          resizeMode="cover"
          sharedTransitionTag={sharedTransitionTag}
        />
      </Reanimated.View>
    </GestureDetector>
  );
}

// ── Dot Indicator ─────────────────────────────────────────────
interface DotProps {
  index: number;
  activeIndex: number;
}

function Dot({ index, activeIndex }: DotProps) {
  const isActive = index === activeIndex;
  const width = useSharedValue(isActive ? 24 : 8);

  React.useEffect(() => {
    width.value = withSpring(isActive ? 24 : 8, { damping: 15, stiffness: 200 });
  }, [isActive]);

  const dotStyle = useAnimatedStyle(() => ({
    width: width.value,
    opacity: isActive ? 1 : 0.4,
  }));

  return <Reanimated.View style={[styles.dot, dotStyle]} />;
}

// ── Main Component ─────────────────────────────────────────────
interface Props {
  images: string[];
  height?: number;
  onDoubleTap?: () => void;
  itemId?: string;
}

export function ImageViewer({ images, height = W, onDoubleTap, itemId }: Props) {
  const [activeIndex, setActiveIndex] = React.useState(0);

  const onViewableItemsChanged = useCallback(({ viewableItems }: any) => {
    if (viewableItems.length > 0) {
      setActiveIndex(viewableItems[0].index ?? 0);
    }
  }, []);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 });

  return (
    <View style={{ height }}>
      <FlatList
        data={images}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig.current}
        renderItem={({ item, index }) => (
          <ImagePage 
            uri={item} 
            onDoubleTap={onDoubleTap}
            sharedTransitionTag={index === 0 && itemId ? `image-${itemId}-0` : undefined} 
          />
        )}
      />
      {images.length > 1 && (
        <View style={styles.dots}>
          {images.map((_, i) => (
            <Dot key={i} index={i} activeIndex={activeIndex} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    width: W,
    height: W,
    backgroundColor: '#0a0a0a',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  dots: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ffffff',
  },
});
