import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { AppButton } from '../components/ui/AppButton';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { createUserAddress } from '../services/commerceApi';

type Props = StackScreenProps<RootStackParamList, 'AddAddress'>;
const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = Colors.card;
const PANEL_SOFT_BG = Colors.cardAlt;
const PANEL_BORDER = Colors.border;
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.97)' : 'rgba(10,10,10,0.95)';

export default function AddAddressScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [isDefaultAddress, setIsDefaultAddress] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const currentUser = useStore((state) => state.currentUser);
  const saveAddress = useStore((state) => state.saveAddress);
  const { show } = useToast();

  const isFormValid = name.trim() && street.trim() && city.trim() && postcode.trim();

  const handleSave = async () => {
    if (!isFormValid || isSaving) {
      return;
    }

    const nextAddress = {
      name: name.trim(),
      street: street.trim(),
      city: city.trim(),
      postcode: postcode.trim().toUpperCase(),
      isDefault: isDefaultAddress,
    };

    setIsSaving(true);
    try {
      const userId = currentUser?.id ?? 'u1';
      const saved = await createUserAddress(userId, nextAddress);

      saveAddress({
        id: saved.id,
        name: saved.name,
        street: saved.street,
        city: saved.city,
        postcode: saved.postcode,
        isDefault: saved.isDefault,
      });
      show('Delivery address saved', 'success');
    } catch {
      saveAddress(nextAddress);
      show('Address saved locally. Backend sync unavailable.', 'info');
    } finally {
      setIsSaving(false);
      navigation.goBack();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
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
                selectionColor={Colors.accent}
                accessibilityLabel="Full name"
                accessibilityHint="Enter your full delivery name"
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
                selectionColor={Colors.accent}
                accessibilityLabel="Street address"
                accessibilityHint="Enter your street and house number"
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
                  selectionColor={Colors.accent}
                  accessibilityLabel="City"
                  accessibilityHint="Enter your city or town"
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
                  selectionColor={Colors.accent}
                  accessibilityLabel="Postcode"
                  accessibilityHint="Enter your postcode"
                />
              </View>
            </View>
          </View>

          <AnimatedPressable
            style={[styles.defaultToggleRow, isDefaultAddress && styles.defaultToggleRowActive]}
            activeOpacity={0.9}
            onPress={() => setIsDefaultAddress((current) => !current)}
            accessibilityRole="switch"
            accessibilityLabel="Set as default delivery address"
            accessibilityHint="Toggles whether this address is your default"
            accessibilityState={{ checked: isDefaultAddress }}
          >
            <Ionicons
              name={isDefaultAddress ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={isDefaultAddress ? Colors.accent : Colors.textSecondary}
            />
            <Text style={[styles.defaultToggleText, !isDefaultAddress && styles.defaultToggleTextMuted]}>
              Set as default delivery address
            </Text>
          </AnimatedPressable>

        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
          <AppButton
            title={isSaving ? 'Saving...' : 'Save Address'}
            onPress={handleSave}
            disabled={!isFormValid || isSaving}
            style={[styles.saveBtn, (!isFormValid || isSaving) && styles.saveBtnDisabled]}
            titleStyle={[styles.saveBtnText, (!isFormValid || isSaving) && styles.saveBtnTextDisabled]}
            accessibilityLabel={isSaving ? 'Saving address' : 'Save address'}
            accessibilityHint="Saves this delivery address"
          />
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
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: Colors.textPrimary },

  content: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 40 },
  
  heroCopy: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
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
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 60,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PANEL_BORDER,
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
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    padding: 20,
    borderRadius: 20,
    marginTop: 16,
    gap: 12,
  },
  defaultToggleRowActive: {
    borderColor: Colors.accent,
    backgroundColor: PANEL_SOFT_BG,
  },
  defaultToggleText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  defaultToggleTextMuted: {
    color: Colors.textSecondary,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    borderTopWidth: 1,
    borderTopColor: PANEL_BORDER,
    backgroundColor: FOOTER_BG,
  },
  saveBtn: {
    backgroundColor: Colors.accent,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: {
    backgroundColor: PANEL_SOFT_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  saveBtnText: {
    color: Colors.textInverse,
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
  },
  saveBtnTextDisabled: {
    color: Colors.textMuted,
  },
});
