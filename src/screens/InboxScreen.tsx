import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { MOCK_CONVERSATIONS, MOCK_USERS, MOCK_LISTINGS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';

type NavT = StackNavigationProp<RootStackParamList>;
const TEAL = '#4ECDC4';

export default function InboxScreen() {
  const navigation = useNavigation<NavT>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>COMMUNICATION</Text>
        <Text style={styles.hugeTitle}>Inbox</Text>
      </View>

      {/* ── Content ── */}
      <FlatList
        data={MOCK_CONVERSATIONS}
        keyExtractor={(c) => c.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => {
          const seller = MOCK_USERS.find((u) => u.id === item.sellerId);
          const listing = MOCK_LISTINGS.find((l) => l.id === item.itemId);
          return (
            <TouchableOpacity
              style={styles.messageCard}
              onPress={() => navigation.navigate('Chat', { conversationId: item.id })}
              activeOpacity={0.85}
            >
              {/* Avatar with online indicator */}
              <View style={styles.avatarWrap}>
                <Image source={{ uri: seller?.avatar }} style={styles.avatar} />
                <View style={styles.onlineDot} />
              </View>

              {/* Message content */}
              <View style={styles.messageBody}>
                <View style={styles.messageTop}>
                  <Text style={styles.senderName}>{seller?.username}</Text>
                  <Text style={styles.time}>{item.lastMessageTime}</Text>
                </View>
                <Text style={styles.snippet} numberOfLines={2}>{item.lastMessage}</Text>
                
                {/* Item preview strip */}
                {listing && (
                  <View style={styles.itemPreview}>
                    <Image source={{ uri: listing.images[0] }} style={styles.itemThumb} />
                    <Text style={styles.itemName} numberOfLines={1}>{listing.title}</Text>
                    <Text style={styles.itemPrice}>£{listing.price}</Text>
                  </View>
                )}
              </View>

              {item.unread && <View style={styles.unreadDot} />}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="chatbubbles-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptySubtitle}>Start a conversation by messaging a seller</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
  },
  headerLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#4ECDC4',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  hugeTitle: {
    fontSize: 32,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    letterSpacing: -0.5,
  },

  // Message cards — floated inside pill cards
  messageCard: {
    backgroundColor: '#111',
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
    borderColor: '#111',
  },
  messageBody: { flex: 1 },
  messageTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  senderName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  time: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },
  snippet: { color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 10 },

  // Item preview strip inside message card
  itemPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
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

  // Empty states
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
});
