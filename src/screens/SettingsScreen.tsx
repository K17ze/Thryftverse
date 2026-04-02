import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { Alert } from 'react-native';
import { CURRENCIES, SupportedCurrencyCode } from '../constants/currencies';
import { useCurrencyPref } from '../hooks/useCurrencyPref';
import { BottomSheetPicker } from '../components/BottomSheetPicker';

type Props = StackScreenProps<RootStackParamList, 'Settings'>;
const TEAL = '#4ECDC4';

interface SettingItem {
  icon: string;
  title: string;
  subtitle?: string;
  color: string;
  onPress?: () => void;
}

export default function SettingsScreen({ navigation }: Props) {
  const logout = useStore(state => state.logout);
  const [currencyPickerVisible, setCurrencyPickerVisible] = React.useState(false);
  const {
    currencyCode,
    displayModeLabel,
    setCurrencyCode,
    cycleDisplayMode,
  } = useCurrencyPref();

  const currencyOptions = React.useMemo(
    () =>
      (Object.keys(CURRENCIES) as SupportedCurrencyCode[]).map(
        (code) => `${code} · ${CURRENCIES[code].name} (${CURRENCIES[code].symbol})`
      ),
    []
  );

  const selectedCurrencyOption = React.useMemo(
    () =>
      currencyOptions.find((option) => option.startsWith(`${currencyCode} ·`)),
    [currencyCode, currencyOptions]
  );

  const handleCurrencySelect = (option: string) => {
    const selectedCode = option.split(' · ')[0] as SupportedCurrencyCode;
    if (selectedCode !== currencyCode) {
      setCurrencyCode(selectedCode);
    }
  };

  const renderSettingRow = (item: SettingItem, isLast: boolean = false) => (
    <AnimatedPressable
      key={item.title}
      style={[styles.settingRow, !isLast && styles.settingRowBorder]}
      activeOpacity={0.7}
      onPress={item.onPress}
    >
      <View style={[styles.iconSquare, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
        <Ionicons name={item.icon as any} size={20} color={item.color} />
      </View>
      <View style={styles.settingTexts}>
        <Text style={styles.settingTitle}>{item.title}</Text>
        {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </AnimatedPressable>
  );

  const accountItems: SettingItem[] = [
    { icon: 'person-outline', title: 'Profile Details', subtitle: 'Username, bio, location', color: TEAL, onPress: () => navigation.navigate('EditProfile') },
    { icon: 'key-outline', title: 'Account Settings', subtitle: 'Email, password, security', color: '#FFD700', onPress: () => navigation.navigate('AccountSettings') },
    { icon: 'card-outline', title: 'Payments', subtitle: 'Cards and bank accounts', color: '#BB86FC', onPress: () => navigation.navigate('Payments') },
    { icon: 'cube-outline', title: 'Postage', subtitle: 'Default carrier and options', color: '#FF6B6B', onPress: () => navigation.navigate('Postage') },
  ];

  const notifItems: SettingItem[] = [
    { icon: 'notifications-outline', title: 'Push Notifications', subtitle: 'Messages, offers, wishlist', color: TEAL, onPress: () => navigation.navigate('PushNotifications') },
    { icon: 'mail-outline', title: 'Email Notifications', subtitle: 'Newsletters and updates', color: '#64B5F6' },
  ];

  const appItems: SettingItem[] = [
    { icon: 'language-outline', title: 'Language', subtitle: 'English EN', color: '#FFD700', onPress: () => Alert.alert('Language', 'Language switching coming soon.') },
    {
      icon: 'swap-horizontal-outline',
      title: 'Currency Display',
      subtitle: displayModeLabel,
      color: TEAL,
      onPress: cycleDisplayMode,
    },
    {
      icon: 'globe-outline',
      title: 'Local Fiat Currency',
      subtitle: `${currencyCode} (${CURRENCIES[currencyCode].symbol})`,
      color: '#64B5F6',
      onPress: () => setCurrencyPickerVisible(true),
    },
    { icon: 'moon-outline', title: 'Dark Mode', subtitle: 'Always on', color: '#BB86FC', onPress: () => Alert.alert('Dark Mode', 'Dark mode is always on.') },
  ];

  const supportItems: SettingItem[] = [
    { icon: 'help-circle-outline', title: 'Help Centre', subtitle: 'FAQs and support', color: TEAL, onPress: () => navigation.navigate('HelpSupport') },
    { icon: 'document-text-outline', title: 'Terms & Conditions', color: '#a0a0a0', onPress: () => Alert.alert('Terms & Conditions', 'Opening terms...') },
    { icon: 'shield-checkmark-outline', title: 'Privacy Policy', color: '#a0a0a0', onPress: () => Alert.alert('Privacy Policy', 'Opening privacy policy...') },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <View>
          <Text style={styles.headerLabel}>PREFERENCES</Text>
          <Text style={styles.hugeTitle}>Settings</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Account */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Account</Text>
          <Text style={styles.sectionDesc}>Manage your profile and payment methods</Text>
        </View>
        <View style={styles.pillCard}>
          {accountItems.map((item, i) => renderSettingRow(item, i === accountItems.length - 1))}
        </View>

        {/* Notifications */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Notifications</Text>
          <Text style={styles.sectionDesc}>Choose what you want to hear about</Text>
        </View>
        <View style={styles.pillCard}>
          {notifItems.map((item, i) => renderSettingRow(item, i === notifItems.length - 1))}
        </View>

        {/* App */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>App</Text>
          <Text style={styles.sectionDesc}>Customise your Thryftverse experience</Text>
        </View>
        <View style={styles.pillCard}>
          {appItems.map((item, i) => renderSettingRow(item, i === appItems.length - 1))}
        </View>

        {/* Support */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Support</Text>
          <Text style={styles.sectionDesc}>Get help and read our policies</Text>
        </View>
        <View style={styles.pillCard}>
          {supportItems.map((item, i) => renderSettingRow(item, i === supportItems.length - 1))}
        </View>

        {/* Logout */}
        <AnimatedPressable 
          style={styles.logoutPill} 
          activeOpacity={0.8}
          onPress={() => {
            logout();
            navigation.replace('AuthLanding');
          }}
        >
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} style={{ marginRight: 8 }} />
          <Text style={styles.logoutText}>Log out</Text>
        </AnimatedPressable>

        {/* Version */}
        <Text style={styles.versionText}>Thryftverse v1.0.0</Text>

      </ScrollView>

      <BottomSheetPicker
        visible={currencyPickerVisible}
        onClose={() => setCurrencyPickerVisible(false)}
        title="Choose Local Currency"
        options={currencyOptions}
        selectedValue={selectedCurrencyOption}
        onSelect={handleCurrencySelect}
        searchable
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 14,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#4ECDC4',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  hugeTitle: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40 },

  // Section headers with descriptions
  sectionHeader: {
    marginTop: 24,
    marginBottom: 12,
    paddingLeft: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 3,
  },
  sectionDesc: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
  },

  // Pill cards
  pillCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },

  // Larger square icons
  iconSquare: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
    borderWidth: 1,
  },
  settingTexts: { flex: 1 },
  settingTitle: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  settingSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginTop: 2 },

  logoutPill: {
    marginTop: 32,
    backgroundColor: '#1A0000',
    borderRadius: 20,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: 'rgba(255, 60, 60, 0.15)',
  },
  logoutText: { color: Colors.danger, fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  versionText: {
    textAlign: 'center',
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    marginTop: 24,
  },
});
