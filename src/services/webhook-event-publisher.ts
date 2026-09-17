import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';

import { env, getRequestId, logger, v2OrderStatusCode } from '@gaian-stellar-integration/config';
import { type OrderRow } from '@gaian-stellar-integration/db';
import axios, { type AxiosInstance } from 'axios';

// Webhook hand-off. This API POSTs every order status transition to
// gaian-webhook's POST /internal/events; that service owns tenant endpoint
// storage, HMAC signing and delivery retries to the tenant. Fire-and-forget:
// the status is already persisted before we get here, so a failed hand-off is
// logged and dropped, never propagated to the caller.

const EVENT_TYPE = 'order.status.updated';
const INTERNAL_EVENTS_PATH = '/internal/events';
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

// Keep-alive agents so bursts of transitions reuse warm TCP connections.
const agentOpts = { keepAlive: true, maxSockets: 32, maxFreeSockets: 8 } as const;
const httpAgent = new HttpAgent(agentOpts);
const httpsAgent = new HttpsAgent(agentOpts);

let _client: AxiosInstance | undefined;
const client = (): AxiosInstance => {
  _client ??= axios.create({
    baseURL: env.GAIAN_WEBHOOK_URL,
    timeout: env.GAIAN_WEBHOOK_TIMEOUT_MS,
    headers: { 'content-type': 'application/json' },
    httpAgent,
    httpsAgent,
    validateStatus: () => true,
  });
  return _client;
};

const sleepBackoff = (attempt: number): Promise<void> => {
  const delay = Math.min(250 * 2 ** attempt, 2_000) + Math.floor(Math.random() * 100);
  return new Promise((resolve) => setTimeout(resolve, delay));
};

// One transition, one event. `id` is the status-history row written inside the
// same DB transaction as the status change, so it names this transition only.
export interface OrderTransition {
  readonly id: number;
  readonly status: string;
}

const buildBody = (order: OrderRow, transition: OrderTransition): Record<string, unknown> => ({
  eventType: EVENT_TYPE,
  subjectType: 'order',
  subjectId: order.orderId,
  // Keyed on the transition, not on `${orderId}.${status}`: a legal re-entry
  // (processing -> pending -> processing) must not be deduplicated away.
  idempotencyKey: `${order.orderId}.${String(transition.id)}`,
  payload: {
    orderId: order.orderId,
    status: transition.status,
    statusCode: v2OrderStatusCode(transition.status),
    fiatAmount: Number(order.fiatAmount),
    fiatCurrency: order.fiatCurrency,
    cryptoAmount: String(order.cryptoAmount),
    cryptoCurrency: order.cryptoCurrency,
    exchangeRate: order.exchangeRate !== null ? Number(order.exchangeRate) : null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  },
});

// Resolves void regardless of outcome; never throws. Call as
// `void publishOrderStatusEvent(order, transition)`.
export const publishOrderStatusEvent = async (
  order: OrderRow,
  transition: OrderTransition,
): Promise<void> => {
  if (!env.GAIAN_WEBHOOK_ENABLED) return;
  if (!env.GAIAN_WEBHOOK_URL) {
    logger.warn({ orderId: order.orderId }, 'gaian-webhook.url_not_set');
    return;
  }

  const correlationId = getRequestId();
  const headers: Record<string, string> = {
    'X-Tenant-ID': String(order.tenantId),
    ...(correlationId !== undefined ? { 'x-request-id': correlationId } : {}),
  };
  const body = buildBody(order, transition);
  const maxAttempts = env.GAIAN_WEBHOOK_RETRY_ATTEMPTS;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client().request({
        method: 'POST',
        url: INTERNAL_EVENTS_PATH,
        headers,
        data: body,
      });

      if (res.status >= 200 && res.status < 300) {
        // gaian-webhook wraps every response as {requestId, data}, so read one level down.
        const accepted = (
          res.data as { data?: { status?: string; matchedEndpoints?: number } } | undefined
        )?.data;
        const line = {
          orderId: order.orderId,
          status: transition.status,
          transitionId: transition.id,
          tenantId: order.tenantId,
          httpStatus: res.status,
          matchedEndpoints: accepted?.matchedEndpoints,
        };
        if (accepted?.status === 'duplicate') {
          logger.warn(line, 'gaian-webhook.duplicate_suppressed');
        } else {
          logger.info(line, 'gaian-webhook.accepted');
        }
        return;
      }

      if (RETRYABLE_STATUSES.has(res.status) && attempt < maxAttempts) {
        logger.warn({ orderId: order.orderId, httpStatus: res.status, attempt }, 'gaian-webhook.retrying');
        await sleepBackoff(attempt);
        continue;
      }

      // Non-retryable (4xx) or retries exhausted. The order is settled on our
      // side; log loudly because our record and the tenant's now disagree.
      logger.error(
        { orderId: order.orderId, status: transition.status, httpStatus: res.status, attempt },
        'gaian-webhook.dropped',
      );
      return;
    } catch (err: unknown) {
      if (attempt < maxAttempts) {
        logger.warn({ err, orderId: order.orderId, attempt }, 'gaian-webhook.network_error_retrying');
        await sleepBackoff(attempt);
        continue;
      }
      logger.error(
        { err, orderId: order.orderId, status: transition.status },
        'gaian-webhook.network_error_dropped',
      );
      return;
    }
  }
};
