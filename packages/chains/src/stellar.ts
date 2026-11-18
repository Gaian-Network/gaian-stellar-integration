import { env, logger, CHAIN_IDS } from '@gaian-stellar-integration/config';
import * as StellarSdk from '@stellar/stellar-sdk';

import type {
  ChainAdapter,
  EncodeTransferInput,
  EncodeTransferResult,
  StellarPathPaymentQuote,
  VerifyTransferInput,
  VerifyTransferResult,
} from './types.js';

const USDC_DECIMALS = 7;

// Slippage cap on an XLM-paid order: the consumer signs for at most the live
// path quote plus 1%. Fixed by the approved scope, not tunable per tenant.
export const STELLAR_PATH_SLIPPAGE_BPS = 100;

// The verify reason both verify routes treat as retryable: order and quote stay
// untouched and the caller resubmits the same hash ('pending').
const TX_NOT_FOUND = 'tx not found';

// The order's tx can no longer land: its max time has passed and Horizon has
// ingested a ledger that closed after it. Routes map this to "order expired".
export const STELLAR_ORDER_EXPIRED = 'order expired';

// Margin past the max time before an order may be called expired. Covers a
// Horizon behind a load balancer whose instances sit a few ledgers apart.
export const STELLAR_EXPIRY_GRACE_SECONDS = 60;

// How far back the payer's own transactions are searched for this order's memo
// before expiring it. A consumer account rarely makes this many in an order's life.
const PAYER_TX_SCAN_LIMIT = 50;

export const stellarMemoFromOrderId = (orderId: string): string => orderId.slice(-12);

const buildServer = (): StellarSdk.Horizon.Server =>
  new StellarSdk.Horizon.Server(env.STELLAR_HORIZON_URL);

const toBaseUnits = (amount: string, decimals: number): bigint => {
  const [whole, frac = ''] = amount.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt((whole ?? '0') + padded);
};

const fromStroops = (stroops: bigint): string => {
  const s = stroops.toString().padStart(USDC_DECIMALS + 1, '0');
  return `${s.slice(0, -USDC_DECIMALS)}.${s.slice(-USDC_DECIMALS)}`;
};

// Rounds UP to the stroop: rounding down would let a quote that moves by
// exactly the cap fail on-chain with op_over_source_max.
export const stellarSendMaxWithSlippage = (
  sourceAmount: string,
  slippageBps: number = STELLAR_PATH_SLIPPAGE_BPS,
): string => {
  const scaled = toBaseUnits(sourceAmount, USDC_DECIMALS) * BigInt(10_000 + slippageBps);
  return fromStroops((scaled + 9_999n) / 10_000n);
};

interface HorizonPathAsset {
  readonly asset_type: string;
  readonly asset_code?: string;
  readonly asset_issuer?: string;
}

const toSdkAsset = (a: HorizonPathAsset): StellarSdk.Asset =>
  a.asset_type === 'native' || !a.asset_code || !a.asset_issuer
    ? StellarSdk.Asset.native()
    : new StellarSdk.Asset(a.asset_code, a.asset_issuer);

const assetLabel = (a: HorizonPathAsset): string =>
  a.asset_type === 'native' ? 'native' : `${a.asset_code ?? ''}:${a.asset_issuer ?? ''}`;

/**
 * Live XLM price of the exact USDC amount, from Horizon's strict-receive path
 * search over the Stellar order book and liquidity pools. No external oracle.
 */
const quoteXlmPath = async (
  server: StellarSdk.Horizon.Server,
  usdcAsset: StellarSdk.Asset,
  destAmount: string,
): Promise<{ quote: StellarPathPaymentQuote; path: StellarSdk.Asset[] }> => {
  let records: { source_amount: string; path: HorizonPathAsset[] }[];
  try {
    const page = await server
      .strictReceivePaths([StellarSdk.Asset.native()], usdcAsset, destAmount)
      .call();
    records = page.records;
  } catch (err) {
    logger.warn({ op: 'stellar.encode', destAmount, err }, 'stellar.encode.path_quote_error');
    throw new Error('failed to get a live XLM to USDC path quote');
  }
  const best = records.reduce<(typeof records)[number] | undefined>(
    (min, r) =>
      min === undefined ||
      toBaseUnits(r.source_amount, USDC_DECIMALS) < toBaseUnits(min.source_amount, USDC_DECIMALS)
        ? r
        : min,
    undefined,
  );
  if (!best) {
    throw new Error('no XLM to USDC path for this amount on the Stellar network');
  }
  return {
    quote: {
      sourceAsset: 'XLM',
      sendMax: stellarSendMaxWithSlippage(best.source_amount),
      quotedSourceAmount: best.source_amount,
      slippageBps: STELLAR_PATH_SLIPPAGE_BPS,
      path: best.path.map(assetLabel),
    },
    path: best.path.map(toSdkAsset),
  };
};

const isHorizonNotFound = (err: unknown): boolean =>
  err instanceof StellarSdk.NotFoundError ||
  (err as { response?: { status?: unknown } } | null)?.response?.status === 404;

/**
 * A tx with max time T is valid only in a ledger that closes at or before T, and
 * Horizon ingests ledgers in order. So once Horizon's newest ledger closed after
 * T (plus the grace), a hash it still does not know can never land. Any doubt
 * (lookup error, no ledger) answers false, which keeps the order retryable.
 * Must be read BEFORE the tx lookup: read after it, a Horizon catching up in
 * between could report a ledger past T while the 404 came from before the tx's
 * own ledger was ingested.
 */
const horizonIngestedPast = async (
  server: StellarSdk.Horizon.Server,
  maxTime: number,
): Promise<boolean> => {
  try {
    const page = await server.ledgers().order('desc').limit(1).call();
    const closedAt = page.records[0]?.closed_at;
    if (closedAt === undefined) return false;
    return Math.floor(Date.parse(closedAt) / 1000) > maxTime + STELLAR_EXPIRY_GRACE_SECONDS;
  } catch (err) {
    logger.warn({ op: 'stellar.verify', maxTime, err }, 'stellar.verify.latest_ledger_error');
    return false;
  }
};

/**
 * Last guard before expiring: did the payer land ANY successful tx carrying
 * this order's memo (a wallet that rebuilt the tx after tx_bad_seq gets a new
 * hash, then reports the old one)? Verify only accepts payments from this payer
 * with this memo, so their own history is the complete place to look. A lookup
 * error, or a page too full to be sure, answers true: never expire on doubt.
 */
const payerMayHavePaidMemo = async (
  server: StellarSdk.Horizon.Server,
  payer: string,
  memo: string,
  maxTime: number,
): Promise<boolean> => {
  try {
    const page = await server
      .transactions()
      .forAccount(payer)
      .order('desc')
      .limit(PAYER_TX_SCAN_LIMIT)
      .call();
    const records = page.records;
    if (records.some((r) => r.successful && r.memo_type === 'text' && r.memo === memo)) {
      return true;
    }
    const oldest = records[records.length - 1];
    // A full page whose oldest entry is still within an hour of the expiry may
    // have pushed the payment off the page.
    return (
      records.length >= PAYER_TX_SCAN_LIMIT &&
      oldest !== undefined &&
      Date.parse(oldest.created_at) / 1000 > maxTime - 3600
    );
  } catch (err) {
    logger.warn({ op: 'stellar.verify', payer, err }, 'stellar.verify.payer_scan_error');
    return true;
  }
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

    const pathQuote =
      input.sourceAsset === 'XLM' ? await quoteXlmPath(server, usdcAsset, input.amount) : undefined;

    // The order's expiry is the tx max time, so a signature that arrives after
    // the order closed is rejected by the network (tx_too_late) instead of
    // landing on a closed order. Callers without an expiry keep the old 300 s.
    const maxTime =
      input.expiresAt !== undefined ? Math.floor(Date.parse(input.expiresAt) / 1000) : undefined;
    if (maxTime !== undefined && !Number.isFinite(maxTime)) {
      throw new Error(`invalid order expiry: ${input.expiresAt ?? ''}`);
    }

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE,
      ...(maxTime !== undefined ? { timebounds: { minTime: 0, maxTime } } : {}),
    }).addOperation(
      pathQuote
        ? StellarSdk.Operation.pathPaymentStrictReceive({
            sendAsset: StellarSdk.Asset.native(),
            sendMax: pathQuote.quote.sendMax,
            destination: input.toAddress,
            destAsset: usdcAsset,
            destAmount: input.amount,
            path: pathQuote.path,
          })
        : StellarSdk.Operation.payment({
            destination: input.toAddress,
            asset: usdcAsset,
            amount: input.amount,
          }),
    );
    if (input.memo !== undefined) {
      txBuilder.addMemo(StellarSdk.Memo.text(input.memo));
    }
    if (maxTime === undefined) txBuilder.setTimeout(300);
    const tx = txBuilder.build();

    const encodedTransaction = tx.toXDR();
    // The hash covers the tx body, not the signatures, so it is final before the
    // consumer signs. Verify expires an order only when THIS tx can never land.
    const builtTxHash = tx.hash().toString('hex');

    logger.info(
      {
        op: 'stellar.encode',
        fromAddress: input.fromAddress,
        toAddress: input.toAddress,
        amount: input.amount,
        sourceAsset: pathQuote ? 'XLM' : 'USDC',
        maxTime,
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
      stellar: {
        txHash: builtTxHash,
        ...(maxTime !== undefined ? { maxTime } : {}),
        ...(pathQuote ? { pathPayment: pathQuote.quote } : {}),
      },
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

    // Expiry is only ever decided for the exact tx Gaian built, once the wall
    // clock is past its max time. Before that nothing extra is read, so the
    // normal verify path costs what it always did.
    const expiryCandidate =
      input.maxTime !== undefined &&
      input.builtTxHash?.toLowerCase() === input.txHash.toLowerCase() &&
      Date.now() / 1000 > input.maxTime + STELLAR_EXPIRY_GRACE_SECONDS;
    const ingestedPastMaxTime =
      expiryCandidate && input.maxTime !== undefined
        ? await horizonIngestedPast(server, input.maxTime)
        : false;

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
      // Only a definite 404 after the max time can mean "will never land". A
      // 429, 5xx or timeout says nothing about the tx, so it stays retryable.
      if (
        ingestedPastMaxTime &&
        input.maxTime !== undefined &&
        input.expectedFromAddress !== undefined &&
        input.memo !== undefined &&
        isHorizonNotFound(err) &&
        !(await payerMayHavePaidMemo(server, input.expectedFromAddress, input.memo, input.maxTime))
      ) {
        logger.warn(
          { op: 'stellar.verify', txHash: input.txHash, maxTime: input.maxTime },
          'stellar.verify.order_expired',
        );
        return {
          ok: false,
          chain: CHAIN_IDS.STELLAR,
          txHash: input.txHash,
          reason: STELLAR_ORDER_EXPIRED,
        };
      }
      // A failed lookup (404 not ingested yet, 429, 5xx, timeout) means the tx
      // could not be seen, not that the payment is wrong. Failing here would
      // tear down an order that may already be paid. Real error is logged above.
      return {
        ok: false,
        chain: CHAIN_IDS.STELLAR,
        txHash: input.txHash,
        reason: TX_NOT_FOUND,
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
      // A strict-receive path payment (pay with XLM) is checked exactly like a
      // plain payment: Horizon's `to`, `amount` and `asset_*` on this op are the
      // DESTINATION side, so asset, amount, memo and payer rules are unchanged.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
      if (op.type === 'payment' || op.type === 'path_payment_strict_receive') {
        const paymentOp = op;
        candidatesSeen.push({
          type: op.type,
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
