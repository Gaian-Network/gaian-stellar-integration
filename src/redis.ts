import { env, logger } from '@gaian-stellar-integration/config';
import IORedis, { type RedisOptions } from 'ioredis';

const REDIS_OPTS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
  connectTimeout: 10_000,
  keepAlive: 30_000,
};

let _shared: IORedis | undefined;
const dedicated: IORedis[] = [];

const attachLog = (redis: IORedis, label: string): IORedis => {
  redis.on('error', (err) => {
    logger.error({ err, label }, 'redis.error');
  });
  return redis;
};

export const getRedis = (): IORedis => {
  _shared ??= attachLog(new IORedis(env.REDIS_URL, REDIS_OPTS), 'shared');
  return _shared;
};

export const createDedicatedRedis = (label: string): IORedis => {
  const redis = attachLog(new IORedis(env.REDIS_URL, REDIS_OPTS), label);
  dedicated.push(redis);
  return redis;
};

export const closeRedis = async (): Promise<void> => {
  const all = [...dedicated];
  dedicated.length = 0;
  if (_shared) {
    all.push(_shared);
    _shared = undefined;
  }
  await Promise.all(
    all.map((r) =>
      r.quit().catch((err: unknown) => {
        logger.warn({ err }, 'redis.quit.failed');
      }),
    ),
  );
};
