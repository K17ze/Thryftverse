import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [isSent, setIsSent] = useState(false);

  const handleReset = () => {
    // Fake APi call
    if (email.trim() !== '') {
      setIsSent(true);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView 
        style={styles.content} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.title}>Reset{'\n'}Password</Text>
        
        {isSent ? (
          <View style={styles.successState}>
            <Ionicons name="mail-unread-outline" size={48} color={Colors.success} />
            <Text style={styles.successText}>We have sent a password reset link to {email}.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.9}>
              <Text style={styles.primaryText}>Return to Login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.form}>
            <Text style={styles.subtitle}>Enter your email address and we will send you a link to reset your password.</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput 
                style={styles.input} 
                placeholder="Enter your email" 
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
            </View>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.primaryBtn} onPress={handleReset} activeOpacity={0.9}>
                <Text style={styles.primaryText}>Send Reset Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, lineHeight: 48, letterSpacing: -1, marginBottom: 20 },
  subtitle: { fontSize: 16, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, marginBottom: 40, lineHeight: 24 },
  
  form: { marginBottom: 40 },
  inputGroup: { marginBottom: 40 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 12 },
  input: { 
    height: 56, 
    borderBottomWidth: 1, 
    borderBottomColor: '#222', 
    color: Colors.textPrimary, 
    fontSize: 16, 
    fontFamily: 'Inter_400Regular' 
  },
  
  footer: { paddingBottom: 40 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', width: '100%', marginTop: 20 },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },

  successState: {
    alignItems: 'center',
    paddingTop: 20,
  },
  successText: {
    fontSize: 16,
    color: Colors.textPrimary,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginVertical: 24,
    lineHeight: 24,
  }
});
