import React, { useState, useCallback } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Image,
  StatusBar,
  Alert,
  RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { MOCK_CONVERSATIONS, MOCK_USERS, MOCK_LISTINGS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { Swipeable } from 'react-native-gesture-handler';
import Reanimated, { FadeInDown, useSharedValue, useAnimatedScrollHandler } from 'react-native-reanimated';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../context/ToastContext';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
const TEAL = '#e8dcc8';
const IS_LIGHT = ActiveTheme === 'light';
const BRAND = IS_LIGHT ? '#2f251b' : TEAL;
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111';
const PANEL_ALT = IS_LIGHT ? '#f1ede6' : '#1a1a1a';

type ConvoItem = typeof MOCK_CONVERSATIONS[0];

export default function InboxScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings, refreshListings } = useBackendData();
  const [conversations, setConversations] = useState(MOCK_CONVERSATIONS);
  const [refreshing, setRefreshing] = useState(false);

  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshListings();
    setTimeout(() => setRefreshing(false), 400);
  };

  const AnimatedFlatList = Reanimated.createAnimatedComponent(FlatList);

  const handleDelete = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    show('Conversation deleted', 'error');
  }, []);

  const handleArchive = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    show('Conversation archived', 'info');
  }, []);

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
    const seller = MOCK_USERS.find((u) => u.id === item.sellerId);
    const listing = listings.find((l) => l.id === item.itemId) || MOCK_LISTINGS.find((l) => l.id === item.itemId);

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
            onPress={() => navigation.navigate('Chat', { conversationId: item.id })}
            activeOpacity={0.85}
          >
            <View style={styles.avatarWrap}>
              <Image source={{ uri: seller?.avatar }} style={styles.avatar} />
              <View style={styles.onlineDot} />
            </View>

            <View style={styles.messageBody}>
              <View style={styles.messageTop}>
                <Text style={styles.senderName}>{seller?.username}</Text>
                <Text style={styles.time}>{item.lastMessageTime}</Text>
              </View>
              <Text style={styles.snippet} numberOfLines={2}>{item.lastMessage}</Text>

              {listing && (
                <View style={styles.itemPreview}>
                  <Image source={{ uri: listing.images[0] }} style={styles.itemThumb} />
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
        <Text style={styles.headerLabel}>COMMUNICATION</Text>
        <Text style={styles.hugeTitle}>Inbox</Text>
      </View>

      <View style={{ flex: 1 }}>
        <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={20} />
        
        <AnimatedFlatList
          data={conversations}
          keyExtractor={(c: any) => c.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120, flexGrow: 1 }}
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
              title="All quiet here"
              subtitle="Start a conversation by messaging a seller"
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
    paddingBottom: 24,
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
  senderName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  time: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },
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
