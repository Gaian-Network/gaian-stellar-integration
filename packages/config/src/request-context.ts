import { AsyncLocalStorage } from 'node:async_hooks';

// Carries correlation fields across the async call chain without threading them
// through every function signature. Set once per request (Fastify onRequest
// hook) or per job (worker), then read anywhere downstream — notably by the
// payout client, which forwards `requestId` as the `x-request-id` header so a
// single payment is traceable across payments → payout → PSP.
export interface RequestContext {
  readonly requestId: string;
  readonly tenantId?: number;
  readonly orderId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

// enterWith sets the store for the remainder of the current async context —
// the right fit for a Fastify onRequest hook or a worker job handler.
export const setRequestContext = (ctx: RequestContext): void => {
  storage.enterWith(ctx);
};

export const getRequestContext = (): RequestContext | undefined => storage.getStore();

export const getRequestId = (): string | undefined => storage.getStore()?.requestId;

// Run a callback inside a fresh context (workers: one store per job, isolated
// from sibling jobs sharing the event loop).
export const runWithRequestContext = <T>(ctx: RequestContext, fn: () => T): T =>
  storage.run(ctx, fn);
