import React, { useRef, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { useToast } from '../context/ToastContext';

type Props = StackScreenProps<RootStackParamList, 'HelpSupport'>;

const IS_LIGHT = ActiveTheme === 'light';
const ACCENT = IS_LIGHT ? '#2f251b' : '#d7b98f';
const BG = Colors.background;
const CARD = Colors.card;
const BORDER = Colors.border;
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;

export default function HelpSupportScreen({ navigation }: Props) {
  const { formatFromFiat } = useFormattedPrice();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const messageInputRef = useRef<TextInput>(null);
  const { show } = useToast();

  const handleOpenExternal = React.useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      show('Unable to open link right now. Please try again.', 'error');
    }
  }, [show]);

  const handleOpenLiveChat = React.useCallback(() => {
    navigation.navigate('Chat', { conversationId: 'c1' });
  }, [navigation]);

  const handleOpenEmail = React.useCallback(() => {
    void handleOpenExternal('mailto:support@thryftverse.com?subject=Thryftverse%20Support');
  }, [handleOpenExternal]);

  const handleOpenTickets = React.useCallback(() => {
    scrollRef.current?.scrollTo({ y: 760, animated: true });
    setTimeout(() => messageInputRef.current?.focus(), 220);
    show('No open tickets. Start a new support message below.', 'info');
  }, [show]);

  const handleSendMessage = React.useCallback(() => {
    if (!message.trim()) {
      return;
    }

    setMessage('');
    show('Support message sent. We usually reply within 2 hours.', 'success');
  }, [message, show]);

  const fixedFeeLabel = formatFromFiat(0.7, 'GBP', { displayMode: 'fiat' });
  const faqs = React.useMemo(
    () => [
      {
        q: 'How does the platform charge work?',
        a: 'Thryftverse applies a platform charge to each checkout. It funds secure payments, delivery issue handling, and buyer support if an item doesn\'t arrive or is significantly misdescribed. File a claim within 2 days of delivery.',
      },
      {
        q: 'How do I withdraw my balance?',
        a: 'Go to Profile -> Balance -> Withdraw. Add a bank account first if you haven\'t already. Withdrawals typically take 1-3 business days.',
      },
      {
        q: 'What fees does Thryftverse charge?',
        a: `Thryftverse charges a 5% service fee on each sale, plus a fixed transaction fee of ${fixedFeeLabel}. Buyers also pay a platform charge on top of the item price.`,
      },
      {
        q: 'Can I cancel or return an order?',
        a: 'Buyers can request a cancellation within 1 hour of purchase. Returns and issue handling are covered under our platform charge support policy when items do not match the description.',
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
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      <View style={styles.header}>
        <AnimatedPressable
          onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen."
        >
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        {/* Quick Actions */}
        <View style={styles.quickRow}>
          {[
            {
              icon: 'chatbubble-outline',
              label: 'Live Chat',
              onPress: handleOpenLiveChat,
              accessibilityLabel: 'Open live chat support',
              accessibilityHint: 'Starts a support conversation in chat.',
            },
            {
              icon: 'mail-outline',
              label: 'Email Us',
              onPress: handleOpenEmail,
              accessibilityLabel: 'Email support',
              accessibilityHint: 'Opens your email app with a prefilled support address.',
            },
            {
              icon: 'document-text-outline',
              label: 'My Tickets',
              onPress: handleOpenTickets,
              accessibilityLabel: 'View support tickets',
              accessibilityHint: 'Scrolls to the message form to create a new support ticket.',
            },
          ].map(a => (
            <AnimatedPressable
              key={a.label}
              style={styles.quickBtn}
              onPress={a.onPress}
              accessibilityLabel={a.accessibilityLabel}
              accessibilityHint={a.accessibilityHint}
            >
              <View style={styles.quickIcon}>
                <Ionicons name={a.icon as any} size={22} color={ACCENT} />
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
                accessibilityLabel={`FAQ: ${faq.q}`}
                accessibilityHint={expanded === faq.q ? 'Collapses this answer.' : 'Expands this answer.'}
                accessibilityState={{ expanded: expanded === faq.q }}
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
            ref={messageInputRef}
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            placeholder="Describe your issue in detail..."
            placeholderTextColor={MUTED}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
            selectionColor={Colors.accent}
            accessibilityLabel="Support message"
            accessibilityHint="Type details about your issue so support can help you."
          />
          <AnimatedPressable
            style={[styles.sendBtn, !message.trim() && { opacity: 0.4 }]}
            disabled={!message.trim()}
            onPress={handleSendMessage}
            accessibilityLabel="Send support message"
            accessibilityHint="Sends your message to the support team."
          >
            <Ionicons name="send" size={16} color={Colors.textInverse} />
            <Text style={styles.sendBtnText}>Send message</Text>
          </AnimatedPressable>
        </View>

        {/* Links */}
        <View style={styles.linksCard}>
          {[
            { icon: 'document-text-outline', label: 'Terms & Conditions', url: 'https://thryftverse.app/terms' },
            { icon: 'shield-checkmark-outline', label: 'Privacy Policy', url: 'https://thryftverse.app/privacy' },
            { icon: 'globe-outline', label: 'Thryftverse Blog', url: 'https://thryftverse.app/blog' },
          ].map((l, idx) => (
            <View key={l.label}>
              <AnimatedPressable
                style={styles.linkRow}
                onPress={() => void handleOpenExternal(l.url)}
                accessibilityLabel={`Open ${l.label}`}
                accessibilityHint="Opens this link in your browser."
              >
                <Ionicons name={l.icon as any} size={18} color={MUTED} />
                <Text style={styles.linkText}>{l.label}</Text>
                <Ionicons name="open-outline" size={14} color={MUTED} />
              </AnimatedPressable>
              {idx < 2 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <Text style={styles.version}>Thryftverse v1.0.0 | response time ~2 hours</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: TEXT },
  content: { padding: 20, paddingBottom: 60 },
  quickRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  quickBtn: { flex: 1, alignItems: 'center', gap: 8 },
  quickIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: CARD, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: BORDER },
  quickLabel: { fontSize: 12, color: TEXT, fontWeight: '600' },
  sectionLabel: { fontSize: 11, color: MUTED, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  faqCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 24 },
  faqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16 },
  faqQ: { flex: 1, fontSize: 14, fontWeight: '600', color: TEXT, lineHeight: 20 },
  faqA: { fontSize: 13, color: MUTED, lineHeight: 20, paddingHorizontal: 18, paddingBottom: 16 },
  divider: { height: 1, backgroundColor: BORDER, marginHorizontal: 18 },
  contactCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, padding: 16, marginBottom: 24 },
  messageInput: { fontSize: 14, color: TEXT, minHeight: 100, marginBottom: 14 },
  sendBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 24, paddingVertical: 12, justifyContent: 'center' },
  sendBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textInverse },
  linksCard: { backgroundColor: CARD, borderWidth: 1, borderColor: BORDER, borderRadius: 16, overflow: 'hidden', marginBottom: 20 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 16 },
  linkText: { flex: 1, fontSize: 14, color: TEXT },
  version: { fontSize: 11, color: MUTED, textAlign: 'center' },
});


