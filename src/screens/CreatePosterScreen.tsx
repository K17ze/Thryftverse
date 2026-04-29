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
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
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
type CreatePosterRoute = RouteProp<RootStackParamList, 'CreatePoster'>;
type PosterMode = 'marketplace' | 'co-own' | 'auction' | 'blank';

const EXPIRY_OPTIONS = [6, 12, 24, 48] as const;
type ExpiryOption = `${typeof EXPIRY_OPTIONS[number]}h`;

const LISTING_SOURCE_OPTIONS: AppSegmentOption<ListingSource>[] = [
  { value: 'mine', label: 'Mine', accessibilityLabel: 'Show my listings' },
  { value: 'marketplace', label: 'Marketplace', accessibilityLabel: 'Show marketplace listings' },
];

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
  const route = useRoute<CreatePosterRoute>();
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
  const [storyColor, setStoryColor] = React.useState('#ffffff');
  const [storyPosition, setStoryPosition] = React.useState<StoryPosition>('bottom');
  const [posterMode, setPosterMode] = React.useState<PosterMode>('marketplace');
  const [blankBackgroundColor, setBlankBackgroundColor] = React.useState('#1a1a2e');
  const [showColorPicker, setShowColorPicker] = React.useState(false);
  const lastAppliedEditorResultAtRef = React.useRef<number | null>(null);

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

  React.useEffect(() => {
    const storyEditorResult = route.params?.storyEditorResult;

    if (!storyEditorResult) {
      return;
    }

    if (lastAppliedEditorResultAtRef.current === storyEditorResult.updatedAt) {
      return;
    }

    setStoryText(storyEditorResult.text);
    setStoryColor(storyEditorResult.color);
    setStoryPosition(storyEditorResult.position);
    lastAppliedEditorResultAtRef.current = storyEditorResult.updatedAt;
  }, [route.params?.storyEditorResult]);

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
    posterMode === 'blank'
      ? null // blank canvas mode uses background color, not image
      : (posterImageUri ??
        (selectedListing
          ? getListingCoverUri(selectedListing.images, 'https://picsum.photos/seed/poster-fallback/600/800')
          : undefined) ??
        'https://picsum.photos/seed/poster-fallback/600/800');

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
      // Silently fail - user can try again
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
      // Silently fail - user can try again
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
      image: previewUri ?? blankBackgroundColor,
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

  const handleMessageSelectedSeller = React.useCallback(() => {
    if (!selectedListing) {
      return;
    }

    const partnerUserId = selectedListingSeller?.id ?? selectedListing.sellerId;
    navigation.navigate('Chat', {
      conversationId: `poster_${selectedListing.id}_${partnerUserId}`,
      focusQuery: selectedListing.title,
      partnerUserId,
    });
    show('Opening seller chat for poster collaboration.', 'info');
  }, [navigation, selectedListing, selectedListingSeller?.id, show]);

  const handleOpenStoryEditor = React.useCallback(() => {
    navigation.navigate('PosterEditor', {
      baseImageUri: previewUri ?? blankBackgroundColor,
      initialText: storyText,
      initialColor: storyColor,
      initialPosition: storyPosition,
      createPosterRouteKey: route.key,
    });
  }, [navigation, previewUri, route.key, storyColor, storyPosition, storyText]);

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
          <CachedImage uri={previewUri ?? blankBackgroundColor} style={styles.previewImage} contentFit="cover" />
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

        {selectedListing ? (
          <View style={styles.selectedSellerRow}>
            <AnimatedPressable
              style={styles.selectedSellerIdentity}
              onPress={() => navigation.navigate('UserProfile', { userId: selectedListingSeller?.id ?? selectedListing.sellerId })}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Open @${selectedListingSeller?.username ?? 'seller'} profile`}
              accessibilityHint="Shows seller profile"
            >
              <CachedImage
                uri={selectedListingSeller?.avatar ?? 'https://picsum.photos/seed/poster-seller-fallback/100/100'}
                style={styles.selectedSellerAvatar}
                containerStyle={styles.selectedSellerAvatarWrap}
                contentFit="cover"
              />
              <Text style={styles.selectedSellerText} numberOfLines={1}>
                @{selectedListingSeller?.username ?? 'seller'}
              </Text>
            </AnimatedPressable>

            <AnimatedPressable
              style={styles.selectedSellerMessageBtn}
              onPress={handleMessageSelectedSeller}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Message selected seller"
              accessibilityHint="Opens chat with the selected listing seller"
            >
              <Ionicons name="chatbubble-ellipses-outline" size={12} color={Colors.textPrimary} />
            </AnimatedPressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Poster Type</Text>
          <View style={styles.modeSelector}>
            {[
              { key: 'marketplace', label: 'Marketplace', icon: 'pricetag-outline' },
              { key: 'co-own', label: 'Co-Own', icon: 'people-outline' },
              { key: 'auction', label: 'Auction', icon: 'gavel-outline' },
              { key: 'blank', label: 'Blank', icon: 'color-palette-outline' },
            ].map((mode) => (
              <AnimatedPressable
                key={mode.key}
                style={[
                  styles.modeChip,
                  posterMode === mode.key && styles.modeChipActive,
                ]}
                onPress={() => setPosterMode(mode.key as PosterMode)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={mode.icon as any}
                  size={16}
                  color={posterMode === mode.key ? '#fff' : Colors.textPrimary}
                />
                <Text
                  style={[
                    styles.modeChipText,
                    posterMode === mode.key && styles.modeChipTextActive,
                  ]}
                >
                  {mode.label}
                </Text>
              </AnimatedPressable>
            ))}
          </View>
        </View>

        {posterMode === 'blank' && (
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Background Color</Text>
              <View style={[styles.colorPreview, { backgroundColor: blankBackgroundColor }]} />
            </View>
            <View style={styles.colorGrid}>
              {[
                '#1a1a2e', '#16213e', '#0f3460', '#e94560', '#ff6b6b',
                '#feca57', '#48dbfb', '#1dd1a1', '#5f27cd', '#ff9f43',
                '#10ac84', '#00d2d3', '#54a0ff', '#5f27cd', '#341f97',
                '#222f3e', '#576574', '#8395a7', '#c8d6e5', '#dfe6e9',
              ].map((color) => (
                <AnimatedPressable
                  key={color}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    blankBackgroundColor === color && styles.colorSwatchActive,
                  ]}
                  onPress={() => setBlankBackgroundColor(color)}
                  activeOpacity={0.85}
                />
              ))}
            </View>
          </View>
        )}

        {posterMode !== 'blank' && (
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
        )}

        {posterMode !== 'blank' && (
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
        )}

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
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Story Overlay</Text>
            <Text style={styles.sectionHint}>{storyText.trim().length > 0 ? 'Layer ready' : 'No layer yet'}</Text>
          </View>

          <View style={styles.storyEditorCard}>
            <View style={styles.storyPreviewMetaRow}>
              <View style={[styles.storyColorDot, { backgroundColor: storyColor }]} />
              <Text style={styles.storyMetaText}>Color</Text>
              <Text style={styles.storyMetaDivider}>|</Text>
              <Text style={styles.storyMetaText}>Position {storyPosition.toUpperCase()}</Text>
            </View>

            <Text
              style={[
                styles.storyEditorPreviewText,
                storyText.trim().length === 0 && styles.storyEditorPreviewPlaceholder,
                storyText.trim().length > 0 && { color: storyColor },
              ]}
              numberOfLines={2}
            >
              {storyText.trim().length > 0
                ? storyText.trim()
                : 'Tap Edit Story Layer to add and move text directly on the canvas.'}
            </Text>

            <AppButton
              title={storyText.trim().length > 0 ? 'Edit Story Layer' : 'Add Story Layer'}
              variant="secondary"
              size="sm"
              align="center"
              style={styles.storyEditorBtn}
              titleStyle={styles.storyEditorBtnText}
              onPress={handleOpenStoryEditor}
              accessibilityLabel="Open story editor"
              accessibilityHint="Opens full-screen editor to drag and style story text"
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
  selectedSellerRow: {
    marginBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  selectedSellerIdentity: {
    flex: 1,
    minHeight: 36,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedSellerAvatarWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  selectedSellerAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  selectedSellerText: {
    flex: 1,
    color: Colors.textPrimary,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  selectedSellerMessageBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
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
  modeSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  modeChipActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  modeChipText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  modeChipTextActive: {
    color: '#fff',
  },
  colorPreview: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
  },
  colorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  colorSwatchActive: {
    borderWidth: 3,
    borderColor: '#fff',
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
  storyEditorCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
    backgroundColor: PANEL_BG,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  storyPreviewMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  storyColorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  storyMetaText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  storyMetaDivider: {
    color: Colors.textMuted,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  storyEditorPreviewText: {
    color: Colors.textPrimary,
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    lineHeight: 20,
  },
  storyEditorPreviewPlaceholder: {
    color: Colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  storyEditorBtn: {
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CHIP_BORDER,
    backgroundColor: CHIP_BG,
  },
  storyEditorBtnText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
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

