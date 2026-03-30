import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MOCK_USERS, MOCK_LISTINGS } from '../data/mockData';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';

type NavT = StackNavigationProp<RootStackParamList>;
const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TEAL = '#4ECDC4';

// ── Feed Mock Data ──────────────────────────────────────────
interface FeedLook {
  id: string;
  creator: { id: string; name: string; avatar: string; isVerified?: boolean };
  title: string;
  description: string;
  coverImage: string;
  items: { id: string; label: string; x: number; y: number }[];
  likes: number;
  comments: number;
  timeAgo: string;
}

const FEED_LOOKS: FeedLook[] = [
  {
    id: 'f1',
    creator: { id: 'u1', name: 'mariefullery', avatar: MOCK_USERS[0].avatar, isVerified: true },
    title: 'Winter Layers in the City',
    description: 'Mixing high and low, keeping it cozy. ❄️',
    coverImage: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80',
    items: [
      { id: 'l5', label: 'Off-White Hoodie', x: 0.2, y: 0.3 },
      { id: 'l7', label: 'Cargo Trousers', x: 0.6, y: 0.65 },
      { id: 'l6', label: 'Air Max 90', x: 0.5, y: 0.85 },
    ],
    likes: 245,
    comments: 18,
    timeAgo: '2h ago',
  },
  {
    id: 'f2',
    creator: { id: 'u2', name: 'scott_art', avatar: MOCK_USERS[1].avatar },
    title: 'Minimal Monochrome',
    description: 'Clean lines for the weekend.',
    coverImage: 'https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80',
    items: [
      { id: 'l2', label: 'AMI Striped Shirt', x: 0.35, y: 0.25 },
      { id: 'l3', label: 'RL Harrington', x: 0.7, y: 0.4 },
    ],
    likes: 156,
    comments: 12,
    timeAgo: '5h ago',
  },
  {
    id: 'f3',
    creator: { id: 'u3', name: 'dankdunksuk', avatar: MOCK_USERS[2].avatar, isVerified: true },
    title: 'Streetwear Daily',
    description: 'Latest pickups. Those Chucks never get old.',
    coverImage: 'https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80',
    items: [
      { id: 'l4', label: 'Stüssy Logo Tee', x: 0.4, y: 0.3 },
      { id: 'l9', label: 'Represent Hoodie', x: 0.25, y: 0.15 },
      { id: 'l10', label: 'Chuck Taylor', x: 0.6, y: 0.8 },
    ],
    likes: 89,
    comments: 7,
    timeAgo: '1d ago',
  },
];

export default function HomeScreen() {
  const navigation = useNavigation<NavT>();
  const notificationCount = useStore(state => state.notificationCount);

  // ── Stories Row ──
  const renderStories = () => (
    <View style={styles.storiesContainer}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesScroll}>
        <View style={styles.storyWrap}>
          <TouchableOpacity style={styles.addStoryBtn} activeOpacity={0.8}>
            <Ionicons name="add" size={24} color={Colors.background} />
          </TouchableOpacity>
          <Text style={styles.storyName}>Your Look</Text>
        </View>
        
        {MOCK_USERS.map((user, idx) => (
          <TouchableOpacity key={user.id} style={styles.storyWrap} activeOpacity={0.8} onPress={() => navigation.navigate('UserProfile', { userId: user.id })}>
            <View style={[styles.storyRing, idx < 3 && styles.storyRingActive]}>
              <Image source={{ uri: user.avatar }} style={styles.storyAvatar} />
            </View>
            <Text style={styles.storyName} numberOfLines={1}>{user.username}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // ── Explore Grid Mix ──
  const EXPLORE_DATA = React.useMemo(() => {
    return [
      ...FEED_LOOKS.map(l => ({ type: 'look', id: `l_${l.id}`, cover: l.coverImage, likes: l.likes, routeId: l.items[0]?.id })),
      ...MOCK_LISTINGS.map(i => ({ type: 'listing', id: `i_${i.id}`, cover: i.images[0], likes: Math.floor(Math.random() * 50) + 1, price: i.price, routeId: i.id }))
    ].sort(() => Math.random() - 0.5);
  }, []);

  const renderExploreItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={styles.exploreItemBox}
      activeOpacity={0.9}
      onPress={() => item.routeId ? navigation.navigate('ItemDetail', { itemId: item.routeId }) : null}
    >
      <Image source={{ uri: item.cover }} style={styles.exploreImage} resizeMode="cover" />
      <View style={styles.exploreOverlay}>
        {item.type === 'listing' ? (
          <View style={styles.exploreTag}>
            <Ionicons name="pricetag" size={10} color="#fff" />
            <Text style={styles.exploreTagText}>£{item.price}</Text>
          </View>
        ) : (
          <View style={styles.exploreTag}>
            <Ionicons name="eye" size={12} color="#fff" />
            <Text style={styles.exploreTagText}>{item.likes}k</Text>
          </View>
        )}
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Floating Header ── */}
      <View style={styles.header}>
        <Text style={styles.brandTitle}>Thryftverse</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('GlobalSearch')}>
            <Ionicons name="search" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={() => navigation.navigate('NotificationsList')}>
            <Ionicons name="notifications-outline" size={22} color={Colors.textPrimary} />
            {notificationCount > 0 && (
              <View style={styles.notiBadge}>
                <Text style={styles.notiBadgeText}>{notificationCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        key="explore-grid-3"
        data={EXPLORE_DATA}
        keyExtractor={item => item.id}
        numColumns={3}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        columnWrapperStyle={{ gap: 2 }}
        ListHeaderComponent={renderStories}
        renderItem={renderExploreItem}
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
    paddingVertical: 12,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    zIndex: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  brandTitle: {
    fontSize: 24,
    fontFamily: 'Inter_800ExtraBold',
    color: Colors.textPrimary,
    letterSpacing: -1,
  },
  headerRight: { flexDirection: 'row', gap: 12 },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  notiBadge: {
    position: 'absolute',
    top: 6,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notiBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
  },

  // Stories
  storiesContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingVertical: 16,
    marginBottom: 8,
  },
  storiesScroll: {
    paddingHorizontal: 16,
    gap: 16,
  },
  storyWrap: {
    alignItems: 'center',
    width: 72,
  },
  storyRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#333',
    padding: 2,
    marginBottom: 6,
  },
  storyRingActive: {
    borderColor: TEAL,
  },
  storyAvatar: {
    width: '100%',
    height: '100%',
    borderRadius: 32,
    backgroundColor: Colors.surface,
  },
  addStoryBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  storyName: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
  },

  // Explore Grid
  exploreItemBox: {
    width: (SCREEN_WIDTH - 4) / 3,
    aspectRatio: 0.8,
    backgroundColor: '#111',
    marginBottom: 2,
    position: 'relative',
  },
  exploreImage: {
    width: '100%',
    height: '100%',
  },
  exploreOverlay: {
    position: 'absolute',
    bottom: 6,
    left: 6,
  },
  exploreTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
  },
  exploreTagText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
  },
});
