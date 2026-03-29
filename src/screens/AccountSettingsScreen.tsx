import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, StatusBar, ScrollView, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

export default function AccountSettingsScreen() {
  const navigation = useNavigation();

  // Expanded Data States restored
  const [email, setEmail] = useState('user@example.com');
  const [phone, setPhone] = useState('+44 7700 900077');
  const [fullName, setFullName] = useState('John Doe');
  const [birthday, setBirthday] = useState('14/05/1996');
  const [holidayMode, setHolidayMode] = useState(false);
  const [privateProfile, setPrivateProfile] = useState(false);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.hugeTitle}>Account</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        
        {/* Profile Inputs */}
        <Text style={styles.sectionTitle}>Personal Details</Text>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Email Address</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={email} onChangeText={setEmail} keyboardType="email-address" />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Full Name</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={fullName} onChangeText={setFullName} />
          </View>
          <Text style={styles.helperText}>Used for shipping labels. Not public.</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Phone Number</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>Date of Birth</Text>
          <View style={styles.pillInput}>
            <TextInput style={styles.inputText} value={birthday} onChangeText={setBirthday} />
            <Ionicons name="calendar-outline" size={20} color={Colors.textMuted} />
          </View>
        </View>

        {/* Restored Switches / Options */}
        <Text style={styles.sectionTitle}>Preferences</Text>
        <View style={styles.cardGroup}>
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Holiday Mode</Text>
              <Text style={styles.rowSub}>Hide your items for up to 90 days</Text>
            </View>
            <Switch 
              value={holidayMode} 
              onValueChange={setHolidayMode}
              trackColor={{ false: '#333', true: Colors.success }}
              thumbColor="#fff"
            />
          </View>
          <View style={[styles.actionRow, { paddingBottom: 0 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Private Profile</Text>
              <Text style={styles.rowSub}>Only followers can see your items</Text>
            </View>
            <Switch 
              value={privateProfile} 
              onValueChange={setPrivateProfile}
              trackColor={{ false: '#333', true: Colors.success }}
              thumbColor="#fff"
            />
          </View>
        </View>

        {/* Security */}
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.cardGroup}>
          <TouchableOpacity style={styles.actionRow}>
            <View>
              <Text style={styles.rowTitle}>Password</Text>
              <Text style={styles.rowSub}>Last changed 2 months ago</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionRow}>
            <View>
              <Text style={styles.rowTitle}>Two-Factor Authentication</Text>
              <Text style={styles.rowSub}>Off</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Linked Accounts */}
        <Text style={styles.sectionTitle}>Linked Accounts</Text>
        <View style={styles.cardGroup}>
          <TouchableOpacity style={styles.actionRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="logo-facebook" size={24} color={Colors.textPrimary} />
              <Text style={styles.rowTitle}>Facebook</Text>
            </View>
            <View style={styles.linkBadgeActive}>
              <Text style={styles.linkBadgeTextActive}>Linked</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionRow, { paddingBottom: 0 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="logo-google" size={24} color={Colors.textPrimary} />
              <Text style={styles.rowTitle}>Google</Text>
            </View>
            <View style={styles.linkBadge}>
              <Text style={styles.linkBadgeText}>Link</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Footer Actions */}
        <TouchableOpacity style={styles.supportRow}>
          <Ionicons name="download-outline" size={20} color={Colors.textPrimary} style={{ marginRight: 12 }} />
          <Text style={styles.rowTitle}>Download my data</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.dangerBtn}>
          <Text style={styles.dangerText}>Delete Account</Text>
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

  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginLeft: 6, marginTop: 24, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 },
  
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textSecondary, marginBottom: 8, marginLeft: 6, textTransform: 'uppercase', letterSpacing: 1 },
  pillInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#111', borderRadius: 24, paddingHorizontal: 20, height: 56 },
  inputText: { flex: 1, color: Colors.textPrimary, fontFamily: 'Inter_500Medium', fontSize: 16 },
  helperText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textMuted, marginLeft: 6, marginTop: 6 },

  cardGroup: { backgroundColor: '#111', borderRadius: 24, paddingVertical: 16, paddingHorizontal: 20 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 24 },
  rowTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textPrimary, marginBottom: 4 },
  rowSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textSecondary, paddingRight: 10 },
  linkBadge: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#333', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6 },
  linkBadgeText: { color: Colors.textPrimary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  linkBadgeActive: { backgroundColor: '#222', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 6 },
  linkBadgeTextActive: { color: Colors.textSecondary, fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  supportRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24, marginTop: 16 },

  dangerBtn: { borderWidth: 1, borderColor: 'rgba(255, 60, 60, 0.2)', backgroundColor: '#1A0000', borderRadius: 30, height: 56, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  dangerText: { color: Colors.danger, fontSize: 16, fontFamily: 'Inter_700Bold' },
});
