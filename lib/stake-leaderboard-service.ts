/**
 * Stake Leaderboard Service
 * 
 * Builds a leaderboard of users ranked by their staked SEED amount.
 * Uses the staking contract's stakersArray to get all stakers directly.
 * Uses multicall for efficient batch fetching and shared caching (15 minutes).
 */

import { getReadClient, STAKE_CONTRACT_ADDRESS, type PixotchiReadClient } from './contracts';
import { readStakeLeaderboard } from './stake-leaderboard-read';
import { redis } from './redis';
import { resolvePrimaryNames } from './ens-resolver';
import { z } from 'zod';

export interface StakeLeaderboardEntry {
  address: string;
  stakedAmount: bigint;
  rank: number;
  ensName?: string;
}

const CACHE_KEY = 'stake:leaderboard:v3';
const CACHE_TTL = 15 * 60; // 15 minutes (shared across all users)

const cachedStakeLeaderboardSchema = z.array(z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  ensName: z.string().nullable().optional(),
  rank: z.number().int().positive(),
  stakedAmount: z.union([
    z.string().regex(/^(0|[1-9]\d*)$/),
    z.bigint().nonnegative(),
  ]),
}));

/**
 * Upstash deserializes JSON by default, while other Redis-compatible clients
 * return the serialized string. Decode either representation once and only
 * return entries that can safely be restored to the public API shape.
 */
export function parseCachedStakeLeaderboard(value: unknown): StakeLeaderboardEntry[] | null {
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  const parsed = cachedStakeLeaderboardSchema.safeParse(candidate);
  if (!parsed.success) return null;

  try {
    return parsed.data.map((entry) => ({
      address: entry.address,
      ...(entry.ensName ? { ensName: entry.ensName } : {}),
      rank: entry.rank,
      stakedAmount: typeof entry.stakedAmount === 'bigint'
        ? entry.stakedAmount
        : BigInt(entry.stakedAmount),
    }));
  } catch {
    return null;
  }
}

async function resolveENSBatch(addresses: string[]): Promise<Map<string, string | null>> {
  try {
    return await resolvePrimaryNames(addresses);
  } catch (error) {
    console.error('Error resolving ENS batch', error);
    return new Map(addresses.map((addr) => [addr.toLowerCase(), null] as const));
  }
}

/** Only complete, fixed-block snapshots may enter the shared 15-minute cache. */
export async function getStakeLeaderboard(
  readClient: PixotchiReadClient = getReadClient(),
): Promise<StakeLeaderboardEntry[]> {
  if (redis) {
    try {
      const parsed = parseCachedStakeLeaderboard(await redis.get(CACHE_KEY));
      if (parsed) return parsed;
    } catch {
      // An unavailable cache may be bypassed; an unavailable chain may not.
      console.warn('Stake leaderboard cache read unavailable');
    }
  }
  const allStakers = await readStakeLeaderboard(readClient, STAKE_CONTRACT_ADDRESS);
  allStakers.sort((a, b) => a.staked === b.staked ? a.address.localeCompare(b.address) : a.staked > b.staked ? -1 : 1);
  const names = await resolveENSBatch(allStakers.map(entry => entry.address));
  const leaderboard = allStakers.map((entry, index) => ({
    address: entry.address,
    stakedAmount: entry.staked,
    rank: index + 1,
    ensName: names.get(entry.address) || undefined,
  }));
  if (redis) {
    try {
      await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(leaderboard, (_, value) =>
        typeof value === 'bigint' ? value.toString() : value));
    } catch {
      console.warn('Stake leaderboard cache write unavailable');
    }
  }
  return leaderboard;
}
