import type { ChainId } from '@gaian-stellar-integration/config';

export interface EncodeTransferInput {
  readonly chain: ChainId;
  readonly token: string;
  readonly fromAddress: string;
  readonly toAddress: string;
  readonly amount: string;
  readonly memo?: string;
}

export interface EncodeTransferResult {
  readonly chain: ChainId;
  readonly encodedTransaction: string;
  readonly format: 'stellar-xdr';
  readonly tokenAddress?: string;
  readonly decimals: number;
  readonly amountBaseUnits: string;
}

export interface VerifyTransferInput {
  readonly chain: ChainId;
  readonly token: string;
  readonly txHash: string;
  readonly expectedToAddress: string;
  readonly expectedFromAddress?: string;
  readonly minAmountBaseUnits: string;
  readonly memo?: string;
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
