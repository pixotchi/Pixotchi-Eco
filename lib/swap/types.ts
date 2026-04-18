import type { Address, Hex } from 'viem';

export type SwapTokenId =
  | 'ETH'
  | 'WETH'
  | 'USDC'
  | 'SEED'
  | 'JESSE'
  | 'PIXOTCHI';

export type UserSwapTokenId = Exclude<SwapTokenId, 'WETH'>;

export type SwapStrategy =
  | 'blocked'
  | 'single_kyber'
  | 'single_baseswap_seed'
  | 'two_step_via_weth';

export type SwapStepKind = 'kyber' | 'baseswap_seed';

export interface SwapTokenDefinition {
  id: SwapTokenId;
  symbol: string;
  displaySymbol: string;
  name: string;
  decimals: number;
  chainId: number;
  address: Address | null;
  image: string;
  isNative?: boolean;
  isInternal?: boolean;
}

export interface SwapQuoteStep {
  key: 'step1' | 'step2';
  kind: SwapStepKind;
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: string;
  expectedOut: string;
  minOut: string;
  taxBps: number;
  marketSlippageBps: number;
  routeLabel: string;
  routeSources: string[];
  warnings: string[];
  approvalTarget?: Address;
  grossOut?: string;
  effectiveIn?: string;
}

export interface SwapQuoteResponse {
  strategy: SwapStrategy;
  sellToken: UserSwapTokenId;
  buyToken: UserSwapTokenId;
  amountIn: string;
  expectedOut: string;
  minOut: string;
  taxBps: number;
  marketSlippageBps: number;
  warnings: string[];
  steps: SwapQuoteStep[];
  blockedReason?: string;
  intermediateToken?: SwapTokenId;
}

export interface SwapBuildTransaction {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
}

export interface SwapApprovalRequirement {
  token: Address;
  spender: Address;
  requiredAmount: string;
}

export interface SwapBuildStepResponse {
  step: SwapQuoteStep;
  approval: SwapApprovalRequirement | null;
  transaction: SwapBuildTransaction;
}
