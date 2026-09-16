import { env, logger, CHAIN_IDS } from '@gaian-stellar-integration/config';
import * as StellarSdk from '@stellar/stellar-sdk';

import type {
  ChainAdapter,
  EncodeTransferInput,
  EncodeTransferResult,
  VerifyTransferInput,
  VerifyTransferResult,
} from './types.js';

const USDC_DECIMALS = 7;

// Disambiguates orders on Stellar's shared deposit address (no per-order
// address exists). Last 12 hex chars of the orderId (final UUID v4 segment).
export const stellarMemoFromOrderId = (orderId: string): string => orderId.slice(-12);

const buildServer = (): StellarSdk.Horizon.Server =>
  new StellarSdk.Horizon.Server(env.STELLAR_HORIZON_URL);

const toBaseUnits = (amount: string, decimals: number): bigint => {
  const [whole, frac = ''] = amount.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole ?? '0') + padded);
};

export const stellarAdapter: ChainAdapter = {
  id: CHAIN_IDS.STELLAR,

  amountBaseUnits(_token: string, amount: string): string {
    return toBaseUnits(amount, USDC_DECIMALS).toString();
  },

  async encode(input: EncodeTransferInput): Promise<EncodeTransferResult> {
    const server = buildServer();
    const usdcAsset = new StellarSdk.Asset(env.STELLAR_USDC_CODE, env.STELLAR_USDC_ISSUER);
    const amountBaseUnits = toBaseUnits(input.amount, USDC_DECIMALS);

    logger.debug(
      {
        op: 'stellar.encode',
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        amount: input.amount,
        token: input.token,
      },
      'stellar.encode.params',
    );

    let account: StellarSdk.Horizon.AccountResponse;
    try {
      account = await server.loadAccount(input.fromAddress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ op: 'stellar.encode', fromAddress: input.fromAddress, err: msg }, 'stellar.encode.load_account_error');
      throw new Error(`failed to load Stellar account: ${msg}`);
    }

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
    }).addOperation(
      StellarSdk.Operation.payment({
        destination: input.toAddress,
        asset: usdcAsset,
        amount: input.amount,
      }),
    );
    if (input.memo !== undefined) {
      txBuilder.addMemo(StellarSdk.Memo.text(input.memo));
    }
    const tx = txBuilder.setTimeout(300).build();

    const encodedTransaction = tx.toXDR();

    logger.info(
      {
        op: 'stellar.encode',
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        amount: input.amount,
        xdrLength: encodedTransaction.length,
      },
      'stellar.encode.ok',
    );

    return {
      chain: CHAIN_IDS.STELLAR,
      encodedTransaction,
      format: 'stellar-xdr',
      tokenAddress: `${env.STELLAR_USDC_CODE}:${env.STELLAR_USDC_ISSUER}`,
      decimals: USDC_DECIMALS,
      amountBaseUnits: amountBaseUnits.toString(),
    };
  },

  async verify(input: VerifyTransferInput): Promise<VerifyTransferResult> {
    const server = buildServer();
    const expectedIssuer = env.STELLAR_USDC_ISSUER;
    const expectedCode = env.STELLAR_USDC_CODE;
    const minAmount = BigInt(input.minAmountBaseUnits);

    logger.debug(
      {
        op: 'stellar.verify',
        txHash: input.txHash,
        horizonUrl: env.STELLAR_HORIZON_URL,
        token: input.token,
        expectedToAddress: input.expectedToAddress,
        expectedFromAddress: input.expectedFromAddress,
        minAmountBaseUnits: input.minAmountBaseUnits,
      },
      'stellar.verify.params',
    );

    logger.info(
      {
        op: 'stellar.verify',
        rpcMethod: 'transactions',
        horizonUrl: env.STELLAR_HORIZON_URL,
        txHash: input.txHash,
      },
      'stellar.verify.rpc.request',
    );

    const rpcStartedAt = Date.now();
    let txRecord: StellarSdk.Horizon.ServerApi.TransactionRecord;
    try {
      txRecord = await server.transactions().transaction(input.txHash).call();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          op: 'stellar.verify',
          txHash: input.txHash,
          durationMs: Date.now() - rpcStartedAt,
          err: msg,
        },
        'stellar.verify.tx_fetch_error',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: `tx fetch error: ${msg}`,
      };
    }

    logger.info(
      {
        op: 'stellar.verify',
        txHash: input.txHash,
        durationMs: Date.now() - rpcStartedAt,
        successful: txRecord.successful,
        ledger: txRecord.ledger_attr,
        createdAt: txRecord.created_at,
      },
      'stellar.verify.tx_fetched',
    );

    if (!txRecord.successful) {
      logger.warn(
        { op: 'stellar.verify', txHash: input.txHash },
        'stellar.verify.tx_failed_onchain',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: 'tx failed on-chain',
      };
    }

    let operations: StellarSdk.Horizon.ServerApi.OperationRecord[];
    try {
      const opsPage = await server.operations().forTransaction(input.txHash).call();
      operations = opsPage.records;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { op: 'stellar.verify', txHash: input.txHash, err: msg },
        'stellar.verify.ops_fetch_error',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: `operations fetch error: ${msg}`,
      };
    }

    let observed: { from: string; to: string; amount: bigint } | null = null;
    const candidatesSeen: { type: string; to?: string; amount?: string; assetCode?: string | undefined }[] = [];

    for (const op of operations) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (op.type === 'payment') {
        const paymentOp = op;
        candidatesSeen.push({
          type: 'payment',
          to: paymentOp.to,
          amount: paymentOp.amount,
          assetCode: paymentOp.asset_code ?? undefined,
        });

        if (paymentOp.asset_type !== 'credit_alphanum4' && paymentOp.asset_type !== 'credit_alphanum12') {
          continue;
        }
        if (paymentOp.asset_code !== expectedCode || paymentOp.asset_issuer !== expectedIssuer) {
          continue;
        }
        if (paymentOp.to !== input.expectedToAddress) {
          continue;
        }

        const amountBaseUnits = toBaseUnits(paymentOp.amount, USDC_DECIMALS);
        observed = { from: paymentOp.from, to: paymentOp.to, amount: amountBaseUnits };
        break;
      }
    }

    if (!observed) {
      logger.warn(
        {
          op: 'stellar.verify',
          txHash: input.txHash,
          expectedToAddress: input.expectedToAddress,
          expectedAsset: `${expectedCode}:${expectedIssuer}`,
          candidatesSeen,
        },
        'stellar.verify.no_match',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: 'no matching USDC payment to expected deposit address',
      };
    }

    if (observed.amount < minAmount) {
      logger.warn(
        {
          op: 'stellar.verify',
          txHash: input.txHash,
          observedAmount: observed.amount.toString(),
          minAmountBaseUnits: input.minAmountBaseUnits,
          observedFrom: observed.from,
          observedTo: observed.to,
        },
        'stellar.verify.amount_below_min',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: `amount ${observed.amount.toString()} < expected ${minAmount.toString()}`,
      };
    }

    // Only enforced when the caller passes one, so orders without a memo on-chain still verify.
    if (input.memo !== undefined) {
      const matchesMemo = txRecord.memo_type === 'text' && txRecord.memo === input.memo;
      if (!matchesMemo) {
        logger.warn(
          {
            op: 'stellar.verify',
            txHash: input.txHash,
            expectedMemo: input.memo,
            observedMemoType: txRecord.memo_type,
            observedMemo: txRecord.memo,
          },
          'stellar.verify.memo_mismatch',
        );
        return {
          ok: false,
          chain: CHAIN_IDS.STELLAR,
          txHash: input.txHash,
          reason: 'memo does not match expected order memo',
        };
      }
    }

    if (input.expectedFromAddress && observed.from !== input.expectedFromAddress) {
      logger.warn(
        {
          op: 'stellar.verify',
          txHash: input.txHash,
          observedFrom: observed.from,
          expectedFromAddress: input.expectedFromAddress,
        },
        'stellar.verify.from_mismatch',
      );
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: `from ${observed.from} != expected ${input.expectedFromAddress}`,
      };
    }

    logger.info(
      {
        op: 'stellar.verify',
        txHash: input.txHash,
        observedAmount: observed.amount.toString(),
        observedFrom: observed.from,
        observedTo: observed.to,
      },
      'stellar.verify.ok',
    );

    return {
      ok: true,
      chain: CHAIN_IDS.STELLAR,
      txHash: input.txHash,
      amountBaseUnits: observed.amount.toString(),
      fromAddress: observed.from,
      toAddress: observed.to,
      confirmedAt: txRecord.created_at,
    };
  },
};
