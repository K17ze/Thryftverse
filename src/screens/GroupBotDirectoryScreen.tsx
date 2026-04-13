import React, { useMemo, useState } from 'react';
import { AnimatedPressable } from '../components/AnimatedPressable';
import {
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { StackScreenProps } from '@react-navigation/stack';
import { ActiveTheme, Colors } from '../constants/colors';
import { RootStackParamList } from '../navigation/types';
import { useStore } from '../store/useStore';
import { EmptyState } from '../components/EmptyState';
import { useToast } from '../context/ToastContext';
import { deployBotToConversationOnApi, undeployBotFromConversationOnApi } from '../services/chatApi';

type Props = StackScreenProps<RootStackParamList, 'GroupBotDirectory'>;

const PANEL = Colors.card;
const BORDER = Colors.border;

export default function GroupBotDirectoryScreen({ navigation, route }: Props) {
  const { conversationId } = route.params;
  const { show } = useToast();
  const [pendingBotId, setPendingBotId] = useState<string | null>(null);

  const conversations = useStore((state) => state.conversations);
  const bots = useStore((state) => state.availableChatBots);
  const deployBotToConversation = useStore((state) => state.deployBotToConversation);
  const undeployBotFromConversation = useStore((state) => state.undeployBotFromConversation);

  const conversation = useMemo(
    () => conversations.find((item) => item.id === conversationId),
    [conversationId, conversations]
  );

  const deployedBotIds = conversation?.botIds ?? [];

  const handleToggleBot = async (botId: string, isDeployed: boolean) => {
    if (!conversation || conversation.type !== 'group') {
      show('Bots can only be deployed inside group chats.', 'error');
      return;
    }

    setPendingBotId(botId);

    try {
      if (isDeployed) {
        await undeployBotFromConversationOnApi(conversation.id, botId);
        undeployBotFromConversation(conversation.id, botId);
        show('Bot removed from group.', 'info');
        return;
      }

      await deployBotToConversationOnApi(conversation.id, botId);
      deployBotToConversation(conversation.id, botId);
      show('Bot deployed to group.', 'success');
      return;
    } catch {
      if (isDeployed) {
        undeployBotFromConversation(conversation.id, botId);
        show('Backend unavailable. Removed locally for now.', 'info');
        return;
      }

      deployBotToConversation(conversation.id, botId);
      show('Backend unavailable. Deployed locally for now.', 'info');
    } finally {
      setPendingBotId(null);
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

        <View style={styles.headerTextWrap}>
          <Text style={styles.headerTitle}>Group Bots</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {conversation?.title ?? 'Conversation'}
          </Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      {!conversation || conversation.type !== 'group' ? (
        <EmptyState
          icon="alert-circle-outline"
          title="Group not found"
          subtitle="Open this directory from a group chat to deploy bots."
        />
      ) : (
        <FlashList
          data={bots}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          renderItem={({ item }) => {
            const deployed = deployedBotIds.includes(item.id);
            const isPending = pendingBotId === item.id;

            return (
              <View style={styles.botCard}>
                <View style={styles.botHeadRow}>
                  <View style={styles.botIconWrap}>
                    <Ionicons
                      name={item.category === 'moderation' ? 'shield-checkmark-outline' : item.category === 'commerce' ? 'trending-up-outline' : 'flash-outline'}
                      size={20}
                      color={Colors.textPrimary}
                    />
                  </View>

                  <View style={styles.botTextWrap}>
                    <Text style={styles.botName}>{item.name}</Text>
                    <Text style={styles.botCategory}>{item.category.toUpperCase()}</Text>
                  </View>

                  <AnimatedPressable
                    style={[styles.deployBtn, deployed && styles.deployBtnActive]}
                    activeOpacity={0.85}
                    onPress={() => {
                      void handleToggleBot(item.id, deployed);
                    }}
                    disabled={isPending}
                  >
                    <Text style={[styles.deployBtnText, deployed && styles.deployBtnTextActive]}>
                      {isPending ? 'Syncing...' : deployed ? 'Remove' : 'Deploy'}
                    </Text>
                  </AnimatedPressable>
                </View>

                <Text style={styles.botDescription}>{item.description}</Text>
                <View style={styles.commandPill}>
                  <Text style={styles.commandText}>{item.commandHint}</Text>
                </View>
              </View>
            );
          }}
        />
      )}
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
  headerTextWrap: { alignItems: 'center', flex: 1 },
  headerTitle: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
  },
  headerSubtitle: {
    marginTop: 2,
    color: Colors.textSecondary,
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    maxWidth: 220,
  },
  headerSpacer: { width: 44, height: 44 },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  botCard: {
    backgroundColor: PANEL,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },
  botHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  botIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cardAlt,
    borderWidth: 1,
    borderColor: BORDER,
  },
  botTextWrap: { flex: 1 },
  botName: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  botCategory: {
    color: Colors.textMuted,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 10,
    letterSpacing: 0.8,
    marginTop: 2,
  },
  deployBtn: {
    minWidth: 80,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: Colors.cardAlt,
    paddingHorizontal: 12,
  },
  deployBtnActive: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accent,
  },
  deployBtnText: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
  },
  deployBtnTextActive: {
    color: Colors.textInverse,
    fontFamily: 'Inter_700Bold',
  },
  botDescription: {
    color: Colors.textSecondary,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    marginTop: 10,
    lineHeight: 19,
  },
  commandPill: {
    marginTop: 10,
    alignSelf: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: Colors.cardAlt,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  commandText: {
    color: Colors.textPrimary,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
  },
});
