import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  TextInput,
  ActivityIndicator,
  ScrollView
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_LISTINGS, MOCK_USERS, Listing } from '../data/mockData';
import { mockFind, mockArrayOrEmpty } from '../utils/mockGate';
import type { Poster } from '../data/posters';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useBackendData } from '../context/BackendDataContext';
import { CachedImage } from '../components/CachedImage';
import { getListingCoverUri } from '../utils/media';
import { AppButton } from '../components/ui/AppButton';
import { AppSegmentControl, AppSegmentOption } from '../components/ui/AppSegmentControl';

type NavT = StackNavigationProp<RootStackParamList>;
type ListingSource = 'mine' | 'marketplace';
type StoryPosition = 'top' | 'center' | 'bottom';

const EXPIRY_OPTIONS = [6, 12, 24, 48] as const;
const STORY_POSITIONS: StoryPosition[] = ['top', 'center', 'bottom'];
type ExpiryOption = `${typeof EXPIRY_OPTIONS[number]}h`;

const LISTING_SOURCE_OPTIONS: AppSegmentOption<ListingSource>[] = [
  { value: 'mine', label: 'Mine', accessibilityLabel: 'Show my listings' },
  { value: 'marketplace', label: 'Marketplace', accessibilityLabel: 'Show marketplace listings' },
];

const STORY_POSITION_OPTIONS: AppSegmentOption<StoryPosition>[] = STORY_POSITIONS.map((position) => ({
  value: position,
  label: position.toUpperCase(),
  accessibilityLabel: `Set story text position to ${position}`,
}));

const EXPIRY_SEGMENT_OPTIONS: AppSegmentOption<ExpiryOption>[] = EXPIRY_OPTIONS.map((hours) => ({
  value: `${hours}h` as ExpiryOption,
  label: `${hours}h`,
  accessibilityLabel: `Set poster expiry to ${hours} hours`,
}));

const IS_LIGHT = ActiveTheme === 'light';
const TRADE_ACCENT = Colors.accentGold;
const HEADER_BORDER = Colors.border;
const HEADER_BUTTON_BG = Colors.card;
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;
const CHIP_BG = Colors.card;
const CHIP_BORDER = Colors.border;
const CHIP_ACTIVE_BG = IS_LIGHT ? '#ede4d3' : '#2f291f';
const CHIP_ACTIVE_TEXT = TRADE_ACCENT;
const IMAGE_BTN_DISABLED_BG = IS_LIGHT ? Colors.cardAlt : '#101010';
const IMAGE_BTN_DISABLED_BORDER = IS_LIGHT ? Colors.border : '#252525';

export default function CreatePosterScreen() {
  const navigation = useNavigation<NavT>();
  const { show } = useToast();
  const { formatFromFiat } = useFormattedPrice();
  const { listings } = useBackendData();

  const currentUser = useStore((state) => state.currentUser);
  const addPoster = useStore((state) => state.addPoster);
  const uploaderId = currentUser?.id ?? MOCK_USERS[0]?.id ?? 'u1';

  const allListingOptions = React.useMemo(
    () => (listings.length ? listings : mockArrayOrEmpty(MOCK_LISTINGS)),
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
  const [storyPosition, setStoryPosition] = React.useState<StoryPosition>('bottom');

  const expiryOptionValue = `${expiryHours}h` as ExpiryOption;

  const handleExpiryOptionChange = (next: ExpiryOption) => {
    const parsed = Number(next.replace('h', ''));
    if (Number.isFinite(parsed)) {
      setExpiryHours(parsed);
    }
  };

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
    () => mockFind(MOCK_USERS, (user) => user.id === selectedListing?.sellerId),
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
    (selectedListing
      ? getListingCoverUri(selectedListing.images, 'https://picsum.photos/seed/poster-fallback/600/800')
      : undefined) ??
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
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setPosterImageUri(result.assets[0].uri);
        show('Poster image selected', 'success');
      }
    } catch {
      show('Unable to open gallery right now', 'error');
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
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 5],
        quality: 0.9,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        setPosterImageUri(result.assets[0].uri);
        show('Poster image captured', 'success');
      }
    } catch {
      show('Unable to open camera right now', 'error');
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
            color: '#ffffff',
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
    const sellerName = mockFind(MOCK_USERS, (user) => user.id === item.sellerId)?.username ?? 'seller';

    return (
      <AnimatedPressable
        style={[styles.listingCard, selected && styles.listingCardSelected]}
        activeOpacity={0.9}
        onPress={() => setSelectedListingId(item.id)}
      >
        <CachedImage uri={getListingCoverUri(item.images, 'https://picsum.photos/seed/poster-listing-fallback/300/400')} style={styles.listingImage} contentFit="cover" />
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

        <AppButton
          title="Publish"
          variant="primary"
          size="sm"
          align="center"
          style={styles.publishBtn}
          titleStyle={styles.publishBtnText}
          onPress={handlePublish}
          accessibilityLabel="Publish poster"
        />
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.previewCard}>
          <CachedImage uri={previewUri} style={styles.previewImage} contentFit="cover" />
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
              <Text style={styles.storyOverlayText} numberOfLines={2}>
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
          <AppSegmentControl
            options={LISTING_SOURCE_OPTIONS}
            value={listingSource}
            onChange={setListingSource}
            style={styles.sourceRow}
            fullWidth
            optionStyle={styles.sourceChip}
            optionActiveStyle={styles.sourceChipActive}
            optionTextStyle={styles.sourceChipText}
            optionTextActiveStyle={styles.sourceChipTextActive}
          />
          <Text style={styles.helperTextLeft}>Pick your own listing or share another seller listing with attribution.</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Poster Image</Text>
            <Text style={styles.sectionHint}>{posterImageUri ? 'Custom image selected' : 'Using listing image'}</Text>
          </View>

          <View style={styles.imagePickerRow}>
            <AppButton
              title="Gallery"
              variant="secondary"
              size="sm"
              align="center"
              style={styles.imagePickerBtn}
              icon={<Ionicons name="images-outline" size={16} color={Colors.textPrimary} />}
              iconContainerStyle={styles.imagePickerIconWrap}
              titleStyle={styles.imagePickerBtnText}
              onPress={pickFromLibrary}
              disabled={isPickingImage}
              accessibilityLabel="Choose image from gallery"
            />

            <AppButton
              title="Camera"
              variant="secondary"
              size="sm"
              align="center"
              style={styles.imagePickerBtn}
              icon={<Ionicons name="camera-outline" size={16} color={Colors.textPrimary} />}
              iconContainerStyle={styles.imagePickerIconWrap}
              titleStyle={styles.imagePickerBtnText}
              onPress={pickFromCamera}
              disabled={isPickingImage}
              accessibilityLabel="Capture image using camera"
            />

            <AppButton
              title="Reset"
              variant="secondary"
              size="sm"
              align="center"
              style={[styles.imagePickerBtn, !posterImageUri && styles.imagePickerBtnDisabled]}
              icon={<Ionicons name="refresh-outline" size={16} color={posterImageUri ? Colors.textPrimary : Colors.textMuted} />}
              iconContainerStyle={styles.imagePickerIconWrap}
              titleStyle={[styles.imagePickerBtnText, !posterImageUri && styles.imagePickerBtnTextDisabled]}
              onPress={() => setPosterImageUri(null)}
              disabled={!posterImageUri || isPickingImage}
              accessibilityLabel="Reset poster image"
            />
          </View>

          {isPickingImage ? (
            <View style={styles.pickingRow}>
              <ActivityIndicator size="small" color="#d7b98f" />
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
            <Text style={styles.storyControlLabel}>Position</Text>
            <AppSegmentControl
              options={STORY_POSITION_OPTIONS}
              value={storyPosition}
              onChange={setStoryPosition}
              style={styles.storyPositionRow}
              fullWidth
              optionStyle={styles.storyPositionChip}
              optionActiveStyle={styles.storyPositionChipActive}
              optionTextStyle={styles.storyPositionText}
              optionTextActiveStyle={styles.storyPositionTextActive}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Expires In</Text>
          <AppSegmentControl
            options={EXPIRY_SEGMENT_OPTIONS}
            value={expiryOptionValue}
            onChange={handleExpiryOptionChange}
            style={styles.expiryRow}
            optionStyle={styles.expiryChip}
            optionActiveStyle={styles.expiryChipActive}
            optionTextStyle={styles.expiryChipText}
            optionTextActiveStyle={styles.expiryChipTextActive}
          />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Attach Listing</Text>
            <Text style={styles.sectionHint}>{listingOptions.length} items</Text>
          </View>

          <FlashList
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
    borderBottomColor: HEADER_BORDER,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: HEADER_BUTTON_BG,
  },
  headerLabel: {
    color: '#d7b98f',
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
    minHeight: 36,
    borderRadius: 16,
    paddingHorizontal: 12,
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
    borderColor: PANEL_BORDER,
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
    color: '#fff',
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
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
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
    borderColor: CHIP_BORDER,
    backgroundColor: CHIP_BG,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  sourceChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  sourceChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
  },
  sourceChipTextActive: {
    color: CHIP_ACTIVE_TEXT,
  },
  storyInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
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
  storyPositionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  storyPositionChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CHIP_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  storyPositionChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  storyPositionText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  storyPositionTextActive: {
    color: CHIP_ACTIVE_TEXT,
  },
  expiryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  expiryChip: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CHIP_BG,
  },
  expiryChipActive: {
    borderColor: TRADE_ACCENT,
    backgroundColor: CHIP_ACTIVE_BG,
  },
  expiryChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  expiryChipTextActive: {
    color: CHIP_ACTIVE_TEXT,
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
    borderColor: CHIP_BORDER,
    backgroundColor: CHIP_BG,
    minHeight: 42,
  },
  imagePickerIconWrap: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  imagePickerBtnDisabled: {
    borderColor: IMAGE_BTN_DISABLED_BORDER,
    backgroundColor: IMAGE_BTN_DISABLED_BG,
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
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  listingCardSelected: {
    borderColor: TRADE_ACCENT,
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
    backgroundColor: TRADE_ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

