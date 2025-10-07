/**
 * Stake Leaderboard Service
 * 
 * Builds and caches a leaderboard of users ranked by their staked SEED amount.
 * Data is cached for 4 hours to minimize RPC calls.
 */

import { redis } from './redis';
import { getStakeInfo } from './contracts';

export interface StakeLeaderboardEntry {
  address: string;
  stakedAmount: bigint;
  rank: number;
}

const CACHE_KEY = 'stake:leaderboard:cached';
const CACHE_TTL = 4 * 60 * 60; // 4 hours in seconds

/**
 * Get unique addresses from plant and land ownership data
 */
async function getActiveUserAddresses(): Promise<string[]> {
  const addresses = new Set<string>();
  
  try {
    // Get addresses from user stats cache (tracks recent activity)
    if (redis) {
      const pattern = 'user:stats:*';
      let cursor: string | number = 0;
      
      do {
        const result = await redis.scan(cursor, { match: pattern, count: 100 }) as [string | number, string[]];
        cursor = result[0];
        const keys = result[1] as string[];
        
        for (const key of keys) {
          // Extract address from key format: user:stats:0x...
          const address = key.split(':')[2];
          if (address && address.startsWith('0x')) {
            addresses.add(address.toLowerCase());
          }
        }
      } while (cursor !== 0 && cursor !== '0');
    }
  } catch (error) {
    console.error('Error fetching user addresses from cache:', error);
  }
  
  return Array.from(addresses);
}

/**
 * Build the stake leaderboard by fetching stake info for all active users
 */
export async function buildStakeLeaderboard(): Promise<StakeLeaderboardEntry[]> {
  console.log('🔨 Building stake leaderboard...');
  
  try {
    // Get all active user addresses
    const addresses = await getActiveUserAddresses();
    
    if (addresses.length === 0) {
      console.log('⚠️ No addresses found for stake leaderboard');
      return [];
    }
    
    console.log(`📊 Fetching stake info for ${addresses.length} addresses...`);
    
    // Fetch stake info for all addresses in parallel (with batching to avoid overwhelming RPC)
    const BATCH_SIZE = 50;
    const allStakes: Array<{ address: string; staked: bigint }> = [];
    
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (address) => {
          try {
            const stakeInfo = await getStakeInfo(address);
            return {
              address,
              staked: stakeInfo?.staked || BigInt(0)
            };
          } catch (error) {
            console.error(`Error fetching stake for ${address}:`, error);
            return { address, staked: BigInt(0) };
          }
        })
      );
      allStakes.push(...batchResults);
    }
    
    // Filter out users with no stake and sort by staked amount (highest first)
    const sortedStakes = allStakes
      .filter(entry => entry.staked > BigInt(0))
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

