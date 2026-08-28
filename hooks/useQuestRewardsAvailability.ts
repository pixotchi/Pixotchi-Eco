"use client";

import { useQuery } from "@tanstack/react-query";
import { parseUnits } from "viem";
import {
  ERC20_BALANCE_ABI,
  LAND_CONTRACT_ADDRESS,
  LEAF_CONTRACT_ADDRESS,
  PIXOTCHI_TOKEN_ADDRESS,
  getQuestRewardSources,
  getReadClient,
  type QuestRewardSources,
} from "@/lib/contracts";

/**
 * Minimum float the quest reward wallet must hold (and have approved to the Land
 * diamond) before the UI will let a player start a quest or open a loot bag.
 *
 * Sized to one worst-case Hard payout so a player is never sent into a quest the
 * pool cannot settle. `finalizeQuest` transfers from the reward wallet, and an
 * insufficient balance reverts the whole transaction.
 */
export const MIN_SEED_REWARDS_BALANCE = parseUnits("300", 18);
export const MIN_LEAF_REWARDS_BALANCE = parseUnits("492750", 18);

const REWARDS_REFRESH_INTERVAL_MS = 30_000;

export type QuestRewardsAvailability = {
  isLoading: boolean;
  /** True once the pool has actually been read. Gate actions on this. */
  isReady: boolean;
  /** True when quests should be blocked because the reward pool cannot settle. */
  isUnavailable: boolean;
  leafAllowance: bigint;
  leafBalance: bigint;
  seedAllowance: bigint;
  seedBalance: bigint;
  sources: QuestRewardSources | null;
};

type QuestRewardsSnapshot = {
  leafAllowance: bigint;
  leafBalance: bigint;
  seedAllowance: bigint;
  seedBalance: bigint;
  sources: QuestRewardSources;
};

async function readQuestRewardsSnapshot(): Promise<QuestRewardsSnapshot> {
  const readClient = getReadClient();

  // The payer is whatever the diamond has in storage, which
  // `setQuestRewardsWallet` can rotate at any time. Resolving it per read means
  // a rotation can never leave this gate inspecting a stale, empty wallet.
  const sources = await getQuestRewardSources(readClient);

  const results = await readClient.multicall({
    allowFailure: true,
    contracts: [
      {
        abi: ERC20_BALANCE_ABI,
        address: PIXOTCHI_TOKEN_ADDRESS,
        args: [sources.seed],
        functionName: "balanceOf" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: PIXOTCHI_TOKEN_ADDRESS,
        args: [sources.seed, LAND_CONTRACT_ADDRESS],
        functionName: "allowance" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: LEAF_CONTRACT_ADDRESS,
        args: [sources.leaf],
        functionName: "balanceOf" as const,
      },
      {
        abi: ERC20_BALANCE_ABI,
        address: LEAF_CONTRACT_ADDRESS,
        args: [sources.leaf, LAND_CONTRACT_ADDRESS],
        functionName: "allowance" as const,
      },
    ],
  });

  const value = (index: number): bigint => {
    const entry = results[index];
    return entry?.status === "success" ? (entry.result as bigint) : BigInt(0);
  };

  return {
    leafAllowance: value(3),
    leafBalance: value(2),
    seedAllowance: value(1),
    seedBalance: value(0),
    sources,
  };
}

/**
 * Shared Farmer House reward-pool gate.
 *
 * Both the per-land quest panel and the batch send panel read through this so
 * they can never disagree about whether quests are runnable.
 */
export function useQuestRewardsAvailability(enabled: boolean = true): QuestRewardsAvailability {
  const query = useQuery<QuestRewardsSnapshot>({
    enabled,
    gcTime: 5 * 60_000,
    queryFn: readQuestRewardsSnapshot,
    queryKey: ["quest-rewards-availability"],
    refetchInterval: enabled ? REWARDS_REFRESH_INTERVAL_MS : false,
    staleTime: REWARDS_REFRESH_INTERVAL_MS,
  });

  const data = query.data;
  const seedBalance = data?.seedBalance ?? BigInt(0);
  const seedAllowance = data?.seedAllowance ?? BigInt(0);
  const leafBalance = data?.leafBalance ?? BigInt(0);
  const leafAllowance = data?.leafAllowance ?? BigInt(0);

  return {
    isLoading: query.isPending,
    // Split "not read yet" from "read and insufficient" so the amber refilling
    // banner never flashes on a cold load, while callers still refuse to submit
    // until the pool is actually known. Submitting blind risks a revert.
    isReady: Boolean(data),
    isUnavailable: data
      ? seedBalance < MIN_SEED_REWARDS_BALANCE ||
        seedAllowance < MIN_SEED_REWARDS_BALANCE ||
        leafBalance < MIN_LEAF_REWARDS_BALANCE ||
        leafAllowance < MIN_LEAF_REWARDS_BALANCE
      : false,
    leafAllowance,
    leafBalance,
    seedAllowance,
    seedBalance,
    sources: data?.sources ?? null,
  };
}
