/**
 * Stake Leaderboard Service
 * 
 * Builds a leaderboard of users ranked by their staked SEED amount.
 * Uses the staking contract's stakersArray to get all stakers directly.
 * Uses multicall for efficient batch fetching and short-term caching (5 minutes).
 */

import { cache, cacheSignal } from 'react';
import { getReadClient, STAKE_CONTRACT_ADDRESS } from './contracts';
import stakeAbi from '@/public/abi/stakeabi.json';
import { redis } from './redis';
import { resolvePrimaryNames } from './ens-resolver';

export interface StakeLeaderboardEntry {
  address: string;
  stakedAmount: bigint;
  rank: number;
  ensName?: string;
}

const CACHE_KEY = 'stake:leaderboard:v2';
const CACHE_TTL = 15 * 60; // 15 minutes (shared across all users)
const MIN_STAKE_THRESHOLD = BigInt(5) * BigInt(10) ** BigInt(17); // 0.5 SEED minimum

async function resolveENSBatch(addresses: string[]): Promise<Map<string, string | null>> {
  try {
    return await resolvePrimaryNames(addresses);
  } catch (error) {
    console.error('Error resolving ENS batch', error);
    return new Map(addresses.map((addr) => [addr.toLowerCase(), null] as const));
  }
}

/**
 * Get all stakers from the staking contract's stakersArray using multicall
 */
async function getAllStakersFromContractSignal(): Promise<Array<{ address: string; staked: bigint }>> {
  const signal = cacheSignal();
  return fetchStakeLeaderboard(signal ?? undefined);
}

const cachedAllStakers = cache(async () => getAllStakersFromContractSignal());

async function fetchStakeLeaderboard(signal?: AbortSignal): Promise<Array<{ address: string; staked: bigint }>> {
  const readClient = getReadClient();
  
  try {
    console.log('📡 Fetching stakers using optimized multicall...');
    const startTime = Date.now();
    
    // Step 1: First, do a binary search to find the total number of stakers
    let low = 0;
    let high = 10000;
    let totalStakers = 0;
    
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      try {
        const address = await readClient.readContract({
          address: STAKE_CONTRACT_ADDRESS,
          abi: stakeAbi as any,
          functionName: 'stakersArray',
          args: [BigInt(mid)],
        }) as `0x${string}`;
        
        if (!address || address === '0x0000000000000000000000000000000000000000') {
          high = mid - 1;
        } else {
          totalStakers = mid + 1;
          low = mid + 1;
        }
      } catch {
        high = mid - 1;
      }
    }
    
    console.log(`📊 Found ${totalStakers} total stakers`);
    
    if (totalStakers === 0) {
      return [];
    }
    
    // Step 2: Batch fetch all addresses using multicall
    const BATCH_SIZE = 100;
    const allAddresses: `0x${string}`[] = [];
    
    for (let i = 0; i < totalStakers; i += BATCH_SIZE) {
      const batchSize = Math.min(BATCH_SIZE, totalStakers - i);
      const contracts = Array.from({ length: batchSize }, (_, idx) => ({
        address: STAKE_CONTRACT_ADDRESS,
        abi: stakeAbi as any,
        functionName: 'stakersArray' as const,
        args: [BigInt(i + idx)],
      }));
      
      const results = await readClient.multicall({ contracts, allowFailure: true });
      
      for (const result of results) {
        if (result.status === 'success' && result.result) {
          allAddresses.push(result.result as `0x${string}`);
        }
      }
      
      console.log(`📦 Fetched addresses batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(totalStakers / BATCH_SIZE)}`);
    }
    
    console.log(`✅ Fetched ${allAddresses.length} addresses in ${Date.now() - startTime}ms`);
    
    // Step 3: Batch fetch stake info for all addresses using multicall
    const allStakers: Array<{ address: string; staked: bigint }> = [];
    
    for (let i = 0; i < allAddresses.length; i += BATCH_SIZE) {
      const batch = allAddresses.slice(i, i + BATCH_SIZE);
      const contracts = batch.map(addr => ({
        address: STAKE_CONTRACT_ADDRESS,
        abi: stakeAbi as any,
        functionName: 'stakers' as const,
        args: [addr],
      }));
      
      const results = await readClient.multicall({ contracts, allowFailure: true });
      
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'success' && result.result) {
          const stakerInfo = result.result as any;
          // Index 2 is amountStaked: [timeOfLastUpdate, conditionIdOflastUpdate, amountStaked, unclaimedRewards]
          const amountStaked = BigInt(stakerInfo?.[2] || 0);
          
          // Only include stakers with at least 0.5 SEED to keep leaderboard clean
          if (amountStaked >= MIN_STAKE_THRESHOLD) {
            allStakers.push({
              address: batch[j].toLowerCase(),
              staked: amountStaked
            });
          }
        }
      }
      
      console.log(`📦 Fetched stakes batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allAddresses.length / BATCH_SIZE)}`);
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`✅ Found ${allStakers.length} stakers with stake in ${totalTime}ms (avg ${(totalTime / allStakers.length).toFixed(2)}ms per staker)`);
    
    return allStakers;
  } catch (error) {
    console.error('❌ Error fetching stakers from contract:', error);
    return [];
  }
}

async function buildStakeLeaderboard(signal?: AbortSignal): Promise<StakeLeaderboardEntry[]> {
  // Try cache first
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached && typeof cached === 'string') {
        console.log('⚡ Returning cached stake leaderboard (< 5 min old)');
        const parsed = JSON.parse(cached);
        return parsed.map((entry: any) => ({
          ...entry,
          stakedAmount: BigInt(entry.stakedAmount)
        }));
      }
    } catch (error) {
      console.error('Error reading cache:', error);
    }
  }
  
  // Cache miss - fetch fresh data
  console.log('🔨 Building fresh stake leaderboard from contract...');
  
  try {
    const allStakers = await cachedAllStakers();
    
    if (allStakers.length === 0) {
      console.log('⚠️ No stakers found in contract');
      return [];
    }
    
    // Sort by staked amount (highest first)
    const sortedStakes = allStakers
      .sort((a, b) => {
        if (a.staked > b.staked) return -1;
        if (a.staked < b.staked) return 1;
        return 0;
      });
    
    console.log(`✅ Built stake leaderboard with ${sortedStakes.length} stakers`);
    
    // Resolve ENS names for all stakers
    const addresses = sortedStakes.map(s => s.address);
    const ensMap = await resolveENSBatch(addresses);
    
    // Build final leaderboard with ENS names
    const leaderboardWithENS = sortedStakes.map((entry, index) => ({
      address: entry.address,
      stakedAmount: entry.staked,
      rank: index + 1,
      ensName: ensMap.get(entry.address.toLowerCase()) || undefined
    }));
    
    // Cache for 15 minutes
    if (redis) {
      try {
        const serialized = JSON.stringify(leaderboardWithENS, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        );
        await redis.setex(CACHE_KEY, CACHE_TTL, serialized);
        console.log(`💾 Cached for ${CACHE_TTL / 60} minutes`);
      } catch (error) {
        console.error('Error caching:', error);
      }
    }
    
    return leaderboardWithENS;
  } catch (error) {
    console.error('❌ Error building stake leaderboard:', error);
    return [];
  }
}

export const getStakeLeaderboard = cache(async () => {
  const signal = cacheSignal();
  return buildStakeLeaderboard(signal ?? undefined);
});

