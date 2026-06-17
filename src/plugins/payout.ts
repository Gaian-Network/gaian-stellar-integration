import fp from 'fastify-plugin';

import { createPayoutStub } from '../payout.js';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const pluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.decorate('payout', createPayoutStub());
};

export const payoutPlugin = fp(pluginImpl, { name: 'payout' });
