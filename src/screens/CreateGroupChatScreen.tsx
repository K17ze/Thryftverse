import React, { useMemo, useState } from 'react';
import { AnimatedPressable } from '../components/AnimatedPressable';
import {
  FlatList,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { MOCK_USERS } from '../data/mockData';
import { useStore } from '../store/useStore';
import { useToast } from '../context/ToastContext';
import { CachedImage } from '../components/CachedImage';
import { createGroupConversationOnApi } from '../services/chatApi';

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

  const members = useMemo(
    () => MOCK_USERS.filter((user) => user.id !== (currentUser?.id ?? 'me')),
    [currentUser?.id]
  );

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

    if (!selectedIds.length) {
      show('Select at least one member.', 'error');
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar
        barStyle={ActiveTheme === 'light' ? 'dark-content' : 'light-content'}
        backgroundColor={Colors.background}
      />

      <View style={styles.header}>
        <AnimatedPressable style={styles.headerBtn} onPress={() => navigation.goBack()}>
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

        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Members</Text>
          <Text style={styles.sectionMeta}>{selectedIds.length} selected</Text>
        </View>

        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            return (
              <AnimatedPressable
                style={[styles.memberRow, selected && styles.memberRowSelected]}
                activeOpacity={0.85}
                onPress={() => toggleMember(item.id)}
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
            );
          }}
          contentContainerStyle={styles.memberList}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator={false}
        />

        <AnimatedPressable
          style={[styles.createBtn, (!title.trim() || !selectedIds.length || isCreating) && styles.createBtnDisabled]}
          activeOpacity={0.9}
          onPress={() => {
            void handleCreateGroup();
          }}
          disabled={!title.trim() || !selectedIds.length || isCreating}
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
    marginBottom: 10,
  },
  sectionTitle: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  sectionMeta: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
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
