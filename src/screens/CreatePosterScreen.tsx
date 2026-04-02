import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  Image,
  FlatList,
  ActivityIndicator,
  ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import type { Poster } from '../data/posters';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';

type NavT = StackNavigationProp<RootStackParamList>;
type ListingSource = 'mine' | 'marketplace';
type StoryPosition = 'top' | 'center' | 'bottom';

const EXPIRY_OPTIONS = [6, 12, 24, 48];
const STORY_COLORS = ['#ffffff', '#e8dcc8', '#ff8fab', '#8dd3ff'];
const STORY_POSITIONS: StoryPosition[] = ['top', 'center', 'bottom'];

export default function CreatePosterScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();

  const currentUser = useStore((state) => state.currentUser);
  const addPoster = useStore((state) => state.addPoster);
  const uploaderId = currentUser?.id ?? MOCK_USERS[0]?.id ?? 'u1';

  const allListingOptions = React.useMemo(
    () => (listings.length ? listings : MOCK_LISTINGS),
    [listings]
  );

  const [listingSource, setListingSource] = React.useState<ListingSource>('mine');

  const listingOptions = React.useMemo(() => {
    const mine = allListingOptions.filter((item) => item.sellerId === uploaderId);
    const marketplace = allListingOptions.filter((item) => item.sellerId !== uploaderId);

    if (listingSource === 'mine') {
      return (mine.length ? mine : allListingOptions).slice(0, 24);
    }

    return (marketplace.length ? marketplace : allListingOptions).slice(0, 24);
  }, [allListingOptions, listingSource, uploaderId]);

  const [caption, setCaption] = React.useState('');
  const [expiryHours, setExpiryHours] = React.useState(24);
  const [selectedListingId, setSelectedListingId] = React.useState(listingOptions[0]?.id ?? '');
  const [posterImageUri, setPosterImageUri] = React.useState<string | null>(null);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const [storyText, setStoryText] = React.useState('');
  const [storyColor, setStoryColor] = React.useState('#ffffff');
  const [storyPosition, setStoryPosition] = React.useState<StoryPosition>('bottom');

  React.useEffect(() => {
    if (!listingOptions.length) {
      return;
    }

    if (!listingOptions.some((item) => item.id === selectedListingId)) {
      setSelectedListingId(listingOptions[0].id);
    }
  }, [listingOptions, selectedListingId]);

  const selectedListing = React.useMemo(
    () => listingOptions.find((item) => item.id === selectedListingId),
    [listingOptions, selectedListingId]
  );

  const selectedListingSeller = React.useMemo(
    () => MOCK_USERS.find((user) => user.id === selectedListing?.sellerId),
    [selectedListing?.sellerId]
  );

  const storyOverlayPositionStyle =
    storyPosition === 'top'
      ? styles.storyOverlayTop
      : storyPosition === 'center'
        ? styles.storyOverlayCenter
        : styles.storyOverlayBottom;

  const previewUri =
    posterImageUri ??
    selectedListing?.images[0] ??
    'https://picsum.photos/seed/poster-fallback/600/800';

  const pickFromLibrary = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      show('Allow photo library access to upload posters', 'error');
      return;
    }

    setIsPickingImage(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setPosterImageUri(result.assets[0].uri);
        show('Poster image selected', 'success');
      }
    } finally {
      setIsPickingImage(false);
    }
  };

  const pickFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      show('Allow camera access to shoot posters', 'error');
      return;
    }

    setIsPickingImage(true);
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setPosterImageUri(result.assets[0].uri);
        show('Poster image captured', 'success');
      }
    } finally {
      setIsPickingImage(false);
    }
  };

  const handlePublish = () => {
    const trimmedCaption = caption.trim();
    const trimmedStoryText = storyText.trim();

    if (!selectedListing) {
      show('Choose a listing first', 'error');
      return;
    }

    if (!trimmedCaption) {
      show('Add a caption to publish', 'error');
      return;
    }

    const sharedFromUserId = selectedListing.sellerId !== uploaderId ? selectedListing.sellerId : undefined;

    const newPoster: Poster = {
      id: `p_user_${Date.now()}`,
      uploaderId,
      listingId: selectedListing.id,
      image: previewUri,
      caption: trimmedCaption,
      createdAt: new Date().toISOString(),
      expiryHours,
      sharedFromUserId,
      storyOverlay: trimmedStoryText
        ? {
            text: trimmedStoryText,
            color: storyColor,
            position: storyPosition,
          }
        : undefined,
    };

    addPoster(newPoster);
    show('Poster is now live', 'success');
    navigation.replace('PosterViewer', { posterId: newPoster.id });
  };

  const renderListingCard = ({ item }: { item: Listing }) => {
    const selected = item.id === selectedListingId;
    const sellerName = MOCK_USERS.find((user) => user.id === item.sellerId)?.username ?? 'seller';

    return (
      <AnimatedPressable
        style={[styles.listingCard, selected && styles.listingCardSelected]}
        activeOpacity={0.9}
        onPress={() => setSelectedListingId(item.id)}
      >
        <Image source={{ uri: item.images[0] }} style={styles.listingImage} />
        <View style={styles.listingMeta}>
          <Text style={styles.listingTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.listingSeller} numberOfLines={1}>@{sellerName}</Text>
          <Text style={styles.listingPrice}>{formatFromFiat(item.price, 'GBP', { displayMode: 'fiat' })}</Text>
        </View>
        {selected ? (
          <View style={styles.selectedBadge}>
            <Ionicons name="checkmark" size={12} color={Colors.background} />
          </View>
        ) : null}
      </AnimatedPressable>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} activeOpacity={0.85} onPress={() => navigation.goBack()}>
          <Ionicons name="close" size={20} color={Colors.textPrimary} />
        </AnimatedPressable>

        <View>
          <Text style={styles.headerLabel}>POSTER COMPOSER</Text>
          <Text style={styles.headerTitle}>Create Poster</Text>
        </View>

        <AnimatedPressable style={styles.publishBtn} activeOpacity={0.9} onPress={handlePublish}>
          <Text style={styles.publishBtnText}>Publish</Text>
        </AnimatedPressable>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.previewCard}>
          <Image
            source={{ uri: previewUri }}
            style={styles.previewImage}
          />
          <View style={styles.previewOverlayTop}>
            {selectedListing && selectedListing.sellerId !== uploaderId ? (
              <View style={styles.sharedListingPill}>
                <Ionicons name="repeat-outline" size={12} color="#fff" />
                <Text style={styles.sharedListingText}>Shared @{selectedListingSeller?.username ?? 'seller'}</Text>
              </View>
            ) : null}
            <View style={styles.previewExpiryPill}>
              <Ionicons name="time-outline" size={12} color="#fff" />
              <Text style={styles.previewExpiryText}>{expiryHours}h</Text>
            </View>
          </View>
          {storyText.trim().length > 0 ? (
            <View style={[styles.storyOverlayWrap, storyOverlayPositionStyle]}>
              <Text style={[styles.storyOverlayText, { color: storyColor }]} numberOfLines={2}>
                {storyText.trim()}
              </Text>
            </View>
          ) : null}
          <View style={styles.previewOverlayBottom}>
            <Text style={styles.previewCaption} numberOfLines={2}>
              {caption.trim() || 'Add caption for this poster...'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Listing Source</Text>
          <View style={styles.sourceRow}>
            <AnimatedPressable
              style={[styles.sourceChip, listingSource === 'mine' && styles.sourceChipActive]}
              onPress={() => setListingSource('mine')}
              activeOpacity={0.9}
            >
              <Text style={[styles.sourceChipText, listingSource === 'mine' && styles.sourceChipTextActive]}>Mine</Text>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.sourceChip, listingSource === 'marketplace' && styles.sourceChipActive]}
              onPress={() => setListingSource('marketplace')}
              activeOpacity={0.9}
            >
              <Text style={[styles.sourceChipText, listingSource === 'marketplace' && styles.sourceChipTextActive]}>Marketplace</Text>
            </AnimatedPressable>
          </View>
          <Text style={styles.helperTextLeft}>Pick your own listing or share another seller listing with attribution.</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Poster Image</Text>
            <Text style={styles.sectionHint}>{posterImageUri ? 'Custom image selected' : 'Using listing image'}</Text>
          </View>

          <View style={styles.imagePickerRow}>
            <AnimatedPressable
              style={styles.imagePickerBtn}
              onPress={pickFromLibrary}
              activeOpacity={0.9}
              disabled={isPickingImage}
            >
              <Ionicons name="images-outline" size={16} color={Colors.textPrimary} />
              <Text style={styles.imagePickerBtnText}>Gallery</Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={styles.imagePickerBtn}
              onPress={pickFromCamera}
              activeOpacity={0.9}
              disabled={isPickingImage}
            >
              <Ionicons name="camera-outline" size={16} color={Colors.textPrimary} />
              <Text style={styles.imagePickerBtnText}>Camera</Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={[styles.imagePickerBtn, !posterImageUri && styles.imagePickerBtnDisabled]}
              onPress={() => setPosterImageUri(null)}
              activeOpacity={0.9}
              disabled={!posterImageUri || isPickingImage}
            >
              <Ionicons name="refresh-outline" size={16} color={posterImageUri ? Colors.textPrimary : Colors.textMuted} />
              <Text style={[styles.imagePickerBtnText, !posterImageUri && styles.imagePickerBtnTextDisabled]}>Reset</Text>
            </AnimatedPressable>
          </View>

          {isPickingImage ? (
            <View style={styles.pickingRow}>
              <ActivityIndicator size="small" color="#e8dcc8" />
              <Text style={styles.pickingText}>Opening picker...</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Caption</Text>
          <TextInput
            style={styles.captionInput}
            value={caption}
            onChangeText={setCaption}
            placeholder="Write a short hook for your poster"
            placeholderTextColor={Colors.textMuted}
            multiline
            maxLength={120}
          />
          <Text style={styles.helperText}>{caption.length}/120</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Story Overlay</Text>
          <TextInput
            style={styles.storyInput}
            value={storyText}
            onChangeText={setStoryText}
            placeholder="Add overlay text like Instagram stories"
            placeholderTextColor={Colors.textMuted}
            maxLength={48}
          />

          <View style={styles.storyControlRow}>
            <Text style={styles.storyControlLabel}>Color</Text>
            <View style={styles.storyColorRow}>
              {STORY_COLORS.map((color) => {
                const active = storyColor === color;
                return (
                  <AnimatedPressable
                    key={color}
                    style={[styles.storyColorChip, { backgroundColor: color }, active && styles.storyColorChipActive]}
                    onPress={() => setStoryColor(color)}
                    activeOpacity={0.85}
                  />
                );
              })}
            </View>
          </View>

          <View style={styles.storyControlRow}>
            <Text style={styles.storyControlLabel}>Position</Text>
            <View style={styles.storyPositionRow}>
              {STORY_POSITIONS.map((position) => {
                const active = storyPosition === position;
                return (
                  <AnimatedPressable
                    key={position}
                    style={[styles.storyPositionChip, active && styles.storyPositionChipActive]}
                    onPress={() => setStoryPosition(position)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.storyPositionText, active && styles.storyPositionTextActive]}>{position.toUpperCase()}</Text>
                  </AnimatedPressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Expires In</Text>
          <View style={styles.expiryRow}>
            {EXPIRY_OPTIONS.map((hours) => {
              const active = expiryHours === hours;
              return (
                <AnimatedPressable
                  key={hours}
                  style={[styles.expiryChip, active && styles.expiryChipActive]}
                  onPress={() => setExpiryHours(hours)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.expiryChipText, active && styles.expiryChipTextActive]}>{hours}h</Text>
                </AnimatedPressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Attach Listing</Text>
            <Text style={styles.sectionHint}>{listingOptions.length} items</Text>
          </View>

          <FlatList
            data={listingOptions}
            horizontal
            keyExtractor={(item) => item.id}
            renderItem={renderListingCard}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.listingListContent}
          />
        </View>
      </ScrollView>
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
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#151515',
  },
  headerLabel: {
    color: '#e8dcc8',
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
  publishBtn: {
    backgroundColor: Colors.accent,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  publishBtnText: {
    color: Colors.background,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  contentContainer: {
    paddingBottom: 28,
  },
  previewCard: {
    height: 198,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    marginBottom: 16,
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewOverlayTop: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sharedListingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
    maxWidth: '68%',
  },
  sharedListingText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  previewExpiryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  previewExpiryText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  previewOverlayBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  previewCaption: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  storyOverlayWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    alignItems: 'center',
    zIndex: 2,
  },
  storyOverlayTop: {
    top: 46,
  },
  storyOverlayCenter: {
    top: '45%',
  },
  storyOverlayBottom: {
    bottom: 44,
  },
  storyOverlayText: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowRadius: 8,
    letterSpacing: 0.2,
  },
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
    marginBottom: 8,
  },
  captionInput: {
    minHeight: 80,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#121212',
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    paddingHorizontal: 12,
    paddingTop: 10,
    textAlignVertical: 'top',
  },
  helperText: {
    marginTop: 6,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    textAlign: 'right',
  },
  helperTextLeft: {
    marginTop: 6,
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  sourceRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#343434',
    backgroundColor: '#121212',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sourceChipActive: {
    borderColor: '#e8dcc8',
    backgroundColor: '#2f291f',
  },
  sourceChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  sourceChipTextActive: {
    color: '#e8dcc8',
  },
  storyInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#121212',
    color: Colors.textPrimary,
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  storyControlRow: {
    marginTop: 6,
  },
  storyControlLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  storyColorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  storyColorChip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#4a4a4a',
  },
  storyColorChipActive: {
    borderColor: '#ffffff',
    borderWidth: 2,
  },
  storyPositionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  storyPositionChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#343434',
    backgroundColor: '#121212',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  storyPositionChipActive: {
    borderColor: '#e8dcc8',
    backgroundColor: '#2f291f',
  },
  storyPositionText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  storyPositionTextActive: {
    color: '#e8dcc8',
  },
  expiryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  expiryChip: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#343434',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#121212',
  },
  expiryChipActive: {
    borderColor: '#e8dcc8',
    backgroundColor: '#2f291f',
  },
  expiryChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  expiryChipTextActive: {
    color: '#e8dcc8',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionHint: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  imagePickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  imagePickerBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    backgroundColor: '#121212',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  imagePickerBtnDisabled: {
    borderColor: '#252525',
    backgroundColor: '#101010',
  },
  imagePickerBtnText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  imagePickerBtnTextDisabled: {
    color: Colors.textMuted,
  },
  pickingRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pickingText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  listingListContent: {
    gap: 8,
    paddingBottom: 8,
  },
  listingCard: {
    width: 118,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: '#272727',
  },
  listingCardSelected: {
    borderColor: '#e8dcc8',
  },
  listingImage: {
    width: '100%',
    height: 92,
  },
  listingMeta: {
    padding: 8,
  },
  listingTitle: {
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  listingSeller: {
    marginTop: 3,
    color: Colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  listingPrice: {
    marginTop: 3,
    color: Colors.textSecondary,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  selectedBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#e8dcc8',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
