/**
 * Stake Leaderboard Service
 * 
 * Builds a leaderboard of users ranked by their staked SEED amount.
 * Uses the staking contract's stakersArray to get all stakers directly.
 * Always fetches fresh data, just like plants and lands leaderboards.
 */

import { getReadClient, STAKE_CONTRACT_ADDRESS, retryWithBackoff } from './contracts';
import { stakingAbi } from '@/public/abi/staking-abi';

export interface StakeLeaderboardEntry {
  address: string;
  stakedAmount: bigint;
  rank: number;
}

/**
 * Get all stakers from the staking contract's stakersArray
 */
async function getAllStakersFromContract(): Promise<Array<{ address: string; staked: bigint }>> {
  const readClient = getReadClient();
  const allStakers: Array<{ address: string; staked: bigint }> = [];
  
  try {
    console.log('📡 Fetching stakers from contract stakersArray...');
    
    // Try to iterate through stakersArray
    let index = 0;
    
    while (index < 10000) { // Safety limit
      try {
        const address = await readClient.readContract({
          address: STAKE_CONTRACT_ADDRESS,
          abi: stakingAbi,
          functionName: 'stakersArray',
          args: [BigInt(index)],
        }) as `0x${string}`;
        
        console.log(`📍 Index ${index}: ${address}`);
        
        // Check if we've reached the end (address(0) or error)
        if (!address || address === '0x0000000000000000000000000000000000000000') {
          console.log(`✅ Reached end of stakersArray at index ${index}`);
          break;
        }
        
        // Get stake info for this address
        try {
          const stakerInfo = await readClient.readContract({
            address: STAKE_CONTRACT_ADDRESS,
            abi: stakingAbi,
            functionName: 'stakers',
            args: [address],
          }) as any;
          
          console.log(`💰 Staker ${address}:`, stakerInfo);
          
          // The stakers mapping returns a struct with these fields:
          // [timeOfLastUpdate, conditionIdOflastUpdate, amountStaked, unclaimedRewards]
          const amountStaked = stakerInfo?.amountStaked || stakerInfo?.[2] || BigInt(0);
          
          if (amountStaked > BigInt(0)) {
            allStakers.push({
              address: address.toLowerCase(),
              staked: BigInt(amountStaked)
            });
            console.log(`✅ Added staker ${address} with ${amountStaked.toString()} staked`);
          }
        } catch (error) {
          console.error(`❌ Error fetching stake info for ${address}:`, error);
        }
        
        index++;
      } catch (error) {
        // If we hit an error, we've likely reached the end
        console.log(`✅ Reached end of stakersArray at index ${index} (error thrown)`);
        break;
      }
    }
    
    console.log(`✅ Found ${allStakers.length} stakers from contract`);
    return allStakers;
  } catch (error) {
    console.error('❌ Error fetching stakers from contract:', error);
    return [];
  }
}

/**
 * Get the stake leaderboard - always fetches fresh data from contract
 */
export async function getStakeLeaderboard(): Promise<StakeLeaderboardEntry[]> {
  console.log('🔨 Building fresh stake leaderboard from contract...');
  
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
    return sortedStakes;
  } catch (error) {
    console.error('❌ Error building stake leaderboard:', error);
    return [];
  }
}

