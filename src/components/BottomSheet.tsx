import React, { useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  Pressable,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const IS_LIGHT = ActiveTheme === 'light';
const SHEET_BG = IS_LIGHT ? '#ffffff' : '#141414';
const HANDLE_BG = IS_LIGHT ? '#c8c1b6' : '#444';
const BACKDROP_COLOR = IS_LIGHT ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.6)';
const SPRING_CONFIG = { damping: 22, stiffness: 280, mass: 0.8 };

interface BottomSheetProps {
  visible: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
  snapPoint?: number; // percentage of screen height (default 0.55)
}

export function BottomSheet({
  visible,
  onDismiss,
  children,
  snapPoint = 0.55,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const sheetHeight = SCREEN_HEIGHT * snapPoint;
  const translateY = useSharedValue(sheetHeight);
  const backdropOpacity = useSharedValue(0);
  const contextY = useSharedValue(0);

  const open = useCallback(() => {
    translateY.value = withSpring(0, SPRING_CONFIG);
    backdropOpacity.value = withTiming(1, { duration: 250 });
  }, [translateY, backdropOpacity]);

  const close = useCallback(() => {
    translateY.value = withSpring(sheetHeight, SPRING_CONFIG, (finished) => {
      if (finished) {
        runOnJS(onDismiss)();
      }
    });
    backdropOpacity.value = withTiming(0, { duration: 200 });
  }, [translateY, backdropOpacity, sheetHeight, onDismiss]);

  useEffect(() => {
    if (visible) {
      open();
    } else {
      translateY.value = sheetHeight;
      backdropOpacity.value = 0;
    }
  }, [visible, open, translateY, backdropOpacity, sheetHeight]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [visible, close]);

  const panGesture = Gesture.Pan()
    .onStart(() => {
      contextY.value = translateY.value;
    })
    .onUpdate((e) => {
      translateY.value = Math.max(0, contextY.value + e.translationY);
    })
    .onEnd((e) => {
      if (translateY.value > sheetHeight * 0.35 || e.velocityY > 600) {
        runOnJS(close)();
      } else {
        translateY.value = withSpring(0, SPRING_CONFIG);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
    pointerEvents: backdropOpacity.value > 0.01 ? 'auto' : 'none',
  }));

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Reanimated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
      </Reanimated.View>

      {/* Sheet */}
      <GestureDetector gesture={panGesture}>
        <Reanimated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight + insets.bottom,
              paddingBottom: insets.bottom,
            },
            sheetStyle,
          ]}
        >
          {/* Drag handle */}
          <View style={styles.handleWrap}>
            <View style={styles.handle} />
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.contentWrap}
          >
            {children}
          </KeyboardAvoidingView>
        </Reanimated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: BACKDROP_COLOR,
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: SHEET_BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 24,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: HANDLE_BG,
  },
  contentWrap: {
    flex: 1,
    paddingHorizontal: 20,
  },
});
