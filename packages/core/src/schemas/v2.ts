import { z } from 'zod';

import { decodedQrInfoSchema } from '../types/index.js';

// Canonical V2 success envelope: { success:true, requestId, data, pagination? }.
export const v2OkEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.literal(true),
    requestId: z.string(),
    data,
  });

// Canonical V2 error envelope: { success:false, requestId, error:{code,message,details?} }.
export const v2ErrorEnvelopeSchema = z.object({
  success: z.literal(false),
  requestId: z.string(),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const v2ChainSchema = z.enum(['stellar']);

export type V2Chain = z.infer<typeof v2ChainSchema>;

export const v2ParseQrRequestSchema = z.object({
  qrString: z.string().min(1),
  country: z.string().min(2).optional(),
  // Optional identity — only needed to decode provider QRs that require the
  // caller's customer id (e.g. PromptPay/KHQR/QRPH). Ignored for plain QRs.
  walletAddress: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

export type V2ParseQrRequest = z.infer<typeof v2ParseQrRequestSchema>;

// Response data is the decoded QR info (qrInfo fields at data root).
export const v2ParseQrResponseSchema = decodedQrInfoSchema;

export const v2QuoteRequestSchema = z
  .object({
    qrString: z.string().min(1),
    amount: z.number().positive(),
    country: z.string().length(2).optional(),
    chainId: z.number().int(),
    settlementCurrency: z.string().min(1),
    walletAddress: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .refine(
    (b) =>
      [b.walletAddress, b.userId, b.email].filter((v) => v !== undefined).length === 1,
    { message: 'provide exactly one of walletAddress, userId, email' },
  );

export type V2QuoteRequest = z.infer<typeof v2QuoteRequestSchema>;

export const v2QuoteResponseSchema = z.object({
  quoteId: z.string(),
  route: z.object({
    routeId: z.number().int(),
  }),
  fiatAmount: z.number(),
  fiatCurrency: z.string(),
  settlementAmount: z.string(),
  settlementCurrency: z.string(),
  chainId: z.number().int(),
  exchangeRate: z.string(),
  protocolFeeUsd: z.string(),
  minimumFeeUsd: z.string(),
  qrInfo: decodedQrInfoSchema,
  expiresAt: z.string(),
});

export type V2QuoteResponse = z.infer<typeof v2QuoteResponseSchema>;

export const v2PlaceOrderRequestSchema = z.object({
  quoteId: z.string().min(1),
  // Stellar USDC orders only. 'XLM' returns a path payment: the consumer spends
  // XLM and the deposit address receives the exact USDC of the order.
  sourceAsset: z.enum(['USDC', 'XLM']).optional(),
});

export type V2PlaceOrderRequest = z.infer<typeof v2PlaceOrderRequestSchema>;

export const v2PlaceOrderResponseSchema = z.object({
  orderId: z.string(),
  status: z.number().int(),
  statusLabel: z.string(),
  chainId: z.number().int(),
  depositAddress: z.string(),
  tokenAddress: z.string(),
  settlementAmount: z.string(),
  settlementAmountBaseUnits: z.string(),
  settlementCurrency: z.string(),
  encodedTransaction: z.string(),
  expiresAt: z.string(),
  memo: z.string().optional(),
  // Present on XLM-paid Stellar orders: the asset the wallet spends and the most
  // of it the transaction can debit (live path quote plus the 1% slippage cap).
  sourceAsset: z.enum(['XLM']).optional(),
  sendMax: z.string().optional(),
});

export type V2PlaceOrderResponse = z.infer<typeof v2PlaceOrderResponseSchema>;

export const v2VerifyRequestSchema = z.object({
  transactionHash: z.string().min(1),
});

export type V2VerifyRequest = z.infer<typeof v2VerifyRequestSchema>;

export const v2VerifyResponseSchema = z.object({
  orderId: z.string(),
  status: z.number().int(),
  statusLabel: z.string(),
  transactionHash: z.string(),
  message: z.string(),
  // Machine-readable failure cause. ORDER_EXPIRED: the order expired before its
  // payment landed, and the transaction's time bound means it never can.
  reasonCode: z.string().optional(),
});

export type V2VerifyResponse = z.infer<typeof v2VerifyResponseSchema>;

export const v2StatusResponseSchema = z.object({
  orderId: z.string(),
  status: z.number().int(),
  statusLabel: z.string(),
  chainId: z.number().int(),
  depositAddress: z.string().optional(),
  transactionHash: z.string().optional(),
  fiatAmount: z.number(),
  fiatCurrency: z.string(),
  settlementAmount: z.string(),
  settlementCurrency: z.string(),
  exchangeRate: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type V2StatusResponse = z.infer<typeof v2StatusResponseSchema>;
