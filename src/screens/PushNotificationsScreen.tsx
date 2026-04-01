import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  Switch,
  ScrollView,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';

type Props = StackScreenProps<RootStackParamList, 'PushNotifications'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

type NotifItem = { key: string; label: string; subtitle: string };

const NOTIFICATIONS: NotifItem[] = [
  { key: 'messages', label: 'New messages', subtitle: 'When someone sends you a message' },
  { key: 'offers', label: 'Offers received', subtitle: 'When buyers make an offer on your item' },
  { key: 'wishlist', label: 'Wishlist activity', subtitle: 'When someone likes your item' },
  { key: 'followers', label: 'New followers', subtitle: 'When someone starts following you' },
  { key: 'orderUpdates', label: 'Order updates', subtitle: 'Shipping and delivery status changes' },
  { key: 'priceDrops', label: 'Price drops', subtitle: 'For items on your wishlist' },
  { key: 'news', label: 'Thryftverse news', subtitle: 'Promotions, features and announcements' },
];

export default function PushNotificationsScreen({ navigation }: Props) {
  const [toggles, setToggles] = useState<Record<string, boolean>>(
    Object.fromEntries(NOTIFICATIONS.map(n => [n.key, true]))
  );

  const toggle = (key: string) =>
    setToggles(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Push notifications</Text>
        <View style={{ width: 24 }} />
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
                  trackColor={{ false: '#333', true: TEAL }}
                  thumbColor={TEXT}
                />
              </View>
              {idx < NOTIFICATIONS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.footerNote}>
          You can also manage push notifications from your device Settings app.
        </Text>
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
    borderBottomColor: '#1a1a1a',
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
  card: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 15, fontWeight: '600', color: TEXT, marginBottom: 2 },
  rowSubtitle: { fontSize: 12, color: MUTED },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 18 },
  footerNote: { fontSize: 12, color: MUTED, textAlign: 'center', lineHeight: 18, paddingHorizontal: 10 },
});
