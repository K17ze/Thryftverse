import React, { useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withDelay,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface DoubleTapHandlerProps {
  children: React.ReactNode;
  onDoubleTap: () => void;
}

export function DoubleTapHandler({ children, onDoubleTap }: DoubleTapHandlerProps) {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  const triggerAnimation = useCallback(() => {
    scale.value = 0;
    opacity.value = 1;

    // Pop up fast, stay a bit, then quickly dissolve and shrink
    scale.value = withSequence(
      withSpring(1, { damping: 10, stiffness: 400 }),
      withDelay(400, withTiming(0.8, { duration: 150 }))
    );
    opacity.value = withSequence(
      withTiming(1, { duration: 100 }),
      withDelay(400, withTiming(0, { duration: 150 }))
    );
  }, [scale, opacity]);

  const onDoubleTapJS = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    triggerAnimation();
    onDoubleTap();
  }, [onDoubleTap, triggerAnimation]);

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onStart(() => {
      runOnJS(onDoubleTapJS)();
    });

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={doubleTap}>
      <View style={styles.container}>
        {children}
        <View style={styles.heartOverlay} pointerEvents="none">
          <Reanimated.View style={animatedStyle}>
            <Ionicons name="heart" size={100} color="#fff" style={styles.shadow} />
          </Reanimated.View>
        </View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    width: '100%', 
    height: '100%',
  },
  heartOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 20,
  },
});
