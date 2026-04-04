import React, { useEffect } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Confetti } from '../components/Confetti';

export default function SuccessScreen() {
  const navigation = useNavigation<any>();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      <Confetti />
      
      <View style={styles.centerContent}>
        <View style={styles.iconCircle}>
          <Ionicons name="checkmark" size={48} color={Colors.background} />
        </View>
        
        <Text style={styles.title}>Payment Successful</Text>
        <Text style={styles.subtitle}>
          Your order has been placed successfully.{'\n'}
          The seller has 5 working days to send the parcel.
        </Text>
      </View>

      <View style={styles.footer}>
        <AnimatedPressable 
          style={styles.primaryBtn} 
          activeOpacity={0.9} 
          onPress={() => navigation.navigate('MyOrders')}
        >
          <Text style={styles.primaryText}>Track Order</Text>
        </AnimatedPressable>
        
        <AnimatedPressable 
          style={styles.secondaryBtn} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('MainTabs')}
        >
          <Text style={styles.secondaryText}>Continue Browsing</Text>
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background, justifyContent: 'space-between' },
  
  centerContent: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconCircle: { 
    width: 96, height: 96, borderRadius: 48, 
    backgroundColor: Colors.success, 
    alignItems: 'center', justifyContent: 'center', 
    marginBottom: 32 
  },
  
  title: { fontSize: 28, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 12, textAlign: 'center' },
  subtitle: { fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  
  footer: { paddingHorizontal: 24, paddingBottom: 40, gap: 12 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
  secondaryBtn: { backgroundColor: 'transparent', height: 56, borderRadius: 28, borderWidth: 1, borderColor: '#333', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: Colors.textPrimary, fontSize: 16, fontFamily: 'Inter_600SemiBold' },
});
