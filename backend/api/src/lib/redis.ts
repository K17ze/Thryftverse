import { Redis } from 'ioredis';
import { config } from '../config.js';

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
});

export async function closeRedis() {
  await redis.quit();
}
