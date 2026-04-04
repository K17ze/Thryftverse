import React from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  Share
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';

type Props = StackScreenProps<RootStackParamList, 'InviteFriends'>;

const IS_LIGHT = ActiveTheme === 'light';
const TEAL = IS_LIGHT ? '#2f251b' : '#e8dcc8';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const CARD_ALT = IS_LIGHT ? '#f3eee7' : '#151515';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#1c1c1c';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;

const MOCK_CONTACTS = [
  { id: '1', name: 'Alex Johnson', initials: 'AJ' },
  { id: '2', name: 'Sam Rivera', initials: 'SR' },
  { id: '3', name: 'Jordan Lee', initials: 'JL' },
  { id: '4', name: 'Morgan Davis', initials: 'MD' },
  { id: '5', name: 'Taylor Brown', initials: 'TB' },
];

export default function InviteFriendsScreen({ navigation }: Props) {
  const inviteLink = 'https://thryftverse.app/invite/user123';

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Join me on Thryftverse - the premium marketplace for second-hand fashion! ${inviteLink}`,
        title: 'Invite to Thryftverse',
      });
    } catch {}
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Invite friends</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.heroCard}>
          <Ionicons name="gift-outline" size={48} color={TEAL} />
          <Text style={styles.heroTitle}>Invite & earn</Text>
          <Text style={styles.heroSubtitle}>
            Invite friends to Thryftverse. When they make their first sale, you both get a reward.
          </Text>
        </View>

        {/* Share Link */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>YOUR INVITE LINK</Text>
          <View style={styles.linkRow}>
            <Text style={styles.linkText} numberOfLines={1}>
              {inviteLink}
            </Text>
            <AnimatedPressable style={styles.copyBtn} onPress={handleShare}>
              <Ionicons name="copy-outline" size={16} color={TEAL} />
              <Text style={styles.copyText}>Copy</Text>
            </AnimatedPressable>
          </View>
        </View>

        {/* Share Options */}
        <View style={styles.shareRow}>
          {[
            { icon: 'logo-whatsapp', label: 'WhatsApp', color: '#25D366' },
            { icon: 'logo-instagram', label: 'Instagram', color: '#E1306C' },
            { icon: 'mail-outline', label: 'Email', color: TEAL },
            { icon: 'share-social-outline', label: 'More', color: MUTED },
          ].map(s => (
            <AnimatedPressable key={s.label} style={styles.shareIconBtn} onPress={handleShare}>
              <View style={[styles.shareIconCircle, { borderColor: s.color }]}>
                <Ionicons name={s.icon as any} size={22} color={s.color} />
              </View>
              <Text style={styles.shareIconLabel}>{s.label}</Text>
            </AnimatedPressable>
          ))}
        </View>

        {/* Contacts */}
        <Text style={styles.sectionLabel}>SUGGESTED CONTACTS</Text>
        <View style={styles.card}>
          {MOCK_CONTACTS.map((contact, idx) => (
            <View key={contact.id}>
              <View style={styles.contactRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{contact.initials}</Text>
                </View>
                <Text style={styles.contactName}>{contact.name}</Text>
                <AnimatedPressable style={styles.inviteBtn} onPress={handleShare}>
                  <Text style={styles.inviteBtnText}>Invite</Text>
                </AnimatedPressable>
              </View>
              {idx < MOCK_CONTACTS.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20 },
  heroCard: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 30,
    alignItems: 'center',
    marginBottom: 28,
  },
  heroTitle: { fontSize: 24, fontWeight: '800', color: TEXT, marginTop: 14, marginBottom: 8 },
  heroSubtitle: { fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 20 },
  sectionLabel: {
    fontSize: 11,
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 10,
    marginLeft: 4,
  },
  section: { marginBottom: 20 },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  linkText: { flex: 1, fontSize: 14, color: MUTED },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  copyText: { fontSize: 13, color: TEAL, fontWeight: '600' },
  shareRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 28,
  },
  shareIconBtn: { alignItems: 'center', gap: 6 },
  shareIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_ALT,
  },
  shareIconLabel: { fontSize: 11, color: MUTED },
  card: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CARD_ALT,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { fontSize: 14, fontWeight: '700', color: TEAL },
  contactName: { flex: 1, fontSize: 15, fontWeight: '500', color: TEXT },
  inviteBtn: {
    borderWidth: 1,
    borderColor: TEAL,
    backgroundColor: CARD_ALT,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  inviteBtnText: { fontSize: 13, color: TEAL, fontWeight: '600' },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 18 },
});
