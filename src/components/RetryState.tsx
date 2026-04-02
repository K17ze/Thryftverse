import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { Colors } from '../constants/colors';
import { AnimatedPressable } from './AnimatedPressable';

interface RetryStateProps {
  onRetry: () => void;
  message?: string;
}

export function RetryState({ onRetry, message = 'Something went wrong.' }: RetryStateProps) {
  return (
    <View style={styles.container}>
      <Reanimated.View entering={FadeInDown.duration(500).springify()} style={styles.iconBox}>
        <Ionicons name="warning-outline" size={64} color={Colors.danger} />
      </Reanimated.View>
      
      <Reanimated.Text entering={FadeInDown.delay(100).duration(500).springify()} style={styles.title}>
        Oops!
      </Reanimated.Text>
      
      <Reanimated.Text entering={FadeInDown.delay(200).duration(500).springify()} style={styles.subtext}>
        {message}
      </Reanimated.Text>

      <Reanimated.View entering={FadeInDown.delay(300).duration(500).springify()}>
        <AnimatedPressable style={styles.retryBtn} onPress={onRetry}>
          <Text style={styles.retryBtnText}>Try Again</Text>
        </AnimatedPressable>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingHorizontal: 40,
  },
  iconBox: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#1E1111',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  subtext: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  retryBtn: {
    backgroundColor: Colors.textPrimary,
    paddingHorizontal: 40,
    paddingVertical: 18,
    borderRadius: 30,
  },
  retryBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
