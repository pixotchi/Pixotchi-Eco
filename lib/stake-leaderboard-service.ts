/**
 * Stake Leaderboard Service
 * 
 * Builds a leaderboard of users ranked by their staked SEED amount.
 * Uses the staking contract's stakersArray to get all stakers directly.
 * Always fetches fresh data, just like plants and lands leaderboards.
 */

import { getReadClient, STAKE_CONTRACT_ADDRESS } from './contracts';
import stakeAbi from '@/public/abi/stakeabi.json';

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
          abi: stakeAbi as any,
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
            abi: stakeAbi as any,
            functionName: 'stakers',
            args: [address],
          }) as any;
          
          console.log(`💰 Staker ${address}:`, stakerInfo);
          
          // The stakers mapping returns a struct with these fields:
          // [timeOfLastUpdate, conditionIdOflastUpdate, amountStaked, unclaimedRewards]
          // Based on your example: ["1727036679", "0", "600", "3737724537784581944"]
          // Index 2 is amountStaked
          const amountStaked = BigInt(stakerInfo?.[2] || stakerInfo?.amountStaked || 0);
          
          console.log(`💰 Amount staked: ${amountStaked.toString()}`);
          
          if (amountStaked > BigInt(0)) {
            allStakers.push({
              address: address.toLowerCase(),
              staked: amountStaked
            });
            console.log(`✅ Added staker ${address} with ${amountStaked.toString()} staked`);
          } else {
            console.log(`⏭️ Skipping ${address} - no stake`);
          }
        } catch (error) {
          console.error(`❌ Error fetching stake info for ${address}:`, error);
        }
        
        index++;
      } catch (error) {
        // If we hit an error, we've likely reached the end
        console.log(`✅ Reached end of stakersArray at index ${index} (error thrown)`, error);
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

