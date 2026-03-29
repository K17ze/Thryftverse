import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';

export default function AuthLandingScreen() {
  const navigation = useNavigation<any>();

  return (
    <ImageBackground 
      source={{ uri: 'https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?w=800&q=80' }} 
      style={styles.container}
    >
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
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
          <TouchableOpacity 
            style={styles.primaryBtn} 
            activeOpacity={0.9} 
            onPress={() => navigation.navigate('SignUp')}
          >
            <Text style={styles.primaryText}>Sign Up</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.secondaryBtn} 
            activeOpacity={0.8}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.secondaryText}>Log In</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  safeArea: { flex: 1, justifyContent: 'space-between' },
  
  topSection: { paddingHorizontal: 20, paddingTop: 20 },
  logo: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFF', letterSpacing: 4 },
  
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  title: { fontSize: 48, fontFamily: 'Inter_700Bold', color: '#FFF', lineHeight: 52, letterSpacing: -1, marginBottom: 12 },
  subtitle: { fontSize: 16, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.8)', lineHeight: 24 },
  
  footer: { paddingHorizontal: 20, paddingBottom: 20, gap: 12 },
  primaryBtn: { backgroundColor: '#FFF', height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#000', fontSize: 16, fontFamily: 'Inter_700Bold' },
  secondaryBtn: { backgroundColor: 'transparent', height: 56, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#FFF', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
