import { getChainAdapter } from '@gaian-stellar-integration/chains';
import {
  AuthenticationError,
  CHAIN_IDS,
  env,
  NotFoundError,
  numericToChainId,
  resolveDepositAddress,
  resolveTokenDecimals,
  ValidationError,
} from '@gaian-stellar-integration/config';
import {
  FIAT_CURRENCY_BY_COUNTRY,
  v2ErrorEnvelopeSchema,
  v2OkEnvelope,
  v2QuoteRequestSchema,
  v2QuoteResponseSchema,
  type FiatCountry,
} from '@gaian-stellar-integration/core';
import Decimal from 'decimal.js';
import { v4 as uuid } from 'uuid';

import { getExchangeRate } from '../services/rate.js';
import { createQrService } from '../services/qr-service.js';
import { createQuoteService, type StoredQuote } from '../services/quote-service.js';
import { createUserService } from '../services/user-service.js';

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';

export const v2QuoteRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const qrSvc = createQrService();
  const quotes = createQuoteService(app.redis);
  const users = createUserService(app.db);

  app.post(
    '/quote',
    {
      schema: {
        tags: ['Quote'],
        summary: 'Create a Stellar USDC quote',
        description:
          'Parse a payment QR, compute the Stellar USDC settlement amount, and return a ' +
          'single-use quote (valid for QUOTE_TTL_SECONDS). Pass the quoteId to POST /orders.',
        body: v2QuoteRequestSchema,
        response: {
          200: v2OkEnvelope(v2QuoteResponseSchema),
          400: v2ErrorEnvelopeSchema,
          401: v2ErrorEnvelopeSchema,
          403: v2ErrorEnvelopeSchema,
          404: v2ErrorEnvelopeSchema,
        },
        security: [{ tenantHeader: [] }],
      },
    },
    async (req, reply) => {
      await app.requireTenantHeader(req);
      const tenant = req.tenant;
      if (!tenant) throw new AuthenticationError('Tenant authentication required');
      const body = req.body as ReturnType<typeof v2QuoteRequestSchema.parse>;

      // Stellar-only endpoint.
      const chain = numericToChainId(body.chainId);
      if (chain !== CHAIN_IDS.STELLAR) {
        throw new ValidationError(
          `This endpoint only supports Stellar (chainId 148). Got chainId: ${body.chainId}`,
        );
      }

      // Resolve identity (exactly one of walletAddress | userId | email).
      let walletAddress: string;
      let userDbId: number | null = null;
      let userEmail: string | null = null;
      let userId: string | null = null;

      if (body.walletAddress !== undefined) {
        walletAddress = body.walletAddress;
        const user = await users.findByWalletAddressAndTenantId(walletAddress, tenant.id);
        if (user) {
          userDbId = user.id;
          userEmail = user.email ?? null;
          userId = user.userId ?? null;
        }
      } else if (body.userId !== undefined) {
        const user = await users.findByUserIdAndTenantId(body.userId, tenant.id);
        if (!user) throw new NotFoundError('User');
        walletAddress = user.walletAddress;
        userDbId = user.id;
        userEmail = user.email ?? null;
        userId = user.userId ?? null;
      } else {
        const user = await users.findByEmailAndTenantId(body.email ?? '', tenant.id);
        if (!user) throw new NotFoundError('User');
        walletAddress = user.walletAddress;
        userDbId = user.id;
        userEmail = user.email ?? null;
        userId = user.userId ?? null;
      }

      // Decode QR locally.
      const qrInfo = await qrSvc.parse(body.qrString, body.country);
      const country = (body.country ?? qrInfo.country ?? 'VN') as FiatCountry;
      const fiatAmount = qrInfo.amount ?? body.amount;

      if (!FIAT_CURRENCY_BY_COUNTRY[country]) {
        throw new ValidationError(`unsupported country: ${country}`);
      }

      // Exchange rate from env (fiat units per 1 USDC).
      const { fiatPerCrypto, fiatCurrency } = getExchangeRate(country);
      const tokenDp = resolveTokenDecimals(chain, body.settlementCurrency);

      // Fee: flat bps on the crypto equivalent.
      const netCrypto = new Decimal(fiatAmount).div(fiatPerCrypto);
      const feeCrypto = netCrypto.mul(env.FEE_BPS).div(10_000);
      const totalCrypto = netCrypto.plus(feeCrypto);
      const protocolFeeUsd = feeCrypto.toFixed(2);

      const depositAddress = resolveDepositAddress(chain, body.settlementCurrency);
      const amountBaseUnits = getChainAdapter(chain).amountBaseUnits(
        body.settlementCurrency,
        totalCrypto.toFixed(tokenDp),
      );

      const quoteId = uuid();
      const orderId = uuid();
      const expiresAt = new Date(Date.now() + env.QUOTE_TTL_SECONDS * 1000);

      const stored: StoredQuote = {
        quoteId,
        orderId,
        tenantId: tenant.id,
        country,
        chain,
        token: body.settlementCurrency,
        fromAddress: walletAddress,
        depositAddress,
        fiatAmount,
        fiatCurrency,
        cryptoAmount: totalCrypto.toFixed(tokenDp),
        amountBaseUnits,
        exchangeRate: fiatPerCrypto,
        protocolFeeUsd,
        qrInfo,
        expiresAt: expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
        ...(userEmail ? { userEmail } : {}),
        ...(userId ? { userId } : {}),
        ...(userDbId !== null ? { userDbId } : {}),
      };
      await quotes.store(stored);

      return await reply.ok({
        quoteId,
        route: { routeId: 1 },
        fiatAmount,
        fiatCurrency,
        settlementAmount: totalCrypto.toFixed(tokenDp),
        settlementCurrency: body.settlementCurrency,
        chainId: body.chainId,
        exchangeRate: fiatPerCrypto.toString(),
        protocolFeeUsd,
        minimumFeeUsd: env.MIN_FEE_USD.toFixed(2),
        qrInfo,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );
};
