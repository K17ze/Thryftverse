import type { FastifyReply } from 'fastify';

export interface RealtimeEnvelope {
  id: string;
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

type RealtimeTransport = 'ws' | 'sse';

interface RealtimeClient {
  id: string;
  userId?: string;
  transport: RealtimeTransport;
  topics: Set<string>;
  send: (event: RealtimeEnvelope) => void;
  close: () => void;
}

interface WsLike {
  readyState: number;
  send: (data: string) => void;
  close: () => void;
  on: (event: 'close' | 'message', listener: (payload: unknown) => void) => void;
}

const clients = new Map<string, RealtimeClient>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function runtimeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLowerCase();
}

export function parseRealtimeTopics(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((entry) => (typeof entry === 'string' ? normalizeTopic(entry) : ''))
      .filter((entry) => entry.length > 0);
  }

  if (typeof raw !== 'string') {
    return [];
  }

  return raw
    .split(',')
    .map((entry) => normalizeTopic(entry))
    .filter((entry) => entry.length > 0);
}

function clientCanReceive(client: RealtimeClient, topic: string, userId?: string): boolean {
  if (client.topics.has('*') || client.topics.has(topic)) {
    return userId ? client.userId === userId : true;
  }

  return false;
}

function removeClient(clientId: string): void {
  clients.delete(clientId);

  if (clients.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function ensureHeartbeat(): void {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(() => {
    const heartbeat: RealtimeEnvelope = {
      id: runtimeId('rt_heartbeat'),
      topic: 'system',
      type: 'heartbeat',
      payload: {},
      timestamp: new Date().toISOString(),
    };

    for (const client of clients.values()) {
      try {
        client.send(heartbeat);
      } catch {
        client.close();
      }
    }
  }, 25_000);
}

function formatSseEvent(event: RealtimeEnvelope): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function createEnvelope(topic: string, type: string, payload: Record<string, unknown>): RealtimeEnvelope {
  return {
    id: runtimeId('rt_event'),
    topic,
    type,
    payload,
    timestamp: new Date().toISOString(),
  };
}

export function registerWsClient(input: {
  socket: WsLike;
  topics: string[];
  userId?: string;
}): string {
  const clientId = runtimeId('rt_ws');
  const topicSet = new Set(input.topics.length > 0 ? input.topics.map(normalizeTopic) : ['*']);

  const client: RealtimeClient = {
    id: clientId,
    userId: input.userId,
    transport: 'ws',
    topics: topicSet,
    send: (event) => {
      if (input.socket.readyState !== 1) {
        throw new Error('socket_not_open');
      }

      input.socket.send(JSON.stringify(event));
    },
    close: () => {
      try {
        input.socket.close();
      } catch {
        // Ignore close races.
      }
      removeClient(clientId);
    },
  };

  input.socket.on('close', () => {
    removeClient(clientId);
  });

  input.socket.on('message', (raw: unknown) => {
    try {
      const messageBody =
        typeof raw === 'string'
          ? raw
          : raw instanceof Buffer
            ? raw.toString('utf8')
            : String(raw ?? '');

      const decoded = JSON.parse(messageBody) as {
        action?: unknown;
        topic?: unknown;
        topics?: unknown;
      };

      const action = typeof decoded.action === 'string' ? decoded.action : '';
      const topicInput = decoded.topics ?? decoded.topic;
      const nextTopics = parseRealtimeTopics(topicInput);

      if (action === 'subscribe') {
        for (const topic of nextTopics) {
          client.topics.add(topic);
        }
      }

      if (action === 'unsubscribe') {
        for (const topic of nextTopics) {
          client.topics.delete(topic);
        }
      }

      if (action === 'subscribe' || action === 'unsubscribe') {
        client.send(
          createEnvelope('system', 'subscription_ack', {
            action,
            topics: Array.from(client.topics.values()),
          })
        );
      }
    } catch {
      client.send(
        createEnvelope('system', 'warning', {
          message: 'Malformed realtime control message',
        })
      );
    }
  });

  clients.set(clientId, client);
  ensureHeartbeat();

  client.send(
    createEnvelope('system', 'connected', {
      transport: 'ws',
      topics: Array.from(topicSet.values()),
    })
  );

  return clientId;
}

export function registerSseClient(input: {
  reply: FastifyReply;
  topics: string[];
  userId?: string;
}): string {
  const clientId = runtimeId('rt_sse');
  const topicSet = new Set(input.topics.length > 0 ? input.topics.map(normalizeTopic) : ['*']);

  input.reply.raw.setHeader('Content-Type', 'text/event-stream');
  input.reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
  input.reply.raw.setHeader('Connection', 'keep-alive');
  input.reply.raw.setHeader('X-Accel-Buffering', 'no');
  input.reply.hijack();

  const client: RealtimeClient = {
    id: clientId,
    userId: input.userId,
    transport: 'sse',
    topics: topicSet,
    send: (event) => {
      input.reply.raw.write(formatSseEvent(event));
    },
    close: () => {
      removeClient(clientId);
      if (!input.reply.raw.writableEnded) {
        input.reply.raw.end();
      }
    },
  };

  input.reply.raw.on('close', () => {
    removeClient(clientId);
  });

  clients.set(clientId, client);
  ensureHeartbeat();

  client.send(
    createEnvelope('system', 'connected', {
      transport: 'sse',
      topics: Array.from(topicSet.values()),
    })
  );

  return clientId;
}

export function publishRealtimeEvent(input: {
  topic: string;
  type: string;
  payload: Record<string, unknown>;
  userId?: string;
}): number {
  const topic = normalizeTopic(input.topic);
  const event = createEnvelope(topic, input.type, input.payload);

  let delivered = 0;
  for (const client of clients.values()) {
    if (!clientCanReceive(client, topic, input.userId)) {
      continue;
    }

    try {
      client.send(event);
      delivered += 1;
    } catch {
      client.close();
    }
  }

  return delivered;
}

export function closeRealtimeConnections(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  for (const client of clients.values()) {
    try {
      client.close();
    } catch {
      // Ignore close races.
    }
  }

  clients.clear();
}
