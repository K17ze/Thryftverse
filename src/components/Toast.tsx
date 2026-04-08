import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useToast, ToastType } from '../context/ToastContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AnimatedPressable } from './AnimatedPressable';
import { Typography } from '../constants/typography';
import { Motion } from '../constants/motion';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';


const TYPE_CONFIG: Record<ToastType, { borderColor: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  success: { borderColor: '#4CAF50', icon: 'checkmark-circle', iconColor: '#4CAF50' },
  error: { borderColor: '#FF4D4D', icon: 'alert-circle', iconColor: '#FF4D4D' },
  info: { borderColor: '#d7b98f', icon: 'information-circle', iconColor: '#d7b98f' },
};

interface ToastItemProps {
  id: string;
  message: string;
  type: ToastType;
}

function ToastItem({ id, message, type }: ToastItemProps) {
  const { dismiss } = useToast();
  const config = TYPE_CONFIG[type];

  const translateY = useSharedValue(-60);
  const opacity = useSharedValue(0);

  useEffect(() => {
    translateY.value = withSpring(0, Motion.spring.flagshipPop);
    opacity.value = withTiming(1, { duration: 150 });
    
    const timer = setTimeout(() => {
      handleDismiss();
    }, 3200);

    return () => clearTimeout(timer);
  }, []);

  const handleDismiss = () => {
    translateY.value = withTiming(-60, { duration: 250 });
    opacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) {
        runOnJS(dismiss)(id);
      }
    });
  };

  const animStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Reanimated.View style={[styles.toast, { borderLeftColor: config.borderColor }, animStyle]}>
      <Ionicons name={config.icon} size={20} color={config.iconColor} />
      <Text style={styles.message} numberOfLines={2}>{message}</Text>
      <AnimatedPressable
        onPress={handleDismiss}
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
    fontSize: Typography.size.body,
    fontFamily: Typography.family.medium,
    color: '#f3ede3',
    letterSpacing: Typography.tracking.normal,
    lineHeight: 19,
  },
  closeBtn: {
    padding: 2,
  },
});

