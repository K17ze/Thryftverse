import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import { View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { BottomSheetPicker } from '../components/BottomSheetPicker';
import { useToast } from '../context/ToastContext';

const ACCENT = '#d7b98f';
const PANEL_BG = Colors.card;
const PANEL_BORDER = Colors.border;
const INFO_BG = ActiveTheme === 'light' ? '#e6efe8' : '#0d2020';
const INFO_BORDER = ActiveTheme === 'light' ? '#c5d7ca' : '#1a3a3a';

type PreferencePickerMode = 'categories' | 'brands' | 'members' | null;

const CATEGORY_SIZE_OPTIONS = ['Balanced', 'Mostly XS-S', 'Mostly M-L', 'All sizes'];
const BRAND_OPTIONS = ['Any', 'Streetwear first', 'Luxury first', 'Vintage first'];
const MEMBER_OPTIONS = ['Everyone', 'Verified sellers first', 'People I follow first'];

export default function PersonalisationScreen() {
  const navigation = useNavigation<any>();
  const [genderFilter, setGenderFilter] = useState<string[]>(['Women', 'Men']);
  const [categoriesAndSizesPref, setCategoriesAndSizesPref] = useState('Balanced');
  const [brandsPref, setBrandsPref] = useState('Any');
  const [membersPref, setMembersPref] = useState('Everyone');
  const [pickerMode, setPickerMode] = useState<PreferencePickerMode>(null);
  const { show } = useToast();

  const genderOptions = ['Women', 'Men', 'Kids', 'All'];

  const toggleGender = (g: string) => {
    setGenderFilter(prev =>
      prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g]
    );
  };

  const pickerTitle =
    pickerMode === 'categories'
      ? 'Categories and Sizes'
      : pickerMode === 'brands'
      ? 'Brand Preference'
      : pickerMode === 'members'
      ? 'Member Preference'
      : 'Preference';

  const pickerOptions =
    pickerMode === 'categories'
      ? CATEGORY_SIZE_OPTIONS
      : pickerMode === 'brands'
      ? BRAND_OPTIONS
      : pickerMode === 'members'
      ? MEMBER_OPTIONS
      : [];

  const selectedPickerValue =
    pickerMode === 'categories'
      ? categoriesAndSizesPref
      : pickerMode === 'brands'
      ? brandsPref
      : pickerMode === 'members'
      ? membersPref
      : undefined;

  const handleSelectPreference = (value: string) => {
    if (pickerMode === 'categories') {
      setCategoriesAndSizesPref(value);
      show('Categories and sizes preference updated.', 'success');
      return;
    }

    if (pickerMode === 'brands') {
      setBrandsPref(value);
      show('Brand preference updated.', 'success');
      return;
    }

    if (pickerMode === 'members') {
      setMembersPref(value);
      show('Member preference updated.', 'success');
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />

      <View style={styles.header}>
        <AnimatedPressable
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Personalisation</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero line */}
        <Text style={styles.heroLine}>See only good fits</Text>
        <Text style={styles.heroSubtitle}>
          Set your preferences to tailor your feed, search results and recommendations to your exact taste.
        </Text>

        {/* Gender Preference Pills */}
        <View style={styles.genderRow}>
          {genderOptions.map(g => (
            <AnimatedPressable
              key={g}
              style={[styles.genderPill, genderFilter.includes(g) && styles.genderPillActive]}
              onPress={() => toggleGender(g)}
              accessibilityRole="button"
              accessibilityState={{ selected: genderFilter.includes(g) }}
              accessibilityLabel={`Toggle ${g} preference`}
              accessibilityHint="Adds or removes this preference from your feed filters"
            >
              <Text style={[styles.genderPillText, genderFilter.includes(g) && styles.genderPillTextActive]}>
                {g}
              </Text>
            </AnimatedPressable>
          ))}
        </View>

        {/* Three navigable preference rows */}
        <Text style={styles.sectionLabel}>YOUR PREFERENCES</Text>
        <View style={styles.card}>
          {[
            {
              icon: 'grid-outline',
              label: 'Categories and sizes',
              sub: categoriesAndSizesPref,
              onPress: () => setPickerMode('categories' as PreferencePickerMode),
            },
            {
              icon: 'barcode-outline',
              label: 'Brands',
              sub: brandsPref,
              onPress: () => setPickerMode('brands' as PreferencePickerMode),
            },
            {
              icon: 'people-outline',
              label: 'Members',
              sub: membersPref,
              onPress: () => setPickerMode('members' as PreferencePickerMode),
            },
          ].map((row, idx) => (
            <View key={row.label}>
              <AnimatedPressable
                style={styles.prefRow}
                onPress={row.onPress}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${row.label.toLowerCase()} preference`}
                accessibilityHint="Opens picker options"
              >
                <View style={styles.prefIcon}>
                  <Ionicons name={row.icon as any} size={20} color={Colors.textPrimary} />
                </View>
                <View style={styles.prefText}>
                  <Text style={styles.prefLabel}>{row.label}</Text>
                  <Text style={styles.prefSub}>{row.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </AnimatedPressable>
              {idx < 2 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={20} color={ACCENT} />
          <Text style={styles.infoText}>
            Your preferences are applied as filters across your feed and search. They never hide items permanently.
          </Text>
        </View>
      </ScrollView>

      <BottomSheetPicker
        visible={pickerMode !== null}
        onClose={() => setPickerMode(null)}
        title={pickerTitle}
        options={pickerOptions}
        selectedValue={selectedPickerValue}
        onSelect={handleSelectPreference}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
    gap: 12,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PANEL_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  heroLine: { fontSize: 22, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, marginBottom: 8 },
  heroSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, lineHeight: 21, marginBottom: 24 },
  genderRow: { flexDirection: 'row', gap: 10, marginBottom: 28, flexWrap: 'wrap' },
  genderPill: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: PANEL_BG,
    borderWidth: 1,
    borderColor: PANEL_BORDER,
  },
  genderPillActive: { backgroundColor: ACCENT + '22', borderColor: ACCENT },
  genderPillText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textMuted },
  genderPillTextActive: { color: ACCENT, fontFamily: 'Inter_600SemiBold' },
  sectionLabel: {
    fontSize: 11, color: Colors.textMuted, letterSpacing: 1.2,
    textTransform: 'uppercase', marginBottom: 10, marginLeft: 4,
  },
  card: { backgroundColor: PANEL_BG, borderRadius: 20, overflow: 'hidden', marginBottom: 20, borderWidth: 1, borderColor: PANEL_BORDER },
  prefRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  prefIcon: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: Colors.card,
    alignItems: 'center', justifyContent: 'center', marginRight: 14,
  },
  prefText: { flex: 1 },
  prefLabel: { fontSize: 16, fontFamily: 'Inter_500Medium', color: Colors.textPrimary },
  prefSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginTop: 2 },
  divider: { height: 1, backgroundColor: PANEL_BORDER, marginHorizontal: 18 },
  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 12,
    backgroundColor: INFO_BG, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: INFO_BORDER,
  },
  infoText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
});




