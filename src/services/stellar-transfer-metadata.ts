import type { EncodeTransferResult, StellarPathPaymentQuote } from '@gaian-stellar-integration/chains';

/**
 * What the order route keeps about a Stellar tx in app_crypto_transfers.metadata
 * (jsonb, so no migration). `maxTime` is the tx time bound: verify needs it to
 * tell an order that expired unpaid from a payment still on its way.
 * `pathPayment` records that the consumer paid in XLM and the most XLM they
 * signed for.
 */
export interface StellarTransferMetadata {
  readonly stellar: {
    readonly txHash: string;
    readonly maxTime?: number;
    readonly pathPayment?: StellarPathPaymentQuote;
  };
}

export const stellarTransferMetadata = (
  encoded: EncodeTransferResult,
): StellarTransferMetadata | undefined => {
  const s = encoded.stellar;
  if (!s) return undefined;
  return {
    stellar: {
      txHash: s.txHash,
      ...(s.maxTime !== undefined ? { maxTime: s.maxTime } : {}),
      ...(s.pathPayment !== undefined ? { pathPayment: s.pathPayment } : {}),
    },
  };
};

const stellarBlock = (metadata: unknown): Record<string, unknown> | undefined => {
  if (typeof metadata !== 'object' || metadata === null) return undefined;
  const stellar = (metadata as { stellar?: unknown }).stellar;
  return typeof stellar === 'object' && stellar !== null
    ? (stellar as Record<string, unknown>)
    : undefined;
};

// Rows written before time bounds existed carry no maxTime (their tx expired
// 300 s after build, later than the order), so they must answer undefined and
// keep the old retryable verify behaviour.
export const stellarMaxTimeFromMetadata = (metadata: unknown): number | undefined => {
  const maxTime = stellarBlock(metadata)?.['maxTime'];
  return typeof maxTime === 'number' && Number.isSafeInteger(maxTime) && maxTime > 0
    ? maxTime
    : undefined;
};

export const stellarBuiltTxHashFromMetadata = (metadata: unknown): string | undefined => {
  const txHash = stellarBlock(metadata)?.['txHash'];
  return typeof txHash === 'string' && /^[0-9a-f]{64}$/i.test(txHash) ? txHash : undefined;
};
