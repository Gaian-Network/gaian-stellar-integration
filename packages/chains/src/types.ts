import type { ChainId } from '@gaian-stellar-integration/config';

export interface EncodeTransferInput {
  readonly chain: ChainId;
  readonly token: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amount: string;
  readonly memo?: string;
  // Stellar only. 'XLM' builds a path payment that spends XLM and delivers the
  // exact USDC `amount`; absent or 'USDC' builds a plain USDC payment.
  readonly sourceAsset?: StellarSourceAsset;
  // Stellar only. ISO time the order expires; written as the tx max time so the
  // network rejects a signature that arrives later.
  readonly expiresAt?: string;
}

export type StellarSourceAsset = 'USDC' | 'XLM';

export interface StellarPathPaymentQuote {
  readonly sourceAsset: 'XLM';
  // Most XLM the consumer can be debited: live path quote plus the slippage cap.
  readonly sendMax: string;
  readonly quotedSourceAmount: string;
  readonly slippageBps: number;
  // Intermediate assets of the chosen path, as 'native' or 'CODE:ISSUER'.
  readonly path: readonly string[];
}

export interface EncodeTransferResult {
  readonly chain: ChainId;
  readonly encodedTransaction: string;
  readonly format: 'stellar-xdr';
  readonly tokenAddress?: string;
  readonly decimals: number;
  readonly amountBaseUnits: string;
  readonly stellar?: {
    // Hex hash of the built tx. Signing does not change it.
    readonly txHash: string;
    // Unix seconds; the tx is invalid in any ledger that closes after it.
    readonly maxTime?: number;
    readonly pathPayment?: StellarPathPaymentQuote;
  };
}

export interface VerifyTransferInput {
  readonly chain: ChainId;
  readonly token: string;
  readonly txHash: string;
  readonly expectedToAddress: string;
  readonly expectedFromAddress?: string;
  readonly minAmountBaseUnits: string;
  readonly memo?: string;
  // Stellar only. Max time (unix seconds) the order's tx was built with. Lets
  // verify tell "not landed yet" from "can never land" once it has passed.
  readonly maxTime?: number;
  // Stellar only. Hash of the tx Gaian built for the order. Expiry is decided
  // only for that tx, never for some other hash a client reports.
  readonly builtTxHash?: string;
}

export type VerifyTransferResult =
  | {
      readonly ok: true;
      readonly chain: ChainId;
      readonly txHash: string;
      readonly amountBaseUnits: string;
      readonly fromAddress: string;
      readonly toAddress: string;
      readonly confirmedAt: string;
    }
  | {
      readonly ok: false;
      readonly chain: ChainId;
      readonly txHash: string;
      readonly reason: string;
    };

export interface ChainAdapter {
  readonly id: ChainId;
  encode(input: EncodeTransferInput): Promise<EncodeTransferResult>;
  // Base-unit amount only — same conversion encode() uses, but no RPC/tx build.
  // For callers (e.g. quote) that need the amount but not the encoded tx.
  amountBaseUnits(token: string, amount: string): string;
  verify(input: VerifyTransferInput): Promise<VerifyTransferResult>;
}
