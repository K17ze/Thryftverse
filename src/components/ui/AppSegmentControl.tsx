import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';
import { AnimatedPressable } from '../AnimatedPressable';

export interface AppSegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  accessibilityLabel?: string;
}

interface AppSegmentControlProps<T extends string> {
  options: AppSegmentOption<T>[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
  optionStyle?: StyleProp<ViewStyle>;
  optionActiveStyle?: StyleProp<ViewStyle>;
  optionTextStyle?: StyleProp<TextStyle>;
  optionTextActiveStyle?: StyleProp<TextStyle>;
  fullWidth?: boolean;
}

export function AppSegmentControl<T extends string>({
  options,
  value,
  onChange,
  style,
  optionStyle,
  optionActiveStyle,
  optionTextStyle,
  optionTextActiveStyle,
  fullWidth = false,
}: AppSegmentControlProps<T>) {
  return (
    <View style={[styles.row, style]}>
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <AnimatedPressable
            key={option.value}
            style={[
              styles.option,
              fullWidth && styles.optionFull,
              optionStyle,
              isActive && styles.optionActive,
              isActive && optionActiveStyle,
            ]}
            onPress={() => {
              if (!isActive) {
                onChange(option.value);
              }
            }}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={option.accessibilityLabel ?? option.label}
          >
            {option.icon}
            <Text
              style={[
                styles.optionText,
                optionTextStyle,
                isActive && styles.optionTextActive,
                isActive && optionTextActiveStyle,
              ]}
            >
              {option.label}
            </Text>
          </AnimatedPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  option: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  optionFull: {
    flex: 1,
  },
  optionActive: {
    borderColor: Colors.accentGold,
    backgroundColor: Colors.cardAlt,
  },
  optionText: {
    color: Colors.textSecondary,
    fontSize: Typography.size.micro + 1,
    fontFamily: Typography.family.bold,
  },
  optionTextActive: {
    color: Colors.accentGold,
  },
});
