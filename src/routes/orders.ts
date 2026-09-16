import { getChainAdapter, stellarMemoFromOrderId } from '@gaian-stellar-integration/chains';
import {
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
  v2ErrorEnvelopeSchema,
  v2OkEnvelope,
  v2PlaceOrderRequestSchema,
  v2PlaceOrderResponseSchema,
  v2VerifyRequestSchema,
  v2VerifyResponseSchema,
  type V2PlaceOrderResponse,
  type V2VerifyResponse,
} from '@gaian-stellar-integration/core';
import { z } from 'zod';

import { OrderService } from '../services/order-service.js';
import { createQuoteService, type StoredQuote } from '../services/quote-service.js';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

const v2IdParamsSchema = z.object({ id: z.string().min(1) });
const envelopeErrors = {
  400: v2ErrorEnvelopeSchema,
  401: v2ErrorEnvelopeSchema,
  403: v2ErrorEnvelopeSchema,
  404: v2ErrorEnvelopeSchema,
  409: v2ErrorEnvelopeSchema,
} as const;

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
      });

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

      const verifyResponse = (
        statusLabel: 'verified' | 'failed' | 'pending',
        message: string,
      ): V2VerifyResponse => ({
        orderId: id,
        status: v2VerifyStatusCode(statusLabel),
        statusLabel,
        transactionHash: body.transactionHash,
        message,
      });

      const order = await orders.findByOrderIdAndTenant(id, tenant.id);
      if (!order) throw new NotFoundError(`Order ${id}`);

      const quote = await quotes.getByOrderId(id);
      if (!quote) throw new ConflictError('quote expired or already consumed');

      if (quote.chain !== CHAIN_IDS.STELLAR) {
        throw new ValidationError(`This endpoint only supports Stellar orders. Got chain: ${quote.chain}`);
      }

      // Verify the transaction on Stellar Horizon.
      const adapter = getChainAdapter(quote.chain);
      const verification = await adapter.verify({
        chain: quote.chain,
        token: quote.token,
        txHash: body.transactionHash,
        expectedToAddress: quote.depositAddress,
        expectedFromAddress: quote.fromAddress,
        minAmountBaseUnits: quote.amountBaseUnits,
        memo: stellarMemoFromOrderId(id),
      });

      if (!verification.ok) {
        // 'tx not found' is transient — Horizon may not have indexed it yet.
        // Return pending so the caller can retry with the same hash.
        if (verification.reason === 'tx not found') {
          return await reply.ok(verifyResponse('pending', verification.reason));
        }
        await Promise.all([
          quotes.consumeByOrderId(id),
          orders.updateStatus(id, 'failed', `verify failed: ${verification.reason}`),
        ]);
        logger.warn({ orderId: id, txHash: body.transactionHash, reason: verification.reason }, 'v2.verify_failed');
        return await reply.ok(verifyResponse('failed', verification.reason));
      }

      // Consume quote and advance order status concurrently.
      await Promise.all([
        quotes.consumeByOrderId(id),
        orders.setTransactionHash(id, body.transactionHash, order.id),
        orders.updateStatus(id, 'processing', 'verified on-chain'),
      ]);

      // Dispatch fiat payout.
      await app.payout.dispatch({
        orderId: id,
        fiatAmount: quote.fiatAmount.toString(),
        fiatCurrency: quote.fiatCurrency,
        recipient: {
          accountNumber: quote.qrInfo.accountNumber,
          bankCode: quote.qrInfo.bankBin,
          beneficiaryName: quote.qrInfo.beneficiaryName,
          country: quote.country,
        },
      });

      return await reply.ok(verifyResponse('verified', 'verified and dispatched'));
    },
  );
};
