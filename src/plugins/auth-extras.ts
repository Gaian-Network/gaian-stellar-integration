import { logger } from '@gaian-stellar-integration/config';
import fp from 'fastify-plugin';

import { createCountryConfigService } from '../services/country-config-service.js';
import { createKycResultService } from '../services/kyc-result-service.js';
import { createUserService } from '../services/user-service.js';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const pluginImpl: FastifyPluginAsync = async (app: FastifyInstance) => {
  const userSvc = createUserService(app.db);
  const kycSvc = createKycResultService(app.db);
  const countryCfg = createCountryConfigService(app.db);

  await countryCfg.refresh();
  logger.info('country-config cache primed');

  app.decorate('userService', userSvc);
  app.decorate('kycService', kycSvc);
  app.decorate('countryConfig', countryCfg);

  app.addHook('onClose', async () => {
    countryCfg.stop();
  });
};

export const authExtrasPlugin = fp(pluginImpl, {
  name: 'auth-extras',
  dependencies: ['db'],
});

