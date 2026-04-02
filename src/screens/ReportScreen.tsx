import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  StatusBar
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';

const REASONS = [
  "Spam or misleading",
  "Inappropriate content",
  "Counterfeit item",
  "Seller unresponsive",
  "Other"
];

export default function ReportScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  
  // Could be 'item' or 'user'
  const reportType = route.params?.type || 'item';
  
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = () => {
    if (selectedReason) {
      setIsSubmitted(true);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Report {reportType === 'user' ? 'User' : 'Item'}</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {isSubmitted ? (
          <View style={styles.successState}>
            <Ionicons name="checkmark-circle-outline" size={64} color={Colors.success} />
            <Text style={styles.successTitle}>Report Submitted</Text>
            <Text style={styles.successText}>Thank you for helping keep the Thryftverse safe. Our moderation team will review this shortly.</Text>
            <AnimatedPressable style={styles.primaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.9}>
              <Text style={styles.primaryText}>Return</Text>
            </AnimatedPressable>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.promptText}>Why are you reporting this {reportType}?</Text>
            
            <View style={styles.reasonsList}>
              {REASONS.map((reason) => (
                <AnimatedPressable 
                  key={reason} 
                  style={[styles.reasonRow, selectedReason === reason && styles.selectedRow]}
                  onPress={() => setSelectedReason(reason)}
                >
                  <Text style={[styles.reasonText, selectedReason === reason && styles.selectedText]}>{reason}</Text>
                  {selectedReason === reason && (
                    <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
                  )}
                </AnimatedPressable>
              ))}
            </View>

            <View style={styles.footer}>
              <AnimatedPressable 
                style={[styles.primaryBtn, !selectedReason && styles.disabledBtn]} 
                onPress={handleSubmit} 
                activeOpacity={0.9}
                disabled={!selectedReason}
              >
                <Text style={styles.primaryText}>Submit Report</Text>
              </AnimatedPressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: 20, 
    paddingTop: 10, 
    paddingBottom: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, textTransform: 'capitalize' },
  
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  form: { flex: 1 },
  
  promptText: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 24 },
  
  reasonsList: { gap: 12 },
  reasonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 16,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  selectedRow: {
    backgroundColor: Colors.accent,
  },
  reasonText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  selectedText: { color: Colors.textInverse, fontFamily: 'Inter_700Bold' },
  
  footer: { flex: 1, justifyContent: 'flex-end', paddingBottom: 40 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  disabledBtn: { opacity: 0.5 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },

  successState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 100,
  },
  successTitle: {
    fontSize: 24,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginTop: 24,
  },
  successText: {
    fontSize: 16,
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginVertical: 16,
    lineHeight: 24,
    maxWidth: '80%',
  }
});
