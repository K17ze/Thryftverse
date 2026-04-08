import React, { useState, useRef, useEffect } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import Reanimated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ActiveTheme, Colors } from '../constants/colors';
import { Motion } from '../constants/motion';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { useBackendData } from '../context/BackendDataContext';
import { SyncStatusPill } from '../components/SyncStatusPill';
import { SkeletonLoader } from '../components/SkeletonLoader';
import { SyncRetryBanner } from '../components/SyncRetryBanner';
import { getBackendSyncStatus } from '../utils/syncStatus';

type Props = StackScreenProps<RootStackParamList, 'GlobalSearch'>;

const RECENT_SEARCHES = ['stussy hoodie', 'arcteryx alpha sv', 'carhartt detroit', 'vintage levis 501'];
const TRENDING_TAGS = ['#y2k', '#gorpcore', 'archive', 'japanese denim', 'techwear', '#streetwear'];

export default function GlobalSearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const updateBrowseFilters = useStore((state) => state.updateBrowseFilters);
  const { listings, source, isSyncing, lastError, refreshListings } = useBackendData();
  const focusProgress = useSharedValue(0);

  // Auto-focus the search bar when the screen mounts
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    focusProgress.value = withTiming(isSearchFocused ? 1 : 0, { duration: Motion.timing.focus });
  }, [focusProgress, isSearchFocused]);

  const animatedSearchShellStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [Colors.glassBorder, Colors.accent],
    );

    const backgroundColor = interpolateColor(
      focusProgress.value,
      [0, 1],
      [Colors.card, Colors.cardAlt],
    );

    return {
      borderColor,
      backgroundColor,
      transform: [{ scale: 1 + focusProgress.value * 0.012 }],
    };
  });

  const handleSearchSubmit = () => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    updateBrowseFilters({
      query: trimmedQuery,
      sort: 'Recommended',
      brands: [],
      sizes: [],
      condition: 'Any',
    });

    navigation.navigate('Browse', {
      categoryId: 'search',
      title: `Search: "${trimmedQuery}"`,
      searchQuery: trimmedQuery,
    });
  };

  const handlePillPress = (tag: string) => {
    const normalizedTag = tag.trim();
    if (!normalizedTag) return;

    updateBrowseFilters({
      query: normalizedTag,
      sort: 'Recommended',
      brands: [],
      sizes: [],
      condition: 'Any',
    });

    navigation.navigate('Browse', {
      categoryId: 'search',
      title: `Search: "${normalizedTag}"`,
      searchQuery: normalizedTag,
    });
  };

  const searchStatus = React.useMemo(
    () =>
      getBackendSyncStatus({
        isSyncing,
        source,
        hasError: Boolean(lastError),
        labels: {
          syncing: 'Refreshing index',
          live: 'Live index',
          error: 'Offline index',
          fallback: 'Cached index',
        },
      }),
    [isSyncing, lastError, source],
  );

  const showSearchLoadingSkeleton = isSyncing && source === 'mock' && listings.length === 0 && !lastError;

  const renderSearchLoadingState = () => (
    <View style={styles.loadingStateWrap}>
      <View style={styles.loadingSection}>
        <SkeletonLoader width="32%" height={14} borderRadius={7} style={{ marginBottom: 12 }} />
        <View style={styles.loadingTagsRow}>
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonLoader key={`search_tag_loading_${index}`} width={96} height={36} borderRadius={18} />
          ))}
        </View>
      </View>

      <View style={styles.loadingSection}>
        <SkeletonLoader width="44%" height={14} borderRadius={7} style={{ marginBottom: 14 }} />
        {Array.from({ length: 4 }).map((_, index) => (
          <View key={`search_recent_loading_${index}`} style={styles.loadingRecentRow}>
            <SkeletonLoader width={20} height={20} borderRadius={10} />
            <SkeletonLoader width="62%" height={13} borderRadius={6} style={{ marginLeft: 12 }} />
          </View>
        ))}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      {/* Hero Search Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color={Colors.textPrimary} />
        </AnimatedPressable>

        <Reanimated.View style={[styles.inputContainer, animatedSearchShellStyle]}>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search listings, brands, sellers"
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearchSubmit}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            returnKeyType="search"
            autoCapitalize="none"
            selectionColor={Colors.accent}
          />
          {query.length > 0 && (
            <AnimatedPressable style={styles.clearBtn} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={20} color={Colors.textSecondary} />
            </AnimatedPressable>
          )}
        </Reanimated.View>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusMeta}>{listings.length} listings indexed</Text>
        <SyncStatusPill tone={searchStatus.tone} label={searchStatus.label} compact />
      </View>

      {lastError ? (
        <SyncRetryBanner
          message="Search indexing is delayed. Results may be stale."
          onRetry={() => void refreshListings()}
          isRetrying={isSyncing}
          telemetryContext="global_search_sync"
          containerStyle={styles.syncRetryBanner}
        />
      ) : null}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {showSearchLoadingSkeleton ? (
          renderSearchLoadingState()
        ) : (
          <>
            {/* Trending Tags Row */}
            <Text style={styles.sectionTitle}>Trending</Text>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false} 
              style={styles.trendingRow}
              contentContainerStyle={{ paddingHorizontal: 20, gap: 10 }}
            >
              {TRENDING_TAGS.map((tag, idx) => (
                <AnimatedPressable key={idx} style={styles.trendingPill} activeOpacity={0.8} onPress={() => handlePillPress(tag)}>
                  <Text style={styles.trendingPillText}>{tag}</Text>
                </AnimatedPressable>
              ))}
            </ScrollView>

            {/* Recent Searches */}
            <View style={styles.recentSection}>
              <Text style={[styles.sectionTitle, { paddingHorizontal: 0, marginBottom: 16 }]}>Recent Searches</Text>
              {RECENT_SEARCHES.map((term, idx) => (
                <AnimatedPressable key={idx} style={styles.recentRow} activeOpacity={0.7} onPress={() => handlePillPress(term)}>
                  <Ionicons name="time-outline" size={20} color={Colors.textMuted} />
                  <Text style={styles.recentText}>{term}</Text>
                  <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
                </AnimatedPressable>
              ))}
            </View>
          </>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
    paddingHorizontal: 20,
    height: 56,
  },
  searchInput: {
    flex: 1,
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },
  clearBtn: {
    padding: 4,
    marginLeft: 8,
  },

  content: { paddingTop: 20 },
  statusRow: {
    paddingHorizontal: 20,
    marginTop: -4,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  statusMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  syncRetryBanner: {
    marginHorizontal: 20,
    marginBottom: 14,
  },
  loadingStateWrap: {
    paddingHorizontal: 20,
    gap: 26,
  },
  loadingSection: {
    gap: 8,
  },
  loadingTagsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  loadingRecentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 12,
    marginBottom: 2,
  },
  
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    letterSpacing: 0.25,
    paddingHorizontal: 20,
    marginBottom: 12,
  },

  trendingRow: {
    marginBottom: 40,
  },
  trendingPill: {
    backgroundColor: ActiveTheme === 'light' ? 'rgba(255,255,255,0.78)' : 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.glassBorder,
  },
  trendingPillText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
  },

  recentSection: {
    paddingHorizontal: 20,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recentText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
    marginLeft: 14,
  },
});
