import './test-env.js';

import { mock } from 'node:test';

import { getChainAdapter } from '@gaian-stellar-integration/chains';
import Fastify, { type FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

import { errorHandlerPlugin } from '../../src/plugins/error-handler.js';
import { replyEnvelopePlugin } from '../../src/plugins/reply-envelope.js';
import { v2OrderRoutes } from '../../src/routes/orders.js';
import { OrderService } from '../../src/services/order-service.js';

import type { VerifyTransferInput, VerifyTransferResult } from '@gaian-stellar-integration/chains';

export const TENANT_ID = 7;
export const ORDER_ID = 'ord_route_test_1';
export const QUOTE_ID = 'quo_route_test_1';
export const DEPOSIT_ADDRESS = 'GAMLF6GKCDUEWCDGX5S23FU4JOVFISZ2K6TIHPWZFBQSNARGPGJBKSHJ';
export const PAYER_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const BUILT_TX_HASH = 'ab'.repeat(32);
export const MAX_TIME = 1_800_000_000;

export const qrInfo = {
  isValid: true,
  encodedString: 'qr',
  country: 'VN',
  qrProvider: 'vietqr',
  bankBin: '970436',
  accountNumber: '123456789',
  beneficiaryName: 'MERCHANT',
  detailedQrInfo: {},
};

/** The order rows verify rebuilds its context from when the quote key is gone. */
export const orderRowContext = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  status: 'awaiting_deposit',
  chain: 'stellar',
  token: 'USDC',
  fromAddress: PAYER_ADDRESS,
  toAddress: DEPOSIT_ADDRESS,
  amount: '10.50000000',
  fiatAmount: '250000.00',
  fiatCurrency: 'VND',
  qrPayload: qrInfo,
  ...overrides,
});

export interface OrderRoutesRig {
  readonly app: FastifyInstance;
  readonly redisStore: Map<string, string>;
  readonly calls: {
    readonly updateStatus: unknown[][];
    readonly verify: Array<Record<string, unknown>>;
    readonly payout: Array<Record<string, unknown>>;
  };
  readonly state: {
    updateStatusResult: boolean;
    transferState: { metadata: unknown; isConfirmed: boolean } | null;
    context: Record<string, unknown> | null;
    verifyResult: VerifyTransferResult;
  };
  close(): Promise<void>;
}

// The stubs are written against the real classes, so a loose signature is enough.
const stub = (target: object, method: string, impl: (...args: never[]) => unknown): void => {
  (mock.method as (t: object, m: string, i: unknown) => unknown)(target, method, impl);
};

/**
 * Fastify app with only the order routes, the error handler and the reply envelope.
 * Everything that would reach Postgres, Redis, Horizon or the payout provider is a
 * stub. The route logic, error mapping and response serializers are the real ones.
 */
export const buildOrderRoutesRig = async (): Promise<OrderRoutesRig> => {
  const store = new Map<string, string>();
  const redis = {
    get: (k: string): Promise<string | null> => Promise.resolve(store.get(k) ?? null),
    getdel: (k: string): Promise<string | null> => {
      const v = store.get(k) ?? null;
      store.delete(k);
      return Promise.resolve(v);
    },
  };
  const calls: OrderRoutesRig['calls'] = { updateStatus: [], verify: [], payout: [] };
  const state: OrderRoutesRig['state'] = {
    updateStatusResult: true,
    transferState: { metadata: { stellar: { txHash: BUILT_TX_HASH, maxTime: MAX_TIME } }, isConfirmed: false },
    context: null,
    verifyResult: { ok: true, amountBaseUnits: '105000000' } as unknown as VerifyTransferResult,
  };

  const proto = OrderService.prototype;
  stub(proto, 'findByOrderIdAndTenant', () => Promise.resolve({ id: 99, orderId: ORDER_ID }));
  stub(proto, 'findVerifyContextByOrderIdAndTenant', () => Promise.resolve(state.context));
  stub(proto, 'findTransferState', () => Promise.resolve(state.transferState));
  stub(proto, 'setTransactionHash', () => Promise.resolve());
  stub(proto, 'updateStatus', (...args: unknown[]) => {
    calls.updateStatus.push(args);
    return Promise.resolve(state.updateStatusResult);
  });

  stub(getChainAdapter('stellar'), 'verify', (input: VerifyTransferInput) => {
    calls.verify.push(input as unknown as Record<string, unknown>);
    return Promise.resolve(state.verifyResult);
  });

  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(errorHandlerPlugin);
  await app.register(replyEnvelopePlugin);
  app.decorateRequest('tenant', undefined);
  app.decorate('requireTenantHeader', (req: { tenant?: unknown }) => {
    req.tenant = { id: TENANT_ID, name: 'route-test', isKyb: true, prefund: false, customFeeBps: null, country: 'VN', email: null };
    return Promise.resolve();
  });
  app.decorate('db', {} as never);
  app.decorate('redis', redis as never);
  app.decorate('payout', {
    dispatch: (input: Record<string, unknown>) => {
      calls.payout.push(input);
      return Promise.resolve();
    },
  } as never);
  app.decorate('kycService', {} as never);
  app.decorate('countryConfig', {} as never);

  await app.register(v2OrderRoutes, { prefix: '/api/v2' });
  await app.ready();

  return {
    app,
    redisStore: store,
    calls,
    state,
    close: async () => {
      await app.close();
      mock.restoreAll();
    },
  };
};

export const tenantHeaders = { 'x-tenant-id': String(TENANT_ID) } as const;
