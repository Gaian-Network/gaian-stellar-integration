import { env } from '@gaian-stellar-integration/config';

import type { ChainId } from '@gaian-stellar-integration/config';
import type { DecodedQrInfo } from '@gaian-stellar-integration/core';
import type Redis from 'ioredis';

export interface StoredQuote {
  readonly quoteId: string;
  readonly orderId: string;
  readonly tenantId: number;
  readonly country: string;
  readonly chain: ChainId;
  readonly token: string;
  readonly fromAddress: string;
  readonly depositAddress: string;
  readonly fiatAmount: number;
  readonly fiatCurrency: string;
  readonly cryptoAmount: string;
  readonly amountBaseUnits: string;
  readonly exchangeRate: number;
  readonly protocolFeeUsd: string;
  readonly qrInfo: DecodedQrInfo;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly userEmail?: string | null;
  readonly userId?: string | null;
  readonly userDbId?: number | null;
}

const keyFor = (quoteId: string): string => `stellar:quote:${quoteId}`;
const orderKeyFor = (orderId: string): string => `stellar:quote-by-order:${orderId}`;

export interface QuoteService {
  store(quote: StoredQuote): Promise<void>;
  get(quoteId: string): Promise<StoredQuote | null>;
  getByOrderId(orderId: string): Promise<StoredQuote | null>;
  consumeByOrderId(orderId: string): Promise<StoredQuote | null>;
}

export const createQuoteService = (redis: Redis): QuoteService => ({
  async store(quote): Promise<void> {
    const ttl = env.QUOTE_TTL_SECONDS;
    const payload = JSON.stringify(quote);
    await redis
      .pipeline()
      .set(keyFor(quote.quoteId), payload, 'EX', ttl)
      .set(orderKeyFor(quote.orderId), quote.quoteId, 'EX', ttl)
      .exec();
  },

  async get(quoteId): Promise<StoredQuote | null> {
    const raw = await redis.get(keyFor(quoteId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredQuote;
  },

  async getByOrderId(orderId): Promise<StoredQuote | null> {
    const quoteId = await redis.get(orderKeyFor(orderId));
    if (!quoteId) return null;
    return await this.get(quoteId);
  },

  async consumeByOrderId(orderId): Promise<StoredQuote | null> {
    const quoteId = await redis.getdel(orderKeyFor(orderId));
    if (!quoteId) return null;
    const raw = await redis.getdel(keyFor(quoteId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredQuote;
  },
});
