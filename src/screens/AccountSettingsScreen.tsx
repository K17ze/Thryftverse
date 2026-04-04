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
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';

export default function AccountSettingsScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
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
  const [facebookLinked, setFacebookLinked] = useState(true);
  const [googleLinked, setGoogleLinked] = useState(false);

  const handleToggleTwoFactor = (enabled: boolean) => {
    if (enabled) {
      navigation.navigate('TwoFactorSetup');
      return;
    }

    setTwoFactorEnabled(false);
    show('Two-factor authentication disabled', 'info');
  };

  const handleFacebookLink = () => {
    const next = !facebookLinked;
    setFacebookLinked(next);
    show(next ? 'Facebook linked' : 'Facebook unlinked', next ? 'success' : 'info');
  };

  const handleGoogleLink = () => {
    const next = !googleLinked;
    setGoogleLinked(next);
    show(next ? 'Google linked' : 'Google unlinked', next ? 'success' : 'info');
  };

  const handleDownloadData = () => {
    show('Data export requested. Check your email within 24 hours.', 'success');
  };

  const handleDeleteAccountSupport = () => {
    navigation.navigate('HelpSupport');
    show('Contact support to complete your account deletion request.', 'info');
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete account', 'This action cannot be undone. Contact support to complete account deletion.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Contact support', style: 'destructive', onPress: handleDeleteAccountSupport },
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
              onValueChange={handleToggleTwoFactor}
              trackColor={{ false: Colors.border, true: Colors.success }}
              thumbColor="#fff"
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
        <AnimatedPressable style={styles.supportRow} onPress={handleDownloadData} activeOpacity={0.8}>
          <Ionicons name="download-outline" size={20} color={Colors.textPrimary} style={{ marginRight: 12 }} />
          <Text style={styles.rowTitle}>Download my data</Text>
        </AnimatedPressable>

        <AnimatedPressable style={styles.dangerBtn} onPress={handleDeleteAccount} activeOpacity={0.9}>
          <Text style={styles.dangerText}>Delete Account</Text>
        </AnimatedPressable>
      </ScrollView>

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

  dangerBtn: { borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.2)', backgroundColor: 'rgba(255, 60, 60, 0.08)', borderRadius: 30, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  dangerText: { color: Colors.danger, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
