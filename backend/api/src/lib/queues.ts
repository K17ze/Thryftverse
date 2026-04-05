import { Queue, Worker } from 'bullmq';
import { Redis as IORedis } from 'ioredis';
import { config } from '../config.js';
import { recordBackgroundJob } from './metrics.js';

export interface PushJobData {
  eventId: string;
  userId: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
}

export interface AuctionSweepJobData {
  reason: 'interval' | 'manual';
}

interface QueueHandlers {
  handlePushJob: (job: PushJobData) => Promise<void>;
  handleAuctionSweepJob: (job: AuctionSweepJobData) => Promise<void>;
}

const queueConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const workerConnection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const PUSH_QUEUE_NAME = 'push_notifications';
const INFRA_QUEUE_NAME = 'infra_ops';

const pushQueue = new Queue<PushJobData>(PUSH_QUEUE_NAME, {
  connection: queueConnection,
});

const infraQueue = new Queue<AuctionSweepJobData>(INFRA_QUEUE_NAME, {
  connection: queueConnection,
});

let pushWorker: Worker<PushJobData> | null = null;
let infraWorker: Worker<AuctionSweepJobData> | null = null;

export function startBackgroundWorkers(handlers: QueueHandlers): void {
  if (!pushWorker) {
    pushWorker = new Worker<PushJobData>(
      PUSH_QUEUE_NAME,
      async (job) => {
        try {
          await handlers.handlePushJob(job.data);
          recordBackgroundJob({
            queue: PUSH_QUEUE_NAME,
            job: job.name,
            result: 'completed',
          });
        } catch (error) {
          recordBackgroundJob({
            queue: PUSH_QUEUE_NAME,
            job: job.name,
            result: 'failed',
          });
          throw error;
        }
      },
      {
        connection: workerConnection,
        concurrency: 6,
      }
    );
  }

  if (!infraWorker) {
    infraWorker = new Worker<AuctionSweepJobData>(
      INFRA_QUEUE_NAME,
      async (job) => {
        try {
          await handlers.handleAuctionSweepJob(job.data);
          recordBackgroundJob({
            queue: INFRA_QUEUE_NAME,
            job: job.name,
            result: 'completed',
          });
        } catch (error) {
          recordBackgroundJob({
            queue: INFRA_QUEUE_NAME,
            job: job.name,
            result: 'failed',
          });
          throw error;
        }
      },
      {
        connection: workerConnection,
        concurrency: 1,
      }
    );
  }
}

export async function enqueuePushNotificationJob(input: PushJobData): Promise<void> {
  await pushQueue.add('push_send', input, {
    attempts: 4,
    backoff: {
      type: 'exponential',
      delay: 2_000,
    },
    removeOnComplete: true,
    removeOnFail: 500,
  });
}

export async function enqueueAuctionSweepJob(reason: 'interval' | 'manual' = 'interval'): Promise<void> {
  const timeBucket = Math.floor(Date.now() / 30_000);

  await infraQueue.add(
    'auction_sweep',
    { reason },
    {
      jobId: `auction_sweep_${timeBucket}`,
      removeOnComplete: true,
      removeOnFail: 100,
    }
  );
}

export async function closeBackgroundQueues(): Promise<void> {
  if (pushWorker) {
    await pushWorker.close();
    pushWorker = null;
  }

  if (infraWorker) {
    await infraWorker.close();
    infraWorker = null;
  }

  await pushQueue.close();
  await infraQueue.close();
  await workerConnection.quit();
  await queueConnection.quit();
}
