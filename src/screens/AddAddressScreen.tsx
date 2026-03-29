import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'AddAddress'>;

export default function AddAddressScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');

  const isFormValid = name.trim() && street.trim() && city.trim() && postcode.trim();

  const handleSave = () => {
    if (isFormValid) {
      // Dummy save logic, just go back to Checkout
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Delivery Address</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          
          <Text style={styles.heroCopy}>Where should we send your items?</Text>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Full Name</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Jane Doe"
                placeholderTextColor={Colors.textMuted}
                value={name}
                onChangeText={setName}
                selectionColor="#4ECDC4"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.label}>Street Address</Text>
            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="123 Example Street"
                placeholderTextColor={Colors.textMuted}
                value={street}
                onChangeText={setStreet}
                selectionColor="#4ECDC4"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>City</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="London"
                  placeholderTextColor={Colors.textMuted}
                  value={city}
                  onChangeText={setCity}
                  selectionColor="#4ECDC4"
                />
              </View>
            </View>

            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text style={styles.label}>Postcode</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.input}
                  placeholder="SW1A 1AA"
                  placeholderTextColor={Colors.textMuted}
                  value={postcode}
                  onChangeText={setPostcode}
                  autoCapitalize="characters"
                  selectionColor="#4ECDC4"
                />
              </View>
            </View>
          </View>

          {/* Dummy Default Toggle */}
          <TouchableOpacity style={styles.defaultToggleRow} activeOpacity={0.9}>
            <Ionicons name="checkmark-circle" size={24} color={Colors.textPrimary} />
            <Text style={styles.defaultToggleText}>Set as default delivery address</Text>
          </TouchableOpacity>

        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity 
            style={[styles.saveBtn, !isFormValid && styles.saveBtnDisabled]} 
            onPress={handleSave}
            disabled={!isFormValid}
            activeOpacity={0.9}
          >
            <Text style={[styles.saveBtnText, !isFormValid && styles.saveBtnTextDisabled]}>Save Address</Text>
          </TouchableOpacity>
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20,
  },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },

  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  
  heroCopy: {
    fontSize: 28,
    fontFamily: 'Inter_800ExtraBold',
    color: Colors.textPrimary,
    letterSpacing: -1,
    lineHeight: 34,
    marginBottom: 40,
    maxWidth: '80%',
  },

  formGroup: { marginBottom: 24 },
  label: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
    marginLeft: 4,
  },
  inputWrapper: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 60,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#222',
  },
  input: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
  },

  row: { flexDirection: 'row', gap: 16 },

  defaultToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    padding: 20,
    borderRadius: 20,
    marginTop: 16,
    gap: 12,
  },
  defaultToggleText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
  },
  saveBtn: {
    backgroundColor: Colors.textPrimary,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: '#222',
  },
  saveBtnText: {
    color: Colors.background,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  saveBtnTextDisabled: {
    color: Colors.textMuted,
  },
});
