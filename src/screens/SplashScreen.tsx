import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar, Dimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withDelay,
  withTiming,
  withSequence,
  runOnJS,
  FadeInUp,
} from 'react-native-reanimated';
import { useReducedMotion } from '../hooks/useReducedMotion';

type NavT = StackNavigationProp<RootStackParamList>;
const { height } = Dimensions.get('window');

const TITLE = "THRYFTVERSE".split('');

export default function SplashScreen() {
  const navigation = useNavigation<NavT>();
  const reducedMotionEnabled = useReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);

  useEffect(() => {
    if (reducedMotionEnabled) {
      const reducedTimer = setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Login' as any }],
        });
      }, 450);

      return () => clearTimeout(reducedTimer);
    }

    // Stage 1: Wait for staggered entrance (TITLE.length * 80 + ~800 = ~1600ms)
    // Stage 2: Zoom out / dissolve
    const timer = setTimeout(() => {
      scale.value = withTiming(0.9, { duration: 300 });
      translateY.value = withTiming(-20, { duration: 300 });
      opacity.value = withTiming(0, { duration: 250 }, () => {
        runOnJS(navigation.reset)({
          index: 0,
          routes: [{ name: 'Login' as any }],
        });
      });
    }, 2200);

    return () => clearTimeout(timer);
  }, [navigation, opacity, reducedMotionEnabled, scale, translateY]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { scale: scale.value },
      { translateY: translateY.value }
    ],
  }));

  return (
    <View style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      <Reanimated.View style={[styles.brandContainer, containerStyle]}>
        <View style={styles.titleRow}>
          {TITLE.map((letter, i) => {
            const letterOffset = useSharedValue(reducedMotionEnabled ? 0 : 40);
            const letterOpacity = useSharedValue(reducedMotionEnabled ? 1 : 0);
            
            useEffect(() => {
              if (reducedMotionEnabled) {
                return;
              }

              letterOffset.value = withDelay(i * 60, withSpring(0, { damping: 12, stiffness: 200 }));
              letterOpacity.value = withDelay(i * 60, withTiming(1, { duration: 200 }));
            }, [i, letterOffset, letterOpacity, reducedMotionEnabled]);

            const letterStyle = useAnimatedStyle(() => ({
              opacity: letterOpacity.value,
              transform: [{ translateY: letterOffset.value }]
            }));

            return (
              <Reanimated.Text key={`${i}-${letter}`} style={[styles.brandText, letterStyle]}>
                {letter}
              </Reanimated.Text>
            );
          })}
        </View>
        
        <Reanimated.Text 
          entering={
            reducedMotionEnabled
              ? undefined
              : FadeInUp.delay(TITLE.length * 60 + 200).duration(800)
          }
          style={styles.subText}
        >
          The New Era of Thryfting
        </Reanimated.Text>
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandContainer: {
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
  },
  brandText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    color: Colors.textPrimary,
    letterSpacing: 2,
    marginHorizontal: 1,
  },
  subText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
  },
});
