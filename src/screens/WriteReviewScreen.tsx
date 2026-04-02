import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StatusBar
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';

export default function WriteReviewScreen() {
  const navigation = useNavigation<any>();
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');

  const submitReview = () => {
    // Navigate back to orders
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Write a Review</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.form}>
          <Text style={styles.promptText}>How was your experience?</Text>
          
          <View style={styles.starsContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <AnimatedPressable key={star} onPress={() => setRating(star)}>
                <Ionicons 
                  name={rating >= star ? "star" : "star-outline"} 
                  size={44} 
                  color={rating >= star ? Colors.star : Colors.textMuted} 
                />
              </AnimatedPressable>
            ))}
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Detailed Review (Optional)</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Tell others what you thought about the item and seller..." 
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
              value={review}
              onChangeText={setReview}
            />
          </View>
        </View>

        <View style={styles.footer}>
          <AnimatedPressable 
            style={[styles.primaryBtn, rating === 0 && styles.disabledBtn]} 
            onPress={submitReview} 
            activeOpacity={0.9}
            disabled={rating === 0}
          >
            <Text style={styles.primaryText}>Submit Review</Text>
          </AnimatedPressable>
        </View>
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
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },
  
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  form: { flex: 1 },
  
  promptText: { fontSize: 22, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, textAlign: 'center', marginBottom: 24 },
  starsContainer: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginBottom: 40 },
  
  inputGroup: { flex: 1 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 12 },
  input: { 
    flex: 1,
    maxHeight: 200,
    backgroundColor: '#111',
    borderRadius: 16,
    padding: 16,
    color: Colors.textPrimary, 
    fontSize: 15, 
    fontFamily: 'Inter_400Regular' 
  },
  
  footer: { paddingBottom: 40 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  disabledBtn: { opacity: 0.5 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
