import React, { useState } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TextInput, 
  TouchableOpacity, 
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

const CONDITIONS = ['New with tags', 'Very good', 'Good', 'Satisfactory'];
const SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'];
const BRANDS = ['Nike', 'Adidas', 'Zara', 'H&M', 'Ralph Lauren', 'Off-White', 'Stone Island', 'Stüssy', 'Other'];

const { width } = Dimensions.get('window');

export default function SellScreen() {
  const navigation = useNavigation<any>();
  
  const [pickerMode, setPickerMode] = useState<'Brand' | 'Size' | 'Condition' | null>(null);

  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
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

  const handleCameraPress = () => {
    // Fake expo-image-picker by adding 3 mock product photos
    setPhotos([
      'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=80', // jeans
      'https://images.unsplash.com/photo-1516257984-b1b4d707412e?w=400&q=80', // detail
      'https://images.unsplash.com/photo-1550614000-4b95fcd7dbfc?w=400&q=80', // tag
    ]);
  };

  const handlePublish = () => {
    if (!title || !price || !sellDraft.categoryId) {
      setErrorMsg('Please provide a title, price, and category.');
      shake();
      return;
    }
    setErrorMsg('');
    // Fake publish
    navigation.replace('ListingSuccess');
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
          <TouchableOpacity style={styles.iconBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Ionicons name="close" size={28} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Scan Item</Text>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.8}>
            <Ionicons name="flash-outline" size={24} color={Colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* Giant Camera-Centric Upload Box or Photo Strip */}
        {photos.length === 0 ? (
          <TouchableOpacity 
            style={styles.giantCameraBox} 
            activeOpacity={0.9}
            onPress={handleCameraPress}
          >
            <View style={styles.cameraCircle}>
              <Ionicons name="camera" size={40} color={Colors.background} />
            </View>
            <Text style={styles.cameraText}>Take a photo or upload</Text>
            <Text style={styles.cameraSubtext}>Clear photos sell 3x faster</Text>
          </TouchableOpacity>
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
            <TouchableOpacity 
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
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity 
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
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity 
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
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity 
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
            </TouchableOpacity>
          </View>

          {/* ── Price Input ── */}
          <Text style={[styles.sectionHeading, { marginTop: 24 }]}>Pricing</Text>
          
          <View style={styles.pricePillBox}>
            <Text style={styles.priceLabel}>£</Text>
            <TextInput 
              style={styles.priceInputContent} 
              placeholder="0.00" 
              placeholderTextColor="#555"
              value={price} 
              onChangeText={setPrice} 
              keyboardType="decimal-pad"
            />
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
          <TouchableOpacity style={styles.uploadCta} activeOpacity={0.9} onPress={handlePublish}>
            <Text style={styles.uploadCtaText}>Publish Item</Text>
          </TouchableOpacity>
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
