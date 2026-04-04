import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, ScrollView, Platform } from 'react-native';
import { BottomSheet } from '../BottomSheet';
import { AnimatedPressable } from '../AnimatedPressable';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../../constants/colors';
import { useStore } from '../../store/useStore';
import { useToast } from '../../context/ToastContext';
import { createUserAddress } from '../../services/commerceApi';
import * as Haptics from 'expo-haptics';

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_SOFT_BG = IS_LIGHT ? '#f7f4ef' : '#151515';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';

interface Props {
  visible: boolean;
  onDismiss: () => void;
  onSuccess?: () => void;
}

export function AddAddressSheet({ visible, onDismiss, onSuccess }: Props) {
  const [name, setName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [postcode, setPostcode] = useState('');
  const [isDefaultAddress, setIsDefaultAddress] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const currentUser = useStore((state) => state.currentUser);
  const saveAddress = useStore((state) => state.saveAddress);
  const { show } = useToast();

  useEffect(() => {
    if (!visible) {
      setName('');
      setStreet('');
      setCity('');
      setPostcode('');
      setIsDefaultAddress(true);
    }
  }, [visible]);

  const isFormValid = name.trim() && street.trim() && city.trim() && postcode.trim();

  const handleSave = async () => {
    if (!isFormValid || isSaving) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

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
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      saveAddress(nextAddress);
      show('Address saved locally. Backend sync unavailable.', 'info');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setIsSaving(false);
      onDismiss();
      if (onSuccess) onSuccess();
    }
  };

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss} snapPoint={0.88}>
      <Text style={styles.sheetTitle}>Delivery Address</Text>
      
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
              />
            </View>
          </View>
        </View>

        <AnimatedPressable
          style={[styles.defaultToggleRow, isDefaultAddress && styles.defaultToggleRowActive]}
          activeOpacity={0.9}
          onPress={() => setIsDefaultAddress((current) => !current)}
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

        <View style={{ height: 40 }} />
      </ScrollView>

      <View style={styles.footer}>
        <AnimatedPressable 
          style={[styles.saveBtn, (!isFormValid || isSaving) && styles.saveBtnDisabled]} 
          onPress={handleSave}
          disabled={!isFormValid || isSaving}
          activeOpacity={0.9}
        >
          <Text style={[styles.saveBtnText, (!isFormValid || isSaving) && styles.saveBtnTextDisabled]}>
            {isSaving ? 'Processing...' : 'Save Address'}
          </Text>
        </AnimatedPressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sheetTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 20 },
  content: { paddingTop: 10, paddingBottom: 40 },
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
  footer: { paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 0 : 20 },
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
