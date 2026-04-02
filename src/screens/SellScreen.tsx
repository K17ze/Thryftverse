import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { 
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  StatusBar,
  Dimensions,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withSequence, withTiming, withSpring, FadeInUp, FadeOutUp, Layout } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../constants/colors';
import { Alert, Modal } from 'react-native';
import { useStore } from '../store/useStore';
import { SortablePhotoStrip } from '../components/SortablePhotoStrip';
import { BottomSheetPicker } from '../components/BottomSheetPicker';
import { CURRENCIES } from '../constants/currencies';
import { useCurrencyPref } from '../hooks/useCurrencyPref';
import { sanitizeDecimalInput, sanitizeIntegerInput } from '../utils/currencyAuthoringFlows';
import { buildCreateSyndicatePrefillFromSell } from '../utils/syndicatePrefill';

const CONDITIONS = ['New with tags', 'Very good', 'Good', 'Satisfactory'];
const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];
const BRANDS = ['Nike', 'Adidas', 'Zara', 'H&M', 'Ralph Lauren', 'Off-White', 'Stone Island', 'Stüssy', 'Other'];
const OFFERING_WINDOWS_HOURS = [24, 48, 72];

const { width } = Dimensions.get('window');

export default function SellScreen() {
  const navigation = useNavigation<any>();
  const { currencyCode } = useCurrencyPref();
  const currencySymbol = CURRENCIES[currencyCode].symbol;
  
  const [pickerMode, setPickerMode] = useState<'Brand' | 'Size' | 'Condition' | null>(null);

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [syndicateEnabled, setSyndicateEnabled] = useState(false);
  const [shareCountInput, setShareCountInput] = useState('100');
  const [sharePriceInput, setSharePriceInput] = useState('');
  const [offeringWindowHours, setOfferingWindowHours] = useState(24);
  const [authPhotos, setAuthPhotos] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  
  const sellDraft = useStore(state => state.sellDraft);
  const updateSellDraft = useStore(state => state.updateSellDraft);

  const shakeOffset = useSharedValue(0);

  const shake = () => {
    shakeOffset.value = withSequence(
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withTiming(-10, { duration: 50 }),
      withTiming(10, { duration: 50 }),
      withSpring(0, { damping: 20, stiffness: 400 })
    );
  };

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeOffset.value }]
  }));

  React.useEffect(() => {
    if (!syndicateEnabled || sharePriceInput) {
      return;
    }

    const listingPrice = Number(sanitizeDecimalInput(price));
    const shareCount = Math.max(1, Math.floor(Number(shareCountInput)));
    if (Number.isFinite(listingPrice) && listingPrice > 0 && Number.isFinite(shareCount) && shareCount > 0) {
      setSharePriceInput((listingPrice / shareCount).toFixed(2));
    }
  }, [price, shareCountInput, sharePriceInput, syndicateEnabled]);

  const handleCameraPress = () => {
    // Fake expo-image-picker by adding 3 mock product photos
    const samplePhotos = [
      'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=80', // jeans
      'https://images.unsplash.com/photo-1516257984-b1b4d707412e?w=400&q=80', // detail
      'https://images.unsplash.com/photo-1550614000-4b95fcd7dbfc?w=400&q=80', // tag
    ];
    setPhotos(samplePhotos);
    if (syndicateEnabled) {
      setAuthPhotos(samplePhotos.slice(0, 2));
    }
  };

  const handlePublish = () => {
    const trimmedTitle = title.trim();
    const trimmedDescription = desc.trim();
    const numericPrice = Number(sanitizeDecimalInput(price));

    if (photos.length === 0) {
      setErrorMsg('Add at least one photo before publishing.');
      shake();
      return;
    }

    if (!trimmedTitle || !sellDraft.categoryId) {
      setErrorMsg('Please provide a title and category.');
      shake();
      return;
    }

    if (!sellDraft.size || !sellDraft.condition) {
      setErrorMsg('Please choose both size and condition.');
      shake();
      return;
    }

    if (!trimmedDescription || trimmedDescription.length < 10) {
      setErrorMsg('Add a description with at least 10 characters.');
      shake();
      return;
    }

    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
      setErrorMsg('Enter a valid price greater than 0.');
      shake();
      return;
    }

    if (syndicateEnabled) {
      const prefillResult = buildCreateSyndicatePrefillFromSell({
        shareCountInput,
        sharePriceInput,
        offeringWindowHours,
        authPhotos,
      });

      if (!prefillResult.ok) {
        setErrorMsg(prefillResult.error ?? 'Unable to prepare syndicate listing.');
        shake();
        return;
      }

      setErrorMsg('');
      navigation.replace('CreateSyndicate', prefillResult.params);
      return;
    }

    setErrorMsg('');

    navigation.replace('ListingSuccess');
  };

  const handlePriceChange = (value: string) => {
    setPrice(sanitizeDecimalInput(value));
  };

  const getPickerOptions = () => {
    switch (pickerMode) {
      case 'Condition': return CONDITIONS;
      case 'Size': return SIZES;
      case 'Brand': return BRANDS;
      default: return [];
    }
  };

  const getPickerSelected = () => {
    switch (pickerMode) {
      case 'Condition': return sellDraft.condition;
      case 'Size': return sellDraft.size;
      case 'Brand': return sellDraft.brand;
      default: return undefined;
    }
  };

  const handlePickerSelect = (val: string) => {
    if (pickerMode === 'Condition') updateSellDraft({ condition: val });
    if (pickerMode === 'Size') updateSellDraft({ size: val });
    if (pickerMode === 'Brand') updateSellDraft({ brand: val });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ── Scan Header / Upload Area ── */}
      <View style={styles.scanHeader}>
        <View style={styles.headerTop}>
          <AnimatedPressable style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Ionicons name="close" size={28} color={Colors.textPrimary} />
          </AnimatedPressable>
          <Text style={styles.headerTitle}>Scan Item</Text>
          <AnimatedPressable style={styles.iconBtn} activeOpacity={0.8}>
            <Ionicons name="flash-outline" size={24} color={Colors.textPrimary} />
          </AnimatedPressable>
        </View>

        {/* Giant Camera-Centric Upload Box or Photo Strip */}
        {photos.length === 0 ? (
          <AnimatedPressable 
            style={styles.giantCameraBox} 
            activeOpacity={0.9}
            onPress={handleCameraPress}
          >
            <View style={styles.cameraCircle}>
              <Ionicons name="camera" size={40} color={Colors.background} />
            </View>
            <Text style={styles.cameraText}>Take a photo or upload</Text>
            <Text style={styles.cameraSubtext}>Clear photos sell 3x faster</Text>
          </AnimatedPressable>
        ) : (
          <SortablePhotoStrip 
            photos={photos} 
            onReorder={setPhotos} 
            onAddPhoto={() => Alert.alert('Add Photo', 'Picker opens here.')} 
          />
        )}
      </View>

      <KeyboardAvoidingView 
        style={styles.keyboardView} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
          
          <Text style={styles.sectionHeading}>Item Details</Text>

          {/* ── Core Details (Floating Pills) ── */}
          <View style={styles.pillInputBox}>
            <Text style={styles.inputLabel}>Title</Text>
            <TextInput 
              style={styles.textInput} 
              placeholder="e.g. Vintage Nike Sweatshirt" 
              placeholderTextColor="#555"
              value={title} 
              onChangeText={setTitle} 
            />
          </View>

          <View style={styles.pillInputBox}>
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput 
              style={[styles.textInput, styles.textArea]} 
              placeholder="Add measurements, flaws, and specific details..." 
              placeholderTextColor="#555"
              value={desc} 
              onChangeText={setDesc} 
              multiline 
              textAlignVertical="top"
            />
          </View>

          {/* ── Pickers (Floating Cards) ── */}
          <View style={styles.cardGroup}>
            <AnimatedPressable 
              style={styles.pickerRow} 
              activeOpacity={0.7} 
              onPress={() => navigation.navigate('CategoryTree', { categoryPrefix: 'Sell' })}
            >
              <Text style={styles.pickerLabel}>Category</Text>
              <View style={styles.pickerValueArea}>
                <Text style={[styles.pickerValue, !sellDraft.categoryId && styles.pickerPlaceholder]}>
                  {sellDraft.categoryId || 'Select'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </AnimatedPressable>
            
            <View style={styles.divider} />

            <AnimatedPressable 
              style={styles.pickerRow} 
              activeOpacity={0.7}
              onPress={() => setPickerMode('Brand')}
            >
              <Text style={styles.pickerLabel}>Brand</Text>
              <View style={styles.pickerValueArea}>
                <Text style={[styles.pickerValue, !sellDraft.brand && styles.pickerPlaceholder]}>
                  {sellDraft.brand || 'Optional'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </AnimatedPressable>
            
            <View style={styles.divider} />

            <AnimatedPressable 
              style={styles.pickerRow} 
              activeOpacity={0.7}
              onPress={() => setPickerMode('Size')}
            >
              <Text style={styles.pickerLabel}>Size</Text>
              <View style={styles.pickerValueArea}>
                <Text style={[styles.pickerValue, !sellDraft.size && styles.pickerPlaceholder]}>
                  {sellDraft.size || 'Select'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </AnimatedPressable>
            
            <View style={styles.divider} />

            <AnimatedPressable 
              style={styles.pickerRow} 
              activeOpacity={0.7}
              onPress={() => setPickerMode('Condition')}
            >
              <Text style={styles.pickerLabel}>Condition</Text>
              <View style={styles.pickerValueArea}>
                <Text style={[styles.pickerValue, !sellDraft.condition && styles.pickerPlaceholder]}>
                  {sellDraft.condition || 'Select'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </AnimatedPressable>
          </View>

          {/* ── Price Input ── */}
          <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Pricing</Text>
          
          <View style={styles.pricePillBox}>
            <Text style={styles.priceLabel}>{currencySymbol}</Text>
            <TextInput 
              style={styles.priceInputContent} 
              placeholder="0.00" 
              placeholderTextColor="#555"
              value={price} 
              onChangeText={handlePriceChange} 
              keyboardType="decimal-pad"
            />
          </View>

          <Text style={styles.priceCurrencyHint}>Listing currency: {currencyCode}</Text>

          <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Syndicate Listing</Text>
          <View style={styles.syndicateCard}>
            <View style={styles.syndicateTopRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.syndicateTitle}>Tokenize this item</Text>
                <Text style={styles.syndicateHint}>Create fractional shares for the Syndicate marketplace.</Text>
              </View>
              <View style={styles.syndicateToggleWrap}>
                <AnimatedPressable
                  style={[styles.syndicateToggleBtn, !syndicateEnabled && styles.syndicateToggleBtnActive]}
                  activeOpacity={0.85}
                  onPress={() => setSyndicateEnabled(false)}
                >
                  <Text style={[styles.syndicateToggleText, !syndicateEnabled && styles.syndicateToggleTextActive]}>Off</Text>
                </AnimatedPressable>
                <AnimatedPressable
                  style={[styles.syndicateToggleBtn, syndicateEnabled && styles.syndicateToggleBtnActive]}
                  activeOpacity={0.85}
                  onPress={() => {
                    setSyndicateEnabled(true);
                    if (authPhotos.length === 0 && photos.length > 0) {
                      setAuthPhotos(photos.slice(0, 2));
                    }
                  }}
                >
                  <Text style={[styles.syndicateToggleText, syndicateEnabled && styles.syndicateToggleTextActive]}>On</Text>
                </AnimatedPressable>
              </View>
            </View>

            {syndicateEnabled ? (
              <View style={styles.syndicateFieldsWrap}>
                <Text style={styles.inputLabel}>Share count</Text>
                <TextInput
                  style={styles.syndicateInput}
                  value={shareCountInput}
                  onChangeText={(value) => setShareCountInput(sanitizeIntegerInput(value))}
                  keyboardType="number-pad"
                  placeholder="100"
                  placeholderTextColor="#555"
                />

                <Text style={styles.inputLabel}>Initial share price ({currencyCode})</Text>
                <TextInput
                  style={styles.syndicateInput}
                  value={sharePriceInput}
                  onChangeText={(value) => setSharePriceInput(sanitizeDecimalInput(value))}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor="#555"
                />

                <Text style={styles.inputLabel}>Offering window</Text>
                <View style={styles.windowChipsRow}>
                  {OFFERING_WINDOWS_HOURS.map((hours) => {
                    const active = offeringWindowHours === hours;
                    return (
                      <AnimatedPressable
                        key={hours}
                        style={[styles.windowChip, active && styles.windowChipActive]}
                        onPress={() => setOfferingWindowHours(hours)}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.windowChipText, active && styles.windowChipTextActive]}>{hours}h</Text>
                      </AnimatedPressable>
                    );
                  })}
                </View>

                <View style={styles.authRow}>
                  <View>
                    <Text style={styles.authTitle}>Authentication photos</Text>
                    <Text style={styles.authHint}>{authPhotos.length} attached · Required for issuance</Text>
                  </View>
                  <View style={styles.authBtnRow}>
                    <AnimatedPressable
                      style={styles.authBtn}
                      activeOpacity={0.85}
                      onPress={() => {
                        if (photos.length === 0) {
                          setErrorMsg('Add listing photos first, then attach auth photos.');
                          shake();
                          return;
                        }
                        setAuthPhotos(photos.slice(0, Math.min(photos.length, 3)));
                      }}
                    >
                      <Text style={styles.authBtnText}>Use listing</Text>
                    </AnimatedPressable>
                    <AnimatedPressable
                      style={[styles.authBtn, styles.authBtnMuted]}
                      activeOpacity={0.85}
                      onPress={() => setAuthPhotos([])}
                    >
                      <Text style={[styles.authBtnText, styles.authBtnTextMuted]}>Clear</Text>
                    </AnimatedPressable>
                  </View>
                </View>
              </View>
            ) : (
              <Text style={styles.syndicateHintMuted}>Enable this to route publishing into the Syndicate issuer flow.</Text>
            )}
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Huge Action Button ── */}
      <View style={styles.stickyFooter}>
        {!!errorMsg && (
          <Reanimated.Text 
            entering={FadeInUp.springify().damping(20).duration(400)} 
            exiting={FadeOutUp}
            layout={Layout.springify()}
            style={styles.errorText}
          >
            {errorMsg}
          </Reanimated.Text>
        )}
        <Reanimated.View style={[shakeStyle, { width: '100%' }]} layout={Layout.springify()}>
          <AnimatedPressable style={styles.uploadCta} activeOpacity={0.9} onPress={handlePublish}>
            <Text style={styles.uploadCtaText}>Publish Item</Text>
          </AnimatedPressable>
        </Reanimated.View>
      </View>

      {pickerMode && (
        <BottomSheetPicker
          visible={!!pickerMode}
          onClose={() => setPickerMode(null)}
          title={`Select ${pickerMode}`}
          options={getPickerOptions()}
          selectedValue={getPickerSelected()}
          onSelect={handlePickerSelect}
          searchable={pickerMode === 'Brand'}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  keyboardView: { flex: 1 },
  
  scanHeader: {
    backgroundColor: '#0a0a0a',
    borderBottomWidth: 1,
    borderBottomColor: '#1A1A1A',
    paddingBottom: 24,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 64,
  },
  iconBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, textTransform: 'uppercase', letterSpacing: 1 },
  
  giantCameraBox: {
    marginHorizontal: 20,
    marginTop: 10,
    height: 200,
    backgroundColor: '#111',
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#222',
  },
  cameraCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cameraText: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  cameraSubtext: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },

  scrollContent: { paddingTop: 24, paddingHorizontal: 20 },
  sectionHeading: { fontSize: 14, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },

  pillInputBox: {
    backgroundColor: '#111',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
  },
  inputLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, marginBottom: 8 },
  textInput: { fontSize: 16, fontFamily: 'Inter_500Medium', color: Colors.textPrimary, padding: 0 },
  textArea: { minHeight: 80, lineHeight: 24 },

  cardGroup: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 18 },
  pickerLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary },
  pickerValueArea: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerValue: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  pickerPlaceholder: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.textMuted },
  divider: { height: 1, backgroundColor: '#1C1C1C' },

  pricePillBox: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 20,
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  priceLabel: { fontSize: 28, fontFamily: 'Inter_700Bold', color: Colors.textMuted, marginRight: 8 },
  priceInputContent: { flex: 1, fontSize: 32, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, padding: 0 },
  priceCurrencyHint: {
    marginTop: -14,
    marginBottom: 6,
    color: Colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  syndicateCard: {
    backgroundColor: '#111',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  syndicateTopRow: {
    flexDirection: 'row',
    gap: 12,
  },
  syndicateTitle: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    marginBottom: 2,
  },
  syndicateHint: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
    lineHeight: 18,
  },
  syndicateHintMuted: {
    marginTop: 10,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
    lineHeight: 18,
  },
  syndicateToggleWrap: {
    flexDirection: 'row',
    backgroundColor: '#181818',
    borderRadius: 14,
    padding: 4,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    height: 36,
  },
  syndicateToggleBtn: {
    borderRadius: 10,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  syndicateToggleBtnActive: {
    backgroundColor: Colors.accent,
  },
  syndicateToggleText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
  },
  syndicateToggleTextActive: {
    color: Colors.background,
  },
  syndicateFieldsWrap: {
    marginTop: 14,
  },
  syndicateInput: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    backgroundColor: '#171717',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 10,
  },
  windowChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  windowChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2f2f2f',
    backgroundColor: '#171717',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  windowChipActive: {
    borderColor: '#4ECDC4',
    backgroundColor: '#16302b',
  },
  windowChipText: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.textSecondary,
  },
  windowChipTextActive: {
    color: '#8de5dc',
  },
  authRow: {
    marginTop: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2b2b2b',
    backgroundColor: '#171717',
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  authTitle: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
  },
  authHint: {
    marginTop: 3,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textMuted,
  },
  authBtnRow: {
    flexDirection: 'row',
    gap: 6,
  },
  authBtn: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3b4a4b',
    backgroundColor: '#152024',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  authBtnMuted: {
    borderColor: '#2f2f2f',
    backgroundColor: '#151515',
  },
  authBtnText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#8de5dc',
  },
  authBtnTextMuted: {
    color: Colors.textSecondary,
  },

  stickyFooter: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 24,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  errorText: { color: Colors.danger, fontSize: 13, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 12 },
  uploadCta: {
    backgroundColor: Colors.textPrimary,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCtaText: { color: Colors.background, fontSize: 18, fontFamily: 'Inter_800ExtraBold', letterSpacing: -0.5 },
});
