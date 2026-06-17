import fp from 'fastify-plugin';

import { getRedis } from '../redis.js';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const redisPluginImpl: FastifyPluginAsync = (app: FastifyInstance) => {
  app.decorate('redis', getRedis());
  return Promise.resolve();
};

export const redisPlugin = fp(redisPluginImpl, { name: 'redis' });
