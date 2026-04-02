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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';

type Props = StackScreenProps<RootStackParamList, 'GlobalSearch'>;

const RECENT_SEARCHES = ['stussy hoodie', 'arcteryx alpha sv', 'carhartt detroit', 'vintage levis 501'];
const TRENDING_TAGS = ['#y2k', '#gorpcore', 'archive', 'japanese denim', 'techwear', '#streetwear'];

export default function GlobalSearchScreen({ navigation }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  const updateBrowseFilters = useStore((state) => state.updateBrowseFilters);

  // Auto-focus the search bar when the screen mounts
  useEffect(() => {
    const timeout = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timeout);
  }, []);

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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* Hero Search Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={26} color={Colors.textPrimary} />
        </AnimatedPressable>
        
        <View style={styles.inputContainer}>
          <TextInput
            ref={inputRef}
            style={styles.searchInput}
            placeholder="Search for items, brands..."
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearchSubmit}
            returnKeyType="search"
            autoCapitalize="none"
            selectionColor="#4ECDC4"
          />
          {query.length > 0 && (
            <AnimatedPressable style={styles.clearBtn} onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={20} color={Colors.textSecondary} />
            </AnimatedPressable>
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        
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
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 24,
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
  
  sectionTitle: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 20,
    marginBottom: 12,
  },

  trendingRow: {
    marginBottom: 40,
  },
  trendingPill: {
    backgroundColor: '#111',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#222',
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
    borderBottomColor: '#1A1A1A',
  },
  recentText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.textPrimary,
    marginLeft: 14,
  },
});
