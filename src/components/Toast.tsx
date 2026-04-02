import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useToast, ToastType } from '../context/ToastContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedPressable } from './AnimatedPressable';
import { Typography } from '../constants/typography';

const TYPE_CONFIG: Record<ToastType, { borderColor: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  success: { borderColor: '#4CAF50', icon: 'checkmark-circle', iconColor: '#4CAF50' },
  error: { borderColor: '#FF4D4D', icon: 'alert-circle', iconColor: '#FF4D4D' },
  info: { borderColor: '#e8dcc8', icon: 'information-circle', iconColor: '#e8dcc8' },
};

interface ToastItemProps {
  id: string;
  message: string;
  type: ToastType;
}

function ToastItem({ id, message, type }: ToastItemProps) {
  const { dismiss } = useToast();
  const translateY = useSharedValue(-80);
  const opacity = useSharedValue(0);
  const config = TYPE_CONFIG[type];

  useEffect(() => {
    translateY.value = withSpring(0, { damping: 18, stiffness: 200 });
    opacity.value = withTiming(1, { duration: 200 });

    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 250 });
      translateY.value = withSpring(-80, { damping: 15 }, () => runOnJS(dismiss)(id));
    }, 3200);
    return () => clearTimeout(timer);
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Reanimated.View style={[styles.toast, { borderLeftColor: config.borderColor }, animStyle]}>
      <Ionicons name={config.icon} size={20} color={config.iconColor} />
      <Text style={styles.message} numberOfLines={2}>{message}</Text>
      <AnimatedPressable
        onPress={() => dismiss(id)}
        style={styles.closeBtn}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disableAnimation
        activeOpacity={1}
      >
        <Ionicons name="close" size={16} color="#888" />
      </AnimatedPressable>
    </Reanimated.View>
  );
}

export function ToastContainer() {
  const { toasts } = useToast();
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View style={[styles.container, { top: insets.top + 12 }]} pointerEvents="box-none">
      {toasts.map(t => (
        <ToastItem key={t.id} {...t} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#191714',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderLeftWidth: 4,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontFamily: Typography.family.medium,
    color: '#f3ede3',
    letterSpacing: 0.08,
    lineHeight: 19,
  },
  closeBtn: {
    padding: 2,
  },
});
