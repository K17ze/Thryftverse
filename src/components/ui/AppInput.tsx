import React from 'react';
import {
  KeyboardTypeOptions,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { ActiveTheme, Colors } from '../../constants/colors';
import { Typography } from '../../constants/typography';

interface AppInputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  helperText?: string;
  errorText?: string;
  containerStyle?: StyleProp<ViewStyle>;
  inputContainerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  labelStyle?: StyleProp<TextStyle>;
  helperStyle?: StyleProp<TextStyle>;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  keyboardType?: KeyboardTypeOptions;
}

const IS_LIGHT = ActiveTheme === 'light';

export function AppInput({
  label,
  helperText,
  errorText,
  containerStyle,
  inputContainerStyle,
  inputStyle,
  labelStyle,
  helperStyle,
  prefix,
  suffix,
  value,
  placeholder,
  placeholderTextColor,
  keyboardType,
  onChangeText,
  editable = true,
  ...rest
}: AppInputProps) {
  const hasError = Boolean(errorText);

  return (
    <View style={containerStyle}>
      {label ? <Text style={[styles.label, labelStyle]}>{label}</Text> : null}
      <View
        style={[
          styles.inputWrap,
          hasError && styles.inputWrapError,
          !editable && styles.inputWrapDisabled,
          inputContainerStyle,
        ]}
      >
        {typeof prefix === 'string' ? <Text style={styles.prefixText}>{prefix}</Text> : null}
        {prefix && typeof prefix !== 'string' ? <View style={styles.prefixNode}>{prefix}</View> : null}
        <TextInput
          {...rest}
          value={value}
          editable={editable}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={placeholderTextColor ?? Colors.textMuted}
          style={[styles.input, inputStyle]}
        />
        {suffix}
      </View>
      {errorText ? <Text style={[styles.errorText, helperStyle]}>{errorText}</Text> : null}
      {!errorText && helperText ? <Text style={[styles.helperText, helperStyle]}>{helperText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    marginBottom: 6,
    color: Colors.textSecondary,
    fontSize: Typography.size.micro + 1,
    fontFamily: Typography.family.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  inputWrap: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  inputWrapError: {
    borderColor: Colors.danger,
    backgroundColor: IS_LIGHT ? 'rgba(182,66,66,0.08)' : 'rgba(255,77,77,0.12)',
  },
  inputWrapDisabled: {
    opacity: 0.6,
  },
  prefixText: {
    color: Colors.textMuted,
    fontSize: Typography.size.caption,
    fontFamily: Typography.family.bold,
  },
  prefixNode: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: Typography.size.bodyLarge,
    fontFamily: Typography.family.semibold,
    paddingVertical: 10,
  },
  helperText: {
    marginTop: 7,
    color: Colors.textMuted,
    fontSize: Typography.size.caption - 1,
    lineHeight: 16,
    fontFamily: Typography.family.medium,
  },
  errorText: {
    marginTop: 7,
    color: Colors.danger,
    fontSize: Typography.size.caption - 1,
    lineHeight: 16,
    fontFamily: Typography.family.semibold,
  },
});
