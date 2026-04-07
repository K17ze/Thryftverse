import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  TextInput,
  StatusBar,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { parseApiError } from '../lib/apiClient';
import { requestMyDataExport, deleteMyAccount } from '../services/accountApi';
import { disableTwoFactor, logoutFromSession } from '../services/authApi';

export default function AccountSettingsScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const currentUser = useStore((state) => state.currentUser);
  const logout = useStore((state) => state.logout);
  const twoFactorEnabled = useStore((state) => state.twoFactorEnabled);
  const setTwoFactorEnabled = useStore((state) => state.setTwoFactorEnabled);
  const { show } = useToast();

  // Expanded Data States restored
  const [email, setEmail] = useState('user@example.com');
  const [phone, setPhone] = useState('+44 7700 900077');
  const [fullName, setFullName] = useState('John Doe');
  const [birthday, setBirthday] = useState('14/05/1996');
  const [holidayMode, setHolidayMode] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(false);
  const facebookLinked = false;
  const googleLinked = false;
  const [isExporting, setIsExporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isTogglingTwoFactor, setIsTogglingTwoFactor] = useState(false);
  const [disableTwoFactorModalVisible, setDisableTwoFactorModalVisible] = useState(false);
  const [disableTwoFactorCode, setDisableTwoFactorCode] = useState('');
  const [disableTwoFactorRecoveryCode, setDisableTwoFactorRecoveryCode] = useState('');

  const handleToggleTwoFactor = async (enabled: boolean) => {
    if (isTogglingTwoFactor) {
      return;
    }

    if (enabled) {
      navigation.navigate('TwoFactorSetup');
      return;
    }

    setDisableTwoFactorCode('');
    setDisableTwoFactorRecoveryCode('');
    setDisableTwoFactorModalVisible(true);
  };

  const closeDisableTwoFactorModal = () => {
    if (isTogglingTwoFactor) {
      return;
    }

    setDisableTwoFactorModalVisible(false);
  };

  const confirmDisableTwoFactor = async () => {
    const normalizedCode = disableTwoFactorCode.replace(/\s+/g, '').trim();
    const normalizedRecoveryCode = disableTwoFactorRecoveryCode.trim().toUpperCase();

    if (!normalizedCode && !normalizedRecoveryCode) {
      show('Enter your authenticator code or a recovery code to disable 2FA.', 'error');
      return;
    }

    setIsTogglingTwoFactor(true);
    try {
      await disableTwoFactor({
        code: normalizedCode || undefined,
        recoveryCode: normalizedRecoveryCode || undefined,
      });
      setTwoFactorEnabled(false);
      setDisableTwoFactorModalVisible(false);
      show('Two-factor authentication disabled', 'info');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to disable two-factor authentication right now.');
      show(parsed.message, 'error');
    } finally {
      setIsTogglingTwoFactor(false);
    }
  };

  const handleFacebookLink = () => {
    show('Facebook account linking is not available yet. Use Help Centre for support.', 'info');
  };

  const handleGoogleLink = () => {
    show('Google sign-in is available from the auth landing screen.', 'info');
  };

  const handleDownloadData = async () => {
    if (!currentUser?.id) {
      show('Please sign in before requesting a data export.', 'error');
      return;
    }

    setIsExporting(true);
    try {
      const result = await requestMyDataExport();
      const recordText = result.estimatedRecords > 0 ? ` (${result.estimatedRecords} records)` : '';
      show(`Data export generated${recordText}. Request ID: ${result.requestId}`, 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to export account data right now.');
      show(parsed.message, 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDeleteAccountSupport = () => {
    navigation.navigate('HelpSupport');
    show('Contact support to complete your account deletion request.', 'info');
  };

  const confirmDeleteAccount = async () => {
    if (!currentUser?.id) {
      show('Please sign in before deleting your account.', 'error');
      return;
    }

    setIsDeleting(true);
    try {
      const result = await deleteMyAccount('User initiated account deletion from mobile settings');
      await logoutFromSession();
      logout();
      show(`Account deleted. Request ID: ${result.requestId}`, 'success');
      navigation.reset({
        index: 0,
        routes: [{ name: 'AuthLanding' }],
      });
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to delete account right now.');
      show(parsed.message, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account', 'This action cannot be undone. Do you want to delete this account now?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Contact support', style: 'default', onPress: handleDeleteAccountSupport },
      { text: 'Delete now', style: 'destructive', onPress: () => void confirmDeleteAccount() },
    ]);
  };

  const handleSaveChanges = () => {
    show('Account details saved', 'success');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Account</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Profile Inputs */}
        <Text style={styles.sectionTitle}>Personal Details</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={email} onChangeText={setEmail} keyboardType="email-address" />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={fullName} onChangeText={setFullName} />
          </View>
          <Text style={styles.helperText}>Used for shipping labels. Not public.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={birthday} onChangeText={setBirthday} />
            <Ionicons name="calendar-outline" size={20} color={Colors.textMuted} />
          </View>
        </View>

        {/* Restored Switches / Options */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.cardGroup}>
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Holiday Mode</Text>
              <Text style={styles.rowSub}>Hide your items for up to 90 days</Text>
            </View>
            <Switch 
              value={holidayMode} 
              onValueChange={setHolidayMode}
              trackColor={{ false: Colors.border, true: Colors.success }}
              thumbColor="#fff"
            />
          </View>
          <View style={[styles.actionRow, { paddingBottom: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Private Profile</Text>
              <Text style={styles.rowSub}>Only followers can see your items</Text>
            </View>
            <Switch 
              value={privateProfile} 
              onValueChange={setPrivateProfile}
              trackColor={{ false: Colors.border, true: Colors.success }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.cardGroup}>
          <AnimatedPressable style={styles.actionRow} onPress={() => navigation.navigate('ChangePassword')}>
            <View>
              <Text style={styles.rowTitle}>Password</Text>
              <Text style={styles.rowSub}>Last changed 2 months ago</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </AnimatedPressable>
          <View style={[styles.actionRow, { paddingBottom: 0 }]}>
            <View>
              <Text style={styles.rowTitle}>Two-Factor Authentication</Text>
              <Text style={styles.rowSub}>Authenticator app verification</Text>
            </View>
            <Switch 
              value={twoFactorEnabled} 
              onValueChange={(value) => void handleToggleTwoFactor(value)}
              trackColor={{ false: Colors.border, true: Colors.success }}
              thumbColor="#fff"
              disabled={isTogglingTwoFactor}
            />
          </View>
        </View>

        {/* Linked Accounts */}
        <Text style={styles.sectionTitle}>Linked Accounts</Text>
        <View style={styles.cardGroup}>
          <AnimatedPressable style={styles.actionRow} onPress={handleFacebookLink} activeOpacity={0.8}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="logo-facebook" size={24} color={Colors.textPrimary} />
              <Text style={styles.rowTitle}>Facebook</Text>
            </View>
            {facebookLinked ? (
              <View style={styles.linkBadgeActive}>
                <Text style={styles.linkBadgeTextActive}>Linked</Text>
              </View>
            ) : (
              <View style={styles.linkBadge}>
                <Text style={styles.linkBadgeText}>Link</Text>
              </View>
            )}
          </AnimatedPressable>
          <AnimatedPressable style={[styles.actionRow, { paddingBottom: 0 }]} onPress={handleGoogleLink} activeOpacity={0.8}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="logo-google" size={24} color={Colors.textPrimary} />
              <Text style={styles.rowTitle}>Google</Text>
            </View>
            {googleLinked ? (
              <View style={styles.linkBadgeActive}>
                <Text style={styles.linkBadgeTextActive}>Linked</Text>
              </View>
            ) : (
              <View style={styles.linkBadge}>
                <Text style={styles.linkBadgeText}>Link</Text>
              </View>
            )}
          </AnimatedPressable>
        </View>

        <AnimatedPressable style={styles.saveBtn} onPress={handleSaveChanges} activeOpacity={0.9}>
          <Text style={styles.saveBtnText}>Save Changes</Text>
        </AnimatedPressable>

        {/* Footer Actions */}
        <AnimatedPressable
          style={[styles.supportRow, (isExporting || isDeleting) && styles.actionDisabled]}
          onPress={() => void handleDownloadData()}
          activeOpacity={0.8}
          disabled={isExporting || isDeleting}
        >
          <Ionicons name="download-outline" size={20} color={Colors.textPrimary} style={{ marginRight: 12 }} />
          {isExporting ? (
            <View style={styles.inlineLoadingRow}>
              <ActivityIndicator color={Colors.textPrimary} size="small" style={{ marginRight: 8 }} />
              <Text style={styles.rowTitle}>Preparing export...</Text>
            </View>
          ) : (
            <Text style={styles.rowTitle}>Download my data</Text>
          )}
        </AnimatedPressable>

        <AnimatedPressable
          style={[styles.dangerBtn, (isDeleting || isExporting) && styles.actionDisabled]}
          onPress={handleDeleteAccount}
          activeOpacity={0.9}
          disabled={isDeleting || isExporting}
        >
          {isDeleting ? (
            <View style={styles.inlineLoadingRow}>
              <ActivityIndicator color={Colors.danger} size="small" style={{ marginRight: 8 }} />
              <Text style={styles.dangerText}>Deleting account...</Text>
            </View>
          ) : (
            <Text style={styles.dangerText}>Delete Account</Text>
          )}
        </AnimatedPressable>
      </ScrollView>

      <Modal
        visible={disableTwoFactorModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeDisableTwoFactorModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Disable 2FA</Text>
            <Text style={styles.modalCopy}>
              Confirm with your authenticator code or a recovery code.
            </Text>

            <View style={styles.modalInputWrap}>
              <Text style={styles.modalLabel}>Authenticator code</Text>
              <TextInput
                style={styles.modalInput}
                value={disableTwoFactorCode}
                onChangeText={setDisableTwoFactorCode}
                keyboardType="number-pad"
                placeholder="123456"
                placeholderTextColor={Colors.textMuted}
                editable={!isTogglingTwoFactor}
                maxLength={12}
              />
            </View>

            <View style={styles.modalInputWrap}>
              <Text style={styles.modalLabel}>Recovery code</Text>
              <TextInput
                style={styles.modalInput}
                value={disableTwoFactorRecoveryCode}
                onChangeText={setDisableTwoFactorRecoveryCode}
                autoCapitalize="characters"
                placeholder="ABCD-EFGH"
                placeholderTextColor={Colors.textMuted}
                editable={!isTogglingTwoFactor}
                maxLength={32}
              />
            </View>

            <View style={styles.modalActionRow}>
              <AnimatedPressable
                style={[styles.modalBtn, styles.modalBtnMuted]}
                onPress={closeDisableTwoFactorModal}
                disabled={isTogglingTwoFactor}
              >
                <Text style={styles.modalBtnMutedText}>Cancel</Text>
              </AnimatedPressable>

              <AnimatedPressable
                style={[styles.modalBtn, styles.modalBtnDanger, isTogglingTwoFactor && styles.actionDisabled]}
                onPress={() => void confirmDisableTwoFactor()}
                disabled={isTogglingTwoFactor}
              >
                {isTogglingTwoFactor ? (
                  <ActivityIndicator color={Colors.background} size="small" />
                ) : (
                  <Text style={styles.modalBtnDangerText}>Disable</Text>
                )}
              </AnimatedPressable>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.card, alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginLeft: 6, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1 },
  pillInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.card, borderRadius: 24, paddingHorizontal: 20, height: 56 },
  inputText: { flex: 1, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },
  helperText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginLeft: 6, marginTop: 6 },

  cardGroup: { backgroundColor: Colors.card, borderRadius: 24, paddingVertical: 16, paddingHorizontal: 20 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 24 },
  rowTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  rowSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, paddingRight: 10 },
  linkBadge: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6 },
  linkBadgeText: { color: Colors.textPrimary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  linkBadgeActive: { backgroundColor: Colors.cardAlt, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6 },
  linkBadgeTextActive: { color: Colors.textSecondary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  saveBtn: { marginTop: 24, backgroundColor: Colors.accent, borderRadius: 30, height: 56, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: Colors.textInverse, fontSize: 16, fontFamily: 'Inter_700Bold' },

  supportRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24, marginTop: 16 },
  inlineLoadingRow: { flexDirection: 'row', alignItems: 'center' },
  actionDisabled: { opacity: 0.55 },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 18,
    gap: 10,
  },
  modalTitle: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
  },
  modalCopy: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 19,
  },
  modalInputWrap: {
    marginTop: 4,
  },
  modalLabel: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  modalInput: {
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.background,
    color: Colors.textPrimary,
    paddingHorizontal: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
  },
  modalActionRow: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 10,
  },
  modalBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnMuted: {
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalBtnMutedText: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  modalBtnDanger: {
    backgroundColor: Colors.danger,
  },
  modalBtnDangerText: {
    color: Colors.background,
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },

  dangerBtn: { borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.2)', backgroundColor: 'rgba(255, 60, 60, 0.08)', borderRadius: 30, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  dangerText: { color: Colors.danger, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
