"use client";

import { useEffect, useState } from "react";

import type { TransactionCall } from "@/lib/types";
import {
  PIXOTCHI_TOKEN_ADDRESS,
  UNISWAP_ROUTER_ADDRESS,
  WETH_ADDRESS,
} from "@/lib/contracts";

/**
 * Shared pieces of the ETH-mode swap bundles.
 *
 * Five components (swap-mint, swap-land-mint, swap-buy-item, swap-fence-purchase,
 * swap-plant-name) each carried their own byte-identical copy of the router ABI,
 * the ERC-20 approve ABI, the max-approval constant and the first two calls of the
 * batch. Only the approve spender and the trailing action call ever differed.
 */

export const UNISWAP_ROUTER_ABI = [
  {
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactETHForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

export const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/** Unlimited ERC-20 approval (2^256 - 1). */
export const MAX_UINT256 = BigInt(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935",
);

/** How far ahead of "now" the router deadline is set. */
export const SWAP_DEADLINE_SECONDS = 60 * 10;

/** How often the deadline is refreshed while a bundle is mounted and usable. */
const DEADLINE_REFRESH_MS = 60_000;

function currentDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS);
}

/**
 * A router deadline that stays close to "now".
 *
 * This exists because of a real bug, not for tidiness. Every bundle computed
 *
 *   const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
 *
 * INSIDE a `useMemo` whose dependencies were all time-invariant (address, amounts,
 * ids). React returns the cached value while deps are unchanged, and nothing
 * refreshes the ETH quote on a timer, so the deadline was frozen at the moment the
 * screen was first rendered. A user who opened the mint screen, then spent more
 * than ten minutes there — easy, since <Activity> preserves tab state across tab
 * switches — would submit a batch whose swap had already expired.
 * UniswapV2Router's `ensure(deadline)` modifier reverts with
 * "UniswapV2Router: EXPIRED", so the user pays gas for a guaranteed failure.
 *
 * Ticking bounds staleness to one minute, so the deadline at click time is always
 * between 9 and 10 minutes out. The interval only runs while `enabled` is true
 * (i.e. the bundle actually has a usable quote), so idle screens cost nothing.
 */
export function useSwapDeadline(enabled: boolean): bigint {
  const [deadline, setDeadline] = useState<bigint>(currentDeadline);

  useEffect(() => {
    if (!enabled) return;

    // Refresh immediately on becoming enabled, then on a slow tick.
    setDeadline(currentDeadline());

    const id = window.setInterval(() => {
      setDeadline(currentDeadline());
    }, DEADLINE_REFRESH_MS);

    return () => window.clearInterval(id);
  }, [enabled]);

  return deadline;
}

// Matches lib/types.ts TransactionCall so the result drops straight into
// SmartWalletTransaction without a cast at any call site.
export type SwapBundleCall = TransactionCall;

/**
 * Calls 1 and 2 of every ETH-mode bundle: swap ETH into SEED, then approve the
 * SEED spender for the action that follows.
 *
 * Emits exactly the shape the five components built by hand, so downstream
 * encoding and builder-code attribution are unchanged.
 */
export function buildSwapAndApproveCalls({
  address,
  deadline,
  ethAmount,
  minSeedOut,
  spender,
}: {
  address: `0x${string}`;
  deadline: bigint;
  ethAmount: bigint;
  minSeedOut: bigint;
  spender: string;
}): SwapBundleCall[] {
  return [
    // Call 1: Swap ETH -> SEED
    {
      address: UNISWAP_ROUTER_ADDRESS as `0x${string}`,
      abi: UNISWAP_ROUTER_ABI,
      functionName: "swapExactETHForTokens",
      args: [minSeedOut, [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS], address, deadline] as UntypedValue[],
      value: ethAmount,
    },
    // Call 2: Approve SEED for the action contract
    {
      address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [spender, MAX_UINT256] as UntypedValue[],
    },
  ];
}
