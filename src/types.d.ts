export {};

declare module 'fastify' {
  interface FastifyInstance {
    db: import('@gaian-stellar-integration/db').AppDb;
    redis: import('ioredis').Redis;
    payout: import('./payout.js').PayoutService;
    userService: import('./services/user-service.js').UserService;
    kycService: import('./services/kyc-result-service.js').KycResultService;
    countryConfig: import('./services/country-config-service.js').CountryConfigService;
    requireTenant(req: FastifyRequest): Promise<void>;
    requireTenantHeader(req: FastifyRequest): Promise<void>;
  }
  interface FastifyRequest {
    tenant?: {
      id: number;
      name: string;
      isKyb: boolean;
      prefund: boolean;
      customFeeBps: number | null;
      country: string | null;
      email: string | null;
    };
    apiKey?: string;
  }
}
