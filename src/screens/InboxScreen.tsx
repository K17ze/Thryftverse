import React, { useState, useCallback, useMemo } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  StatusBar,
  RefreshControl,
  TextInput,
  ScrollView,
} from 'react-native';
import { CachedImage } from '../components/CachedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { MOCK_USERS, MOCK_LISTINGS } from '../data/mockData';
import type { Conversation } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { Swipeable } from 'react-native-gesture-handler';
import Reanimated, { FadeInDown, useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { EmptyState } from '../components/EmptyState';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { fetchConversationsFromApi } from '../services/chatApi';

type NavT = StackNavigationProp<RootStackParamList>;
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : TEAL;
const PANEL_BG = Colors.card;
const PANEL_ALT = Colors.cardAlt;

type ConvoItem = Conversation;
type InboxSegment = 'all' | 'unread' | 'groups' | 'direct';
type InboxSortMode = 'latest' | 'unread_first' | 'groups_first';

const SEGMENT_OPTIONS: Array<{ key: InboxSegment; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
  { key: 'direct', label: 'Direct' },
];

const SORT_OPTIONS: Array<{ key: InboxSortMode; label: string }> = [
  { key: 'latest', label: 'Latest' },
  { key: 'unread_first', label: 'Unread First' },
  { key: 'groups_first', label: 'Groups First' },
];

export default function InboxScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings, refreshListings } = useBackendData();
  const conversations = useStore((state) => state.conversations);
  const upsertConversation = useStore((state) => state.upsertConversation);
  const deleteConversation = useStore((state) => state.deleteConversation);
  const archiveConversation = useStore((state) => state.archiveConversation);
  const markConversationRead = useStore((state) => state.markConversationRead);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [segment, setSegment] = useState<InboxSegment>('all');
  const [sortMode, setSortMode] = useState<InboxSortMode>('latest');

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshListings();

    try {
      const remoteConversations = await fetchConversationsFromApi();
      for (const conversation of remoteConversations) {
        upsertConversation(conversation);
      }
    } catch {
      // Keep existing local conversations when backend sync is unavailable.
    }

    setTimeout(() => setRefreshing(false), 400);
  };

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  const inboxStats = useMemo(() => {
    const unreadCount = conversations.filter((item) => item.unread).length;
    const groupCount = conversations.filter((item) => item.type === 'group').length;
    const directCount = conversations.length - groupCount;
    const botConversationCount = conversations.filter((item) => (item.botIds?.length ?? 0) > 0).length;

    return {
      unreadCount,
      groupCount,
      directCount,
      botConversationCount,
    };
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return conversations.filter((conversation) => {
      if (segment === 'unread' && !conversation.unread) {
        return false;
      }

      if (segment === 'groups' && conversation.type !== 'group') {
        return false;
      }

      if (segment === 'direct' && conversation.type !== 'dm') {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const listing = listings.find((item) => item.id === conversation.itemId)
        || MOCK_LISTINGS.find((item) => item.id === conversation.itemId);
      const seller = MOCK_USERS.find((user) => user.id === conversation.sellerId);
      const title = conversation.type === 'group'
        ? conversation.title ?? 'group chat'
        : seller?.username ?? 'direct message';

      return [
        title,
        conversation.lastMessage,
        listing?.title ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [conversations, listings, searchQuery, segment]);

  const visibleConversations = useMemo(() => {
    if (sortMode === 'latest') {
      return filteredConversations;
    }

    const ordered = [...filteredConversations];

    if (sortMode === 'unread_first') {
      ordered.sort((a, b) => Number(b.unread) - Number(a.unread));
      return ordered;
    }

    ordered.sort((a, b) => {
      const groupDelta = Number(b.type === 'group') - Number(a.type === 'group');
      if (groupDelta !== 0) {
        return groupDelta;
      }

      return Number(b.unread) - Number(a.unread);
    });

    return ordered;
  }, [filteredConversations, sortMode]);

  const handleMarkVisibleRead = useCallback(() => {
    const unreadTargets = visibleConversations.filter((conversation) => conversation.unread);
    if (!unreadTargets.length) {
      show('No unread conversations in this view', 'info');
      return;
    }

    unreadTargets.forEach((conversation) => {
      markConversationRead(conversation.id);
    });

    show(`${unreadTargets.length} conversation${unreadTargets.length === 1 ? '' : 's'} marked read`, 'success');
  }, [markConversationRead, show, visibleConversations]);

  const handleArchiveResolved = useCallback(() => {
    const resolvedTargets = visibleConversations.filter((conversation) => !conversation.unread);
    if (!resolvedTargets.length) {
      show('No resolved conversations in this view', 'info');
      return;
    }

    resolvedTargets.forEach((conversation) => {
      archiveConversation(conversation.id);
    });

    show(`${resolvedTargets.length} resolved conversation${resolvedTargets.length === 1 ? '' : 's'} archived`, 'info');
  }, [archiveConversation, show, visibleConversations]);

  const handleDelete = useCallback((id: string) => {
    deleteConversation(id);
    show('Conversation deleted', 'error');
  }, [deleteConversation, show]);

  const handleArchive = useCallback((id: string) => {
    archiveConversation(id);
    show('Conversation archived', 'info');
  }, [archiveConversation, show]);

  const renderRightActions = (id: string) => (
    <AnimatedPressable
      style={styles.swipeDelete}
      onPress={() => handleDelete(id)}
    >
      <Ionicons name="trash-outline" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Delete</Text>
    </AnimatedPressable>
  );

  const renderLeftActions = (id: string) => (
    <AnimatedPressable
      style={styles.swipeArchive}
      onPress={() => handleArchive(id)}
    >
      <Ionicons name="archive-outline" size={22} color="#fff" />
      <Text style={styles.swipeActionText}>Archive</Text>
    </AnimatedPressable>
  );

  const renderItem = ({ item, index }: { item: ConvoItem; index: number }) => {
    const isGroup = item.type === 'group';
    const seller = MOCK_USERS.find((u) => u.id === item.sellerId);
    const listing = listings.find((l) => l.id === item.itemId) || MOCK_LISTINGS.find((l) => l.id === item.itemId);
    const displayTitle = isGroup ? item.title ?? 'Untitled Group' : seller?.username ?? 'Unknown user';
    const memberCount = item.participantIds?.length ?? 0;
    const deployedBotCount = item.botIds?.length ?? 0;

    return (
      <Reanimated.View entering={FadeInDown.delay(Math.min(index, 7) * 60).duration(400)}>
        <Swipeable
          friction={2}
          overshootLeft={false}
          overshootRight={false}
          renderRightActions={() => renderRightActions(item.id)}
          renderLeftActions={() => renderLeftActions(item.id)}
        >
          <AnimatedPressable
            style={styles.messageCard}
            onPress={() => {
              markConversationRead(item.id);
              navigation.navigate('Chat', { conversationId: item.id });
            }}
            activeOpacity={0.85}
          >
            <View style={styles.avatarWrap}>
              {isGroup ? (
                <View style={styles.groupAvatar}>
                  <Ionicons name="people" size={20} color={Colors.textPrimary} />
                </View>
              ) : (
                <>
                  <CachedImage uri={seller?.avatar ?? ''} style={styles.avatar} containerStyle={{ width: 48, height: 48, borderRadius: 24 }} contentFit="cover" />
                  <View style={styles.onlineDot} />
                </>
              )}
            </View>

            <View style={styles.messageBody}>
              <View style={styles.messageTop}>
                <Text style={styles.senderName}>{displayTitle}</Text>
                <Text style={styles.time}>{item.lastMessageTime}</Text>
              </View>

              <View style={styles.channelMetaRow}>
                <View style={styles.channelTypeBadge}>
                  <Text style={styles.channelTypeBadgeText}>{isGroup ? 'GROUP' : 'DIRECT'}</Text>
                </View>
                {item.unread ? (
                  <View style={styles.priorityBadge}>
                    <Text style={styles.priorityBadgeText}>UNREAD</Text>
                  </View>
                ) : null}
              </View>

              {isGroup ? (
                <View style={styles.groupMetaRow}>
                  <Text style={styles.groupMetaText}>{memberCount} members</Text>
                  {deployedBotCount > 0 ? (
                    <Text style={styles.groupMetaText}>{deployedBotCount} bot{deployedBotCount === 1 ? '' : 's'}</Text>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.snippet} numberOfLines={2}>{item.lastMessage}</Text>

              {!isGroup && listing && (
                <View style={styles.itemPreview}>
                  <CachedImage uri={listing.images[0]} style={styles.itemThumb} containerStyle={{ width: 42, height: 42, borderRadius: 8 }} contentFit="cover" />
                  <Text style={styles.itemName} numberOfLines={1}>{listing.title}</Text>
                  <Text style={styles.itemPrice}>{formatFromFiat(listing.price, 'GBP', { displayMode: 'fiat' })}</Text>
                </View>
              )}
            </View>

            {item.unread && <View style={styles.unreadDot} />}
          </AnimatedPressable>
        </Swipeable>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerOverline}>Messaging Command</Text>
            <Text style={styles.hugeTitle}>Inbox</Text>
          </View>
          <View style={styles.headerActions}>
            <AnimatedPressable
              style={styles.addGroupBtn}
              onPress={() => navigation.navigate('CreateGroupChat')}
              activeOpacity={0.85}
            >
              <Ionicons name="people-outline" size={18} color={Colors.textPrimary} />
              <Text style={styles.addGroupBtnText}>New Group</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={styles.policiesBtn}
              onPress={() => navigation.navigate('Settings')}
              activeOpacity={0.85}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={Colors.textPrimary} />
            </AnimatedPressable>
          </View>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search conversations, members, listings"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 ? (
            <AnimatedPressable onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
              <Ionicons name="close" size={16} color={Colors.textSecondary} />
            </AnimatedPressable>
          ) : null}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.kpiStrip}
        >
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Unread Threads</Text>
            <Text style={styles.kpiValue}>{inboxStats.unreadCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Group Rooms</Text>
            <Text style={styles.kpiValue}>{inboxStats.groupCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Bot Enabled</Text>
            <Text style={styles.kpiValue}>{inboxStats.botConversationCount}</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>Direct Channels</Text>
            <Text style={styles.kpiValue}>{inboxStats.directCount}</Text>
          </View>
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.segmentStrip}>
          {SEGMENT_OPTIONS.map((option) => {
            const active = option.key === segment;
            return (
              <AnimatedPressable
                key={option.key}
                style={[styles.segmentChip, active && styles.segmentChipActive]}
                onPress={() => setSegment(option.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.segmentChipText, active && styles.segmentChipTextActive]}>{option.label}</Text>
              </AnimatedPressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sortStrip}>
          {SORT_OPTIONS.map((option) => {
            const active = option.key === sortMode;
            return (
              <AnimatedPressable
                key={option.key}
                style={[styles.sortChip, active && styles.sortChipActive]}
                onPress={() => setSortMode(option.key)}
                activeOpacity={0.85}
              >
                <Text style={[styles.sortChipText, active && styles.sortChipTextActive]}>{option.label}</Text>
              </AnimatedPressable>
            );
          })}
        </ScrollView>

        <View style={styles.bulkActionRow}>
          <AnimatedPressable
            style={styles.bulkActionBtn}
            onPress={handleMarkVisibleRead}
            activeOpacity={0.85}
          >
            <Ionicons name="checkmark-done-outline" size={16} color={Colors.textPrimary} />
            <Text style={styles.bulkActionText}>Mark Visible Read</Text>
          </AnimatedPressable>

          <AnimatedPressable
            style={styles.bulkActionBtn}
            onPress={handleArchiveResolved}
            activeOpacity={0.85}
          >
            <Ionicons name="archive-outline" size={16} color={Colors.textPrimary} />
            <Text style={styles.bulkActionText}>Archive Resolved</Text>
          </AnimatedPressable>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={20} />
        
        <AnimatedFlatList
          data={visibleConversations}
          keyExtractor={(c: any) => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          renderItem={renderItem as any}
          onScroll={scrollHandler}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="transparent"
              colors={['transparent']}
              progressBackgroundColor="transparent"
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="chatbubbles-outline"
              title={searchQuery || segment !== 'all' ? 'No matching conversations' : 'All quiet here'}
              subtitle={searchQuery || segment !== 'all'
                ? 'Try another keyword or filter to locate your messages'
                : 'Start a conversation by messaging a seller'}
              ctaLabel="Browse listings"
              onCtaPress={() => navigation.navigate('MainTabs')}
            />
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 18,
  },
  headerOverline: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 4,
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: BRAND,
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hugeTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  addGroupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.card,
  },
  addGroupBtnText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  policiesBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
  },
  searchWrap: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    paddingVertical: 0,
  },
  clearSearchBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardAlt,
  },
  kpiStrip: {
    gap: 10,
    paddingRight: 12,
    marginBottom: 12,
  },
  kpiCard: {
    width: 132,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  kpiLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 20,
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    letterSpacing: -0.3,
  },
  segmentStrip: {
    gap: 8,
    paddingRight: 20,
    marginBottom: 10,
  },
  segmentChip: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  segmentChipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  segmentChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
  },
  segmentChipTextActive: {
    color: Colors.textInverse,
  },
  sortStrip: {
    gap: 8,
    paddingRight: 20,
    marginBottom: 10,
  },
  sortChip: {
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sortChipActive: {
    borderColor: Colors.textPrimary,
  },
  sortChipText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  sortChipTextActive: {
    color: Colors.textPrimary,
  },
  bulkActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  bulkActionBtn: {
    flex: 1,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  bulkActionText: {
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    flexGrow: 1,
  },

  messageCard: {
    backgroundColor: PANEL_BG,
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.surface,
  },
  groupAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#4caf50',
    borderWidth: 3,
    borderColor: PANEL_BG,
  },
  messageBody: { flex: 1 },
  messageTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  channelMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  channelTypeBadge: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: PANEL_ALT,
  },
  channelTypeBadgeText: {
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  priorityBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.accent,
  },
  priorityBadgeText: {
    color: Colors.textInverse,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.7,
  },
  senderName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  time: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },
  groupMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  groupMetaText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  snippet: { color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },

  itemPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PANEL_ALT,
    borderRadius: 12,
    padding: 8,
    gap: 10,
  },
  itemThumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.card },
  itemName: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textSecondary },
  itemPrice: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: TEAL,
    marginTop: 6,
  },

  // Swipe actions
  swipeDelete: {
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 20,
    marginLeft: 8,
    gap: 4,
  },
  swipeArchive: {
    backgroundColor: TEAL,
    justifyContent: 'center',
    alignItems: 'center',
    width: 90,
    borderRadius: 20,
    marginRight: 8,
    gap: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
