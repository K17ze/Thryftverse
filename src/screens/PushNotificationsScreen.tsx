import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  StatusBar
} from 'react-native';
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
  const { show } = useToast();
  const {
    pushNotificationToggles: toggles,
    pushEnabledCount: enabledCount,
    pushTotalCount,
    setPushNotificationToggle,
    setAllPushNotificationToggles,
  } = useSettingsPreferences();

  const toggle = (key: string) => {
    setPushNotificationToggle(key, !toggles[key]);
  };

  const handleToggleAll = React.useCallback(() => {
    const shouldEnableAll = enabledCount !== pushTotalCount;
    setAllPushNotificationToggles(shouldEnableAll);
    show(
      shouldEnableAll ? 'All push notifications enabled' : 'All push notifications paused',
      shouldEnableAll ? 'success' : 'info'
    );
  }, [enabledCount, pushTotalCount, setAllPushNotificationToggles, show]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Push notifications</Text>
        <AnimatedPressable onPress={handleToggleAll}>
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
                  onValueChange={() => toggle(item.key)}
                  trackColor={{ false: BORDER, true: TEAL }}
                  thumbColor={Colors.textInverse}
                />
              </View>
              {idx < NOTIFICATIONS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
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
  footerNote: { fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
  footerMeta: { marginTop: 10, fontSize: 12, color: MUTED, textAlign: 'center' },
});
