import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, Platform, ScrollView, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { ActiveTheme, Colors } from '../constants/colors';
import { useToast } from '../context/ToastContext';
import { AnimatedPressable } from '../components/AnimatedPressable';

const FOOTER_BG = ActiveTheme === 'light' ? 'rgba(236, 234, 230, 0.96)' : 'rgba(10, 10, 10, 0.95)';

export default function ChangePasswordScreen() {
  const navigation = useNavigation();
  const { show } = useToast();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSecure, setIsSecure] = useState(true);

  const handleUpdate = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      show('Please fill in all fields', 'error');
      return;
    }
    if (newPassword.length < 8) {
      show('New password must be at least 8 characters', 'error');
      return;
    }
    if (currentPassword === newPassword) {
      show('New password must be different from current password', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      show('New passwords do not match', 'error');
      return;
    }
    show('Password updated successfully', 'success');
    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Change Password</Text>
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          
          <Text style={styles.sectionTitle}>Security</Text>
          
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Current Password</Text>
            <View style={styles.pillInput}>
              <TextInput 
                style={styles.inputText} 
                value={currentPassword} 
                onChangeText={setCurrentPassword} 
                secureTextEntry={isSecure}
                placeholder="Enter current password"
                placeholderTextColor={Colors.textMuted}
              />
              <AnimatedPressable onPress={() => setIsSecure(!isSecure)} hitSlop={10}>
                <Ionicons name={isSecure ? "eye-off-outline" : "eye-outline"} size={20} color={Colors.textSecondary} />
              </AnimatedPressable>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>New Password</Text>
            <View style={styles.pillInput}>
              <TextInput 
                style={styles.inputText} 
                value={newPassword} 
                onChangeText={setNewPassword} 
                secureTextEntry={isSecure}
                placeholder="Enter new password"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
            <Text style={styles.helperText}>Must be at least 8 characters</Text>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm New Password</Text>
            <View style={styles.pillInput}>
              <TextInput 
                style={styles.inputText} 
                value={confirmPassword} 
                onChangeText={setConfirmPassword} 
                secureTextEntry={isSecure}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>

        </ScrollView>

        <View style={styles.footer}>
          <AnimatedPressable style={styles.saveBtn} onPress={handleUpdate}>
            <Text style={styles.saveBtnText}>Update Password</Text>
          </AnimatedPressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginLeft: 6, marginTop: 24, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 },
  
  inputGroup: { marginBottom: 20 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1 },
  pillInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 24, paddingHorizontal: 20, height: 56 },
  inputText: { flex: 1, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },
  helperText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginLeft: 6, marginTop: 6 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: FOOTER_BG,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
});
