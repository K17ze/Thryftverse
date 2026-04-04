import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';
import { AnimatedPressable } from './AnimatedPressable';
import { trackTelemetryEvent } from '../lib/telemetry';

interface SyncRetryBannerProps {
  message: string;
  onRetry: () => void;
  isRetrying?: boolean;
  disabled?: boolean;
  retryLabel?: string;
  retryingLabel?: string;
  containerStyle?: StyleProp<ViewStyle>;
  messageStyle?: StyleProp<TextStyle>;
  actionStyle?: StyleProp<ViewStyle>;
  actionTextStyle?: StyleProp<TextStyle>;
  telemetryContext?: string;
  trackImpression?: boolean;
}

export function SyncRetryBanner({
  message,
  onRetry,
  isRetrying = false,
  disabled = false,
  retryLabel = 'Retry',
  retryingLabel = 'Retrying...',
  containerStyle,
  messageStyle,
  actionStyle,
  actionTextStyle,
  telemetryContext,
  trackImpression = true,
}: SyncRetryBannerProps) {
  const actionDisabled = disabled || isRetrying;
  const trackedImpressionContext = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!telemetryContext || !trackImpression) {
      return;
    }

    if (trackedImpressionContext.current === telemetryContext) {
      return;
    }

    trackedImpressionContext.current = telemetryContext;
    trackTelemetryEvent('sync_retry_banner_impression', {
      context: telemetryContext,
    });
  }, [telemetryContext, trackImpression]);

  const handleRetry = React.useCallback(() => {
    if (telemetryContext) {
      trackTelemetryEvent('sync_retry_tapped', {
        context: telemetryContext,
      });
    }
    onRetry();
  }, [onRetry, telemetryContext]);

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.message, messageStyle]} numberOfLines={2}>
        {message}
      </Text>
      <AnimatedPressable
        style={[styles.actionBtn, actionStyle]}
        activeOpacity={0.9}
        onPress={handleRetry}
        disabled={actionDisabled}
      >
        <Text style={[styles.actionText, actionTextStyle]}>{isRetrying ? retryingLabel : retryLabel}</Text>
      </AnimatedPressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  message: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'Inter_500Medium',
  },
  actionBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  actionText: {
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
});
