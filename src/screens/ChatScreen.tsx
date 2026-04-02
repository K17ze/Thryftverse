import React, { useState, useRef } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import Reanimated, { 
  SlideInRight, 
  SlideInLeft, 
  ZoomIn, 
  FadeIn, 
  Layout 
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { RootStackParamList } from '../navigation/types';
import { useFormattedPrice } from '../hooks/useFormattedPrice';

type Props = StackScreenProps<RootStackParamList, 'Chat'>;

const TEAL = '#4ECDC4';
const BG = '#0a0a0a';
const CARD = '#111111';
const MUTED = '#888888';
const TEXT = '#FFFFFF';

type MsgType = 'text' | 'offer' | 'offer_declined' | 'purchase_status';

interface Message {
  id: string;
  type: MsgType;
  sender: 'me' | 'them';
  text?: string;
  offer?: { price: number; originalPrice: number; status?: 'declined' | 'countered' | 'accepted' };
  date?: string;
}

const INITIAL_MESSAGES: Message[] = [
  { id: 'd1', type: 'text', sender: 'me', text: '', date: '19/03/2026' },
  {
    id: 'm1',
    type: 'offer',
    sender: 'me',
    offer: { price: 30, originalPrice: 48, status: 'declined' },
  },
  {
    id: 'm2',
    type: 'offer',
    sender: 'them',
    offer: { price: 35, originalPrice: 48 },
  },
  {
    id: 's1',
    type: 'purchase_status',
    sender: 'them',
    text: 'Purchase successful\nmariefullery has to send it before 26 Mar. We\'ll keep you updated on the progress.',
    date: '20/03/2026',
  },
];

export default function ChatScreen({ navigation }: Props) {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const { formatFromFiat } = useFormattedPrice();

  const sendMessage = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { id: String(Date.now()), type: 'text', sender: 'me', text: input.trim() }]);
    setInput('');
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const handleAcceptOffer = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, offer: { ...m.offer!, status: 'accepted' } } : m));
    // Route directly to checkout for the accepted offer
    navigation.navigate('Checkout', { itemId: '1' });
  };

  const handleDeclineOffer = (msgId: string) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, offer: { ...m.offer!, status: 'declined' } } : m));
  };

  const renderMessage = (msg: Message) => {
    if (msg.date) {
      return (
        <Reanimated.View key={msg.id + '_date'} entering={FadeIn} layout={Layout.springify()} style={styles.dateLabel}>
          <Text style={styles.dateLabelText}>{msg.date}</Text>
        </Reanimated.View>
      );
    }
    if (msg.type === 'purchase_status') {
      const lines = msg.text!.split('\n');
      return (
        <Reanimated.View key={msg.id} entering={FadeIn.delay(200)} layout={Layout.springify()} style={styles.statusBlock}>
          <Text style={styles.statusTitle}>{lines[0]}</Text>
          <Text style={styles.statusBody}>{lines.slice(1).join('\n')}</Text>
          {msg.id === 's2' && (
            <AnimatedPressable><Text style={styles.tealLink}>Tracking information</Text></AnimatedPressable>
          )}
        </Reanimated.View>
      );
    }
    if (msg.type === 'offer' || msg.type === 'offer_declined') {
      const isMe = msg.sender === 'me';
      const offerStatus = msg.offer!.status;
      
      return (
        <Reanimated.View 
          key={msg.id} 
          entering={ZoomIn.duration(400).springify()}
          layout={Layout.springify()}
          style={[styles.msgRow, isMe && styles.msgRowRight]}
        >
          <View style={[styles.offerBubble, isMe && styles.offerBubbleMe]}>
            <View style={styles.offerTextRow}>
              <Text style={styles.offerPrice}>{formatFromFiat(msg.offer!.price, 'GBP', { displayMode: 'fiat' })}</Text>
              <Text style={styles.offerOriginal}>
                <Text style={styles.strikethrough}>{formatFromFiat(msg.offer!.originalPrice, 'GBP', { displayMode: 'fiat' })}</Text>
              </Text>
            </View>
            
            {/* Context / Status */}
            {offerStatus === 'declined' && <Text style={styles.offerDeclined}>Declined</Text>}
            {offerStatus === 'accepted' && <Text style={styles.offerAccepted}>Accepted</Text>}
            {!offerStatus && isMe && <Text style={styles.offerPending}>Waiting for response</Text>}

            {/* Interactive Buttons for Inbound Offers */}
            {!isMe && !offerStatus && (
              <View style={styles.offerActionRow}>
                <AnimatedPressable 
                  style={styles.offerDeclineBtn} 
                  activeOpacity={0.8}
                  onPress={() => handleDeclineOffer(msg.id)}
                >
                  <Text style={styles.offerDeclineText}>Decline</Text>
                </AnimatedPressable>
                <AnimatedPressable 
                  style={styles.offerAcceptBtn} 
                  activeOpacity={0.8}
                  onPress={() => handleAcceptOffer(msg.id)}
                >
                  <Text style={styles.offerAcceptText}>Accept</Text>
                </AnimatedPressable>
              </View>
            )}
          </View>
        </Reanimated.View>
      );
    }
    if (!msg.text) return null;
    const isMe = msg.sender === 'me';
    return (
      <Reanimated.View 
        key={msg.id} 
        entering={isMe ? SlideInRight.springify() : SlideInLeft.springify()}
        layout={Layout.springify()}
        style={[styles.msgRow, isMe && styles.msgRowRight]}
      >
         <View style={[styles.textBubble, isMe && styles.textBubbleMe]}>
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.text}</Text>
        </View>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      
      {/* Editorial Header */}
      <View style={styles.header}>
        <AnimatedPressable style={styles.headerIconBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>mariefullery</Text>
        <AnimatedPressable style={styles.headerIconBtn}>
          <Ionicons name="information-circle-outline" size={24} color={TEXT} />
        </AnimatedPressable>
      </View>

      {/* Floating Context Cards (No Dividers) */}
      <View style={styles.contextGallery}>
        <View style={styles.itemCard}>
          <View style={styles.itemThumb}>
            <Ionicons name="shirt-outline" size={24} color={MUTED} />
          </View>
          <View style={styles.itemInfo}>
            <Text style={styles.itemTitle}>Simple striped shirt</Text>
            <Text style={styles.itemPrice}>{formatFromFiat(35, 'GBP', { displayMode: 'fiat' })}</Text>
            <Text style={styles.itemProtection}>{formatFromFiat(37.45, 'GBP', { displayMode: 'fiat' })} Includes Buyer Protection 🛡</Text>
          </View>
        </View>

        <View style={styles.sellerBubble}>
          <View style={styles.smallAvatar2}>
            <Ionicons name="person" size={16} color={MUTED} />
          </View>
          <View>
            <Text style={styles.sellerName}>Hi, I'm mariefullery</Text>
            <View style={styles.sellerMeta}>
               <Text style={styles.sellerMetaText}>United Kingdom, South Elmsall</Text>
            </View>
            <View style={styles.sellerMeta}>
               <Text style={styles.sellerMetaText}>Last seen 2 hours ago</Text>
            </View>
          </View>
        </View>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollViewRef}
          style={styles.messageList}
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24, gap: 16 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.map(msg => renderMessage(msg))}
        </ScrollView>

        {/* Floating Input Row */}
        <View style={styles.inputContainer}>
          <View style={styles.inputFloatingPill}>
            <AnimatedPressable style={styles.cameraBtn}>
              <Ionicons name="camera-outline" size={22} color={MUTED} />
            </AnimatedPressable>
            <TextInput
              style={styles.textInput}
              placeholder="Write a message..."
              placeholderTextColor={MUTED}
              value={input}
              onChangeText={setInput}
              onSubmitEditing={sendMessage}
              returnKeyType="send"
              selectionColor={TEAL}
            />
            {input.length > 0 && (
              <AnimatedPressable onPress={sendMessage} style={styles.sendBtn}>
                <Ionicons name="arrow-up" size={20} color={BG} />
              </AnimatedPressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
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
    paddingTop: 10,
    paddingBottom: 20,
    backgroundColor: 'rgba(10, 10, 10, 0.95)',
    zIndex: 10,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: TEXT },
  
  contextGallery: {
    paddingHorizontal: 16,
    gap: 12,
    paddingBottom: 16,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 4 },
  itemPrice: { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 2 },
  itemProtection: { fontSize: 12, fontFamily: 'Inter_500Medium', color: TEAL },
  
  sellerBubble: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    padding: 16,
    backgroundColor: CARD,
    borderRadius: 20,
  },
  smallAvatar2: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 6 },
  sellerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sellerMetaText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: MUTED },
  
  messageList: { flex: 1 },
  dateLabel: { alignItems: 'center', marginVertical: 12 },
  dateLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  
  statusBlock: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 20,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: '#222',
  },
  statusTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 8 },
  statusBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22 },
  tealLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: TEAL, marginTop: 12 },
  
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowRight: { flexDirection: 'row-reverse' },
  
  textBubble: {
    backgroundColor: CARD,
    borderRadius: 24,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    maxWidth: '80%',
  },
  textBubbleMe: {
    backgroundColor: TEXT,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 6,
  },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT, lineHeight: 22 },
  bubbleTextMe: { color: BG },
  
  offerBubble: {
    backgroundColor: CARD,
    borderRadius: 24,
    borderBottomLeftRadius: 6,
    padding: 20,
    maxWidth: '85%',
    borderWidth: 1,
    borderColor: '#222',
  },
  offerBubbleMe: { borderBottomLeftRadius: 24, borderBottomRightRadius: 6 },
  offerTextRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  offerPrice: { fontSize: 28, fontFamily: 'Inter_800ExtraBold', color: TEXT, letterSpacing: -1 },
  offerOriginal: { fontSize: 16, fontFamily: 'Inter_500Medium', color: MUTED },
  strikethrough: { textDecorationLine: 'line-through' },
  
  offerDeclined: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#FF6B6B', marginTop: 4 },
  offerAccepted: { fontSize: 14, fontFamily: 'Inter_700Bold', color: TEAL, marginTop: 4 },
  offerPending: { fontSize: 13, fontFamily: 'Inter_500Medium', color: MUTED, marginTop: 4 },

  offerActionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  offerDeclineBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
  },
  offerDeclineText: { color: TEXT, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  offerAcceptBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: TEAL,
    alignItems: 'center',
  },
  offerAcceptText: { color: BG, fontSize: 14, fontFamily: 'Inter_700Bold' },

  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    backgroundColor: BG,
  },
  inputFloatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderRadius: 30,
    paddingLeft: 6,
    paddingRight: 6,
    height: 56,
  },
  cameraBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  textInput: {
    flex: 1,
    paddingHorizontal: 8,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: TEXT,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
