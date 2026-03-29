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
import { MOCK_NOTIFICATIONS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';

type NavT = StackNavigationProp<RootStackParamList>;
const TEAL = '#4ECDC4';

export default function NotificationsScreen() {
  const navigation = useNavigation<NavT>();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        <View style={{ width: 44 }} />
      </View>

      <FlatList
        data={MOCK_NOTIFICATIONS}
        keyExtractor={(n) => n.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 120 }}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <TouchableOpacity 
            style={styles.notifCard}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('ItemDetail', { itemId: '1' })}
          >
            <Image source={{ uri: item.itemImage }} style={styles.notifImage} />
            <View style={styles.notifBody}>
              <Text style={styles.notifText} numberOfLines={3}>{item.text}</Text>
              <Text style={styles.notifTime}>{item.time}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="notifications-outline" size={48} color={Colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>We'll notify you about new items and updates</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  headerTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },

  // Notification cards
  notifCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },
  notifImage: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.surface,
  },
  notifBody: { flex: 1 },
  notifText: { color: Colors.textSecondary, fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginBottom: 6 },
  notifTime: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Inter_400Regular' },

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
