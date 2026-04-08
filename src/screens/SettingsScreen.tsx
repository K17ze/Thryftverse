import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { logoutFromSession } from '../services/authApi';
import { CURRENCIES, SupportedCurrencyCode } from '../constants/currencies';
import { useCurrencyPref } from '../hooks/useCurrencyPref';
import { BottomSheetPicker } from '../components/BottomSheetPicker';
import { useToast } from '../context/ToastContext';
import {
  LANGUAGE_OPTIONS,
  SupportedLanguageOption,
} from '../preferences/settingsPreferences';
import { useSettingsPreferences } from '../context/SettingsPreferencesContext';
import {
  getStoredThemePreference,
  getThemePreferenceLabel,
  ThemePreference,
  updateThemePreference,
} from '../theme/themePreference';

type Props = StackScreenProps<RootStackParamList, 'Settings'>;
const ACCENT = '#d7b98f';
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : ACCENT;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;

interface SettingItem {
  icon: string;
  title: string;
  subtitle?: string;
  color: string;
  onPress?: () => void;
}

export default function SettingsScreen({ navigation }: Props) {
  const logout = useStore(state => state.logout);
  const { show } = useToast();
  const {
    language: selectedLanguage,
    emailNotificationsEnabled,
    pushEnabledCount,
    pushTotalCount,
    setLanguage,
    toggleEmailNotifications,
  } = useSettingsPreferences();
  const [currencyPickerVisible, setCurrencyPickerVisible] = React.useState(false);
  const [themePickerVisible, setThemePickerVisible] = React.useState(false);
  const [languagePickerVisible, setLanguagePickerVisible] = React.useState(false);
  const [themePreference, setThemePreference] = React.useState<ThemePreference>('system');
  const {
    currencyCode,
    displayModeLabel,
    setCurrencyCode,
    cycleDisplayMode,
  } = useCurrencyPref();

  const currencyOptions = React.useMemo(
    () =>
      (Object.keys(CURRENCIES) as SupportedCurrencyCode[]).map(
        (code) => `${code} | ${CURRENCIES[code].name} (${CURRENCIES[code].symbol})`
      ),
    []
  );

  const selectedCurrencyOption = React.useMemo(
    () =>
      currencyOptions.find((option) => option.startsWith(`${currencyCode} |`)),
    [currencyCode, currencyOptions]
  );

  const themeOptions = React.useMemo(() => ['System', 'Light', 'Dark'], []);
  const languageOptions = React.useMemo(() => [...LANGUAGE_OPTIONS], []);

  const selectedThemeOption = React.useMemo(
    () => themeOptions.find((option) => option.toLowerCase() === themePreference),
    [themeOptions, themePreference]
  );
  const pushNotificationsSubtitle = `${pushEnabledCount}/${pushTotalCount} types enabled`;

  React.useEffect(() => {
    getStoredThemePreference().then(setThemePreference).catch(() => {
      // Ignore persistence errors and keep default.
    });
  }, []);

  const handleCurrencySelect = (option: string) => {
    const selectedCode = option.split(' | ')[0] as SupportedCurrencyCode;
    if (selectedCode !== currencyCode) {
      setCurrencyCode(selectedCode);
    }
  };

  const handleThemeSelect = async (option: string) => {
    const nextPreference = option.toLowerCase() as ThemePreference;

    if (nextPreference === themePreference) {
      return;
    }

    setThemePreference(nextPreference);
    const reloaded = await updateThemePreference(nextPreference, { reloadApp: true });

    if (!reloaded) {
      show('Theme updated. Restart the app to fully apply this mode.', 'info');
    }
  };

  const handleLanguageSelect = (option: string) => {
    if (!LANGUAGE_OPTIONS.includes(option as SupportedLanguageOption)) {
      return;
    }

    const nextLanguage = option as SupportedLanguageOption;

    if (nextLanguage === selectedLanguage) {
      return;
    }

    setLanguage(nextLanguage);
  };

  const handleToggleEmailNotifications = React.useCallback(() => {
    const next = !emailNotificationsEnabled;
    toggleEmailNotifications();
    show(next ? 'Email notifications enabled' : 'Email notifications paused', next ? 'success' : 'info');
  }, [emailNotificationsEnabled, show, toggleEmailNotifications]);

  const handleOpenExternal = React.useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      show('Unable to open link. Please try again in a moment.', 'error');
    }
  }, [show]);

  const renderSettingRow = (item: SettingItem, isLast: boolean = false) => {
    const isInteractive = Boolean(item.onPress);

    return (
      <AnimatedPressable
        key={item.title}
        style={[styles.settingRow, !isLast && styles.settingRowBorder, !isInteractive && styles.settingRowDisabled]}
        activeOpacity={0.7}
        onPress={item.onPress}
        disabled={!isInteractive}
      >
        <View style={[styles.iconSquare, { backgroundColor: item.color + '18', borderColor: item.color + '30' }]}>
          <Ionicons name={item.icon as any} size={20} color={item.color} />
        </View>
        <View style={styles.settingTexts}>
          <Text style={styles.settingTitle}>{item.title}</Text>
          {item.subtitle && <Text style={styles.settingSubtitle}>{item.subtitle}</Text>}
        </View>
        {isInteractive ? <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} /> : null}
      </AnimatedPressable>
    );
  };

  const accountItems: SettingItem[] = [
    { icon: 'person-outline', title: 'Profile Details', subtitle: 'Username, bio, location', color: ACCENT, onPress: () => navigation.navigate('EditProfile') },
    { icon: 'key-outline', title: 'Account Settings', subtitle: 'Email, password, security', color: '#FFD700', onPress: () => navigation.navigate('AccountSettings') },
    { icon: 'card-outline', title: 'Payments', subtitle: 'Cards and bank accounts', color: '#BB86FC', onPress: () => navigation.navigate('Payments') },
    { icon: 'cube-outline', title: 'Postage', subtitle: 'Default carrier and options', color: '#FF6B6B', onPress: () => navigation.navigate('Postage') },
  ];

  const profileHubItems: SettingItem[] = [
    {
      icon: 'person-circle-outline',
      title: 'Account settings',
      subtitle: 'Security and account access',
      color: ACCENT,
      onPress: () => navigation.navigate('AccountSettings'),
    },
    {
      icon: 'notifications-outline',
      title: 'Notification controls',
      subtitle: pushNotificationsSubtitle,
      color: '#64B5F6',
      onPress: () => navigation.navigate('PushNotifications'),
    },
    {
      icon: 'color-palette-outline',
      title: 'Theme and profile style',
      subtitle: getThemePreferenceLabel(themePreference),
      color: '#BB86FC',
      onPress: () => navigation.navigate('Personalisation'),
    },
  ];

  const notifItems: SettingItem[] = [
    {
      icon: 'notifications-outline',
      title: 'Push Notifications',
      subtitle: pushNotificationsSubtitle,
      color: ACCENT,
      onPress: () => navigation.navigate('PushNotifications'),
    },
    {
      icon: 'mail-outline',
      title: 'Email Notifications',
      subtitle: emailNotificationsEnabled ? 'Enabled for newsletters and updates' : 'Paused',
      color: '#64B5F6',
      onPress: handleToggleEmailNotifications,
    },
  ];

  const appItems: SettingItem[] = [
    {
      icon: 'language-outline',
      title: 'Language',
      subtitle: selectedLanguage,
      color: '#FFD700',
      onPress: () => setLanguagePickerVisible(true),
    },
    {
      icon: 'swap-horizontal-outline',
      title: 'Currency Display',
      subtitle: displayModeLabel,
      color: ACCENT,
      onPress: cycleDisplayMode,
    },
    {
      icon: 'globe-outline',
      title: 'Local Fiat Currency',
      subtitle: `${currencyCode} (${CURRENCIES[currencyCode].symbol})`,
      color: '#64B5F6',
      onPress: () => setCurrencyPickerVisible(true),
    },
    {
      icon: 'color-palette-outline',
      title: 'Theme',
      subtitle: getThemePreferenceLabel(themePreference),
      color: '#BB86FC',
      onPress: () => setThemePickerVisible(true),
    },
  ];

  const supportItems: SettingItem[] = [
    { icon: 'help-circle-outline', title: 'Help Centre', subtitle: 'FAQs and support', color: ACCENT, onPress: () => navigation.navigate('HelpSupport') },
    {
      icon: 'document-text-outline',
      title: 'Terms & Conditions',
      color: '#a0a0a0',
      onPress: () => {
        void handleOpenExternal('https://thryftverse.app/terms');
      },
    },
    {
      icon: 'shield-checkmark-outline',
      title: 'Privacy Policy',
      color: '#a0a0a0',
      onPress: () => {
        void handleOpenExternal('https://thryftverse.app/privacy');
      },
    },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

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

        {/* Profile Hub */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Profile Hub</Text>
          <Text style={styles.sectionDesc}>Account, notifications, and profile style controls</Text>
        </View>
        <View style={styles.pillCard}>
          {profileHubItems.map((item, i) => renderSettingRow(item, i === profileHubItems.length - 1))}
        </View>

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
          onPress={async () => {
            await logoutFromSession();
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

      <BottomSheetPicker
        visible={languagePickerVisible}
        onClose={() => setLanguagePickerVisible(false)}
        title="Language"
        options={languageOptions}
        selectedValue={selectedLanguage}
        onSelect={handleLanguageSelect}
      />

      <BottomSheetPicker
        visible={themePickerVisible}
        onClose={() => setThemePickerVisible(false)}
        title="Theme Mode"
        options={themeOptions}
        selectedValue={selectedThemeOption}
        onSelect={handleThemeSelect}
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
    backgroundColor: PANEL_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: BRAND,
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
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
  },
  settingRowDisabled: {
    opacity: 0.72,
  },
  settingRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
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
    backgroundColor: 'rgba(255, 60, 60, 0.08)',
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


