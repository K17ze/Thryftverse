import React, { useEffect } from 'react';
import { View, Text, StyleSheet, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Colors } from '../constants/colors';

type NavT = StackNavigationProp<RootStackParamList>;

export default function SplashScreen() {
  const navigation = useNavigation<NavT>();

  useEffect(() => {
    // Artificial 2-second delay to show the branding, then navigate to Home
    const timer = setTimeout(() => {
      navigation.reset({
        index: 0,
        routes: [{ name: 'AuthLanding' as any }],
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <View style={styles.brandContainer}>
        <Text style={styles.brandText}>THRYFTVERSE</Text>
        <Text style={styles.subText}>The New Era of Thryfting</Text>
      </View>
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
  brandText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    color: Colors.textPrimary,
    letterSpacing: 4,
  },
  subText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 8,
    letterSpacing: 1.5,
  },
});
