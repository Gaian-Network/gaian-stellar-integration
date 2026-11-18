import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import './support/test-env.js';

import { closeDb } from '@gaian-stellar-integration/db';

import { buildApp, type App } from '../src/app.js';
import { closeRedis } from '../src/redis.js';

describe('buildApp', () => {
  let app: App;
  before(async () => {
    app = await buildApp();
    await app.ready();
  });
  after(async () => {
    await app.close();
    await closeRedis();
    await closeDb();
  });

  it('starts with every v2 route compiled', () => {
    for (const [method, url] of [
      ['POST', '/api/v2/quote'],
      ['POST', '/api/v2/orders'],
      ['POST', '/api/v2/orders/x/verify'],
      ['GET', '/api/v2/orders/x'],
    ] as const) {
      assert.ok(app.hasRoute({ method, url: url.replace('/x', '/:id') }), `${method} ${url}`);
    }
  });

  it('validates a request body against the route schema', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v2/orders/ord_1/verify',
      headers: { 'x-tenant-id': '1' },
      payload: { transactionHash: 42 },
    });

    assert.equal(res.statusCode, 400);
  });
});
