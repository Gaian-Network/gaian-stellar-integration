import { env } from './env.js';

export const CHAIN_IDS = {
  STELLAR: 'stellar',
} as const;

export type ChainId = (typeof CHAIN_IDS)[keyof typeof CHAIN_IDS];

const CHAIN_VALUES = Object.values(CHAIN_IDS) as readonly string[];

export const isChainId = (value: string): value is ChainId => CHAIN_VALUES.includes(value);

// Stellar's SLIP-44 coin type, used so V2 callers pass one numeric field.
export const NUMERIC_CHAIN_ID: Record<ChainId, number> = {
  [CHAIN_IDS.STELLAR]: 148,
};

const CHAIN_ID_BY_NUMERIC: Record<number, ChainId> = Object.fromEntries(
  Object.entries(NUMERIC_CHAIN_ID).map(([name, num]) => [num, name]),
) as Record<number, ChainId>;

export const chainIdToNumeric = (chain: ChainId): number => NUMERIC_CHAIN_ID[chain];

export const numericToChainId = (numeric: number): ChainId | undefined =>
  CHAIN_ID_BY_NUMERIC[numeric];

export const SUPPORTED_TOKENS = ['USDC'] as const;
export type SupportedToken = (typeof SUPPORTED_TOKENS)[number];

const isSupportedToken = (value: string): value is SupportedToken =>
  (SUPPORTED_TOKENS as readonly string[]).includes(value);

export const resolveDepositAddress = (chain: ChainId, token: string): string => {
  const upperToken = token.toUpperCase();
  if (!isSupportedToken(upperToken)) {
    throw new Error(`unsupported token for deposit: ${token}`);
  }
  const key = `DEPOSIT_ADDRESS_${chain.toUpperCase()}_${upperToken}` as keyof typeof env;
  const address = env[key] as string | undefined;
  if (!address) {
    throw new Error(`deposit address not configured for ${chain}/${upperToken}`);
  }
  return address;
};

// Stellar USDC uses 7 decimals (Circle's official asset).
export const resolveTokenDecimals = (_chain: ChainId, token: string): number => {
  const upperToken = token.toUpperCase();
  if (!isSupportedToken(upperToken)) {
    throw new Error(`unsupported token: ${token}`);
  }
  return 7;
};

// Stellar assets identified by code:issuer pair.
export const resolveTokenAddress = (_chain: ChainId, token: string): string => {
  const upperToken = token.toUpperCase();
  if (upperToken === 'USDC') return `${env.STELLAR_USDC_CODE}:${env.STELLAR_USDC_ISSUER}`;
  throw new Error(`no token address configured for stellar/${token}`);
};
