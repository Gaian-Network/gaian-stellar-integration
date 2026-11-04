import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  stellarBuiltTxHashFromMetadata,
  stellarMaxTimeFromMetadata,
  stellarTransferMetadata,
} from '../src/services/stellar-transfer-metadata.js';

import type { EncodeTransferResult } from '@gaian-stellar-integration/chains';

const encoded = (stellar?: EncodeTransferResult['stellar']): EncodeTransferResult => ({
  chain: 'stellar',
  encodedTransaction: 'AAAA',
  format: 'stellar-xdr',
  decimals: 7,
  amountBaseUnits: '125000000',
  ...(stellar !== undefined ? { stellar } : {}),
});

const TX_HASH = 'ab'.repeat(32);

const pathPayment = {
  sourceAsset: 'XLM',
  sendMax: '15.1500000',
  quotedSourceAmount: '15.0000000',
  slippageBps: 100,
  path: [],
} as const;

describe('stellarTransferMetadata', () => {
  it('U-D1-08 stores the source asset, send max and time bound of an XLM order', () => {
    assert.deepEqual(
      stellarTransferMetadata(encoded({ txHash: TX_HASH, maxTime: 1_800_000_000, pathPayment })),
      {
        stellar: { txHash: TX_HASH, maxTime: 1_800_000_000, pathPayment },
      },
    );
  });

  it('stores only the time bound for a plain USDC order', () => {
    assert.deepEqual(
      stellarTransferMetadata(encoded({ txHash: TX_HASH, maxTime: 1_800_000_000 })),
      {
        stellar: { txHash: TX_HASH, maxTime: 1_800_000_000 },
      },
    );
  });

  it('stores nothing for a chain with no Stellar details', () => {
    assert.equal(stellarTransferMetadata(encoded()), undefined);
  });
});

describe('stellarMaxTimeFromMetadata', () => {
  it('U-R-01 reads the time bound written at order time, next to a sandbox block', () => {
    const meta = { sandbox: { outcome: 'fail' }, stellar: { maxTime: 1_800_000_000 } };
    assert.equal(stellarMaxTimeFromMetadata(meta), 1_800_000_000);
  });

  it('U-D2-06 rows from before time bounds answer undefined, so verify stays retryable', () => {
    assert.equal(stellarMaxTimeFromMetadata(null), undefined);
    assert.equal(stellarMaxTimeFromMetadata({ sandbox: { outcome: 'fail' } }), undefined);
    assert.equal(stellarMaxTimeFromMetadata({ stellar: {} }), undefined);
  });

  it('ignores a corrupt value instead of trusting it', () => {
    assert.equal(stellarMaxTimeFromMetadata({ stellar: { maxTime: '1800000000' } }), undefined);
    assert.equal(stellarMaxTimeFromMetadata({ stellar: { maxTime: -1 } }), undefined);
    assert.equal(stellarMaxTimeFromMetadata({ stellar: { maxTime: 1.5 } }), undefined);
  });
});

describe('stellarBuiltTxHashFromMetadata', () => {
  it('U-D2-08 reads the built tx hash so verify can expire only that tx', () => {
    assert.equal(stellarBuiltTxHashFromMetadata({ stellar: { txHash: TX_HASH } }), TX_HASH);
  });

  it('answers undefined for a missing or malformed hash', () => {
    assert.equal(stellarBuiltTxHashFromMetadata(null), undefined);
    assert.equal(stellarBuiltTxHashFromMetadata({ stellar: {} }), undefined);
    assert.equal(stellarBuiltTxHashFromMetadata({ stellar: { txHash: 'not-a-hash' } }), undefined);
  });
});
