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
const ACCENT = Colors.accent;
const PANEL_BG = Colors.card;

type ConvoItem = Conversation;
type InboxSegment = 'all' | 'unread' | 'groups' | 'direct';

const SEGMENT_OPTIONS: Array<{ key: InboxSegment; label: string }> = [
  { key: 'direct', label: 'Direct' },
  { key: 'unread', label: 'Unread' },
  { key: 'groups', label: 'Groups' },
  { key: 'all', label: 'All' },
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
  const [segment, setSegment] = useState<InboxSegment>('direct');

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
    const ordered = [...filteredConversations];
    ordered.sort((a, b) => Number(b.unread) - Number(a.unread));

    return ordered;
  }, [filteredConversations]);

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

              {isGroup ? (
                <View style={styles.groupMetaRow}>
                  <Text style={styles.groupMetaText}>{memberCount} members</Text>
                  {deployedBotCount > 0 ? (
                    <Text style={styles.groupMetaText}>{deployedBotCount} bot{deployedBotCount === 1 ? '' : 's'}</Text>
                  ) : null}
                </View>
              ) : (
                <Text style={styles.groupMetaText}>Direct message</Text>
              )}

              {item.unread ? (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>Unread</Text>
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

        <Text style={styles.listMeta}>
          {visibleConversations.length} conversation{visibleConversations.length === 1 ? '' : 's'} | {conversations.filter((item) => item.unread).length} unread
        </Text>
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
              title={searchQuery || segment !== 'direct' ? 'No matching conversations' : 'No conversations yet'}
              subtitle={searchQuery || segment !== 'direct'
                ? 'Try another keyword or filter.'
                : 'Message a seller to start a chat.'}
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
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
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
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.cardAlt,
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
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardAlt,
  },
  searchWrap: {
    height: 46,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.cardAlt,
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
  segmentStrip: {
    gap: 8,
    paddingRight: 20,
    marginBottom: 10,
  },
  segmentChip: {
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.cardAlt,
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
  listMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    letterSpacing: 0.2,
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
  unreadBadge: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: Colors.accent,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  unreadBadgeText: {
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
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  snippet: { color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },

  itemPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
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
    backgroundColor: ACCENT,
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
    backgroundColor: ACCENT,
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

