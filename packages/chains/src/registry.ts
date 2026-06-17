import { CHAIN_IDS, type ChainId } from "@gaian-stellar-integration/config";

import { stellarAdapter } from "./stellar.js";

import type { ChainAdapter } from "./types.js";

const ADAPTERS: Partial<Record<ChainId, ChainAdapter>> = {
  [CHAIN_IDS.STELLAR]: stellarAdapter,
};

export const getChainAdapter = (chain: ChainId): ChainAdapter => {
  const adapter = ADAPTERS[chain];
  if (!adapter) throw new Error(`unsupported chain: ${chain}`);
  return adapter;
};
