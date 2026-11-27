import './support/test-env.js';

import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { after, before, beforeEach, describe, it, mock } from 'node:test';

import type { OrderRow } from '@gaian-stellar-integration/db';

const FAKE_KEY = 'test-only-fake-internal-key-0000';

interface Received {
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

let server: Server;
let received: Received[] = [];
let statuses: number[] = [];

type Publisher = typeof import('../src/services/webhook-event-publisher.js');
type Cfg = typeof import('@gaian-stellar-integration/config');
let publisher: Publisher;
let logger: Cfg['logger'];

const order = {
  orderId: 'order-1',
  tenantId: 7,
  status: 'completed',
  fiatAmount: '100',
  fiatCurrency: 'VND',
  cryptoAmount: '4',
  cryptoCurrency: 'USDC',
  exchangeRate: '25000',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as OrderRow;

const transition = { id: 42, status: 'completed' } as const;

before(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = statuses.shift() ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { status: 'accepted', matchedEndpoints: 1 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr !== null && typeof addr === 'object');
  process.env['GAIAN_WEBHOOK_ENABLED'] = 'true';
  process.env['GAIAN_WEBHOOK_URL'] = `http://127.0.0.1:${String(addr.port)}`;
  process.env['GAIAN_WEBHOOK_INTERNAL_API_KEY'] = FAKE_KEY;
  process.env['GAIAN_WEBHOOK_RETRY_ATTEMPTS'] = '2';
  publisher = await import('../src/services/webhook-event-publisher.js');
  ({ logger } = await import('@gaian-stellar-integration/config'));
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  received = [];
  statuses = [];
  mock.restoreAll();
});

describe('webhook event publisher', () => {
  it('sends the internal key and keeps the existing headers and payload', async () => {
    await publisher.publishOrderStatusEvent(order, transition);
    assert.equal(received.length, 1);
    assert.equal(received[0]?.headers['x-internal-api-key'], FAKE_KEY);
    assert.equal(received[0]?.headers['x-tenant-id'], '7');
    const body = JSON.parse(received[0]?.body ?? '{}') as {
      eventType: string;
      idempotencyKey: string;
    };
    assert.equal(body.eventType, 'order.status.updated');
    assert.equal(body.idempotencyKey, 'order-1.42');
  });

  it('on 401 logs a warning with the ids, does not retry and does not throw', async () => {
    statuses = [401, 200];
    const warn = mock.method(logger, 'warn');
    const error = mock.method(logger, 'error');
    await assert.doesNotReject(publisher.publishOrderStatusEvent(order, transition));

    assert.equal(received.length, 1, '401 is not retried');
    const line = warn.mock.calls.find(
      (c) => c.arguments[1] === 'gaian-webhook.internal_key_rejected',
    );
    assert.ok(line, 'warn line written');
    const fields = line.arguments[0] as unknown as Record<string, unknown>;
    assert.equal(fields['orderId'], 'order-1');
    assert.equal(fields['transitionId'], 42);
    assert.equal(error.mock.callCount(), 0);
  });

  it('never logs the key value, even when delivery fails', async () => {
    const lines: unknown[] = [];
    for (const level of ['warn', 'error', 'info'] as const) {
      mock.method(logger, level, (...args: unknown[]) => void lines.push(args));
    }
    statuses = [401];
    await publisher.publishOrderStatusEvent(order, transition);
    statuses = [500, 500, 500];
    await publisher.publishOrderStatusEvent(order, transition);
    assert.ok(lines.length > 0);
    assert.ok(!JSON.stringify(lines).includes(FAKE_KEY));
  });

  it('keeps retrying 5xx with the same attempt budget', async () => {
    statuses = [503, 503, 200];
    await publisher.publishOrderStatusEvent(order, transition);
    assert.equal(received.length, 3);

    received = [];
    statuses = [500, 500, 500];
    const error = mock.method(logger, 'error');
    await publisher.publishOrderStatusEvent(order, transition);
    assert.equal(received.length, 3);
    assert.equal(error.mock.calls[0]?.arguments[1], 'gaian-webhook.dropped');
  });
});
