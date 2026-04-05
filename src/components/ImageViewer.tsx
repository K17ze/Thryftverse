import React, { useCallback, useRef } from 'react';
import { View, Dimensions, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import {
  GestureDetector,
  Gesture,
  FlatList,
} from 'react-native-gesture-handler';
import { SharedTransitionImage } from './SharedTransitionImage';
import { useReducedMotion } from '../hooks/useReducedMotion';

const { width: W } = Dimensions.get('window');
const MAX_ZOOM = 4;
const MIN_ZOOM = 1;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const applyRubberBand = (value: number, min: number, max: number, friction = 0.24) => {
  if (value < min) {
    return min + (value - min) * friction;
  }
  if (value > max) {
    return max + (value - max) * friction;
  }
  return value;
};

interface ImagePageProps {
  uri: string;
  onDoubleTap?: () => void;
  sharedTransitionTag?: string;
}

function ImagePage({ uri, onDoubleTap, sharedTransitionTag }: ImagePageProps) {
  const reducedMotionEnabled = useReducedMotion();
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
      const zoomLevel = Math.max(scale.value, savedScale.value);
      if (zoomLevel > 1) {
        const maxTransX = (W * (zoomLevel - 1)) / 2;
        const maxTransY = (W * (zoomLevel - 1)) / 2;
        const nextX = savedTranslateX.value + e.translationX;
        const nextY = savedTranslateY.value + e.translationY;
        translateX.value = applyRubberBand(nextX, -maxTransX, maxTransX);
        translateY.value = applyRubberBand(nextY, -maxTransY, maxTransY);
      }
    })
    .onEnd((e) => {
      const zoomLevel = Math.max(scale.value, savedScale.value);

      if (zoomLevel <= 1) {
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        translateX.value = withSpring(0, { damping: 18, stiffness: 220 });
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
        return;
      }

      const maxTransX = (W * (zoomLevel - 1)) / 2;
      const maxTransY = (W * (zoomLevel - 1)) / 2;
      const projectedX = translateX.value + e.velocityX * 0.08;
      const projectedY = translateY.value + e.velocityY * 0.08;
      const targetX = clamp(projectedX, -maxTransX, maxTransX);
      const targetY = clamp(projectedY, -maxTransY, maxTransY);

      savedTranslateX.value = targetX;
      savedTranslateY.value = targetY;

      translateX.value = withSpring(targetX, {
        damping: 17,
        stiffness: 200,
        velocity: reducedMotionEnabled ? 0 : e.velocityX,
      });
      translateY.value = withSpring(targetY, {
        damping: 17,
        stiffness: 200,
        velocity: reducedMotionEnabled ? 0 : e.velocityY,
      });
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
        const zoomTarget = reducedMotionEnabled ? 2 : 2.5;
        scale.value = withSpring(zoomTarget, { damping: 12 });
        savedScale.value = zoomTarget;
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
  }, [isActive, width]);

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
