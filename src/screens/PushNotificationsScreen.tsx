import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  StatusBar,
  Platform,
  ActivityIndicator,
} from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import {
  PUSH_NOTIFICATION_DEFINITIONS,
} from '../preferences/settingsPreferences';
import { useToast } from '../context/ToastContext';
import { useSettingsPreferences } from '../context/SettingsPreferencesContext';
import { useStore } from '../store/useStore';
import { parseApiError } from '../lib/apiClient';
import { deactivateNotificationDevice, registerNotificationDevice } from '../services/notificationsApi';

type Props = StackScreenProps<RootStackParamList, 'PushNotifications'>;

const IS_LIGHT = ActiveTheme === 'light';
const TEAL = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const BG = Colors.background;
const CARD = Colors.card;
const BORDER = Colors.border;
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;

const NOTIFICATIONS = PUSH_NOTIFICATION_DEFINITIONS;

export default function PushNotificationsScreen({ navigation }: Props) {
  const currentUser = useStore((state) => state.currentUser);
  const { show } = useToast();
  const {
    pushNotificationToggles: toggles,
    pushEnabledCount: enabledCount,
    pushTotalCount,
    setPushNotificationToggle,
    setAllPushNotificationToggles,
  } = useSettingsPreferences();
  const [isSyncingDevice, setIsSyncingDevice] = React.useState(false);
  const [registeredToken, setRegisteredToken] = React.useState<string | null>(null);
  const [isDeviceRegistered, setIsDeviceRegistered] = React.useState(false);

  const resolvePushPlatform = React.useCallback((): 'ios' | 'android' | 'web' => {
    if (Platform.OS === 'ios') {
      return 'ios';
    }

    if (Platform.OS === 'android') {
      return 'android';
    }

    return 'web';
  }, []);

  const resolveProjectId = React.useCallback(() => {
    const fromExpoConfig = (Constants.expoConfig as { extra?: { eas?: { projectId?: string } } } | null)
      ?.extra?.eas?.projectId;
    const fromEasConfig = (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    return fromExpoConfig ?? fromEasConfig;
  }, []);

  const ensureDeviceRegistration = React.useCallback(async () => {
    if (!currentUser?.id) {
      show('Please sign in to enable push notifications.', 'error');
      return;
    }

    setIsSyncingDevice(true);
    try {
      const permission = await Notifications.getPermissionsAsync();
      let finalStatus = permission.status;

      if (finalStatus !== 'granted') {
        const request = await Notifications.requestPermissionsAsync();
        finalStatus = request.status;
      }

      if (finalStatus !== 'granted') {
        show('Push permissions were denied on this device.', 'error');
        return;
      }

      const projectId = resolveProjectId();
      const tokenResponse = projectId
        ? await Notifications.getExpoPushTokenAsync({ projectId })
        : await Notifications.getExpoPushTokenAsync();
      const token = tokenResponse.data;

      await registerNotificationDevice({
        userId: currentUser.id,
        token,
        platform: resolvePushPlatform(),
        appVersion: (Constants.expoConfig as { version?: string } | null)?.version,
        metadata: {
          enabledNotificationTypes: enabledCount,
        },
      });

      setRegisteredToken(token);
      setIsDeviceRegistered(true);
      show('This device is now registered for push delivery.', 'success');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to register this device for push notifications.');
      show(parsed.message, 'error');
    } finally {
      setIsSyncingDevice(false);
    }
  }, [currentUser?.id, enabledCount, resolveProjectId, resolvePushPlatform, show]);

  const disableDeviceRegistration = React.useCallback(async () => {
    if (!registeredToken) {
      setIsDeviceRegistered(false);
      show('This device is already not registered for push delivery.', 'info');
      return;
    }

    setIsSyncingDevice(true);
    try {
      await deactivateNotificationDevice(registeredToken);
      setIsDeviceRegistered(false);
      setRegisteredToken(null);
      show('Push delivery paused for this device.', 'info');
    } catch (error) {
      const parsed = parseApiError(error, 'Unable to pause push delivery for this device.');
      show(parsed.message, 'error');
    } finally {
      setIsSyncingDevice(false);
    }
  }, [registeredToken, show]);

  const toggle = async (key: string) => {
    const nextEnabled = !toggles[key];
    setPushNotificationToggle(key, nextEnabled);

    const nextCount = nextEnabled ? enabledCount + 1 : enabledCount - 1;
    if (nextCount === 1 && nextEnabled && !isDeviceRegistered) {
      await ensureDeviceRegistration();
    }

    if (nextCount === 0 && !nextEnabled && isDeviceRegistered) {
      await disableDeviceRegistration();
    }
  };

  const handleToggleAll = React.useCallback(async () => {
    const shouldEnableAll = enabledCount !== pushTotalCount;
    setAllPushNotificationToggles(shouldEnableAll);

    if (shouldEnableAll && !isDeviceRegistered) {
      await ensureDeviceRegistration();
    }

    if (!shouldEnableAll && isDeviceRegistered) {
      await disableDeviceRegistration();
    }

    show(
      shouldEnableAll ? 'All push notifications enabled' : 'All push notifications paused',
      shouldEnableAll ? 'success' : 'info'
    );
  }, [
    disableDeviceRegistration,
    enabledCount,
    ensureDeviceRegistration,
    isDeviceRegistered,
    pushTotalCount,
    setAllPushNotificationToggles,
    show,
  ]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Push notifications</Text>
        <AnimatedPressable onPress={() => void handleToggleAll()} disabled={isSyncingDevice}>
          <Ionicons
            name={enabledCount === pushTotalCount ? 'notifications-off-outline' : 'notifications-outline'}
            size={22}
            color={TEXT}
          />
        </AnimatedPressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>NOTIFICATION TYPES</Text>
        <View style={styles.card}>
          {NOTIFICATIONS.map((item, idx) => (
            <View key={item.key}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowLabel}>{item.label}</Text>
                  <Text style={styles.rowSubtitle}>{item.subtitle}</Text>
                </View>
                <Switch
                  value={toggles[item.key]}
                  onValueChange={() => void toggle(item.key)}
                  trackColor={{ false: BORDER, true: TEAL }}
                  thumbColor={Colors.textInverse}
                />
              </View>
              {idx < NOTIFICATIONS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <View style={styles.deviceCard}>
          <View style={styles.deviceHeaderRow}>
            <Text style={styles.deviceTitle}>Device Delivery</Text>
            <Text style={[styles.deviceBadge, isDeviceRegistered ? styles.deviceBadgeActive : styles.deviceBadgeMuted]}>
              {isDeviceRegistered ? 'Registered' : 'Not Registered'}
            </Text>
          </View>
          <Text style={styles.deviceCopy}>
            {isDeviceRegistered
              ? 'Push notifications can be delivered to this device.'
              : 'Register this device to receive push notifications when events occur.'}
          </Text>

          <AnimatedPressable
            style={[styles.deviceActionBtn, (!currentUser?.id || isSyncingDevice) && styles.deviceActionBtnDisabled]}
            onPress={() => {
              if (isDeviceRegistered) {
                void disableDeviceRegistration();
                return;
              }

              void ensureDeviceRegistration();
            }}
            disabled={!currentUser?.id || isSyncingDevice}
          >
            {isSyncingDevice ? (
              <ActivityIndicator color={Colors.background} size="small" />
            ) : (
              <Text style={styles.deviceActionText}>{isDeviceRegistered ? 'Deactivate Device' : 'Register Device'}</Text>
            )}
          </AnimatedPressable>
        </View>

        <Text style={styles.footerNote}>
          You can also manage push notifications from your device Settings app.
        </Text>
        <Text style={styles.footerMeta}>{enabledCount}/{pushTotalCount} notification types enabled</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20 },
  sectionLabel: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 2 },
  rowSubtitle: { fontSize: 12, color: MUTED },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 18 },
  deviceCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 18,
    gap: 12,
  },
  deviceHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  deviceTitle: { fontSize: 15, fontWeight: '700', color: TEXT },
  deviceBadge: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  deviceBadgeActive: {
    color: Colors.background,
    backgroundColor: Colors.accent,
  },
  deviceBadgeMuted: {
    color: MUTED,
    backgroundColor: Colors.cardAlt,
  },
  deviceCopy: { fontSize: 12, color: MUTED, lineHeight: 18 },
  deviceActionBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
  },
  deviceActionBtnDisabled: {
    opacity: 0.55,
  },
  deviceActionText: {
    color: Colors.background,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  footerNote: { fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
  footerMeta: { marginTop: 10, fontSize: 12, color: MUTED, textAlign: 'center' },
});
