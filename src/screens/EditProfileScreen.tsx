import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, StatusBar, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { MY_USER } from '../data/mockData';
import { Alert } from 'react-native';

export default function EditProfileScreen() {
  const navigation = useNavigation();
  const [bio, setBio] = useState('Vintage collector based in London.');
  const [location, setLocation] = useState('London, UK');
  const [gender, setGender] = useState('Non-binary');
  const [website, setWebsite] = useState('https://vsco.co/thryftuser');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.hugeTitle}>Edit Profile</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarSection}>
          <TouchableOpacity 
            style={styles.avatarPlaceholder}
            onPress={() => Alert.alert('Change Avatar', 'Camera / photo library integration would open here.')}
            activeOpacity={0.8}
          >
            <Ionicons name="camera-outline" size={32} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.changeText}>Change Avatar</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Username</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={MY_USER.username} editable={false} />
            <Ionicons name="lock-closed" size={16} color={Colors.textMuted} />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Gender</Text>
          <TouchableOpacity style={styles.pillInput} activeOpacity={0.8}>
            <Text style={styles.inputText}>{gender}</Text>
            <Ionicons name="chevron-down" size={16} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>About You</Text>
          <View style={[styles.pillInput, { height: 100, alignItems: 'flex-start', paddingTop: 16 }]}>
            <TextInput 
              style={[styles.inputText, { textAlignVertical: 'top' }]} 
              value={bio} onChangeText={setBio} multiline 
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Location</Text>
          <View style={styles.pillInput}>
            <TextInput 
              style={styles.inputText} 
              value={location} onChangeText={setLocation}
              placeholderTextColor={Colors.textMuted}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Website (Optional)</Text>
          <View style={styles.pillInput}>
            <TextInput 
              style={styles.inputText} 
              value={website} onChangeText={setWebsite}
              placeholderTextColor={Colors.textMuted}
              keyboardType="url"
            />
          </View>
        </View>

        <TouchableOpacity 
          style={styles.saveBtn} 
          activeOpacity={0.8} 
          onPress={() => {
            Alert.alert('Profile Updated', 'Your changes have been saved.', [
              { text: 'OK', onPress: () => navigation.goBack() }
            ]);
          }}
        >
          <Text style={styles.saveText}>Save Changes</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20, gap: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#111', alignItems: 'center', justifyContent: 'center' },
  hugeTitle: { fontSize: 34, fontFamily: 'Inter_700Bold', color: Colors.textPrimary, letterSpacing: -0.5 },
  content: { paddingHorizontal: 20, paddingBottom: 40 },

  avatarSection: { alignItems: 'center', marginBottom: 40, marginTop: 10 },
  avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#111', borderWidth: 1, borderColor: '#333', borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  changeText: { color: Colors.textPrimary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  inputGroup: { marginBottom: 24 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1 },
  pillInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 24, paddingHorizontal: 20, height: 56 },
  inputText: { flex: 1, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },

  saveBtn: { backgroundColor: Colors.textPrimary, borderRadius: 30, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveText: { color: Colors.background, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
