import React, { useMemo, useState } from 'react';
import { AnimatedPressable } from '../components/AnimatedPressable';
import {
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_USERS } from '../data/mockData';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { CachedImage } from '../components/CachedImage';
import { createGroupConversationOnApi, joinGroupByInviteOnApi } from '../services/chatApi';
import { parseApiError } from '../lib/apiClient';
import { extractGroupInviteToken } from '../utils/groupInviteLink';

type Props = StackScreenProps<RootStackParamList, 'CreateGroupChat'>;

const PANEL = Colors.card;
const BORDER = Colors.border;
const PANEL_ALT = Colors.cardAlt;

export default function CreateGroupChatScreen({ navigation }: Props) {
  const currentUser = useStore((state) => state.currentUser);
  const createGroupConversation = useStore((state) => state.createGroupConversation);
  const upsertConversation = useStore((state) => state.upsertConversation);
  const { show } = useToast();

  const [title, setTitle] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const members = useMemo(
    () => MOCK_USERS.filter((user) => user.id !== (currentUser?.id ?? 'me')),
    [currentUser?.id]
  );

  const filteredMembers = useMemo(() => {
    if (!searchQuery.trim()) return members;
    const query = searchQuery.toLowerCase();
    return members.filter(
      (user) => user.username.toLowerCase().includes(query)
    );
  }, [members, searchQuery]);

  const toggleMember = (userId: string) => {
    setSelectedIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    );
  };

  const handleCreateGroup = async () => {
    const groupTitle = title.trim();
    if (!groupTitle) {
      show('Add a group title to continue.', 'error');
      return;
    }

    setIsCreating(true);

    try {
      const conversation = await createGroupConversationOnApi({
        title: groupTitle,
        memberIds: selectedIds,
      });

      upsertConversation(conversation);
      show('Group chat created.', 'success');
      navigation.replace('Chat', { conversationId: conversation.id });
      return;
    } catch {
      const conversationId = createGroupConversation({
        title: groupTitle,
        memberIds: selectedIds,
        creatorId: currentUser?.id ?? 'me',
      });

      show('Backend sync unavailable. Created locally.', 'info');
      navigation.replace('Chat', { conversationId });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinViaInvite = async () => {
    const inviteToken = extractGroupInviteToken(inviteInput);
    if (!inviteToken) {
      show('Paste a valid invite link or invite token.', 'error');
      return;
    }

    setIsJoining(true);

    try {
      const result = await joinGroupByInviteOnApi(inviteToken);
      upsertConversation(result.conversation);
      show(result.joined ? 'Joined group successfully.' : 'You are already in this group.', 'success');
      navigation.replace('Chat', { conversationId: result.conversation.id });
    } catch (error) {
      const parsedError = parseApiError(error, 'Unable to join group with invite link.');
      show(parsedError.message, 'error');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar
        barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={Colors.background}
      />

      <View style={styles.header}>
        <AnimatedPressable style={styles.headerBtn} onPress={() => navigation.goBack()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </AnimatedPressable>
        <Text style={styles.headerTitle}>Create Group Chat</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleCard}>
          <Text style={styles.label}>Group title</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Example: Thryft Snipers"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            maxLength={40}
          />
        </View>

        <View style={styles.joinCard}>
          <Text style={styles.label}>Join with invite link</Text>
          <TextInput
            value={inviteInput}
            onChangeText={setInviteInput}
            placeholder="Paste invite link or token"
            placeholderTextColor={Colors.textMuted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <AnimatedPressable
            style={[styles.joinBtn, (!inviteInput.trim() || isJoining) && styles.joinBtnDisabled]}
            activeOpacity={0.9}
            onPress={() => {
              void handleJoinViaInvite();
            }}
            disabled={!inviteInput.trim() || isJoining}
          >
            <Text style={styles.joinBtnText}>{isJoining ? 'Joining...' : 'Join Group'}</Text>
          </AnimatedPressable>
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Members (optional)</Text>
          <Text style={styles.sectionMeta}>{selectedIds.length} selected</Text>
        </View>

        <View style={styles.searchCard}>
          <Ionicons name="search-outline" size={18} color={Colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by username..."
            placeholderTextColor={Colors.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <AnimatedPressable onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </AnimatedPressable>
          )}
        </View>

        <FlashList
          data={filteredMembers}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            return (
              <View
                style={[styles.memberRow, selected && styles.memberRowSelected]}
              >
                <AnimatedPressable
                  style={styles.memberSelectTap}
                  activeOpacity={0.85}
                  onPress={() => toggleMember(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${selected ? 'Deselect' : 'Select'} @${item.username}`}
                  accessibilityHint="Toggles this member for the new group"
                >
                  <CachedImage
                    uri={item.avatar}
                    style={styles.memberAvatar}
                    containerStyle={styles.memberAvatar}
                    contentFit="cover"
                  />

                  <View style={styles.memberTextWrap}>
                    <Text style={styles.memberName}>@{item.username}</Text>
                    <Text style={styles.memberLocation}>{item.location}</Text>
                  </View>

                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={selected ? Colors.accent : Colors.textMuted}
                  />
                </AnimatedPressable>

                <AnimatedPressable
                  style={styles.memberProfileBtn}
                  activeOpacity={0.85}
                  onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Open @${item.username} profile`}
                  accessibilityHint="Shows this member profile details"
                >
                  <Ionicons name="person-circle-outline" size={20} color={Colors.textPrimary} />
                </AnimatedPressable>
              </View>
            );
          }}
          contentContainerStyle={styles.memberList}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
        />

        <AnimatedPressable
          style={[styles.createBtn, (!title.trim() || isCreating) && styles.createBtnDisabled]}
          activeOpacity={0.9}
          onPress={() => {
            void handleCreateGroup();
          }}
          disabled={!title.trim() || isCreating}
          accessibilityLabel={isCreating ? 'Creating group chat' : 'Create group chat'}
          accessibilityRole="button"
        >
          <Text style={styles.createBtnText}>{isCreating ? 'Creating...' : 'Create Group'}</Text>
        </AnimatedPressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: BORDER,
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  headerSpacer: { width: 44, height: 44 },
  body: { flex: 1, paddingHorizontal: 16, paddingBottom: 18 },
  titleCard: {
    backgroundColor: PANEL,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 8,
    marginBottom: 14,
  },
  joinCard: {
    backgroundColor: PANEL,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    marginBottom: 14,
  },
  label: {
    color: Colors.textMuted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  input: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 16,
    paddingVertical: 10,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionMeta: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textSecondary,
  },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: PANEL,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
    padding: 0,
  },
  memberList: { paddingBottom: 12 },
  memberRow: {
    backgroundColor: PANEL,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  memberSelectTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  memberRowSelected: {
    borderColor: Colors.accent,
    backgroundColor: PANEL_ALT,
  },
  memberAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.surface,
  },
  memberTextWrap: { flex: 1 },
  memberName: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    marginBottom: 2,
  },
  memberLocation: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  memberProfileBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: PANEL_ALT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtn: {
    marginTop: 8,
    backgroundColor: Colors.cardAlt,
    borderRadius: 20,
    height: 40,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinBtnDisabled: {
    opacity: 0.45,
  },
  joinBtnText: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    letterSpacing: 0.2,
  },
  createBtn: {
    marginTop: 'auto',
    backgroundColor: Colors.accent,
    borderRadius: 26,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnDisabled: {
    opacity: 0.45,
  },
  createBtnText: {
    color: Colors.textInverse,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
});
