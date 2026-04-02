import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ImageBackground,
  StatusBar
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Typography } from '../constants/typography';

export default function AuthLandingScreen() {
  const navigation = useNavigation<any>();

  return (
    <ImageBackground 
      source={{ uri: 'https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?w=800&q=80' }} 
      style={styles.container}
    >
      <StatusBar translucent backgroundColor="transparent" barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} />
      <View style={styles.overlay} />
      
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.topSection}>
          <Text style={styles.logo}>THRYFTVERSE</Text>
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>Your wardrobe,{'\n'}evolved.</Text>
          <Text style={styles.subtitle}>Discover curated pre-loved pieces, right at your fingertips.</Text>
        </View>

        <View style={styles.footer}>
          <AnimatedPressable 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={styles.primaryText}>Sign Up</Text>
          </AnimatedPressable>
          
          <AnimatedPressable 
            style={styles.secondaryBtn} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.secondaryText}>Log In</Text>
          </AnimatedPressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.58)' },
  safeArea: { flex: 1, justifyContent: 'space-between' },
  
  topSection: { paddingHorizontal: 22, paddingTop: 18 },
  logo: {
    fontSize: 18,
    fontFamily: Typography.family.semibold,
    color: '#f3ede3',
    letterSpacing: 2.8,
  },
  
  content: { paddingHorizontal: 22, paddingBottom: 42 },
  title: {
    fontSize: 44,
    fontFamily: Typography.family.bold,
    color: '#f6f2ea',
    lineHeight: 50,
    letterSpacing: -0.7,
    marginBottom: 14,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: Typography.family.regular,
    color: 'rgba(245, 239, 230, 0.84)',
    lineHeight: 23,
    letterSpacing: 0.08,
  },
  
  footer: { paddingHorizontal: 22, paddingBottom: 22, gap: 12 },
  primaryBtn: {
    backgroundColor: '#e8dcc8',
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#0b0907',
    fontSize: 15,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(232,220,200,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    color: '#f5efe6',
    fontSize: 15,
    fontFamily: Typography.family.semibold,
    letterSpacing: 0.18,
  },
});
