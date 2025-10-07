/**
 * Stake Leaderboard Service
 * 
 * Builds and caches a leaderboard of users ranked by their staked SEED amount.
 * Uses the staking contract's stakersArray to get all stakers directly.
 * Data is cached for 4 hours to minimize RPC calls.
 */

import { redis } from './redis';
import { getReadClient, STAKE_CONTRACT_ADDRESS, retryWithBackoff } from './contracts';
import { stakingAbi } from '@/public/abi/staking-abi';

export interface StakeLeaderboardEntry {
  address: string;
  stakedAmount: bigint;
  rank: number;
}

const CACHE_KEY = 'stake:leaderboard:cached';
const CACHE_TTL = 4 * 60 * 60; // 4 hours in seconds

/**
 * Get all stakers from the staking contract's stakersArray
 */
async function getAllStakersFromContract(): Promise<Array<{ address: string; staked: bigint }>> {
  const readClient = getReadClient();
  const allStakers: Array<{ address: string; staked: bigint }> = [];
  
  try {
    console.log('📡 Fetching stakers from contract stakersArray...');
    
    // Iterate through stakersArray until we get address(0) or an error
    let index = 0;
    const BATCH_SIZE = 20; // Fetch addresses in batches
    
    while (true) {
      try {
        // Fetch a batch of addresses
        const batch = await Promise.all(
          Array.from({ length: BATCH_SIZE }, (_, i) => index + i).map(async (idx) => {
            try {
              return await retryWithBackoff(async () => {
                const address = await readClient.readContract({
                  address: STAKE_CONTRACT_ADDRESS,
                  abi: stakingAbi,
                  functionName: 'stakersArray',
                  args: [BigInt(idx)],
                }) as `0x${string}`;
                return { index: idx, address };
              });
            } catch {
              return { index: idx, address: null };
            }
          })
        );
        
        // Process batch results
        let foundEnd = false;
        for (const result of batch) {
          if (!result.address || result.address === '0x0000000000000000000000000000000000000000') {
            foundEnd = true;
            break;
          }
          
          // Get stake info for this address
          try {
            const stakerInfo = await retryWithBackoff(async () => {
              return await readClient.readContract({
                address: STAKE_CONTRACT_ADDRESS,
                abi: stakingAbi,
                functionName: 'stakers',
                args: [result.address],
              }) as any;
            });
            
            const amountStaked = stakerInfo?.amountStaked || stakerInfo?.[2] || BigInt(0);
            
            if (amountStaked > BigInt(0)) {
              allStakers.push({
                address: result.address.toLowerCase(),
                staked: BigInt(amountStaked)
              });
            }
          } catch (error) {
            console.error(`Error fetching stake info for ${result.address}:`, error);
          }
        }
        
        if (foundEnd) {
          break;
        }
        
        index += BATCH_SIZE;
        
        // Safety check to prevent infinite loops
        if (index > 10000) {
          console.warn('⚠️ Reached max index limit (10000) for stakersArray');
          break;
        }
      } catch (error) {
        // If we hit an error, we've likely reached the end
        console.log(`Reached end of stakersArray at index ${index}`);
        break;
      }
    }
    
    console.log(`✅ Found ${allStakers.length} stakers from contract`);
    return allStakers;
  } catch (error) {
    console.error('Error fetching stakers from contract:', error);
    return [];
  }
}

/**
 * Build the stake leaderboard by fetching all stakers from the contract
 */
export async function buildStakeLeaderboard(): Promise<StakeLeaderboardEntry[]> {
  console.log('🔨 Building stake leaderboard from contract...');
  
  try {
    // Get all stakers directly from the contract
    const allStakers = await getAllStakersFromContract();
    
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
      })
      .map((entry, index) => ({
        address: entry.address,
        stakedAmount: entry.staked,
        rank: index + 1
      }));
    
    console.log(`✅ Built stake leaderboard with ${sortedStakes.length} stakers`);
    
    // Cache the result
    if (redis) {
      try {
        const serialized = JSON.stringify(sortedStakes, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value
        );
        await redis.setex(CACHE_KEY, CACHE_TTL, serialized);
        console.log(`💾 Cached stake leaderboard for ${CACHE_TTL / 3600} hours`);
      } catch (error) {
        console.error('Error caching stake leaderboard:', error);
      }
    }
    
    return sortedStakes;
  } catch (error) {
    console.error('Error building stake leaderboard:', error);
    return [];
  }
}

/**
 * Get the stake leaderboard (from cache if available, otherwise build it)
 */
export async function getStakeLeaderboard(): Promise<StakeLeaderboardEntry[]> {
  // Try to get from cache first
  if (redis) {
    try {
      const cached = await redis.get(CACHE_KEY);
      if (cached && typeof cached === 'string') {
        console.log('✅ Returning cached stake leaderboard');
        const parsed = JSON.parse(cached);
        // Re-hydrate bigint values
        return parsed.map((entry: any) => ({
          ...entry,
          stakedAmount: BigInt(entry.stakedAmount)
        }));
      }
    } catch (error) {
      console.error('Error reading cached stake leaderboard:', error);
    }
  }
  
  // Cache miss or error - build fresh leaderboard
  console.log('🔄 Cache miss - building fresh stake leaderboard');
  return await buildStakeLeaderboard();
}

/**
 * Force refresh the stake leaderboard (for admin use)
 */
export async function refreshStakeLeaderboard(): Promise<StakeLeaderboardEntry[]> {
  console.log('🔄 Force refreshing stake leaderboard...');
  
  // Clear cache
  if (redis) {
    try {
      await redis.del(CACHE_KEY);
    } catch (error) {
      console.error('Error clearing stake leaderboard cache:', error);
    }
  }
  
  return await buildStakeLeaderboard();
}

