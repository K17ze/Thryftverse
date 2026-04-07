import type { ChatBot, Conversation, Message } from '../data/mockData';
import { fetchJson } from '../lib/apiClient';

type ApiConversationType = 'dm' | 'group';
type ApiSenderType = 'user' | 'bot' | 'system';

interface ApiConversationPayload {
  id: string;
  type: ApiConversationType;
  title: string | null;
  ownerId: string | null;
  itemId: string | null;
  participantIds: string[];
  botIds: string[];
  lastMessage: string;
  lastMessageTime: string;
  unread: boolean;
}

interface ApiMessagePayload {
  id: string;
  senderType: ApiSenderType;
  senderUserId: string | null;
  senderBotId: string | null;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface ApiBotPayload {
  id: string;
  slug: string;
  name: string;
  description: string;
  commandHint: string;
  category: 'moderation' | 'commerce' | 'automation';
}

function mapApiMessageToConversationMessage(payload: ApiMessagePayload): Message {
  const senderId = payload.senderType === 'bot'
    ? payload.senderBotId ?? 'system'
    : payload.senderType === 'user'
      ? payload.senderUserId ?? 'system'
      : 'system';

  return {
    id: payload.id,
    senderId,
    text: payload.body,
    timestamp: payload.createdAt,
    isSystem: payload.senderType === 'system',
    systemTitle: payload.senderType === 'system' ? 'System' : undefined,
    type: payload.senderType === 'system' ? 'system' : 'text',
    sender: payload.senderType === 'system' ? 'system' : 'other',
  };
}

function mapApiConversationToApp(
  payload: ApiConversationPayload,
  messages: Message[] = []
): Conversation {
  const latestMessage = payload.lastMessage || messages[messages.length - 1]?.text || 'No messages yet';
  const latestMessageTime = payload.lastMessageTime || messages[messages.length - 1]?.timestamp || 'just now';
  const resolvedMessages: Message[] = messages.length
    ? messages
    : payload.lastMessage
      ? [
          {
            id: `sync_${payload.id}`,
            senderId: 'system',
            text: payload.lastMessage,
            timestamp: latestMessageTime,
            isSystem: true,
            systemTitle: payload.type === 'group' ? 'Group update' : 'Conversation update',
            type: 'system' as const,
            sender: 'system' as const,
          },
        ]
      : [];

  return {
    id: payload.id,
    type: payload.type,
    title: payload.title ?? undefined,
    ownerId: payload.ownerId ?? undefined,
    itemId: payload.itemId ?? undefined,
    participantIds: payload.participantIds,
    botIds: payload.botIds,
    lastMessage: latestMessage,
    lastMessageTime: latestMessageTime,
    unread: payload.unread,
    messages: resolvedMessages,
  };
}

export async function createGroupConversationOnApi(input: {
  title: string;
  memberIds: string[];
  itemId?: string;
}): Promise<Conversation> {
  const payload = await fetchJson<{
    ok: true;
    conversation: ApiConversationPayload;
    initialMessage: ApiMessagePayload | null;
  }>('/chat/groups', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: input.title.trim(),
      memberIds: input.memberIds,
      itemId: input.itemId,
    }),
  });

  const messages = payload.initialMessage
    ? [mapApiMessageToConversationMessage(payload.initialMessage)]
    : [];

  return mapApiConversationToApp(payload.conversation, messages);
}

export async function fetchConversationsFromApi(): Promise<Conversation[]> {
  const payload = await fetchJson<{
    ok: true;
    items: ApiConversationPayload[];
  }>('/chat/conversations');

  return payload.items.map((item) => mapApiConversationToApp(item, []));
}

export async function fetchConversationMessagesFromApi(
  conversationId: string,
  limit = 120
): Promise<Message[]> {
  const payload = await fetchJson<{
    ok: true;
    items: ApiMessagePayload[];
  }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages?limit=${limit}`);

  return payload.items.map((item) => mapApiMessageToConversationMessage(item));
}

export async function sendConversationMessageOnApi(
  conversationId: string,
  text: string,
  metadata?: Record<string, unknown>
): Promise<Message> {
  const payload = await fetchJson<{
    ok: true;
    message: ApiMessagePayload;
  }>(`/chat/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      metadata,
    }),
  });

  return mapApiMessageToConversationMessage(payload.message);
}

export async function deployBotToConversationOnApi(conversationId: string, botId: string) {
  return fetchJson<{
    ok: true;
    conversationId: string;
    botId: string;
    installed: boolean;
    botIds: string[];
  }>(`/chat/conversations/${encodeURIComponent(conversationId)}/bots/${encodeURIComponent(botId)}/deploy`, {
    method: 'POST',
  });
}

export async function undeployBotFromConversationOnApi(conversationId: string, botId: string) {
  return fetchJson<{
    ok: true;
    conversationId: string;
    botId: string;
    removed: boolean;
    botIds: string[];
  }>(`/chat/conversations/${encodeURIComponent(conversationId)}/bots/${encodeURIComponent(botId)}`, {
    method: 'DELETE',
  });
}

export async function fetchChatBotsFromApi(): Promise<ChatBot[]> {
  const payload = await fetchJson<{
    ok: true;
    items: ApiBotPayload[];
  }>('/chat/bots');

  return payload.items.map((item) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    commandHint: item.commandHint,
    category: item.category,
  }));
}
