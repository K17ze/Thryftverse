import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AnimatedPressable } from '../components/AnimatedPressable';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  Switch,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { ActiveTheme, Colors } from '../constants/colors';
import { useFormattedPrice } from '../hooks/useFormattedPrice';
import { MOCK_USERS } from '../data/mockData';
import { mockArrayOrEmpty } from '../utils/mockGate';
import { useStore } from '../store/useStore';
import {
  createGroupInviteLinkOnApi,
  fetchConversationMessagesFromApi,
  sendConversationMessageOnApi,
} from '../services/chatApi';
import { useToast } from '../context/ToastContext';
import { BottomSheetPicker } from '../components/BottomSheetPicker';
import { parseApiError } from '../lib/apiClient';
import { AppInput } from '../components/ui/AppInput';
import { AppSegmentControl } from '../components/ui/AppSegmentControl';
import { AppButton } from '../components/ui/AppButton';
import { AppStatusPill } from '../components/ui/AppStatusPill';
import { useReducedMotion } from '../hooks/useReducedMotion';

type Props = StackScreenProps<RootStackParamList, 'Chat'>;

const IS_LIGHT = ActiveTheme === 'light';
const ACCENT = IS_LIGHT ? '#2f251b' : '#d7b98f';
const BG = Colors.background;
const CARD = IS_LIGHT ? '#ffffff' : '#111111';
const CARD_ALT = IS_LIGHT ? '#f3eee7' : '#1a1a1a';
const BORDER = IS_LIGHT ? '#d8d1c6' : '#2a2a2a';
const MUTED = Colors.textMuted;
const TEXT = Colors.textPrimary;
const HEADER_BG = IS_LIGHT ? 'rgba(247,245,241,0.96)' : 'rgba(10, 10, 10, 0.95)';
const FOOTER_BG = IS_LIGHT ? 'rgba(236,234,230,0.96)' : 'rgba(10,10,10,0.95)';

type MsgType = 'text' | 'offer' | 'offer_declined' | 'purchase_status';
type MessageFilterMode = 'all' | 'offers' | 'updates';

const MESSAGE_FILTERS: Array<{ value: MessageFilterMode; label: string; accessibilityLabel: string }> = [
  { value: 'all', label: 'All', accessibilityLabel: 'Show all messages' },
  { value: 'offers', label: 'Offers', accessibilityLabel: 'Show offer messages' },
  { value: 'updates', label: 'Updates', accessibilityLabel: 'Show status updates' },
];

const NOTIFICATION_MODES = ['All activity', 'Mentions only', 'Muted'];
const RETENTION_MODES = ['No auto-delete', '24 hours', '7 days', '30 days'];
const QUICK_COMPOSER_TEMPLATES = [
  'Is this still available?',
  'Can you share more photos?',
  'I can close today.',
  'Would you accept this offer?',
];

interface Message {
  id: string;
  type: MsgType;
  sender: 'me' | 'them';
  senderLabel?: string;
  text?: string;
  offer?: { price: number; originalPrice: number; status?: 'pending' | 'declined' | 'countered' | 'accepted' };
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

const CHAT_ORDER_ID = 'ord1';

export default function ChatScreen({ navigation, route }: Props) {
  const { conversationId } = route.params;
  const currentUser = useStore((state) => state.currentUser);
  const conversations = useStore((state) => state.conversations);
  const bots = useStore((state) => state.availableChatBots);
  const appendConversationMessage = useStore((state) => state.appendConversationMessage);
  const replaceConversationMessages = useStore((state) => state.replaceConversationMessages);
  const markConversationRead = useStore((state) => state.markConversationRead);
  const { show } = useToast();
  const conversation = useMemo(
    () => conversations.find((item) => item.id === conversationId),
    [conversationId, conversations]
  );
  const isGroup = conversation?.type === 'group';
  const reducedMotionEnabled = useReducedMotion();

  const botLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const bot of bots) {
      map.set(bot.id, bot.name);
    }
    return map;
  }, [bots]);

  const userLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of mockArrayOrEmpty(MOCK_USERS)) {
      map.set(user.id, user.username);
    }
    map.set('me', currentUser?.username ?? 'you');
    if (currentUser?.id) {
      map.set(currentUser.id, currentUser.username);
    }
    return map;
  }, [currentUser?.id, currentUser?.username]);

  const hydratedMessages = useMemo<Message[]>(() => {
    if (!conversation?.messages.length) {
      return INITIAL_MESSAGES;
    }

    return conversation.messages.map((entry) => {
      const resolvedSenderId = entry.senderId;
      const isCurrentUserSender = resolvedSenderId === 'me' || resolvedSenderId === currentUser?.id;
      const sender: 'me' | 'them' = isCurrentUserSender ? 'me' : 'them';

      const senderLabel = botLookup.get(resolvedSenderId)
        ?? userLookup.get(resolvedSenderId)
        ?? (resolvedSenderId === 'system' ? 'System' : resolvedSenderId);

      if (entry.offerPrice !== undefined && entry.originalPrice !== undefined) {
        return {
          id: entry.id,
          type: 'offer',
          sender,
          senderLabel,
          offer: {
            price: entry.offerPrice,
            originalPrice: entry.originalPrice,
            status: entry.offerStatus,
          },
          text: entry.text,
        };
      }

      return {
        id: entry.id,
        type: 'text',
        sender,
        senderLabel,
        text: entry.text ?? entry.systemTitle ?? '',
        date: entry.timestamp,
      };
    });
  }, [botLookup, conversation?.messages, currentUser?.id, userLookup]);

  const [messages, setMessages] = useState<Message[]>(hydratedMessages);
  const [input, setInput] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [messageFilter, setMessageFilter] = useState<MessageFilterMode>('all');
  const [showControls, setShowControls] = useState(false);
  const [showNotificationPicker, setShowNotificationPicker] = useState(false);
  const [showRetentionPicker, setShowRetentionPicker] = useState(false);
  const [notificationMode, setNotificationMode] = useState('All activity');
  const [retentionMode, setRetentionMode] = useState('No auto-delete');
  const [readReceiptsEnabled, setReadReceiptsEnabled] = useState(true);
  const [safetyGuardEnabled, setSafetyGuardEnabled] = useState(true);
  const [composerAssistEnabled, setComposerAssistEnabled] = useState(true);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [latestInviteLink, setLatestInviteLink] = useState<string | null>(null);
  const [latestInviteMeta, setLatestInviteMeta] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const { formatFromFiat } = useFormattedPrice();

  const messageTelemetry = useMemo(() => {
    const offerCount = messages.filter((item) => item.type === 'offer' || item.type === 'offer_declined').length;
    const systemUpdateCount = messages.filter((item) => item.type === 'purchase_status').length;
    const outgoingCount = messages.filter((item) => item.sender === 'me').length;

    return {
      offerCount,
      systemUpdateCount,
      outgoingCount,
      total: messages.length,
    };
  }, [messages]);

  const visibleMessages = useMemo(() => {
    const normalizedQuery = threadSearch.trim().toLowerCase();

    return messages.filter((item) => {
      if (messageFilter === 'offers' && item.type !== 'offer' && item.type !== 'offer_declined') {
        return false;
      }

      if (messageFilter === 'updates' && item.type !== 'purchase_status') {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return [item.text ?? '', item.senderLabel ?? '']
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [messageFilter, messages, threadSearch]);

  useEffect(() => {
    setMessages(hydratedMessages);
  }, [hydratedMessages]);

  useEffect(() => {
    markConversationRead(conversationId);
  }, [conversationId, markConversationRead]);

  useEffect(() => {
    let cancelled = false;

    const syncMessagesFromApi = async () => {
      try {
        const syncedMessages = await fetchConversationMessagesFromApi(conversationId);
        if (cancelled || !syncedMessages.length) {
          return;
        }

        replaceConversationMessages(conversationId, syncedMessages);
      } catch {
        // Keep local message timeline when backend sync is unavailable.
      }
    };

    void syncMessagesFromApi();

    return () => {
      cancelled = true;
    };
  }, [conversationId, replaceConversationMessages]);

  const resolvedPartnerId = useMemo(() => {
    if (isGroup) {
      return null;
    }

    if (conversation?.sellerId) {
      return conversation.sellerId;
    }

    return conversation?.participantIds?.find((id) => id !== 'me' && id !== currentUser?.id) ?? null;
  }, [conversation?.participantIds, conversation?.sellerId, currentUser?.id, isGroup]);

  const deployedBotIds = conversation?.botIds ?? [];
  const deployedBotNames = deployedBotIds
    .map((botId) => botLookup.get(botId))
    .filter((value): value is string => Boolean(value));
  const chatTitle = isGroup
    ? conversation?.title ?? 'Group Chat'
    : `@${resolvedPartnerId ? userLookup.get(resolvedPartnerId) ?? resolvedPartnerId : 'chat'}`;
  const groupMemberLabels = (conversation?.participantIds ?? [])
    .map((participantId) => userLookup.get(participantId) ?? participantId)
    .slice(0, 4);

  const pushMessage = (next: Message) => {
    setMessages((prev) => [...prev, next]);
    setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const appendToConversationStore = (next: Message, senderIdOverride?: string) => {
    appendConversationMessage(conversationId, {
      id: next.id,
      senderId: senderIdOverride ?? (next.sender === 'me' ? currentUser?.id ?? 'me' : 'system'),
      text: next.text,
      offerPrice: next.offer?.price,
      originalPrice: next.offer?.originalPrice,
      offerStatus: next.offer?.status === 'countered' ? 'pending' : next.offer?.status,
      isSystem: senderIdOverride === 'system',
      timestamp: 'just now',
      type: next.type === 'offer' ? 'offer' : 'text',
      sender: next.sender === 'me' ? 'me' : 'other',
    });
  };

  const sendMessage = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (safetyGuardEnabled && /seed phrase|private key|mnemonic|recovery phrase/i.test(trimmed)) {
      show('Sensitive credential phrase detected. Message blocked by safety guard.', 'error');
      return;
    }

    const outgoing: Message = {
      id: String(Date.now()),
      type: 'text',
      sender: 'me',
      senderLabel: currentUser?.username ?? 'you',
      text: trimmed,
    };

    pushMessage(outgoing);
    appendToConversationStore(outgoing, currentUser?.id ?? 'me');

    if (isGroup) {
      void sendConversationMessageOnApi(conversationId, trimmed).catch(() => {
        // Keep optimistic local message state when backend sync is temporarily unavailable.
      });
    }

    if (isGroup && trimmed.startsWith('/') && deployedBotIds.length > 0) {
      const botId = deployedBotIds[0];
      const botName = botLookup.get(botId) ?? 'Bot';
      const botReply: Message = {
        id: `${Date.now()}_bot`,
        type: 'text',
        sender: 'them',
        senderLabel: botName,
        text: `${botName}: command received (${trimmed}).`,
      };

      setTimeout(() => {
        pushMessage(botReply);
        appendToConversationStore(botReply, botId);
      }, 350);
    }

    setInput('');
  };

  const sendTemplateMessage = (template: string) => {
    setInput(template);
    show('Template inserted', 'info');
  };

  const handleExportConversationSummary = () => {
    const summary = `Total ${messageTelemetry.total} | Offers ${messageTelemetry.offerCount} | Updates ${messageTelemetry.systemUpdateCount}`;
    show(`Conversation summary ready: ${summary}`, 'success');
  };

  const handleClearVisibleTimeline = () => {
    if (!visibleMessages.length) {
      show('No messages to clear in this view', 'info');
      return;
    }

    const visibleIds = new Set(visibleMessages.map((item) => item.id));
    setMessages((prev) => prev.filter((item) => !visibleIds.has(item.id)));
    show('Visible messages cleared from local view', 'info');
  };

  const handleAttachPhoto = () => {
    const photoMessage: Message = {
      id: String(Date.now()),
      type: 'text',
      sender: 'me',
      senderLabel: currentUser?.username ?? 'you',
      text: 'Sent a photo.',
    };
    pushMessage(photoMessage);
    appendToConversationStore(photoMessage, currentUser?.id ?? 'me');
  };

  const handleShareGroupInvite = async () => {
    if (!isGroup) {
      return;
    }

    setIsCreatingInvite(true);
    try {
      const invite = await createGroupInviteLinkOnApi(conversationId, {
        expiresInHours: 72,
        maxUses: 100,
      });

      setLatestInviteLink(invite.inviteLink);

      const expiryLabel = new Date(invite.expiresAt).toLocaleString();
      const usageLabel = invite.maxUses > 0
        ? `${invite.useCount}/${invite.maxUses} uses`
        : `${invite.useCount} uses`;
      setLatestInviteMeta(`${usageLabel} · Expires ${expiryLabel}`);

      await Share.share({
        message: `Join ${conversation?.title ?? 'my group'} on Thryftverse: ${invite.inviteLink}`,
      });

      show('Invite link generated and ready to share.', 'success');
    } catch (error) {
      const parsedError = parseApiError(error, 'Unable to generate invite link right now.');
      show(parsedError.message, 'error');
    } finally {
      setIsCreatingInvite(false);
    }
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
    const layoutAnimation = reducedMotionEnabled ? undefined : Layout.springify();

    if (msg.date) {
      return (
        <Reanimated.View
          key={msg.id + '_date'}
          entering={reducedMotionEnabled ? undefined : FadeIn}
          layout={layoutAnimation}
          style={styles.dateLabel}
        >
          <Text style={styles.dateLabelText}>{msg.date}</Text>
        </Reanimated.View>
      );
    }
    if (msg.type === 'purchase_status') {
      const lines = msg.text!.split('\n');
      return (
        <Reanimated.View
          key={msg.id}
          entering={reducedMotionEnabled ? undefined : FadeIn.delay(200)}
          layout={layoutAnimation}
          style={styles.statusBlock}
        >
          <Text style={styles.statusTitle}>{lines[0]}</Text>
          <Text style={styles.statusBody}>{lines.slice(1).join('\n')}</Text>
          <AnimatedPressable
            onPress={() => navigation.navigate('OrderDetail', { orderId: CHAT_ORDER_ID })}
            accessibilityRole="button"
            accessibilityLabel="Open tracking information"
            accessibilityHint="Opens the related order details and shipment tracking"
          >
            <Text style={styles.accentLink}>Tracking information</Text>
          </AnimatedPressable>
        </Reanimated.View>
      );
    }
    if (msg.type === 'offer' || msg.type === 'offer_declined') {
      const isMe = msg.sender === 'me';
      const offerStatus = msg.offer!.status;
      
      return (
        <Reanimated.View 
          key={msg.id} 
          entering={reducedMotionEnabled ? undefined : ZoomIn.duration(400).springify()}
          layout={layoutAnimation}
          style={[styles.msgRow, isMe && styles.msgRowRight]}
        >
          <View style={[styles.offerBubble, isMe && styles.offerBubbleMe]}>
            {isGroup && !isMe && msg.senderLabel ? (
              <Text style={styles.groupSenderLabel}>{msg.senderLabel}</Text>
            ) : null}
            <View style={styles.offerTextRow}>
              <Text style={styles.offerPrice}>{formatFromFiat(msg.offer!.price, 'GBP', { displayMode: 'fiat' })}</Text>
              <Text style={styles.offerOriginal}>
                <Text style={styles.strikethrough}>{formatFromFiat(msg.offer!.originalPrice, 'GBP', { displayMode: 'fiat' })}</Text>
              </Text>
            </View>
            
            {/* Context / Status */}
            {offerStatus === 'declined' && (
              <AppStatusPill
                style={styles.offerStatusPill}
                tone="negative"
                iconName="close-circle-outline"
                label="Declined"
              />
            )}
            {offerStatus === 'accepted' && (
              <AppStatusPill
                style={styles.offerStatusPill}
                tone="positive"
                iconName="checkmark-circle-outline"
                label="Accepted"
              />
            )}
            {!offerStatus && isMe && (
              <AppStatusPill
                style={styles.offerStatusPill}
                tone="neutral"
                iconName="time-outline"
                label="Waiting for response"
              />
            )}

            {/* Interactive Buttons for Inbound Offers */}
            {!isMe && !offerStatus && (
              <View style={styles.offerActionRow}>
                <AppButton
                  style={styles.offerDeclineBtn}
                  variant="secondary"
                  size="sm"
                  align="center"
                  icon={<Ionicons name="close-outline" size={15} color={TEXT} />}
                  iconContainerStyle={styles.actionIconWrap}
                  title="Pass"
                  titleStyle={styles.offerDeclineText}
                  onPress={() => handleDeclineOffer(msg.id)}
                  accessibilityLabel="Decline incoming offer"
                />
                <AppButton
                  style={styles.offerAcceptBtn}
                  variant="primary"
                  size="sm"
                  align="center"
                  icon={<Ionicons name="flash-outline" size={15} color={Colors.textInverse} />}
                  iconContainerStyle={styles.actionIconWrap}
                  title="Accept offer"
                  titleStyle={styles.offerAcceptText}
                  onPress={() => handleAcceptOffer(msg.id)}
                  accessibilityLabel="Accept incoming offer"
                  accessibilityHint="Accepts this offer and opens checkout flow."
                />
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
        entering={
          reducedMotionEnabled
            ? undefined
            : isMe
              ? SlideInRight.springify()
              : SlideInLeft.springify()
        }
        layout={layoutAnimation}
        style={[styles.msgRow, isMe && styles.msgRowRight]}
      >
         <View style={[styles.textBubble, isMe && styles.textBubbleMe]}>
          {isGroup && !isMe && msg.senderLabel ? (
            <Text style={styles.groupSenderLabel}>{msg.senderLabel}</Text>
          ) : null}
          <Text style={[styles.bubbleText, isMe && styles.bubbleTextMe]}>{msg.text}</Text>
        </View>
      </Reanimated.View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'} backgroundColor={BG} />
      
      {/* Editorial Header */}
      <View style={styles.header}>
        <AnimatedPressable
          style={styles.headerIconBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          accessibilityHint="Returns to the previous screen"
        >
          <Ionicons name="arrow-back" size={24} color={TEXT} />
        </AnimatedPressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{chatTitle}</Text>
        {isGroup ? (
          <AnimatedPressable
            style={styles.headerIconBtn}
            onPress={() => navigation.navigate('GroupBotDirectory', { conversationId })}
            accessibilityRole="button"
            accessibilityLabel="Open group bot directory"
            accessibilityHint="Manage bots available in this group chat"
          >
            <Ionicons name="hardware-chip-outline" size={22} color={TEXT} />
          </AnimatedPressable>
        ) : (
          <AnimatedPressable
            style={styles.headerIconBtn}
            onPress={() => {
              if (resolvedPartnerId) {
                navigation.navigate('UserProfile', { userId: resolvedPartnerId });
              }
            }}
            accessibilityRole="button"
            accessibilityLabel="Open user profile"
            accessibilityHint="View profile details for this chat participant"
          >
            <Ionicons name="information-circle-outline" size={24} color={TEXT} />
          </AnimatedPressable>
        )}
      </View>

      {/* Floating Context Cards (No Dividers) */}
      {isGroup ? (
        <View style={styles.contextGallery}>
          <View style={styles.groupSummaryCard}>
            <View style={styles.itemThumb}>
              <Ionicons name="people-outline" size={24} color={MUTED} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>{conversation?.title ?? 'Group chat'}</Text>
              <Text style={styles.itemPrice}>{(conversation?.participantIds?.length ?? 0)} members</Text>
              <Text style={styles.itemProtection}>
                {groupMemberLabels.length ? `Members: ${groupMemberLabels.join(', ')}` : 'No members yet'}
              </Text>
            </View>
          </View>

          <View style={styles.groupBotRow}>
            <Text style={styles.groupBotLabel}>DEPLOYED BOTS</Text>
            {deployedBotNames.length ? (
              <View style={styles.groupBotChipWrap}>
                {deployedBotNames.map((botName) => (
                  <View key={botName} style={styles.groupBotChip}>
                    <Text style={styles.groupBotChipText}>{botName}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.groupBotEmpty}>No bots deployed yet.</Text>
            )}

            <View style={styles.groupInviteRow}>
              <Text style={styles.groupInviteLabel}>INVITES</Text>
              <AnimatedPressable
                style={[styles.groupInviteBtn, isCreatingInvite && styles.groupInviteBtnDisabled]}
                onPress={() => {
                  void handleShareGroupInvite();
                }}
                activeOpacity={0.85}
                disabled={isCreatingInvite}
                accessibilityRole="button"
                accessibilityLabel={isCreatingInvite ? 'Creating invite link' : 'Share invite link'}
                accessibilityHint="Generates and shares a new group invite link"
              >
                <Ionicons name="share-social-outline" size={14} color={TEXT} />
                <Text style={styles.groupInviteBtnText}>{isCreatingInvite ? 'Creating...' : 'Share Invite Link'}</Text>
              </AnimatedPressable>
            </View>

            {latestInviteLink ? <Text style={styles.groupInviteLink}>{latestInviteLink}</Text> : null}
            {latestInviteMeta ? <Text style={styles.groupInviteMeta}>{latestInviteMeta}</Text> : null}
          </View>
        </View>
      ) : (
        <View style={styles.contextGallery}>
          <View style={styles.itemCard}>
            <View style={styles.itemThumb}>
              <Ionicons name="shirt-outline" size={24} color={MUTED} />
            </View>
            <View style={styles.itemInfo}>
              <Text style={styles.itemTitle}>Simple striped shirt</Text>
              <Text style={styles.itemPrice}>{formatFromFiat(35, 'GBP', { displayMode: 'fiat' })}</Text>
              <Text style={styles.itemProtection}>{formatFromFiat(37.45, 'GBP', { displayMode: 'fiat' })} Includes platform charge</Text>
            </View>
          </View>

          <View style={styles.sellerBubble}>
            <View style={styles.smallAvatar2}>
              <Ionicons name="person" size={16} color={MUTED} />
            </View>
            <View style={styles.sellerInfoCol}>
              <Text style={styles.sellerName}>Seller {resolvedPartnerId ? userLookup.get(resolvedPartnerId) ?? resolvedPartnerId : 'profile'}</Text>
              <Text style={styles.sellerMetaText}>South Elmsall, UK | Last seen 2h ago</Text>
            </View>
            {resolvedPartnerId ? (
              <AnimatedPressable
                style={styles.sellerProfileBtn}
                onPress={() => navigation.navigate('UserProfile', { userId: resolvedPartnerId })}
                accessibilityRole="button"
                accessibilityLabel="Open seller profile"
                accessibilityHint="View seller details"
              >
                <Text style={styles.sellerProfileBtnText}>Profile</Text>
              </AnimatedPressable>
            ) : null}
          </View>
        </View>
      )}

      <View style={styles.opsContainer}>
        <AppInput
          value={threadSearch}
          onChangeText={setThreadSearch}
          placeholder="Search in conversation"
          autoCapitalize="none"
          autoCorrect={false}
          inputContainerStyle={styles.opsSearchWrap}
          inputStyle={styles.opsSearchInput}
          prefix={<Ionicons name="search" size={16} color={MUTED} />}
          suffix={threadSearch.length > 0 ? (
            <AnimatedPressable
              style={styles.clearOpsSearchBtn}
              onPress={() => setThreadSearch('')}
              accessibilityLabel="Clear thread search"
            >
              <Ionicons name="close" size={14} color={TEXT} />
            </AnimatedPressable>
          ) : null}
        />

        <AppSegmentControl
          style={styles.opsFilterStrip}
          options={MESSAGE_FILTERS}
          value={messageFilter}
          onChange={setMessageFilter}
          fullWidth
          optionStyle={styles.opsFilterChip}
          optionActiveStyle={styles.opsFilterChipActive}
          optionTextStyle={styles.opsFilterChipText}
          optionTextActiveStyle={styles.opsFilterChipTextActive}
        />

        <View style={styles.opsCommandRow}>
          <View style={styles.opsSummaryCard}>
            <Ionicons name="analytics-outline" size={16} color={MUTED} />
            <View style={styles.opsSummaryBody}>
              <Text style={styles.opsSummaryLabel}>Conversation overview</Text>
              <Text style={styles.opsSummaryValue}>
                {messageTelemetry.total} msgs | {messageTelemetry.offerCount} offers | {messageTelemetry.systemUpdateCount} updates
              </Text>
            </View>
          </View>
          <AnimatedPressable
            style={styles.opsActionBtn}
            onPress={() => setShowControls((prev) => !prev)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={showControls ? 'Hide tools panel' : 'Show tools panel'}
            accessibilityHint="Shows or hides advanced conversation controls"
          >
            <Ionicons name={showControls ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={TEXT} />
            <Text style={styles.opsActionText}>{showControls ? 'Hide tools' : 'Tools'}</Text>
          </AnimatedPressable>
        </View>

        {showControls ? (
          <View style={styles.controlPanel}>
            <View style={styles.controlRow}>
              <View>
                <Text style={styles.controlTitle}>Notification Scope</Text>
                <Text style={styles.controlValue}>{notificationMode}</Text>
              </View>
              <AnimatedPressable
                style={styles.controlPickerBtn}
                onPress={() => setShowNotificationPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Change notification scope"
                accessibilityHint="Opens notification options"
              >
                <Text style={styles.controlPickerText}>Change</Text>
              </AnimatedPressable>
            </View>

            <View style={styles.controlRow}>
              <View>
                <Text style={styles.controlTitle}>Retention Policy</Text>
                <Text style={styles.controlValue}>{retentionMode}</Text>
              </View>
              <AnimatedPressable
                style={styles.controlPickerBtn}
                onPress={() => setShowRetentionPicker(true)}
                accessibilityRole="button"
                accessibilityLabel="Adjust retention policy"
                accessibilityHint="Opens message retention options"
              >
                <Text style={styles.controlPickerText}>Adjust</Text>
              </AnimatedPressable>
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Read Receipts</Text>
              <Switch
                value={readReceiptsEnabled}
                onValueChange={setReadReceiptsEnabled}
                trackColor={{ false: BORDER, true: Colors.accent }}
                thumbColor={readReceiptsEnabled ? Colors.textInverse : '#f4f4f4'}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Credential Safety Guard</Text>
              <Switch
                value={safetyGuardEnabled}
                onValueChange={setSafetyGuardEnabled}
                trackColor={{ false: BORDER, true: Colors.accent }}
                thumbColor={safetyGuardEnabled ? Colors.textInverse : '#f4f4f4'}
              />
            </View>

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Composer Assist</Text>
              <Switch
                value={composerAssistEnabled}
                onValueChange={setComposerAssistEnabled}
                trackColor={{ false: BORDER, true: Colors.accent }}
                thumbColor={composerAssistEnabled ? Colors.textInverse : '#f4f4f4'}
              />
            </View>

            <View style={styles.controlActionRow}>
              <AppButton
                style={styles.secondaryControlBtn}
                variant="secondary"
                size="sm"
                align="center"
                icon={<Ionicons name="document-text-outline" size={16} color={TEXT} />}
                iconContainerStyle={styles.actionIconWrap}
                title="Export Summary"
                titleStyle={styles.secondaryControlText}
                onPress={handleExportConversationSummary}
                accessibilityLabel="Export conversation summary"
              />
              <AppButton
                style={styles.secondaryControlBtn}
                variant="secondary"
                size="sm"
                align="center"
                icon={<Ionicons name="trash-outline" size={16} color={TEXT} />}
                iconContainerStyle={styles.actionIconWrap}
                title="Clear Visible"
                titleStyle={styles.secondaryControlText}
                onPress={handleClearVisibleTimeline}
                accessibilityLabel="Clear visible messages"
              />
            </View>
          </View>
        ) : null}
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
          {visibleMessages.length ? (
            visibleMessages.map((msg) => renderMessage(msg))
          ) : (
            <View style={styles.emptySearchState}>
              <Ionicons name="search-outline" size={24} color={MUTED} />
              <Text style={styles.emptySearchTitle}>No messages in this scope</Text>
              <Text style={styles.emptySearchSubtitle}>Try another keyword or filter.</Text>
            </View>
          )}
        </ScrollView>

        {/* Floating Input Row */}
        <View style={styles.inputContainer}>
          {composerAssistEnabled ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateStrip}>
              {QUICK_COMPOSER_TEMPLATES.map((template) => (
                <AnimatedPressable
                  key={template}
                  style={styles.templateChip}
                  onPress={() => sendTemplateMessage(template)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.templateChipText}>{template}</Text>
                </AnimatedPressable>
              ))}
            </ScrollView>
          ) : null}

          <View style={styles.inputFloatingPill}>
            <AnimatedPressable style={styles.cameraBtn} onPress={handleAttachPhoto} accessibilityLabel="Attach photo">
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
              selectionColor={Colors.accent}
            />
            {input.length > 0 && (
              <AnimatedPressable
                onPress={sendMessage}
                style={styles.sendBtn}
                accessibilityRole="button"
                accessibilityLabel="Send message"
                accessibilityHint="Sends the current message"
              >
                <Ionicons name="arrow-up" size={20} color={Colors.textInverse} />
              </AnimatedPressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <BottomSheetPicker
        visible={showNotificationPicker}
        onClose={() => setShowNotificationPicker(false)}
        title="Notification Scope"
        options={NOTIFICATION_MODES}
        selectedValue={notificationMode}
        onSelect={(value) => {
          setNotificationMode(value);
          show(`Notification scope set to ${value}`, 'success');
        }}
      />

      <BottomSheetPicker
        visible={showRetentionPicker}
        onClose={() => setShowRetentionPicker(false)}
        title="Retention Policy"
        options={RETENTION_MODES}
        selectedValue={retentionMode}
        onSelect={(value) => {
          setRetentionMode(value);
          show(`Retention policy set to ${value}`, 'info');
        }}
      />
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
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    backgroundColor: HEADER_BG,
    zIndex: 10,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
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
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  groupSummaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  groupBotRow: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  groupBotLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  groupBotChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  groupBotChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  groupBotChipText: {
    color: TEXT,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  groupBotEmpty: {
    color: MUTED,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
  },
  groupInviteRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  groupInviteLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.8,
  },
  groupInviteBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    paddingHorizontal: 10,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupInviteBtnDisabled: {
    opacity: 0.5,
  },
  groupInviteBtnText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  groupInviteLink: {
    marginTop: 8,
    color: Colors.textPrimary,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  groupInviteMeta: {
    marginTop: 4,
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  itemThumb: {
    width: 56,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfo: { flex: 1 },
  itemTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: TEXT, marginBottom: 4 },
  itemPrice: { fontSize: 15, fontFamily: 'Inter_400Regular', color: MUTED, marginBottom: 2 },
  itemProtection: { fontSize: 12, fontFamily: 'Inter_500Medium', color: ACCENT },
  
  sellerBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 20,
  },
  smallAvatar2: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerInfoCol: {
    flex: 1,
    gap: 3,
  },
  sellerName: { fontSize: 14, fontFamily: 'Inter_700Bold', color: TEXT },
  sellerMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  sellerMetaText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: MUTED },
  sellerProfileBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    paddingHorizontal: 10,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sellerProfileBtnText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },

  opsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
  },
  opsSearchWrap: {
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  opsSearchInput: {
    flex: 1,
    color: TEXT,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    paddingVertical: 0,
  },
  clearOpsSearchBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  opsFilterStrip: {
    marginTop: 2,
  },
  opsFilterChip: {
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD_ALT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opsFilterChipActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  opsFilterChipText: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  opsFilterChipTextActive: {
    color: Colors.textInverse,
  },
  opsCommandRow: {
    flexDirection: 'row',
    gap: 10,
  },
  opsSummaryCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: CARD,
  },
  opsSummaryBody: {
    flex: 1,
  },
  opsSummaryLabel: {
    color: MUTED,
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  opsSummaryValue: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  opsActionBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CARD,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  opsActionText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.2,
  },
  controlPanel: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 16,
    backgroundColor: CARD,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
    paddingBottom: 8,
  },
  controlTitle: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
    marginBottom: 2,
  },
  controlValue: {
    color: TEXT,
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
  },
  controlPickerBtn: {
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_ALT,
  },
  controlPickerText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchLabel: {
    color: TEXT,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  controlActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryControlBtn: {
    flex: 1,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'transparent',
  },
  actionIconWrap: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'transparent',
  },
  secondaryControlText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    textTransform: 'uppercase',
  },
  
  messageList: { flex: 1 },
  emptySearchState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 6,
  },
  emptySearchTitle: {
    color: TEXT,
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  emptySearchSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  dateLabel: { alignItems: 'center', marginVertical: 12 },
  dateLabelText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: MUTED, textTransform: 'uppercase', letterSpacing: 1 },
  
  statusBlock: {
    backgroundColor: CARD,
    borderRadius: 16,
    padding: 20,
    marginVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  statusTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: TEXT, marginBottom: 8 },
  statusBody: { fontSize: 14, fontFamily: 'Inter_400Regular', color: MUTED, lineHeight: 22 },
  accentLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: ACCENT, marginTop: 12 },
  
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  msgRowRight: { flexDirection: 'row-reverse' },
  
  textBubble: {
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 24,
    borderBottomLeftRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 14,
    maxWidth: '80%',
  },
  textBubbleMe: {
    backgroundColor: Colors.accent,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 6,
  },
  bubbleText: { fontSize: 15, fontFamily: 'Inter_500Medium', color: TEXT, lineHeight: 22 },
  bubbleTextMe: { color: Colors.textInverse },
  groupSenderLabel: {
    color: MUTED,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  
  offerBubble: {
    backgroundColor: CARD,
    borderRadius: 24,
    borderBottomLeftRadius: 6,
    padding: 20,
    maxWidth: '85%',
    borderWidth: 1,
    borderColor: BORDER,
  },
  offerBubbleMe: { borderBottomLeftRadius: 24, borderBottomRightRadius: 6 },
  offerTextRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 4 },
  offerPrice: { fontSize: 28, fontFamily: 'Inter_700Bold', color: TEXT, letterSpacing: -1 },
  offerOriginal: { fontSize: 16, fontFamily: 'Inter_500Medium', color: MUTED },
  strikethrough: { textDecorationLine: 'line-through' },
  
  offerStatusPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },

  offerActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  offerDeclineBtn: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  offerDeclineText: { color: TEXT, fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },
  offerAcceptBtn: {
    flex: 1,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'transparent',
  },
  offerAcceptText: { color: Colors.textInverse, fontSize: 13, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },

  inputContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: FOOTER_BG,
  },
  templateStrip: {
    gap: 8,
    paddingBottom: 10,
    paddingRight: 8,
  },
  templateChip: {
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  templateChipText: {
    color: TEXT,
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  inputFloatingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
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
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});


