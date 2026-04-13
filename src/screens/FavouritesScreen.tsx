import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, { FadeInDown, useSharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { ProductCard } from '../components/ProductCard';
import { EmptyState } from '../components/EmptyState';
import { RefreshIndicator } from '../components/RefreshIndicator';
import { Listing } from '../data/mockData';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
const HEADER_BUTTON_BG = Colors.card;
const HEADER_BUTTON_BORDER = Colors.border;
const HEADER_LABEL_COLOR = Colors.accent;

export default function FavouritesScreen() {
  const navigation = useNavigation<NavT>();
  const wishlistIds = useStore((state) => state.wishlist);
  const { listings, refreshListings } = useBackendData();

  const [refreshing, setRefreshing] = React.useState(false);
  const scrollY = useSharedValue(0);

  const favouriteItems = React.useMemo(
    () => listings.filter((item) => wishlistIds.includes(item.id)),
    [listings, wishlistIds]
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshListings();
    setTimeout(() => setRefreshing(false), 350);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <View>
          <Text style={styles.headerLabel}>SAVED ITEMS</Text>
          <Text style={styles.headerTitle}>Favourites</Text>
        </View>
        <Text style={styles.countText}>{favouriteItems.length}</Text>
      </View>

      <RefreshIndicator scrollY={scrollY} isRefreshing={refreshing} topInset={20} />

      <FlashList
        data={favouriteItems}
        keyExtractor={(item: Listing) => item.id}
        numColumns={2}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        onScroll={(event) => {
          scrollY.value = event.nativeEvent.contentOffset.y;
        }}
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
        renderItem={({ item, index }: { item: Listing; index: number }) => (
          <Reanimated.View entering={FadeInDown.delay(Math.min(index, 10) * 45).duration(360)}>
            <ProductCard
              item={item}
              onPress={() => navigation.navigate('ItemDetail', { itemId: item.id })}
            />
          </Reanimated.View>
        )}
        ListEmptyComponent={
          <EmptyState
            icon="heart-outline"
            title="No saved items yet"
            subtitle="Items you save will appear here."
            ctaLabel="Browse Closet"
            onCtaPress={() => (navigation as any).navigate('MainTabs', { screen: 'Search' })}
          />
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: HEADER_BUTTON_BORDER,
    backgroundColor: HEADER_BUTTON_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerLabel: {
    color: HEADER_LABEL_COLOR,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  headerTitle: {
    marginTop: 2,
    color: Colors.textPrimary,
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
  },
  countText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    minWidth: 24,
    textAlign: 'right',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 120,
  },
  columnWrap: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
});
