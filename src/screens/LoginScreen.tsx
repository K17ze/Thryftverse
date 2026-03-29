import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export default function LoginScreen() {
  const navigation = useNavigation<any>();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = () => {
    // Navigate straight to MainTabs temporarily (dummy auth)
    navigation.replace('MainTabs');
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
        <Text style={styles.title}>Welcome{'\n'}back.</Text>
        
        <View style={styles.form}>
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
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput 
              style={styles.input} 
              placeholder="Enter your password" 
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
          </View>

          <TouchableOpacity style={styles.forgotBtn}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} activeOpacity={0.9}>
            <Text style={styles.primaryText}>Log In</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, lineHeight: 48, letterSpacing: -1, marginBottom: 40 },
  
  form: { marginBottom: 40 },
  inputGroup: { marginBottom: 24 },
  label: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 12 },
  input: { 
    height: 56, 
    borderBottomWidth: 1, 
    borderBottomColor: '#222', 
    color: Colors.textPrimary, 
    fontSize: 16, 
    fontFamily: 'Inter_400Regular' 
  },
  
  forgotBtn: { alignSelf: 'flex-start', marginTop: 8 },
  forgotText: { color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_500Medium', textDecorationLine: 'underline' },
  
  footer: { paddingBottom: 40 },
  primaryBtn: { backgroundColor: Colors.textPrimary, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
