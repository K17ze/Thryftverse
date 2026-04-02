import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { Confetti } from '../components/Confetti';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type Props = StackScreenProps<RootStackParamList, 'ListingSuccess'>;

const TEAL = '#4ECDC4';

export default function ListingSuccessScreen({ navigation }: Props) {
  const { formatFromFiat } = useFormattedPrice();
  const bumpFeeLabel = formatFromFiat(1.99, 'GBP', { displayMode: 'fiat' });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      <Confetti />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        
        {/* Celebration Header */}
        <View style={styles.heroSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="checkmark" size={64} color={TEAL} />
          </View>
          <Text style={styles.heroBigText}>It's Live.</Text>
          <Text style={styles.heroSubText}>Your item is now visible to the community.</Text>
        </View>

        {/* Promotion Upsell Card */}
        <View style={styles.promoCard}>
          <View style={styles.promoBadge}>
            <Ionicons name="flash" size={12} color="#000" />
            <Text style={styles.promoBadgeText}>Sell 3x Faster</Text>
          </View>
          <Text style={styles.promoTitle}>Bump your listing</Text>
          <Text style={styles.promoDesc}>
            Push your item to the top of the feed and search results for 3 days.
          </Text>

          <AnimatedPressable style={styles.bumpBtn} activeOpacity={0.9}>
            <Text style={styles.bumpBtnText}>Promote for {bumpFeeLabel}</Text>
          </AnimatedPressable>
        </View>

        {/* Standard Actions */}
        <AnimatedPressable 
          style={styles.actionRowBtn} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('MainTabs')} // Dummy routing to view listing later
        >
          <View style={styles.actionLeft}>
            <View style={styles.actionIconBox}>
              <Ionicons name="eye-outline" size={20} color={Colors.textPrimary} />
            </View>
            <Text style={styles.actionText}>View my listing</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

        <AnimatedPressable 
          style={styles.actionRowBtn} 
          activeOpacity={0.8}
          onPress={() => navigation.replace('MainTabs')}
        >
          <View style={styles.actionLeft}>
            <View style={styles.actionIconBox}>
              <Ionicons name="home-outline" size={20} color={Colors.textPrimary} />
            </View>
            <Text style={styles.actionText}>Back to Home</Text>
          </View>
          <Ionicons name="arrow-forward" size={16} color={Colors.textMuted} />
        </AnimatedPressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  
  content: { paddingHorizontal: 20, paddingTop: 40, paddingBottom: 60 },

  heroSection: {
    alignItems: 'center',
    marginBottom: 48,
  },
  iconCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#0a1a1a', // subtle teal tint
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  heroBigText: {
    fontSize: 48,
    fontFamily: 'Inter_800ExtraBold',
    color: Colors.textPrimary,
    letterSpacing: -2,
    marginBottom: 8,
  },
  heroSubText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },

  promoCard: {
    backgroundColor: '#111',
    borderRadius: 24,
    padding: 24,
    marginBottom: 40,
    borderWidth: 1,
    borderColor: '#222',
  },
  promoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: TEAL,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: 16,
  },
  promoBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#000', textTransform: 'uppercase', letterSpacing: 0.5 },
  promoTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
  promoDesc: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textSecondary, lineHeight: 22, marginBottom: 24 },
  
  bumpBtn: {
    backgroundColor: Colors.textPrimary,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bumpBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },

  actionRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
  },
  actionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  actionIconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
});
