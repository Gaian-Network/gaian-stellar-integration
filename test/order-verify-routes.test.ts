import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import './support/test-env.js';

import {
  BUILT_TX_HASH,
  DEPOSIT_ADDRESS,
  MAX_TIME,
  ORDER_ID,
  PAYER_ADDRESS,
  QUOTE_ID,
  buildOrderRoutesRig,
  orderRowContext,
  qrInfo,
  tenantHeaders,
  type OrderRoutesRig,
} from './support/order-routes-harness.js';

interface Envelope {
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
}

const verifyOrder = async (rig: OrderRoutesRig, transactionHash = BUILT_TX_HASH) => {
  const res = await rig.app.inject({
    method: 'POST',
    url: `/api/v2/orders/${ORDER_ID}/verify`,
    headers: tenantHeaders,
    payload: { transactionHash },
  });
  return { res, json: res.json() as Envelope };
};

const putQuote = (rig: OrderRoutesRig): void => {
  rig.redisStore.set(`stellar:quote:${QUOTE_ID}`, JSON.stringify({
    quoteId: QUOTE_ID, orderId: ORDER_ID, tenantId: 7, country: 'VN', chain: 'stellar', token: 'USDC',
    fromAddress: PAYER_ADDRESS, depositAddress: DEPOSIT_ADDRESS, fiatAmount: 250000, fiatCurrency: 'VND',
    cryptoAmount: '10.5', amountBaseUnits: '105000000', exchangeRate: 25000, protocolFeeUsd: '0', qrInfo,
    expiresAt: new Date(MAX_TIME * 1000).toISOString(), createdAt: new Date(MAX_TIME * 1000 - 120_000).toISOString(),
  }));
  rig.redisStore.set(`stellar:quote-by-order:${ORDER_ID}`, QUOTE_ID);
};

describe('POST /orders/:id/verify', () => {
  let rig: OrderRoutesRig;
  beforeEach(async () => {
    rig = await buildOrderRoutesRig();
  });
  afterEach(async () => {
    await rig.close();
  });

  describe('order expired, with the quote already gone from Redis', () => {
    it('answers ORDER_EXPIRED and expires the order only from awaiting_deposit', async () => {
      rig.state.context = orderRowContext();
      rig.state.verifyResult = { ok: false, reason: 'order expired' } as never;

      const { res, json } = await verifyOrder(rig);

      assert.equal(res.statusCode, 200);
      assert.equal(json.data?.['statusLabel'], 'failed');
      assert.equal(json.data?.['message'], 'order expired');
      assert.equal(json.data?.['reasonCode'], 'ORDER_EXPIRED');
      assert.equal(rig.calls.updateStatus.length, 1);
      assert.equal(rig.calls.updateStatus[0]?.[1], 'expired');
      assert.equal(rig.calls.updateStatus[0]?.[3], 'awaiting_deposit');
      assert.equal(rig.calls.payout.length, 0);
    });

    it('hands the adapter the deposit address, payer, base units, time bound and built hash from the rows', async () => {
      rig.state.context = orderRowContext();
      rig.state.verifyResult = { ok: false, reason: 'tx not found' } as never;

      const { json } = await verifyOrder(rig);

      assert.equal(json.data?.['statusLabel'], 'pending');
      const call = rig.calls.verify[0];
      assert.equal(call?.['expectedToAddress'], DEPOSIT_ADDRESS);
      assert.equal(call?.['expectedFromAddress'], PAYER_ADDRESS);
      assert.equal(call?.['minAmountBaseUnits'], '105000000');
      assert.equal(call?.['maxTime'], MAX_TIME);
      assert.equal(call?.['builtTxHash'], BUILT_TX_HASH);
    });

    it('a paid order is verified and its payout is dispatched from the stored recipient', async () => {
      rig.state.context = orderRowContext();

      const { json } = await verifyOrder(rig);

      assert.equal(json.data?.['statusLabel'], 'verified');
      assert.equal(rig.calls.payout.length, 1);
      assert.deepEqual(rig.calls.payout[0]?.['recipient'], {
        accountNumber: '123456789', bankCode: '970436', beneficiaryName: 'MERCHANT', country: 'VN',
      });
      assert.equal(rig.calls.payout[0]?.['fiatAmount'], '250000');
      assert.equal(rig.calls.updateStatus[0]?.[1], 'processing');
      assert.equal(rig.calls.updateStatus[0]?.[3], 'awaiting_deposit');
    });

    it('answers 409 and dispatches nothing when the order is no longer awaiting a deposit', async () => {
      rig.state.context = orderRowContext({ status: 'processing' });

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 409);
      assert.equal(rig.calls.verify.length, 0);
      assert.equal(rig.calls.payout.length, 0);
    });

    it('repeats the order expired answer for the tx built for this order, not a 409', async () => {
      rig.state.context = orderRowContext({ status: 'expired' });

      const { res, json } = await verifyOrder(rig, BUILT_TX_HASH.toUpperCase());

      assert.equal(res.statusCode, 200);
      assert.equal(json.data?.['reasonCode'], 'ORDER_EXPIRED');
      assert.equal(rig.calls.verify.length, 0, 'the network is not asked again');
    });

    it('keeps the 409 for an expired order and a different hash', async () => {
      rig.state.context = orderRowContext({ status: 'expired' });

      const { res } = await verifyOrder(rig, 'cd'.repeat(32));

      assert.equal(res.statusCode, 409);
    });

    it('answers 409 when there is neither a quote nor order rows', async () => {
      rig.state.context = null;

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 409);
    });

    it('refuses an order whose stored recipient is unreadable', async () => {
      rig.state.context = orderRowContext({ qrPayload: { broken: true } });

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 500);
      assert.equal(rig.calls.payout.length, 0);
    });

    it('refuses an order on another chain', async () => {
      rig.state.context = orderRowContext({ chain: 'base' });

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 400);
      assert.equal(rig.calls.verify.length, 0);
    });
  });

  describe('quote still in Redis', () => {
    it('expires the order and consumes the quote on ORDER_EXPIRED', async () => {
      putQuote(rig);
      rig.state.verifyResult = { ok: false, reason: 'order expired' } as never;

      const { json } = await verifyOrder(rig);

      assert.equal(json.data?.['reasonCode'], 'ORDER_EXPIRED');
      assert.equal(rig.redisStore.size, 0);
    });

    it('answers 409 and dispatches no payout when the order moved on before it could advance', async () => {
      putQuote(rig);
      rig.state.updateStatusResult = false;

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 409);
      assert.equal(rig.calls.payout.length, 0);
    });
  });

  describe('transaction hash and failed verify', () => {
    it('refuses a hash that is not 64 hex characters before the network or any row sees it', async () => {
      rig.state.context = orderRowContext();

      const { res } = await verifyOrder(rig, `${BUILT_TX_HASH}/../${BUILT_TX_HASH}`);

      assert.equal(res.statusCode, 400);
      assert.equal(rig.calls.verify.length, 0);
      assert.equal(rig.calls.updateStatus.length, 0);
    });

    it('refuses a body with no transaction hash through the route schema', async () => {
      const res = await rig.app.inject({
        method: 'POST',
        url: `/api/v2/orders/${ORDER_ID}/verify`,
        headers: tenantHeaders,
        payload: {},
      });

      assert.equal(res.statusCode, 400);
      assert.equal(rig.calls.verify.length, 0);
    });

    it('hands the network the hash in lower case', async () => {
      rig.state.context = orderRowContext();
      rig.state.verifyResult = { ok: false, reason: 'tx not found' } as never;

      await verifyOrder(rig, BUILT_TX_HASH.toUpperCase());

      assert.equal(rig.calls.verify[0]?.['txHash'], BUILT_TX_HASH);
    });

    it('fails the order only from awaiting_deposit when the hash does not pay it', async () => {
      putQuote(rig);
      rig.state.verifyResult = { ok: false, reason: 'memo does not match expected order memo' } as never;

      const { json } = await verifyOrder(rig);

      assert.equal(json.data?.['statusLabel'], 'failed');
      assert.equal(rig.calls.updateStatus[0]?.[1], 'failed');
      assert.equal(rig.calls.updateStatus[0]?.[3], 'awaiting_deposit');
      assert.equal(rig.redisStore.size, 0);
    });

    it('answers 409 and keeps the quote when a failing verify finds the order already moved on', async () => {
      putQuote(rig);
      rig.state.verifyResult = { ok: false, reason: 'memo does not match expected order memo' } as never;
      rig.state.updateStatusResult = false;

      const { res } = await verifyOrder(rig);

      assert.equal(res.statusCode, 409);
      assert.equal(rig.redisStore.size, 2);
    });
  });
});
