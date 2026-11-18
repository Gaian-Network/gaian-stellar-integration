import { env, logger } from '@gaian-stellar-integration/config';

import { buildApp } from './app.js';

const start = async (): Promise<void> => {
  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ host: env.HOST, port: env.PORT });
};

start().catch((err: unknown) => {
  logger.fatal({ err }, 'server failed to start');
  process.exit(1);
});
