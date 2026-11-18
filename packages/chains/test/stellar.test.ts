import './setup-env.js';

import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import * as StellarSdk from '@stellar/stellar-sdk';

import {
  STELLAR_EXPIRY_GRACE_SECONDS,
  STELLAR_ORDER_EXPIRED,
  stellarAdapter,
  stellarSendMaxWithSlippage,
} from '../src/stellar.js';

const PASSPHRASE = 'Test SDF Network ; September 2015';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OTHER_ISSUER = StellarSdk.Keypair.random().publicKey();
const PAYER = StellarSdk.Keypair.random().publicKey();
const DEPOSIT = StellarSdk.Keypair.random().publicKey();
const STRANGER = StellarSdk.Keypair.random().publicKey();
const MEMO = 'a1b2c3d4e5f6';
const TX_HASH = 'f'.repeat(64);
const OTHER_HASH = 'e'.repeat(64);
const EXPIRES_AT = '2026-10-29T15:00:30.500Z';
const EXPIRES_AT_SEC = Math.floor(Date.parse(EXPIRES_AT) / 1000);
// For expiry tests: an order whose max time is an hour behind the wall clock.
const PAST_MAX_TIME = Math.floor(Date.now() / 1000) - 3600;
const isoAt = (sec: number): string => new Date(sec * 1000).toISOString();

const proto = StellarSdk.Horizon.Server.prototype as unknown as Record<
  string,
  (...args: never[]) => unknown
>;

const notFound = (): Error =>
  new StellarSdk.NotFoundError('Not Found', { status: 404, statusText: 'Not Found' });

interface HorizonFakes {
  readonly paths?: {
    source_amount: string;
    path: { asset_type: string; asset_code?: string; asset_issuer?: string }[];
  }[];
  readonly tx?: Record<string, unknown> | (() => never);
  readonly ops?: Record<string, unknown>[];
  readonly latestLedgerClosedAt?: string | (() => never);
  readonly payerTxs?: Record<string, unknown>[] | (() => never);
}

// Every Horizon read, in order, so tests can assert what was read and when.
let horizonCalls: string[] = [];
let pathSearchArgs: unknown[] = [];

const fakeHorizon = (f: HorizonFakes): void => {
  horizonCalls = [];
  pathSearchArgs = [];
  mock.method(proto, 'loadAccount', async (id: string) => new StellarSdk.Account(id, '1000'));
  mock.method(proto, 'strictReceivePaths', (...args: unknown[]) => {
    pathSearchArgs = args;
    return { call: async () => ({ records: f.paths ?? [] }) };
  });
  mock.method(proto, 'transactions', () => ({
    transaction: () => ({
      call: async () => {
        horizonCalls.push('tx');
        return typeof f.tx === 'function' ? f.tx() : f.tx;
      },
    }),
    forAccount: () => ({
      order: () => ({
        limit: () => ({
          call: async () => {
            horizonCalls.push('payerTxs');
            const v = f.payerTxs;
            if (typeof v === 'function') return v();
            return { records: v ?? [] };
          },
        }),
      }),
    }),
  }));
  mock.method(proto, 'operations', () => ({
    forTransaction: () => ({ call: async () => ({ records: f.ops ?? [] }) }),
  }));
  mock.method(proto, 'ledgers', () => ({
    order: () => ({
      limit: () => ({
        call: async () => {
          horizonCalls.push('ledger');
          const v = f.latestLedgerClosedAt;
          if (typeof v === 'function') return v();
          return { records: v === undefined ? [] : [{ closed_at: v }] };
        },
      }),
    }),
  }));
};

afterEach(() => mock.restoreAll());

const decode = (xdr: string): StellarSdk.Transaction =>
  StellarSdk.TransactionBuilder.fromXDR(xdr, PASSPHRASE) as StellarSdk.Transaction;

const baseEncode = {
  chain: 'stellar',
  token: 'USDC',
  fromAddress: PAYER,
  toAddress: DEPOSIT,
  amount: '12.5',
  memo: MEMO,
  expiresAt: EXPIRES_AT,
} as const;

const okTx = {
  successful: true,
  memo_type: 'text',
  memo: MEMO,
  created_at: '2026-10-29T15:00:00Z',
};

const pathOp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'path_payment_strict_receive',
  from: PAYER,
  to: DEPOSIT,
  amount: '12.5000000',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: USDC_ISSUER,
  source_amount: '15.1000000',
  source_asset_type: 'native',
  source_max: '15.2500000',
  ...over,
});

const plainOp = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: 'payment',
  from: PAYER,
  to: DEPOSIT,
  amount: '12.5000000',
  asset_type: 'credit_alphanum4',
  asset_code: 'USDC',
  asset_issuer: USDC_ISSUER,
  ...over,
});

const baseVerify = {
  chain: 'stellar',
  token: 'USDC',
  txHash: TX_HASH,
  expectedToAddress: DEPOSIT,
  expectedFromAddress: PAYER,
  minAmountBaseUnits: '125000000',
  memo: MEMO,
} as const;

describe('stellarSendMaxWithSlippage', () => {
  it('adds exactly 1% to the quoted source amount', () => {
    assert.equal(stellarSendMaxWithSlippage('15.0000000'), '15.1500000');
  });

  it('rounds a fractional stroop up, never down', () => {
    assert.equal(stellarSendMaxWithSlippage('1.0000001'), '1.0100002');
  });
});

describe('stellarAdapter.encode', () => {
  it('plain USDC payment is unchanged: one payment op, USDC, amount, memo', async () => {
    fakeHorizon({});
    const res = await stellarAdapter.encode({ ...baseEncode });
    const tx = decode(res.encodedTransaction);
    assert.equal(tx.operations.length, 1);
    const op = tx.operations[0] as StellarSdk.Operation.Payment;
    assert.equal(op.type, 'payment');
    assert.equal(op.destination, DEPOSIT);
    assert.equal(op.amount, '12.5000000');
    assert.ok(op.asset.equals(new StellarSdk.Asset('USDC', USDC_ISSUER)));
    assert.equal(tx.memo.value?.toString(), MEMO);
    assert.equal(res.amountBaseUnits, '125000000');
    assert.equal(res.stellar?.pathPayment, undefined);
  });

  it('the plain payment carries the order expiry as its max time, min time 0', async () => {
    fakeHorizon({});
    const res = await stellarAdapter.encode({ ...baseEncode });
    const tx = decode(res.encodedTransaction);
    assert.equal(tx.timeBounds?.minTime, '0');
    assert.equal(tx.timeBounds?.maxTime, String(EXPIRES_AT_SEC));
    assert.equal(res.stellar?.maxTime, EXPIRES_AT_SEC);
  });

  it('XLM order builds one path payment: XLM in, exact USDC out to the deposit address', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    const tx = decode(res.encodedTransaction);
    assert.equal(tx.operations.length, 1);
    const op = tx.operations[0] as StellarSdk.Operation.PathPaymentStrictReceive;
    assert.equal(op.type, 'pathPaymentStrictReceive');
    assert.ok(op.sendAsset.isNative());
    assert.ok(op.destAsset.equals(new StellarSdk.Asset('USDC', USDC_ISSUER)));
    assert.equal(op.destAmount, '12.5000000');
    assert.equal(op.destination, DEPOSIT);
    assert.equal(op.sendMax, '15.1500000');
    assert.equal(tx.memo.value?.toString(), MEMO);
  });

  it('the live path search asks for XLM in and the exact USDC amount out', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    const [sources, dest, amount] = pathSearchArgs as [
      StellarSdk.Asset[],
      StellarSdk.Asset,
      string,
    ];
    assert.equal(sources.length, 1);
    assert.ok(sources[0]?.isNative());
    assert.ok(dest.equals(new StellarSdk.Asset('USDC', USDC_ISSUER)));
    assert.equal(amount, '12.5');
  });

  it('encode reports the hash of the tx it built (unchanged by signing)', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    const tx = decode(res.encodedTransaction);
    const before = tx.hash().toString('hex');
    tx.sign(StellarSdk.Keypair.random());
    assert.equal(res.stellar?.txHash, before);
    assert.equal(tx.hash().toString('hex'), before);
  });

  it('XLM order still reports the USDC base units of the order', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    assert.equal(res.amountBaseUnits, '125000000');
  });

  it('the path payment carries the order expiry as its max time', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    const tx = decode(res.encodedTransaction);
    assert.equal(tx.timeBounds?.minTime, '0');
    assert.equal(tx.timeBounds?.maxTime, String(EXPIRES_AT_SEC));
  });

  it('picks the cheapest live path and uses its intermediate assets', async () => {
    const hop = { asset_type: 'credit_alphanum4', asset_code: 'EURC', asset_issuer: OTHER_ISSUER };
    fakeHorizon({
      paths: [
        { source_amount: '16.0000000', path: [] },
        { source_amount: '14.0000000', path: [hop] },
      ],
    });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    const op = decode(res.encodedTransaction)
      .operations[0] as StellarSdk.Operation.PathPaymentStrictReceive;
    assert.equal(op.sendMax, '14.1400000');
    assert.equal(op.path.length, 1);
    assert.ok(op.path[0]?.equals(new StellarSdk.Asset('EURC', OTHER_ISSUER)));
  });

  it('reports source asset, send max, quoted amount and path for storage and display', async () => {
    fakeHorizon({ paths: [{ source_amount: '15.0000000', path: [] }] });
    const res = await stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' });
    assert.deepEqual(res.stellar?.pathPayment, {
      sourceAsset: 'XLM',
      sendMax: '15.1500000',
      quotedSourceAmount: '15.0000000',
      slippageBps: 100,
      path: [],
    });
  });

  it('no XLM to USDC path: throws, nothing is built', async () => {
    fakeHorizon({ paths: [] });
    await assert.rejects(
      stellarAdapter.encode({ ...baseEncode, sourceAsset: 'XLM' }),
      /no XLM to USDC path/,
    );
  });
});

describe('stellarAdapter.verify', () => {
  it('plain USDC payment with asset, amount, memo and payer right is accepted', async () => {
    fakeHorizon({ tx: okTx, ops: [plainOp()] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, true);
  });

  it('path payment delivering the exact USDC with the order memo is accepted', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp()] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.amountBaseUnits, '125000000');
      assert.equal(res.fromAddress, PAYER);
      assert.equal(res.toAddress, DEPOSIT);
    }
  });

  it('path payment delivering USDC from another issuer is rejected', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp({ asset_issuer: OTHER_ISSUER })] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.reason, /no matching USDC payment/);
  });

  it('path payment to another account is rejected', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp({ to: STRANGER })] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
  });

  it('path payment delivering less than the order amount is rejected', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp({ amount: '12.4999999' })] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.reason, /< expected/);
  });

  it('path payment with the wrong memo is rejected', async () => {
    fakeHorizon({ tx: { ...okTx, memo: 'ffffffffffff' }, ops: [pathOp()] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.reason, /memo does not match/);
  });

  it('path payment from another payer is rejected', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp({ from: STRANGER })] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.reason, /!= expected/);
  });

  it('a strict-send path payment is not accepted', async () => {
    fakeHorizon({ tx: okTx, ops: [pathOp({ type: 'path_payment_strict_send' })] });
    const res = await stellarAdapter.verify({ ...baseVerify });
    assert.equal(res.ok, false);
  });

  // The order's own tx (built hash), max time an hour ago, Horizon past it.
  const expiredCase = {
    tx: (): never => {
      throw notFound();
    },
    latestLedgerClosedAt: isoAt(PAST_MAX_TIME + STELLAR_EXPIRY_GRACE_SECONDS + 5),
    payerTxs: [],
  };
  const expiryVerify = { ...baseVerify, maxTime: PAST_MAX_TIME, builtTxHash: TX_HASH };

  it('the built tx is not on Horizon, its max time passed and Horizon ingested past it: order expired', async () => {
    fakeHorizon(expiredCase);
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, STELLAR_ORDER_EXPIRED);
  });

  it('the latest ledger is read BEFORE the tx lookup, then the payer is checked', async () => {
    fakeHorizon(expiredCase);
    await stellarAdapter.verify(expiryVerify);
    assert.deepEqual(horizonCalls, ['ledger', 'tx', 'payerTxs']);
  });

  it('Horizon has not ingested past max time plus the grace: still pending', async () => {
    fakeHorizon({
      ...expiredCase,
      latestLedgerClosedAt: isoAt(PAST_MAX_TIME + STELLAR_EXPIRY_GRACE_SECONDS),
    });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('a 5xx or timeout on the tx lookup never becomes expired', async () => {
    fakeHorizon({
      ...expiredCase,
      tx: () => {
        throw new Error('socket hang up');
      },
    });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it("orders without a max time keep today's retryable answer", async () => {
    fakeHorizon(expiredCase);
    const res = await stellarAdapter.verify({ ...baseVerify, builtTxHash: TX_HASH });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('latest-ledger lookup failing keeps the retryable answer', async () => {
    fakeHorizon({
      ...expiredCase,
      latestLedgerClosedAt: () => {
        throw new Error('503');
      },
    });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('a hash other than the built tx never expires the order', async () => {
    fakeHorizon(expiredCase);
    const res = await stellarAdapter.verify({ ...expiryVerify, txHash: OTHER_HASH });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
    assert.deepEqual(horizonCalls, ['tx']);
  });

  it('the payer landed another tx with the order memo: not expired', async () => {
    fakeHorizon({
      ...expiredCase,
      payerTxs: [
        { successful: true, memo_type: 'text', memo: MEMO, created_at: isoAt(PAST_MAX_TIME) },
      ],
    });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('a payer-history lookup error never becomes expired', async () => {
    fakeHorizon({
      ...expiredCase,
      payerTxs: () => {
        throw new Error('429');
      },
    });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('a payer page too full to be sure never becomes expired', async () => {
    const recent = { successful: true, memo_type: 'none', created_at: isoAt(PAST_MAX_TIME) };
    fakeHorizon({ ...expiredCase, payerTxs: Array.from({ length: 50 }, () => recent) });
    const res = await stellarAdapter.verify(expiryVerify);
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
  });

  it('before max time plus the grace, verify reads nothing extra', async () => {
    fakeHorizon(expiredCase);
    const future = Math.floor(Date.now() / 1000) + 600;
    const res = await stellarAdapter.verify({ ...expiryVerify, maxTime: future });
    assert.equal(res.ok, false);
    if (!res.ok) assert.equal(res.reason, 'tx not found');
    assert.deepEqual(horizonCalls, ['tx']);
  });
});
