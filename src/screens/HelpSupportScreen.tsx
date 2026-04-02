import React, { useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type Props = StackScreenProps<RootStackParamList, 'HelpSupport'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

export default function HelpSupportScreen({ navigation }: Props) {
  const { formatFromFiat } = useFormattedPrice();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const fixedFeeLabel = formatFromFiat(0.7, 'GBP', { displayMode: 'fiat' });
  const faqs = React.useMemo(
    () => [
      {
        q: 'How does Buyer Protection work?',
        a: 'Thryftverse Buyer Protection covers you if an item doesn\'t arrive, arrives significantly different from what was described, or is damaged. File a claim within 2 days of the delivery date.',
      },
      {
        q: 'How do I withdraw my balance?',
        a: 'Go to Profile → Balance → Withdraw. Add a bank account first if you haven\'t already. Withdrawals typically take 1–3 business days.',
      },
      {
        q: 'What fees does Thryftverse charge?',
        a: `Thryftverse charges a 5% service fee on each sale, plus a fixed transaction fee of ${fixedFeeLabel}. The buyer also pays a Buyer Protection fee on top of the item price.`,
      },
      {
        q: 'Can I cancel or return an order?',
        a: 'Buyers can request a cancellation within 1 hour of purchase. Returns are handled through Buyer Protection if the item doesn\'t match the description.',
      },
      {
        q: 'How do I report a fake or misleading listing?',
        a: 'On any item page, tap the three-dot menu and select "Report". Our trust team reviews flagged items within 24 hours.',
      },
    ],
    [fixedFeeLabel]
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Quick Actions */}
        <View style={styles.quickRow}>
          {[
            { icon: 'chatbubble-outline', label: 'Live Chat', onPress: () => Alert.alert('Live Chat', 'Our chat support is available Mon–Fri, 9am–6pm.') },
            { icon: 'mail-outline', label: 'Email Us', onPress: () => Alert.alert('Email Support', 'Email us at support@thryftverse.com') },
            { icon: 'document-text-outline', label: 'My Tickets', onPress: () => Alert.alert('My Tickets', 'You have no open support tickets.') },
          ].map(a => (
            <AnimatedPressable key={a.label} style={styles.quickBtn} onPress={a.onPress}>
              <View style={styles.quickIcon}>
                <Ionicons name={a.icon as any} size={22} color={TEAL} />
              </View>
              <Text style={styles.quickLabel}>{a.label}</Text>
            </AnimatedPressable>
          ))}
        </View>

        {/* FAQs */}
        <Text style={styles.sectionLabel}>FREQUENTLY ASKED</Text>
        <View style={styles.faqCard}>
          {faqs.map((faq, idx) => (
            <View key={faq.q}>
              <AnimatedPressable
                style={styles.faqRow}
                onPress={() => setExpanded(prev => prev === faq.q ? null : faq.q)}
              >
                <Text style={styles.faqQ}>{faq.q}</Text>
                <Ionicons
                  name={expanded === faq.q ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={MUTED}
                />
              </AnimatedPressable>
              {expanded === faq.q && (
                <Text style={styles.faqA}>{faq.a}</Text>
              )}
              {idx < faqs.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        {/* Contact form */}
        <Text style={styles.sectionLabel}>SEND A MESSAGE</Text>
        <View style={styles.contactCard}>
          <TextInput
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue in detail..."
            placeholderTextColor={MUTED}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            selectionColor={TEAL}
          />
          <AnimatedPressable
            style={[styles.sendBtn, !message.trim() && { opacity: 0.4 }]}
            disabled={!message.trim()}
            onPress={() => setMessage('')}
          >
            <Ionicons name="send" size={16} color="#0a0a0a" />
            <Text style={styles.sendBtnText}>Send message</Text>
          </AnimatedPressable>
        </View>

        {/* Links */}
        <View style={styles.linksCard}>
          {[
            { icon: 'document-text-outline', label: 'Terms & Conditions' },
            { icon: 'shield-checkmark-outline', label: 'Privacy Policy' },
            { icon: 'globe-outline', label: 'Thryftverse Blog' },
          ].map((l, idx) => (
            <View key={l.label}>
              <AnimatedPressable style={styles.linkRow}>
                <Ionicons name={l.icon as any} size={18} color={MUTED} />
                <Text style={styles.linkText}>{l.label}</Text>
                <Ionicons name="open-outline" size={14} color={MUTED} />
              </AnimatedPressable>
              {idx < 2 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.version}>Thryftverse v1.0.0 • response time ~2 hours</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20, paddingBottom: 60 },
  quickRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  quickBtn: { flex: 1, alignItems: 'center', gap: 8 },
  quickIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#1c1c1c' },
  quickLabel: { fontSize: 12, color: TEXT, fontWeight: '600' },
  sectionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  faqCard: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  faqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: TEXT, lineHeight: 20 },
  faqA: { fontSize: 13, color: MUTED, lineHeight: 20, paddingHorizontal: 18, paddingBottom: 16 },
  divider: { height: 1, backgroundColor: '#1c1c1c', marginHorizontal: 18 },
  contactCard: { backgroundColor: CARD, borderRadius: 16, padding: 16, marginBottom: 24 },
  messageInput: { fontSize: 14, color: TEXT, minHeight: 100, marginBottom: 14 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: TEAL, borderRadius: 24, paddingVertical: 12, justifyContent: 'center' },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: '#0a0a0a' },
  linksCard: { backgroundColor: CARD, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 16 },
  linkText: { flex: 1, fontSize: 14, color: TEXT },
  version: { fontSize: 11, color: MUTED, textAlign: 'center' },
});
