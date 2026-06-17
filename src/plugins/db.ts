import { logger } from '@gaian-stellar-integration/config';
import { closeDb, getDb } from '@gaian-stellar-integration/db';
import fp from 'fastify-plugin';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const dbPluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  const db = getDb();
  app.decorate('db', db);

  app.addHook('onClose', async () => {
    logger.info('closing db pool');
    await closeDb();
  });
};

export const dbPlugin = fp(dbPluginImpl, { name: 'db' });
