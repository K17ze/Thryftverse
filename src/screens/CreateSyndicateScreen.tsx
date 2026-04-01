import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TouchableOpacity,
  TextInput,
  Image,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import type { SyndicateAsset } from '../data/tradeHub';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';

type NavT = StackNavigationProp<RootStackParamList>;

const STABLE_COIN = 'TVUSD';

export default function CreateSyndicateScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();

  const currentUser = useStore((state) => state.currentUser);
  const addSyndicate = useStore((state) => state.addSyndicate);

  const issuerId = currentUser?.id ?? MOCK_USERS[0]?.id ?? 'u1';

  const issuerListings = React.useMemo(() => {
    const own = MOCK_LISTINGS.filter((item) => item.sellerId === issuerId);
    return own.length ? own : MOCK_LISTINGS.slice(0, 12);
  }, [issuerId]);

  const [selectedListingId, setSelectedListingId] = React.useState(issuerListings[0]?.id ?? '');
  const [totalUnitsInput, setTotalUnitsInput] = React.useState('1000');
  const [unitPriceInput, setUnitPriceInput] = React.useState('1.00');
  const [stablePriceInput, setStablePriceInput] = React.useState('1.28');

  React.useEffect(() => {
    if (!issuerListings.length) {
      return;
    }

    if (!issuerListings.some((item) => item.id === selectedListingId)) {
      setSelectedListingId(issuerListings[0].id);
    }
  }, [issuerListings, selectedListingId]);

  const selectedListing = React.useMemo(
    () => issuerListings.find((item) => item.id === selectedListingId),
    [issuerListings, selectedListingId]
  );

  const issueSyndicate = () => {
    if (!selectedListing) {
      show('Select a listing to issue', 'error');
      return;
    }

    const totalUnits = Number(totalUnitsInput);
    if (!Number.isFinite(totalUnits) || totalUnits < 10 || !Number.isInteger(totalUnits)) {
      show('Units must be an integer of at least 10', 'error');
      return;
    }

    const unitPriceGBP = Number(unitPriceInput);
    if (!Number.isFinite(unitPriceGBP) || unitPriceGBP <= 0) {
      show('Enter a valid GBP unit price', 'error');
      return;
    }

    const unitPriceStable = Number(stablePriceInput);
    if (!Number.isFinite(unitPriceStable) || unitPriceStable <= 0) {
      show('Enter a valid stable coin unit price', 'error');
      return;
    }

    const now = Date.now();

    const newAsset: SyndicateAsset = {
      id: `s_user_${now}`,
      listingId: selectedListing.id,
      issuerId,
      title: `${selectedListing.title} Split`,
      image: selectedListing.images[0] ?? 'https://picsum.photos/seed/new-syndicate/500/700',
      totalUnits,
      availableUnits: totalUnits,
      unitPriceGBP,
      unitPriceStable,
      marketMovePct24h: 0,
      holders: 0,
      volume24hGBP: 0,
      yourUnits: 0,
      isOpen: true,
    };

    addSyndicate(newAsset);
    show('Syndicate issued successfully', 'success');
    navigation.goBack();
  };

  const estimatedValue = React.useMemo(() => {
    const units = Number(totalUnitsInput);
    const unitPrice = Number(unitPriceInput);

    if (!Number.isFinite(units) || !Number.isFinite(unitPrice)) {
      return 0;
    }

    return units * unitPrice;
  }, [totalUnitsInput, unitPriceInput]);

  const renderListingCard = ({ item }: { item: Listing }) => {
    const selected = item.id === selectedListingId;

    return (
      <TouchableOpacity
        style={[styles.listingCard, selected && styles.listingCardSelected]}
        onPress={() => setSelectedListingId(item.id)}
        activeOpacity={0.9}
      >
        <Image source={{ uri: item.images[0] }} style={styles.listingImage} />
        <View style={styles.listingMeta}>
          <Text style={styles.listingTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.listingPrice}>GBP {item.price.toFixed(2)}</Text>
        </View>
        {selected ? (
          <View style={styles.selectedTick}>
            <Ionicons name="checkmark" size={12} color={Colors.background} />
          </View>
        ) : null}
      </TouchableOpacity>
    );
  };

  const previewImage = selectedListing?.images[0] ?? 'https://picsum.photos/seed/syndicate-preview/500/700';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.closeBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="close" size={20} color={Colors.textPrimary} />
        </TouchableOpacity>

        <View>
          <Text style={styles.headerLabel}>ISSUER CONSOLE</Text>
          <Text style={styles.headerTitle}>Create Syndicate</Text>
        </View>

        <TouchableOpacity style={styles.issueBtn} onPress={issueSyndicate} activeOpacity={0.9}>
          <Text style={styles.issueBtnText}>Issue</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <View style={styles.previewCard}>
          <Image source={{ uri: previewImage }} style={styles.previewImage} />
          <View style={styles.previewOverlay}>
            <Text style={styles.previewTitle} numberOfLines={1}>{selectedListing?.title ?? 'Select listing'}</Text>
            <Text style={styles.previewMeta}>Estimated cap GBP {estimatedValue.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Token Split</Text>

          <Text style={styles.inputLabel}>Total Units</Text>
          <TextInput
            style={styles.input}
            value={totalUnitsInput}
            onChangeText={setTotalUnitsInput}
            keyboardType="number-pad"
            placeholder="1000"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.inputLabel}>Unit Price (GBP)</Text>
          <TextInput
            style={styles.input}
            value={unitPriceInput}
            onChangeText={setUnitPriceInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
          />

          <Text style={styles.inputLabel}>Unit Price ({STABLE_COIN})</Text>
          <TextInput
            style={styles.input}
            value={stablePriceInput}
            onChangeText={setStablePriceInput}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor={Colors.textMuted}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Attach Listing</Text>
            <Text style={styles.sectionHint}>{issuerListings.length} available</Text>
          </View>

          <FlatList
            data={issuerListings}
            horizontal
            keyExtractor={(item) => item.id}
            renderItem={renderListingCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listingsContent}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  headerLabel: {
    color: '#4ECDC4',
    fontSize: 10,
    letterSpacing: 1,
    fontFamily: 'Inter_600SemiBold',
    textAlign: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  issueBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  issueBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  previewCard: {
    height: 188,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 16,
    backgroundColor: '#121212',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.56)',
  },
  previewTitle: {
    color: '#fff',
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  previewMeta: {
    marginTop: 3,
    color: '#8fdcd4',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  section: {
    marginBottom: 15,
  },
  sectionHeaderRow: {
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    marginBottom: 6,
  },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: '#2d2d2d',
    borderRadius: 12,
    paddingHorizontal: 12,
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    backgroundColor: '#111111',
    marginBottom: 10,
  },
  listingsContent: {
    gap: 8,
  },
  listingCard: {
    width: 156,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2d2d2d',
    backgroundColor: '#121212',
  },
  listingCardSelected: {
    borderColor: '#4ECDC4',
    backgroundColor: '#15201f',
  },
  listingImage: {
    width: '100%',
    height: 92,
  },
  listingMeta: {
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  listingTitle: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  listingPrice: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  selectedTick: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.accent,
  },
});
