import React from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  StatusBar,
} from 'react-native';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { MOCK_NOTIFICATIONS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { EmptyState } from '../components/EmptyState';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
import { useToast } from '../context/ToastContext';

type NavT = StackNavigationProp<RootStackParamList>;

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_ALT = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';

// Enrich notifications with read state and more types for demo
const ENRICHED_NOTIFICATIONS = [
  ...MOCK_NOTIFICATIONS.map((n, i) => ({ ...n, read: i > 0 })),
  {
    id: 'n4',
    itemImage: 'https://picsum.photos/seed/noti4/80/80',
    text: 'Your listing "Off-White Hoodie" received 5 new likes today.',
    time: '5 hours ago',
    type: 'like' as const,
    read: true,
  },
  {
    id: 'n5',
    itemImage: 'https://picsum.photos/seed/noti5/80/80',
    text: 'samrivera left you a 5* review: "Great quality item, well packaged."',
    time: 'Yesterday',
    type: 'review' as const,
    read: true,
  },
  {
    id: 'n6',
    itemImage: 'https://picsum.photos/seed/noti6/80/80',
    text: 'Your order from dankdunksuk has been shipped! Track it in My Orders.',
    time: '2 days ago',
    type: 'order' as const,
    read: true,
  },
  {
    id: 'n7',
    itemImage: 'https://picsum.photos/seed/noti7/80/80',
    text: 'Price drop alert: "Stussy Logo Tee" is now 20% off.',
    time: '3 days ago',
    type: 'price' as const,
    read: true,
  },
];

function getNotifIcon(type: string): { name: string; color: string; bg: string } {
  switch (type) {
    case 'new_item': return { name: 'shirt-outline', color: IS_LIGHT ? '#5c4830' : '#d8c6a2', bg: IS_LIGHT ? '#f0e9df' : '#1f1a14' };
    case 'like': return { name: 'heart', color: '#e74c3c', bg: IS_LIGHT ? '#fdf0ef' : '#1f1212' };
    case 'review': return { name: 'star', color: '#FFD700', bg: IS_LIGHT ? '#fdf8e8' : '#1f1c0e' };
    case 'order': return { name: 'cube-outline', color: IS_LIGHT ? '#2d7d46' : '#5dd47a', bg: IS_LIGHT ? '#ecf7ef' : '#0f1f14' };
    case 'price': return { name: 'pricetag-outline', color: BRAND, bg: IS_LIGHT ? '#f4efe7' : '#171412' };
    default: return { name: 'notifications-outline', color: Colors.textMuted, bg: PANEL_ALT };
  }
}

// Group notifications into time sections
function groupNotifications(notifications: typeof ENRICHED_NOTIFICATIONS) {
  const today: typeof ENRICHED_NOTIFICATIONS = [];
  const thisWeek: typeof ENRICHED_NOTIFICATIONS = [];
  const earlier: typeof ENRICHED_NOTIFICATIONS = [];

  notifications.forEach(n => {
    const t = n.time.toLowerCase();
    if (t.includes('just now') || t.includes('hour') || t.includes('minute')) {
      today.push(n);
    } else if (t.includes('yesterday') || t.includes('day')) {
      thisWeek.push(n);
    } else {
      earlier.push(n);
    }
  });

  const sections = [];
  if (today.length > 0) sections.push({ title: 'Today', data: today });
  if (thisWeek.length > 0) sections.push({ title: 'This Week', data: thisWeek });
  if (earlier.length > 0) sections.push({ title: 'Earlier', data: earlier });
  return sections;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const [notifications, setNotifications] = React.useState(ENRICHED_NOTIFICATIONS);

  const sections = React.useMemo(() => groupNotifications(notifications), [notifications]);
  const hasUnread = React.useMemo(() => notifications.some((item) => !item.read), [notifications]);

  const handleMarkAllAsRead = React.useCallback(() => {
    if (!hasUnread) {
      show('You are all caught up', 'info');
      return;
    }

    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
    show('Marked all notifications as read', 'success');
  }, [hasUnread, show]);

  const handleOpenNotification = React.useCallback(
    (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((item) => (item.id === notificationId ? { ...item, read: true } : item))
      );
      navigation.navigate('ItemDetail', { itemId: '1' });
    },
    [navigation]
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} accessibilityLabel="Go back">
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Notifications</Text>
        <AnimatedPressable style={styles.backBtn} onPress={handleMarkAllAsRead} accessibilityLabel={hasUnread ? 'Mark all notifications as read' : 'All caught up'}>
          <Ionicons
            name="checkmark-done-outline"
            size={22}
            color={hasUnread ? Colors.textPrimary : Colors.textMuted}
          />
        </AnimatedPressable>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(n) => n.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.sectionTitle}>{title}</Text>
        )}
        renderItem={({ item, index }) => {
          const icon = getNotifIcon(item.type);
          return (
            <Reanimated.View entering={FadeInDown.delay(Math.min(index, 8) * 60).duration(350)}>
              <AnimatedPressable
                style={[styles.notifCard, !item.read && styles.notifCardUnread]}
                activeOpacity={0.8}
                onPress={() => handleOpenNotification(item.id)}
                accessibilityLabel={`${item.read ? '' : 'Unread: '}${item.text}, ${item.time}`}
              >
                {/* Unread dot */}
                {!item.read && <View style={styles.unreadDot} />}

                {/* Item image thumbnail */}
                <View style={styles.notifImageWrap}>
                  <CachedImage uri={item.itemImage} style={styles.notifImage} contentFit="cover" />
                </View>

                {/* Content */}
                <View style={styles.notifBody}>
                  <Text style={[styles.notifText, !item.read && styles.notifTextUnread]} numberOfLines={3}>
                    {item.text}
                  </Text>
                  <View style={styles.notifMetaRow}>
                    <View style={[styles.notifTypeIcon, { backgroundColor: icon.bg }]}>
                      <Ionicons name={icon.name as any} size={12} color={icon.color} />
                    </View>
                    <Text style={styles.notifTime}>{item.time}</Text>
                  </View>
                </View>
              </AnimatedPressable>
            </Reanimated.View>
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="notifications-outline"
            title="No notifications yet"
            subtitle="We'll notify you about new items, price drops, and order updates."
            iconColor={Colors.textMuted}
          />
        }
      />
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
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: PANEL_BORDER,
  },
  backBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: PANEL_BG,
    borderWidth: 1, borderColor: PANEL_BORDER,
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },

  listContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 120 },

  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 24,
    marginBottom: 14,
    marginLeft: 4,
  },

  notifCard: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  notifCardUnread: {
    backgroundColor: IS_LIGHT ? '#f9f6f0' : '#141210',
    borderColor: IS_LIGHT ? '#d4c9b5' : '#332e26',
  },

  unreadDot: {
    position: 'absolute',
    top: 18,
    left: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
  },

  notifImageWrap: {
    width: 52, height: 52, borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: PANEL_ALT,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  notifImage: { width: '100%', height: '100%' },

  notifBody: { flex: 1 },
  notifText: { 
    color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', 
    lineHeight: 20, marginBottom: 8 
  },
  notifTextUnread: { color: Colors.textPrimary, fontFamily: 'Inter_500Medium' },

  notifMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifTypeIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  notifTime: { fontSize: 12, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },
});

