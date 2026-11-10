import {
  getChainAdapter,
  STELLAR_ORDER_EXPIRED,
  stellarMemoFromOrderId,
} from '@gaian-stellar-integration/chains';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  CHAIN_IDS,
  chainIdToNumeric,
  ConflictError,
  NotFoundError,
  logger,
  ValidationError,
  v2OrderStatusCode,
  v2VerifyStatusCode,
} from '@gaian-stellar-integration/config';
import {
  decodedQrInfoSchema,
  v2ErrorEnvelopeSchema,
  v2OkEnvelope,
  v2PlaceOrderRequestSchema,
  v2PlaceOrderResponseSchema,
  v2StatusResponseSchema,
  v2VerifyRequestSchema,
  v2VerifyResponseSchema,
  type DecodedQrInfo,
  type V2PlaceOrderResponse,
  type V2StatusResponse,
  type V2VerifyResponse,
} from '@gaian-stellar-integration/core';
import { z } from 'zod';

import { OrderService } from '../services/order-service.js';
import { createQuoteService, type StoredQuote } from '../services/quote-service.js';
import {
  stellarBuiltTxHashFromMetadata,
  stellarMaxTimeFromMetadata,
  stellarTransferMetadata,
} from '../services/stellar-transfer-metadata.js';

import type { ChainId } from '@gaian-stellar-integration/config';
import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const v2IdParamsSchema = z.object({ id: z.string().min(1) });
const envelopeErrors = {
  400: v2ErrorEnvelopeSchema,
  401: v2ErrorEnvelopeSchema,
  403: v2ErrorEnvelopeSchema,
  404: v2ErrorEnvelopeSchema,
  409: v2ErrorEnvelopeSchema,
} as const;

/** What verify checks against and what the payout needs, from the quote or from the order rows. */
interface VerifyContext {
  readonly chain: ChainId;
  readonly token: string;
  readonly depositAddress: string;
  readonly fromAddress: string;
  readonly amountBaseUnits: string;
  readonly fiatAmount: number;
  readonly fiatCurrency: string;
  readonly qrInfo: DecodedQrInfo;
  readonly country: string;
}

/** Drops zeros after the decimal point: "10.50000000" -> "10.5", "10.00000000" -> "10". */
const trimDecimal = (v: string): string => (v.includes('.') ? v.replace(/\.?0+$/, '') : v);

const verifyContextFromRow = (
  row: NonNullable<Awaited<ReturnType<OrderService['findVerifyContextByOrderIdAndTenant']>>>,
): VerifyContext => {
  const qr = decodedQrInfoSchema.safeParse(row.qrPayload);
  if (!qr.success) {
    throw new AppError('order is missing its payout recipient', {
      category: 'INTERNAL',
      statusCode: 500,
      severity: 'HIGH',
      code: 'ORDER_RECIPIENT_MISSING',
    });
  }
  return {
    chain: row.chain as ChainId,
    token: row.token,
    depositAddress: row.toAddress,
    fromAddress: row.fromAddress,
    amountBaseUnits: getChainAdapter(row.chain as ChainId).amountBaseUnits(
      row.token,
      trimDecimal(row.amount),
    ),
    fiatAmount: Number(row.fiatAmount),
    fiatCurrency: row.fiatCurrency,
    qrInfo: qr.data,
    country: qr.data.country,
  };
};

export const v2OrderRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const orders = new OrderService(app.db);
  const quotes = createQuoteService(app.redis);

  const requireKyc = async (quote: StoredQuote): Promise<void> => {
    const userDbId = quote.userDbId;
    if (userDbId === undefined || userDbId === null) {
      throw new AuthorizationError(`KYC verification is required for transactions in ${quote.country}`);
    }
    const countryCfg = app.countryConfig.forCountry(quote.country);
    const kycRow = await app.kycService.findVerifiedByUserIdAndProviders(
      userDbId,
      countryCfg?.kycProviders ?? [],
    );
    if (!kycRow) {
      throw new AuthorizationError(`KYC verification is required for transactions in ${quote.country}`);
    }
  };

  app.post(
    '/orders',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Place Stellar order from quote',
        description:
          'Consume the quote, run the KYC gate, and return `encodedTransaction` ' +
          '(Stellar XDR) for the client to sign and broadcast. ' +
          'Call POST /orders/:id/verify after broadcasting.',
        body: v2PlaceOrderRequestSchema,
        response: { 200: v2OkEnvelope(v2PlaceOrderResponseSchema), ...envelopeErrors },
        security: [{ tenantHeader: [] }],
      },
    },
    async (req, reply) => {
      await app.requireTenantHeader(req);
      const tenant = req.tenant;
      if (!tenant) throw new AuthenticationError('Tenant authentication required');
      const body = req.body as ReturnType<typeof v2PlaceOrderRequestSchema.parse>;

      const quote = await quotes.get(body.quoteId);
      if (!quote) throw new NotFoundError('Quote');
      if (quote.tenantId !== tenant.id) throw new AuthorizationError('quote does not belong to caller');

      if (quote.chain !== CHAIN_IDS.STELLAR) {
        throw new ValidationError(`This endpoint only supports Stellar orders. Got chain: ${quote.chain}`);
      }

      // Pay with XLM exists only where Stellar's DEX can deliver the order's
      // exact USDC: a Stellar USDC order. Anywhere else it is a client error.
      const payWithXlm = body.sourceAsset === 'XLM';
      if (payWithXlm && quote.token !== 'USDC') {
        throw new ValidationError('sourceAsset XLM is only available for Stellar USDC orders');
      }

      await requireKyc(quote);

      const adapter = getChainAdapter(quote.chain);
      const memo = stellarMemoFromOrderId(quote.orderId);
      const encoded = await adapter.encode({
        chain: quote.chain,
        token: quote.token,
        fromAddress: quote.fromAddress,
        toAddress: quote.depositAddress,
        amount: quote.cryptoAmount,
        memo,
        // The order expiry becomes the Stellar tx max time: a late signature on
        // the tx built here is rejected by the network (tx_too_late) instead of
        // paying an order that is already closed.
        expiresAt: quote.expiresAt,
        ...(payWithXlm ? { sourceAsset: 'XLM' as const } : {}),
      });
      const stellarMetadata = stellarTransferMetadata(encoded);

      await orders.createOrder({
        orderId: quote.orderId,
        tenantId: tenant.id,
        status: 'awaiting_deposit',
        fiatAmount: quote.fiatAmount,
        fiatCurrency: quote.fiatCurrency,
        cryptoAmount: Number(quote.cryptoAmount),
        cryptoCurrency: quote.token,
        exchangeRate: quote.exchangeRate,
        routeId: 1,
        ...(quote.userDbId != null ? { userId: quote.userDbId } : {}),
        expiresAt: new Date(quote.expiresAt),
        qrInfo: quote.qrInfo,
        protocolFee: 0,
        feeShare: 0,
        tenantFeeShare: 0,
        providerCharge: 0,
        cryptoTransferInfo: {
          chain: quote.chain,
          fromAddress: quote.fromAddress,
          toAddress: quote.depositAddress,
          token: quote.token,
          amount: Number(quote.cryptoAmount),
        },
        ...(stellarMetadata !== undefined ? { metadata: { ...stellarMetadata } } : {}),
      });

      const response: V2PlaceOrderResponse = {
        orderId: quote.orderId,
        status: v2OrderStatusCode('awaiting_deposit'),
        statusLabel: 'awaiting_deposit',
        chainId: chainIdToNumeric(quote.chain),
        depositAddress: quote.depositAddress,
        tokenAddress: encoded.tokenAddress ?? '',
        settlementAmount: quote.cryptoAmount,
        settlementAmountBaseUnits: encoded.amountBaseUnits,
        settlementCurrency: quote.token,
        encodedTransaction: encoded.encodedTransaction,
        expiresAt: quote.expiresAt,
        memo,
        ...(encoded.stellar?.pathPayment
          ? {
              sourceAsset: encoded.stellar.pathPayment.sourceAsset,
              sendMax: encoded.stellar.pathPayment.sendMax,
            }
          : {}),
      };
      return await reply.ok(response);
    },
  );

  app.post(
    '/orders/:id/verify',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Verify Stellar on-chain transaction',
        description:
          'Submit the broadcasted Stellar transaction hash. The adapter queries Horizon to verify ' +
          'the USDC transfer (amount, addresses, memo). On success the order advances to `processing` ' +
          'and payout is dispatched.',
        params: v2IdParamsSchema,
        body: v2VerifyRequestSchema,
        response: { 200: v2OkEnvelope(v2VerifyResponseSchema), ...envelopeErrors },
        security: [{ tenantHeader: [] }],
      },
    },
    async (req, reply) => {
      await app.requireTenantHeader(req);
      const tenant = req.tenant;
      if (!tenant) throw new AuthenticationError('Tenant authentication required');
      const { id } = req.params as { id: string };
      const body = req.body as ReturnType<typeof v2VerifyRequestSchema.parse>;
      // The hash goes straight into a Horizon URL path, so anything but 64 hex
      // characters (for example `H/../H`) is refused before it can reach the network
      // or an order row. Lower case is the one canonical form.
      if (!/^[0-9a-fA-F]{64}$/.test(body.transactionHash)) {
        throw new ValidationError('transactionHash must be 64 hexadecimal characters');
      }
      const txHash = body.transactionHash.toLowerCase();

      const verifyResponse = (
        statusLabel: 'verified' | 'failed' | 'pending',
        message: string,
        reasonCode?: string,
      ): V2VerifyResponse => ({
        orderId: id,
        status: v2VerifyStatusCode(statusLabel),
        statusLabel,
        transactionHash: txHash,
        message,
        ...(reasonCode !== undefined ? { reasonCode } : {}),
      });
      // A clear, stable answer for the wallet in place of a generic failure.
      const orderExpiredResponse = (): V2VerifyResponse =>
        verifyResponse('failed', STELLAR_ORDER_EXPIRED, 'ORDER_EXPIRED');

      const order = await orders.findByOrderIdAndTenant(id, tenant.id);
      if (!order) throw new NotFoundError(`Order ${id}`);

      // Peek; consume only after verification succeeds.
      const quote = await quotes.getByOrderId(id);

      /**
       * What verify checks the on-chain transfer against and what the payout needs.
       * Taken from the cached quote while it is there, and rebuilt from Postgres when
       * it is not. The quote key lives for QUOTE_TTL_SECONDS, which is also the order
       * expiry, so by the time an order can be told it expired the quote is always
       * gone. The order rows already hold every value, written when the order was
       * placed, so nothing here is inferred.
       */
      const fromDb = quote ? null : await orders.findVerifyContextByOrderIdAndTenant(id, tenant.id);

      if (!quote && fromDb?.status === 'expired') {
        // Asked again, with the same tx, after verify expired the order unpaid:
        // same answer, not a 409. Anything else keeps the 409.
        const state = await orders.findTransferState(order.id);
        const builtTxHash = stellarBuiltTxHashFromMetadata(state?.metadata);
        if (
          state !== null &&
          !state.isConfirmed &&
          builtTxHash?.toLowerCase() === txHash
        ) {
          return await reply.ok(orderExpiredResponse());
        }
      }
      if (!quote && !fromDb) {
        throw new ConflictError('quote expired or already consumed');
      }
      // The quote being single-use was the only thing stopping a second verify from
      // dispatching a second payout. Without it the status takes over the job: only
      // an order still awaiting its deposit may be verified.
      if (fromDb && fromDb.status !== 'awaiting_deposit') {
        throw new ConflictError(`order is no longer awaiting a deposit (status: ${fromDb.status})`);
      }

      if ((quote?.chain ?? fromDb?.chain) !== CHAIN_IDS.STELLAR) {
        throw new ValidationError(
          `This endpoint only supports Stellar orders. Got chain: ${quote?.chain ?? fromDb?.chain ?? 'unknown'}`,
        );
      }

      const vctx: VerifyContext = quote ?? verifyContextFromRow(fromDb as NonNullable<typeof fromDb>);

      // The tx time bound and built tx hash written at order time. Read from the
      // durable row (the quote is usually gone by the time an order has expired).
      const transferState = await orders.findTransferState(order.id);
      const stellarMaxTime = stellarMaxTimeFromMetadata(transferState?.metadata);
      const stellarBuiltTxHash = stellarBuiltTxHashFromMetadata(transferState?.metadata);

      // Verify the transaction on Stellar Horizon.
      const adapter = getChainAdapter(vctx.chain);
      const verification = await adapter.verify({
        chain: vctx.chain,
        token: vctx.token,
        txHash,
        expectedToAddress: vctx.depositAddress,
        expectedFromAddress: vctx.fromAddress,
        minAmountBaseUnits: vctx.amountBaseUnits,
        memo: stellarMemoFromOrderId(id),
        ...(stellarMaxTime !== undefined ? { maxTime: stellarMaxTime } : {}),
        ...(stellarBuiltTxHash !== undefined ? { builtTxHash: stellarBuiltTxHash } : {}),
      });

      if (!verification.ok) {
        // 'tx not found' is transient — Horizon may not have indexed it yet.
        // Return pending so the caller can retry with the same hash.
        if (verification.reason === 'tx not found') {
          return await reply.ok(verifyResponse('pending', verification.reason));
        }
        // The adapter only says this for the tx built for this order, once the
        // network can no longer accept it and the payer landed nothing with the
        // order memo, so closing the order cannot strand a payment on its way.
        if (verification.reason === STELLAR_ORDER_EXPIRED) {
          // Only from awaiting_deposit: a parallel verify of a real payment may
          // have moved the order on, and expiring it then would orphan the payout.
          const expired = await orders.updateStatus(
            id,
            'expired',
            'order expired before payment',
            'awaiting_deposit',
          );
          if (!expired) {
            throw new ConflictError('order is no longer awaiting a deposit');
          }
          await quotes.consumeByOrderId(id);
          logger.warn(
            { orderId: id, txHash },
            'v2.verify_order_expired',
          );
          return await reply.ok(orderExpiredResponse());
        }
        // Only an order still awaiting its deposit may be failed. A wrong hash
        // must not fail an order whose own transaction can still land, and a slow
        // failing call must not overwrite a status a parallel verify just wrote.
        const failed = await orders.updateStatus(
          id,
          'failed',
          `verify failed: ${verification.reason}`,
          'awaiting_deposit',
        );
        if (!failed) {
          throw new ConflictError('order is no longer awaiting a deposit');
        }
        await quotes.consumeByOrderId(id);
        logger.warn({ orderId: id, txHash, reason: verification.reason }, 'v2.verify_failed');
        return await reply.ok(verifyResponse('failed', verification.reason));
      }

      // Only an order still awaiting its deposit may move on, so a repeated or
      // parallel verify cannot dispatch a second payout.
      const advanced = await orders.updateStatus(id, 'processing', 'verified on-chain', 'awaiting_deposit');
      if (!advanced) {
        throw new ConflictError('order is no longer awaiting a deposit');
      }
      await Promise.all([
        quotes.consumeByOrderId(id),
        orders.setTransactionHash(id, txHash, order.id),
      ]);

      // Dispatch fiat payout.
      await app.payout.dispatch({
        orderId: id,
        fiatAmount: vctx.fiatAmount.toString(),
        fiatCurrency: vctx.fiatCurrency,
        recipient: {
          accountNumber: vctx.qrInfo.accountNumber,
          bankCode: vctx.qrInfo.bankBin,
          beneficiaryName: vctx.qrInfo.beneficiaryName,
          country: vctx.country,
        },
      });

      return await reply.ok(verifyResponse('verified', 'verified and dispatched'));
    },
  );

  app.get(
    '/orders/:id',
    {
      schema: {
        tags: ['Orders'],
        summary: 'Fetch order status',
        description:
          'Payment status for partner polling. Returns the order row joined with its ' +
          'on-chain transfer record (deposit address, transaction hash). Every status ' +
          'transition is also pushed to the tenant webhook endpoint.',
        params: v2IdParamsSchema,
        response: { 200: v2OkEnvelope(v2StatusResponseSchema), ...envelopeErrors },
        security: [{ tenantHeader: [] }],
      },
    },
    async (req, reply) => {
      await app.requireTenantHeader(req);
      const tenant = req.tenant;
      if (!tenant) throw new AuthenticationError('Tenant authentication required');
      const { id } = req.params as { id: string };

      // Tenant-scoped lookup: a tenant can only read its own orders.
      const row = await orders.findStatusByOrderIdAndTenant(id, tenant.id);
      if (!row) throw new NotFoundError(`Order ${id}`);

      const response: V2StatusResponse = {
        orderId: row.orderId,
        status: v2OrderStatusCode(row.status),
        statusLabel: row.status,
        chainId: chainIdToNumeric(CHAIN_IDS.STELLAR),
        ...(row.depositAddress ? { depositAddress: row.depositAddress } : {}),
        ...(row.transactionHash ? { transactionHash: row.transactionHash } : {}),
        fiatAmount: Number(row.fiatAmount),
        fiatCurrency: row.fiatCurrency,
        settlementAmount: String(row.cryptoAmount),
        settlementCurrency: row.cryptoCurrency,
        exchangeRate: String(row.exchangeRate ?? 0),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
      return await reply.ok(response);
    },
  );
};
