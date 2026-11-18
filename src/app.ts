import { randomUUID } from 'node:crypto';

import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { env, logger, setRequestContext } from '@gaian-stellar-integration/config';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { authExtrasPlugin } from './plugins/auth-extras.js';
import { authPlugin } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { payoutPlugin } from './plugins/payout.js';
import { redisPlugin } from './plugins/redis.js';
import { replyEnvelopePlugin } from './plugins/reply-envelope.js';
import { v2QuoteRoutes } from './routes/quote.js';
import { v2OrderRoutes } from './routes/orders.js';

export const buildApp = async () => {
  const app = Fastify({
    loggerInstance: logger as unknown as FastifyBaseLogger,
    bodyLimit: 1_048_576,
    requestTimeout: 30_000,
    disableRequestLogging: env.NODE_ENV === 'test',
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onRequest', (req, _reply, done) => {
    setRequestContext({ requestId: String(req.id) });
    done();
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: true });
  await app.register(sensible);

  await app.register(errorHandlerPlugin);
  await app.register(replyEnvelopePlugin);
  await app.register(dbPlugin);
  await app.register(redisPlugin);
  await app.register(payoutPlugin);
  await app.register(authPlugin);
  await app.register(authExtrasPlugin);

  await app.register(v2QuoteRoutes, { prefix: '/api/v2' });
  await app.register(v2OrderRoutes, { prefix: '/api/v2' });

  return app;
};

export type App = Awaited<ReturnType<typeof buildApp>>;
