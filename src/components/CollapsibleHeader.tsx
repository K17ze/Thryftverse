/**
 * CollapsibleHeader - Instagram-style header that shrinks on scroll
 * Provides smooth header collapse/expand animation based on scroll position
 */

import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Space } from '../theme/designTokens';

interface Props {
  /** Header height when expanded */
  expandedHeight?: number;
  /** Header height when collapsed */
  collapsedHeight?: number;
  /** Scroll Y position from scroll event */
  scrollY: SharedValue<number>;
  /** Content to render in the header */
  children: React.ReactNode;
  /** Optional background color */
  backgroundColor?: string;
}

const HEADER_EXPANDED = 80;
const HEADER_COLLAPSED = 56;
const SCROLL_THRESHOLD = 60;

export function CollapsibleHeader({
  expandedHeight = HEADER_EXPANDED,
  collapsedHeight = HEADER_COLLAPSED,
  scrollY,
  children,
  backgroundColor = Colors.background,
}: Props) {
  const headerStyle = useAnimatedStyle(() => {
    const height = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD],
      [expandedHeight, collapsedHeight],
      Extrapolation.CLAMP
    );

    const opacity = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD * 0.6],
      [1, 0],
      Extrapolation.CLAMP
    );

    return {
      height,
      opacity: 1,
    };
  });

  const contentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD * 0.5],
      [1, 0],
      Extrapolation.CLAMP
    );

    const translateY = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD],
      [0, -10],
      Extrapolation.CLAMP
    );

    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <Reanimated.View
      style={[
        styles.container,
        { backgroundColor },
        headerStyle,
      ]}
    >
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <Reanimated.View style={[styles.content, contentStyle]}>
          {children}
        </Reanimated.View>
      </SafeAreaView>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  safeArea: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: Space.md,
    justifyContent: 'center',
  },
});

export default CollapsibleHeader;
