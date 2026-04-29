/**
 * Button Component System
 * 3 variants only: primary, secondary, ghost
 * Based on Depop/Instagram button patterns
 * Consistent sizing: sm (32px), md (44px), lg (56px)
 */

import React from 'react';
import {
  TouchableOpacity,
  TouchableOpacityProps,
  StyleSheet,
  ViewStyle,
  TextStyle,
  ActivityIndicator,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { Space, Radius, Duration } from '../../theme/designTokens';
import { Colors } from '../../constants/colors';
import { BodyEmphasis } from './Text';

interface ButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  /** Button visual style */
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Button size - affects height and padding */
  size?: 'sm' | 'md' | 'lg';
  /** Button text */
  title: string;
  /** Loading state */
  loading?: boolean;
  /** Disabled state */
  disabled?: boolean;
  /** Full width button */
  fullWidth?: boolean;
  /** Custom container style */
  style?: ViewStyle;
  /** Custom text style */
  textStyle?: TextStyle | TextStyle[];
  /** Left icon component */
  leftIcon?: React.ReactNode;
  /** Right icon component */
  rightIcon?: React.ReactNode;
}

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  title,
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  textStyle,
  leftIcon,
  rightIcon,
  onPressIn,
  onPressOut,
  ...touchableProps
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 20, stiffness: 300 });
    onPressIn?.();
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
    onPressOut?.();
  };

  const isDisabled = disabled || loading;

  const containerStyles = [
    styles.base,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    isDisabled && styles.disabled,
    style,
  ];

  const textColor = {
    primary: Colors.textInverse,
    secondary: Colors.textPrimary,
    ghost: Colors.textPrimary,
  }[variant];

  return (
    <AnimatedTouchable
      style={[containerStyles, animatedStyle]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      activeOpacity={0.8}
      {...touchableProps}
    >
      {loading ? (
        <ActivityIndicator 
          size="small" 
          color={textColor} 
        />
      ) : (
        <>
          {leftIcon}
          <BodyEmphasis 
            color={isDisabled ? Colors.textMuted : textColor}
            style={[styles.text, textStyle]}
          >
            {title}
          </BodyEmphasis>
          {rightIcon}
        </>
      )}
    </AnimatedTouchable>
  );
};

// ============================================================================
// SPECIALTY BUTTONS
// ============================================================================

/** Primary CTA - Use for main actions (Sell, Buy, Confirm) */
export const PrimaryButton: React.FC<Omit<ButtonProps, 'variant'>> = (props) => (
  <Button variant="primary" {...props} />
);

/** Secondary - Use for supporting actions (Save, Share, Filter) */
export const SecondaryButton: React.FC<Omit<ButtonProps, 'variant'>> = (props) => (
  <Button variant="secondary" {...props} />
);

/** Ghost - Use for navigation, cancel, less important actions */
export const GhostButton: React.FC<Omit<ButtonProps, 'variant'>> = (props) => (
  <Button variant="ghost" {...props} />
);

/** The iconic Depop "Sell" button - Large, prominent, primary */
export const SellButton: React.FC<Omit<ButtonProps, 'variant' | 'size' | 'title'>> = (props) => (
  <Button 
    variant="primary" 
    size="lg" 
    title="Sell" 
    fullWidth 
    {...props} 
  />
);

/** Icon button - Circular, for navigation bars */
interface IconButtonProps extends Omit<TouchableOpacityProps, 'style'> {
  icon: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
  style?: ViewStyle;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  size = 'md',
  variant = 'ghost',
  style,
  ...touchableProps
}) => {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, { damping: 20, stiffness: 300 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 20, stiffness: 300 });
  };

  const iconSizes = {
    sm: 32,
    md: 44,
    lg: 56,
  };

  return (
    <AnimatedTouchable
      style={[
        styles.iconButton,
        { width: iconSizes[size], height: iconSizes[size] },
        styles[variant],
        style,
        animatedStyle,
      ]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={0.8}
      {...touchableProps}
    >
      {icon}
    </AnimatedTouchable>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space.xs,
    borderRadius: Radius.sm,
  },
  
  // Variants
  primary: {
    backgroundColor: Colors.accent,
  },
  secondary: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  
  // Sizes
  sm: {
    height: 32,
    paddingHorizontal: Space.md,
  },
  md: {
    height: 44,
    paddingHorizontal: Space.lg,
  },
  lg: {
    height: 56,
    paddingHorizontal: Space.xl,
  },
  
  // States
  disabled: {
    opacity: 0.5,
  },
  fullWidth: {
    width: '100%',
  },
  
  // Text
  text: {
    letterSpacing: 0,
  },
  
  // Icon button
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
  },
});

export default Button;
