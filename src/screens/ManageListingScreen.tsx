import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Image,
  Alert
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { MOCK_LISTINGS } from '../data/mockData';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

type RouteT = RouteProp<RootStackParamList, 'ManageListing'>;

export default function ManageListingScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteT>();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();
  const { itemId } = route.params;

  const item = listings.find((l) => l.id === itemId) || MOCK_LISTINGS.find((l) => l.id === itemId) || listings[0] || MOCK_LISTINGS[0];
  const bumpFeeLabel = formatFromFiat(1.95, 'GBP', { displayMode: 'fiat' });

  const handleAction = (title: string, msg: string) => {
    Alert.alert(title, msg, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', style: 'default' }
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Manage Listing</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        
        {/* Item Preview */}
        <View style={styles.previewCard}>
          <Image source={{ uri: item.images[0] }} style={styles.previewImg} />
          <View style={styles.previewInfo}>
            <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={styles.itemPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{item.isSold ? 'SOLD' : 'ACTIVE'}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Promote</Text>
        <AnimatedPressable 
          style={styles.actionBlock} 
          activeOpacity={0.8}
          onPress={() => handleAction('Bump Item', `Push this item to the top of the feed for ${bumpFeeLabel}?`)}
        >
          <View style={styles.blockLeft}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(245,166,35,0.1)' }]}>
              <Ionicons name="flash-outline" size={22} color="#F5A623" />
            </View>
            <View style={styles.blockTextCol}>
              <Text style={styles.blockTitle}>Bump Listing</Text>
              <Text style={styles.blockSub}>Get up to 5x more views</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
        </AnimatedPressable>

        <Text style={styles.sectionTitle}>Actions</Text>
        
        <AnimatedPressable 
          style={styles.actionBlock} 
          activeOpacity={0.8}
          onPress={() => navigation.navigate('Sell')}
        >
          <View style={styles.blockLeft}>
            <View style={[styles.iconBox, { backgroundColor: '#111' }]}>
              <Ionicons name="create-outline" size={22} color={Colors.textPrimary} />
            </View>
            <Text style={styles.blockTitle}>Edit details</Text>
          </View>
        </AnimatedPressable>

        {!item.isSold && (
          <AnimatedPressable 
            style={styles.actionBlock} 
            activeOpacity={0.8}
            onPress={() => handleAction('Mark as Sold', 'Are you sure you want to mark this item as sold? It will no longer be available for purchase.')}
          >
            <View style={styles.blockLeft}>
              <View style={[styles.iconBox, { backgroundColor: 'rgba(52,199,89,0.1)' }]}>
                <Ionicons name="checkmark-circle-outline" size={22} color={Colors.success} />
              </View>
              <Text style={styles.blockTitle}>Mark as Sold</Text>
            </View>
          </AnimatedPressable>
        )}

        <AnimatedPressable 
          style={[styles.actionBlock, { borderBottomWidth: 0 }]} 
          activeOpacity={0.8}
          onPress={() => handleAction('Delete Item', 'Are you sure you want to permanently delete this listing?')}
        >
          <View style={styles.blockLeft}>
            <View style={[styles.iconBox, { backgroundColor: 'rgba(255,59,48,0.1)' }]}>
              <Ionicons name="trash-outline" size={22} color="#FF3B30" />
            </View>
            <Text style={[styles.blockTitle, { color: '#FF3B30' }]}>Delete Listing</Text>
          </View>
        </AnimatedPressable>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: 1, borderBottomColor: '#1A1A1A' },
  backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'flex-start' },
  headerTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },

  content: { paddingHorizontal: 20, paddingTop: 20 },

  previewCard: { flexDirection: 'row', backgroundColor: '#111', padding: 16, borderRadius: 20, marginBottom: 32, gap: 16 },
  previewImg: { width: 80, height: 80, borderRadius: 12 },
  previewInfo: { flex: 1, justifyContent: 'center' },
  itemTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  itemPrice: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 8 },
  statusBadge: { alignSelf: 'flex-start', backgroundColor: '#222', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: 0.5 },

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 12 },

  actionBlock: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#111' },
  blockLeft: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  iconBox: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  blockTextCol: { justifyContent: 'center' },
  blockTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  blockSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.accent, marginTop: 4 },
});
