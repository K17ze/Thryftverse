import React from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { EmptyState } from '../components/EmptyState';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
import { SharedTransitionView } from '../components/SharedTransitionView';
import { useToast } from '../context/ToastContext';
import { useStore } from '../store/useStore';
import { NotificationEvent, listNotificationEvents } from '../services/notificationsApi';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Motion } from '../constants/motion';

type NavT = StackNavigationProp<RootStackParamList>;

type NotificationCardType = 'new_item' | 'like' | 'review' | 'order' | 'price' | 'generic';

type NotificationCard = {
  id: string;
  itemImage: string;
  text: string;
  time: string;
  type: NotificationCardType;
  read: boolean;
  createdAt: string;
  payload: Record<string, unknown>;
};

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_ALT = IS_LIGHT ? '#f7f4ef' : '#161616';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const BRAND = IS_LIGHT ? '#2f251b' : '#d7b98f';

function getNotifIcon(type: NotificationCardType): { name: string; color: string; bg: string } {
  switch (type) {
    case 'new_item':
      return { name: 'shirt-outline', color: IS_LIGHT ? '#5c4830' : '#d8c6a2', bg: IS_LIGHT ? '#f0e9df' : '#1f1a14' };
    case 'like':
      return { name: 'heart', color: '#e74c3c', bg: IS_LIGHT ? '#fdf0ef' : '#1f1212' };
    case 'review':
      return { name: 'star', color: '#FFD700', bg: IS_LIGHT ? '#fdf8e8' : '#1f1c0e' };
    case 'order':
      return { name: 'cube-outline', color: IS_LIGHT ? '#2d7d46' : '#5dd47a', bg: IS_LIGHT ? '#ecf7ef' : '#0f1f14' };
    case 'price':
      return { name: 'pricetag-outline', color: BRAND, bg: IS_LIGHT ? '#f4efe7' : '#171412' };
    default:
      return { name: 'notifications-outline', color: Colors.textMuted, bg: PANEL_ALT };
  }
}

function parsePayloadEvent(payload: Record<string, unknown>): string {
  const candidate = payload.event;
  return typeof candidate === 'string' ? candidate.toLowerCase() : '';
}

function deriveCardType(event: NotificationEvent): NotificationCardType {
  const payloadEvent = parsePayloadEvent(event.payload);
  const mergedText = `${event.title} ${event.body}`.toLowerCase();

  if (payloadEvent.includes('shipment') || payloadEvent.includes('order') || payloadEvent.includes('deliver')) {
    return 'order';
  }

  if (payloadEvent.includes('review') || mergedText.includes('review')) {
    return 'review';
  }

  if (payloadEvent.includes('price') || mergedText.includes('price')) {
    return 'price';
  }

  if (payloadEvent.includes('like') || mergedText.includes('like')) {
    return 'like';
  }

  if (mergedText.includes('listing') || mergedText.includes('new item')) {
    return 'new_item';
  }

  return 'generic';
}

function formatRelativeTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Just now';
  }

  const diffMs = Date.now() - parsed.getTime();
  const minutes = Math.max(0, Math.floor(diffMs / 60_000));
  if (minutes < 1) {
    return 'Just now';
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function buildNotificationImage(event: NotificationEvent, index: number): string {
  const payloadOrderId = event.payload.orderId;
  const payloadListingId = event.payload.listingId;
  const primarySeed =
    typeof payloadOrderId === 'string'
      ? payloadOrderId
      : typeof payloadListingId === 'string'
        ? payloadListingId
        : event.id;

  return `https://picsum.photos/seed/notif-${primarySeed}-${index}/80/80`;
}

function mapEventToCard(
  event: NotificationEvent,
  index: number,
  readIds: Set<string>
): NotificationCard {
  return {
    id: event.id,
    itemImage: buildNotificationImage(event, index),
    text: `${event.title} ${event.body}`.trim(),
    time: formatRelativeTime(event.createdAt),
    type: deriveCardType(event),
    read: readIds.has(event.id),
    createdAt: event.createdAt,
    payload: event.payload,
  };
}

function groupNotifications(notifications: NotificationCard[]) {
  const now = Date.now();
  const today: NotificationCard[] = [];
  const thisWeek: NotificationCard[] = [];
  const earlier: NotificationCard[] = [];

  notifications.forEach((notification) => {
    const parsed = new Date(notification.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      today.push(notification);
      return;
    }

    const ageHours = Math.max(0, (now - parsed.getTime()) / 3_600_000);
    if (ageHours < 24) {
      today.push(notification);
      return;
    }

    if (ageHours < 24 * 7) {
      thisWeek.push(notification);
      return;
    }

    earlier.push(notification);
  });

  const sections: Array<{ title: string; data: NotificationCard[] }> = [];
  if (today.length > 0) {
    sections.push({ title: 'Today', data: today });
  }
  if (thisWeek.length > 0) {
    sections.push({ title: 'This Week', data: thisWeek });
  }
  if (earlier.length > 0) {
    sections.push({ title: 'Earlier', data: earlier });
  }

  return sections;
}

export default function NotificationsScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const currentUser = useStore((state) => state.currentUser);
  const reducedMotionEnabled = useReducedMotion();
  const [notifications, setNotifications] = React.useState<NotificationCard[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const hasShownSyncErrorRef = React.useRef(false);

  const syncNotifications = React.useCallback(
    async (options?: { silent?: boolean }) => {
      if (!currentUser?.id) {
        setNotifications([]);
        return;
      }

      if (!options?.silent) {
        setIsLoading(true);
      }

      try {
        const events = await listNotificationEvents(currentUser.id, 80);
        setNotifications((previous) => {
          const readIds = new Set(previous.filter((item) => item.read).map((item) => item.id));
          return events.map((event, index) => mapEventToCard(event, index, readIds));
        });
        hasShownSyncErrorRef.current = false;
      } catch {
        if (!options?.silent || !hasShownSyncErrorRef.current) {
          show('Unable to sync notifications right now.', 'error');
          hasShownSyncErrorRef.current = true;
        }
      } finally {
        if (!options?.silent) {
          setIsLoading(false);
        }
      }
    },
    [currentUser?.id, show]
  );

  useFocusEffect(
    React.useCallback(() => {
      void syncNotifications();

      const refreshInterval = setInterval(() => {
        void syncNotifications({ silent: true });
      }, 30_000);

      return () => {
        clearInterval(refreshInterval);
      };
    }, [syncNotifications])
  );

  const sections = React.useMemo(() => groupNotifications(notifications), [notifications]);
  const hasUnread = React.useMemo(() => notifications.some((item) => !item.read), [notifications]);

  const handleMarkAllAsRead = React.useCallback(() => {
    if (!hasUnread) {
      show('You are all caught up', 'info');
      return;
    }

    setNotifications((previous) => previous.map((item) => ({ ...item, read: true })));
    show('Marked all notifications as read', 'success');
  }, [hasUnread, show]);

  const handleOpenNotification = React.useCallback(
    (notification: NotificationCard) => {
      setNotifications((previous) =>
        previous.map((item) => (item.id === notification.id ? { ...item, read: true } : item))
      );

      const orderId = typeof notification.payload.orderId === 'string' ? notification.payload.orderId : null;
      if (orderId) {
        navigation.navigate('OrderDetail', { orderId });
        return;
      }

      const listingId = typeof notification.payload.listingId === 'string' ? notification.payload.listingId : null;
      if (listingId) {
        navigation.push('ItemDetail', { itemId: listingId });
        return;
      }

      show('No linked destination for this notification yet.', 'info');
    },
    [navigation, show]
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
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.sectionTitle}>{title}</Text>
        )}
        renderItem={({ item, index }) => {
          const icon = getNotifIcon(item.type);
          const listingId = typeof item.payload.listingId === 'string' ? item.payload.listingId : undefined;
          return (
            <Reanimated.View
              entering={
                reducedMotionEnabled
                  ? undefined
                  : FadeInDown
                      .delay(Math.min(index, Motion.list.maxStaggerItems) * Motion.list.staggerStep)
                      .duration(Motion.list.enterDuration)
              }
            >
              <AnimatedPressable
                style={[styles.notifCard, !item.read && styles.notifCardUnread]}
                activeOpacity={0.8}
                onPress={() => handleOpenNotification(item)}
                accessibilityLabel={`${item.read ? '' : 'Unread: '}${item.text}, ${item.time}`}
              >
                {!item.read && <View style={styles.unreadDot} />}

                <View style={styles.notifImageWrap}>
                  <SharedTransitionView
                    style={styles.notifImageShared}
                    sharedTransitionTag={listingId ? `image-${listingId}-0` : undefined}
                  >
                    <CachedImage uri={item.itemImage} style={styles.notifImage} contentFit="cover" />
                  </SharedTransitionView>
                </View>

                <View style={styles.notifBody}>
                  <Text style={[styles.notifText, !item.read && styles.notifTextUnread]} numberOfLines={3}>
                    {item.text}
                  </Text>
                  <View style={styles.notifMetaRow}>
                    <View style={[styles.notifTypeIcon, { backgroundColor: icon.bg }]}> 
                      <Ionicons name={icon.name as never} size={12} color={icon.color} />
                    </View>
                    <Text style={styles.notifTime}>{item.time}</Text>
                  </View>
                </View>
              </AnimatedPressable>
            </Reanimated.View>
          );
        }}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={Colors.accent} size="small" />
              <Text style={styles.loadingText}>Syncing notifications...</Text>
            </View>
          ) : (
            <EmptyState
              icon="notifications-outline"
              title="No notifications yet"
              subtitle="We'll notify you about new items, price drops, and order updates."
              iconColor={Colors.textMuted}
            />
          )
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
  notifImageShared: {
    ...StyleSheet.absoluteFillObject,
  },
  notifImage: { width: '100%', height: '100%' },

  notifBody: { flex: 1 },
  notifText: {
    color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular',
    lineHeight: 20, marginBottom: 8,
  },
  notifTextUnread: { color: Colors.textPrimary, fontFamily: 'Inter_500Medium' },

  notifMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notifTypeIcon: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
  notifTime: { fontSize: 12, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },

  loadingState: {
    marginTop: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
});
