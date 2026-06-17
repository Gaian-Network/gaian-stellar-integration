import { z } from 'zod';

import { decodedQrInfoSchema } from './qr.js';

export const cryptoTransferInfoSchema = z.object({
  chain: z.string(),
  fromAddress: z.string(),
  toAddress: z.string(),
  token: z.string(),
  amount: z.number(),
  encodedTransaction: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type CryptoTransferInfo = z.infer<typeof cryptoTransferInfoSchema>;

export const bankTransactionReferenceSchema = z.object({
  requestId: z.string().optional(),
  requestDate: z.string().optional(),
});

export type BankTransactionReference = z.infer<typeof bankTransactionReferenceSchema>;

export const cryptoOrderSchema = z.object({
  id: z.number().optional(),
  orderId: z.string(),
  tenantId: z.number(),
  status: z.string(),
  fiatAmount: z.number(),
  fiatCurrency: z.string(),
  cryptoAmount: z.number(),
  cryptoCurrency: z.string(),
  exchangeRate: z.number(),
  isPrefunded: z.boolean().optional(),
  routeId: z.number().optional(),
  qrInfo: decodedQrInfoSchema,
  cryptoTransferInfo: cryptoTransferInfoSchema,
  userId: z.number().optional(),
  paymentMethod: z.string().optional(),
  transactionHash: z.string().optional(),
  bankTransactionReference: bankTransactionReferenceSchema.optional(),
  walletAddress: z.string().optional(),
  expiresAt: z.date().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
  protocolFee: z.number().optional(),
  feeShare: z.number().optional(),
  tenantFeeShare: z.number().optional(),
  providerCharge: z.number().optional(),
});

export type CryptoOrder = z.infer<typeof cryptoOrderSchema>;

export const orderStatusSchema = z.enum([
  'pending',
  'payment_received',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export type OrderStatus = z.infer<typeof orderStatusSchema>;
