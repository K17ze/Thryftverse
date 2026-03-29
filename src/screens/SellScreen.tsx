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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../constants/colors';

const { width } = Dimensions.get('window');

export default function SellScreen() {
  const navigation = useNavigation<any>();
  
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');

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

        {/* Giant Camera-Centric Upload Box */}
        <TouchableOpacity style={styles.giantCameraBox} activeOpacity={0.9}>
          <View style={styles.cameraCircle}>
            <Ionicons name="camera" size={40} color={Colors.background} />
          </View>
          <Text style={styles.cameraText}>Take a photo or upload</Text>
          <Text style={styles.cameraSubtext}>Clear photos sell 3x faster</Text>
        </TouchableOpacity>
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
            <TouchableOpacity style={styles.pickerRow} activeOpacity={0.7} onPress={() => setCategory('Clothing')}>
              <Text style={styles.pickerLabel}>Category</Text>
              <View style={styles.pickerValueArea}>
                <Text style={[styles.pickerValue, !category && styles.pickerPlaceholder]}>
                  {category || 'Select'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity style={styles.pickerRow} activeOpacity={0.7}>
              <Text style={styles.pickerLabel}>Brand</Text>
              <View style={styles.pickerValueArea}>
                <Text style={styles.pickerPlaceholder}>Optional</Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
            </TouchableOpacity>
            
            <View style={styles.divider} />

            <TouchableOpacity style={styles.pickerRow} activeOpacity={0.7}>
              <Text style={styles.pickerLabel}>Condition</Text>
              <View style={styles.pickerValueArea}>
                <Text style={styles.pickerPlaceholder}>Select</Text>
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
        <TouchableOpacity style={styles.uploadCta} activeOpacity={0.9} onPress={() => navigation.replace('ListingSuccess')}>
          <Text style={styles.uploadCtaText}>Publish Item</Text>
        </TouchableOpacity>
      </View>
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
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: 'rgba(10,10,10,0.9)',
    borderTopWidth: 1,
    borderTopColor: '#1A1A1A',
  },
  uploadCta: {
    backgroundColor: Colors.textPrimary,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadCtaText: { color: Colors.background, fontSize: 18, fontFamily: 'Inter_800ExtraBold', letterSpacing: -0.5 },
});
