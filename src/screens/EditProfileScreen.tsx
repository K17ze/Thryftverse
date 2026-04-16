import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  StatusBar,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActiveTheme, Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MY_USER } from '../data/mockData';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { CachedImage } from '../components/CachedImage';
import { BottomSheetPicker } from '../components/BottomSheetPicker';
import { AppButton } from '../components/ui/AppButton';
import {
  setStoredUserAvatar,
  setStoredUserAvatarForUser,
} from '../preferences/profileMediaPreferences';
import { persistProfileMediaUri } from '../utils/profileMediaAsset';

const IS_LIGHT = ActiveTheme === 'light';
const PANEL_BG = IS_LIGHT ? '#ffffff' : '#111111';
const PANEL_BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const INPUT_BG = IS_LIGHT ? '#f7f4ef' : '#161616';

const GENDER_OPTIONS = ['Male', 'Female', 'Non-binary', 'Prefer not to say'];

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const { show } = useToast();
  const currentUser = useStore(state => state.currentUser);
  const userAvatar = useStore(state => state.userAvatar);
  const updateUserAvatar = useStore(state => state.updateUserAvatar);

  const [bio, setBio] = useState('Vintage collector based in London.');
  const [location, setLocation] = useState('London, UK');
  const [gender, setGender] = useState('Non-binary');
  const [website, setWebsite] = useState('https://vsco.co/thryftuser');
  const [genderPickerVisible, setGenderPickerVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (!result.canceled) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const nextAvatarUri = await persistProfileMediaUri(result.assets[0].uri, 'avatar');
      updateUserAvatar(nextAvatarUri);
      Promise.all([
        setStoredUserAvatar(nextAvatarUri),
        setStoredUserAvatarForUser(MY_USER.id, nextAvatarUri),
        currentUser?.id ? setStoredUserAvatarForUser(currentUser.id, nextAvatarUri) : Promise.resolve(),
      ]).catch(() => {
        // Keep UX responsive when local persistence fails.
      });
      show('Avatar updated', 'success');
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 600));
    setIsSaving(false);
    show('Profile updated', 'success');
    navigation.goBack();
  };

  const currentAvatar = userAvatar || MY_USER.avatar;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <AnimatedPressable style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.hugeTitle}>Edit Profile</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          
          {/* Avatar Section — functional image picker */}
          <View style={styles.avatarSection}>
            <AnimatedPressable 
              style={styles.avatarWrap}
              onPress={pickAvatar}
              activeOpacity={0.85}
            >
              <CachedImage
                uri={currentAvatar}
                style={styles.avatarImage}
                containerStyle={styles.avatarContainer}
                contentFit="cover"
              />
              <View style={styles.avatarOverlay}>
                <View style={styles.avatarCameraCircle}>
                  <Ionicons name="camera" size={18} color="#fff" />
                </View>
              </View>
            </AnimatedPressable>
            <Text style={styles.changeText}>Tap to change</Text>
          </View>

          {/* Username — locked */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Username</Text>
            <View style={styles.pillInput}>
              <TextInput style={styles.inputText} value={MY_USER.username} editable={false} />
              <Ionicons name="lock-closed" size={16} color={Colors.textMuted} />
            </View>
          </View>

          {/* Gender — BottomSheetPicker */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Gender</Text>
            <AnimatedPressable 
              style={styles.pillInput} 
              activeOpacity={0.8}
              onPress={() => setGenderPickerVisible(true)}
            >
              <Text style={styles.inputText}>{gender}</Text>
              <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
            </AnimatedPressable>
          </View>

          {/* Bio */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>About You</Text>
            <View style={[styles.pillInput, styles.bioInput]}>
              <TextInput 
                style={[styles.inputText, { textAlignVertical: 'top' }]} 
                value={bio} onChangeText={setBio} multiline 
                placeholderTextColor={Colors.textMuted}
                placeholder="Tell people about yourself..."
                maxLength={200}
              />
            </View>
            <Text style={styles.charCount}>{bio.length}/200</Text>
          </View>

          {/* Location */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Location</Text>
            <View style={styles.pillInput}>
              <Ionicons name="location-outline" size={18} color={Colors.textMuted} style={{ marginRight: 10 }} />
              <TextInput 
                style={styles.inputText} 
                value={location} onChangeText={setLocation}
                placeholderTextColor={Colors.textMuted}
                placeholder="City, Country"
              />
            </View>
          </View>

          {/* Website */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Website (Optional)</Text>
            <View style={styles.pillInput}>
              <Ionicons name="link-outline" size={18} color={Colors.textMuted} style={{ marginRight: 10 }} />
              <TextInput 
                style={styles.inputText} 
                value={website} onChangeText={setWebsite}
                placeholderTextColor={Colors.textMuted}
                keyboardType="url"
                autoCapitalize="none"
                placeholder="https://"
              />
            </View>
          </View>

          {/* Save Button */}
          <AppButton
            title={isSaving ? 'Saving...' : 'Save Changes'}
            onPress={() => void handleSave()}
            disabled={isSaving}
            variant="primary"
            size="md"
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            titleStyle={styles.saveText}
            accessibilityLabel="Save profile changes"
          />

          <View style={{ height: 40 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Gender Bottom Sheet Picker */}
      <BottomSheetPicker
        visible={genderPickerVisible}
        onClose={() => setGenderPickerVisible(false)}
        title="Gender"
        options={GENDER_OPTIONS}
        selectedValue={gender}
        onSelect={(option) => {
          setGender(option);
          setGenderPickerVisible(false);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    paddingHorizontal: 20, 
    paddingTop: 10, 
    paddingBottom: 20, 
  },
  backBtn: { 
    width: 44, height: 44, borderRadius: 22, 
    backgroundColor: PANEL_BG, 
    borderWidth: 1, borderColor: PANEL_BORDER,
    alignItems: 'center', justifyContent: 'center' 
  },
  hugeTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.3 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 36, marginTop: 10 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatarContainer: {
    width: 100, height: 100, borderRadius: 50,
    borderWidth: 3, borderColor: Colors.accent,
  },
  avatarImage: { width: '100%', height: '100%', borderRadius: 50 },
  avatarOverlay: {
    position: 'absolute', bottom: 0, right: 0,
  },
  avatarCameraCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: Colors.background,
  },
  changeText: { color: Colors.textMuted, fontFamily: 'Inter_500Medium', fontSize: 13 },

  inputGroup: { marginBottom: 22 },
  label: { 
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.textMuted, 
    marginBottom: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1.2 
  },
  pillInput: { 
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', 
    backgroundColor: INPUT_BG, borderRadius: 20, paddingHorizontal: 20, height: 56,
    borderWidth: 1, borderColor: PANEL_BORDER,
  },
  bioInput: { height: 110, alignItems: 'flex-start', paddingTop: 16 },
  inputText: { flex: 1, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },
  charCount: { 
    fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textMuted, 
    textAlign: 'right', marginTop: 6, marginRight: 6 
  },

  saveBtn: { 
    backgroundColor: Colors.accent,
    borderRadius: 28,
    minHeight: 56,
    borderWidth: 0,
    marginTop: 8,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveText: { color: Colors.textInverse, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
