/**
 * Batch Limits Diagnostic API
 * 
 * Tests the practical limits for batch transactions by estimating gas
 * for different batch sizes of villageClaimProduction calls.
 * 
 * GET /api/admin/batch-limits?address=0x...&maxBatch=50
 * 
 * Returns gas estimates for batch sizes from 1 to maxBatch
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { LAND_CONTRACT_ADDRESS, getLandsByOwner, getLandBuildingsBatch } from '@/lib/contracts';

// Base block gas limit (as of 2024)
const BASE_BLOCK_GAS_LIMIT = 30_000_000n;

// Known limits to report
const KNOWN_LIMITS = {
  baseBlockGas: BASE_BLOCK_GAS_LIMIT,
  // Coinbase Smart Wallet uses bundler, which has practical limits
  // No official documented limit, but ~50-100 calls seems safe
  smartWalletRecommended: 50,
  // RPC simulation typically times out around 100-200 calls
  rpcSimulationSafe: 100,
  // Conservative recommendation based on testing
  recommendedBatchSize: 25,
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get('address');
  const maxBatchParam = searchParams.get('maxBatch');
  const maxBatch = maxBatchParam ? Math.min(parseInt(maxBatchParam), 100) : 50;

  if (!address) {
    return NextResponse.json({
      error: 'Address required',
      usage: '/api/admin/batch-limits?address=0x...&maxBatch=50',
      knownLimits: KNOWN_LIMITS,
    }, { status: 400 });
  }

  try {
    const client = createPublicClient({
      chain: base,
      transport: http(),
    });

    // Get user's lands and their claimable buildings
    const lands = await getLandsByOwner(address);
    
    if (lands.length === 0) {
      return NextResponse.json({
        error: 'No lands found for address',
        address,
        knownLimits: KNOWN_LIMITS,
      });
    }

    // Get all buildings across all lands
    const landIds = lands.map(l => l.tokenId);
    const buildingResults = await getLandBuildingsBatch(landIds);

    // Collect all claimable items
    interface ClaimableItem {
      landId: bigint;
      buildingId: number;
      points: bigint;
      lifetime: bigint;
    }
    
    const claimableItems: ClaimableItem[] = [];
    buildingResults.forEach(result => {
      result.villageBuildings.forEach((b: any) => {
        const id = Number(b.id);
        const points = BigInt(b.accumulatedPoints || 0);
        const lifetime = BigInt(b.accumulatedLifetime || 0);
        
        // Production buildings only (0: Solar, 3: Soil, 5: Bee)
        if ((id === 0 || id === 3 || id === 5) && (points > 0n || lifetime > 0n)) {
          claimableItems.push({
            landId: result.landId,
            buildingId: id,
            points,
            lifetime
          });
        }
      });
    });

    if (claimableItems.length === 0) {
      return NextResponse.json({
        message: 'No claimable buildings found',
        lands: lands.length,
        knownLimits: KNOWN_LIMITS,
        suggestion: 'Wait for buildings to accumulate production, or test with mock data',
      });
    }

    // Test different batch sizes
    const batchSizesToTest = [1, 5, 10, 15, 20, 25, 30, 40, 50].filter(n => n <= maxBatch && n <= claimableItems.length);
    
    const results: {
      batchSize: number;
      gasEstimate: string;
      gasPerCall: string;
      fitsInBlock: boolean;
      recommendedMax: number;
      error?: string;
    }[] = [];

    for (const batchSize of batchSizesToTest) {
      const batchItems = claimableItems.slice(0, batchSize);
      
      // Encode calls for gas estimation
      const calls = batchItems.map(item => ({
        to: LAND_CONTRACT_ADDRESS as `0x${string}`,
        data: encodeFunctionData({
          abi: landAbi,
          functionName: 'villageClaimProduction',
          args: [item.landId, item.buildingId],
        }),
      }));

      try {
        // Estimate gas for the batch
        // Note: For smart wallet batching, gas is estimated differently,
        // but this gives us a baseline for each call's complexity
        let totalGas = 0n;
        
        for (const call of calls) {
          try {
            const gas = await client.estimateGas({
              account: address as `0x${string}`,
              to: call.to,
              data: call.data,
            });
            totalGas += gas;
          } catch (e) {
            // If estimation fails, use a conservative estimate
            totalGas += 100_000n;
          }
        }

        const gasPerCall = totalGas / BigInt(batchSize);
        const fitsInBlock = totalGas < BASE_BLOCK_GAS_LIMIT;
        
        // Calculate recommended max based on gas per call
        // Leave 20% headroom for smart wallet overhead
        const recommendedMax = Number((BASE_BLOCK_GAS_LIMIT * 80n / 100n) / gasPerCall);

        results.push({
          batchSize,
          gasEstimate: totalGas.toString(),
          gasPerCall: gasPerCall.toString(),
          fitsInBlock,
          recommendedMax: Math.min(recommendedMax, 100), // Cap at 100 for safety
        });
      } catch (error: any) {
        results.push({
          batchSize,
          gasEstimate: 'FAILED',
          gasPerCall: 'N/A',
          fitsInBlock: false,
          recommendedMax: 0,
          error: error.message?.slice(0, 100),
        });
      }
    }

    // Calculate recommended batch size
    const successfulResults = results.filter(r => r.gasEstimate !== 'FAILED');
    const avgGasPerCall = successfulResults.length > 0
      ? successfulResults.reduce((acc, r) => acc + BigInt(r.gasPerCall), 0n) / BigInt(successfulResults.length)
      : 80_000n;

    // Smart wallet overhead: ~21k base + ~5k per call for bundler
    const smartWalletOverhead = 21_000n + 5_000n * BigInt(maxBatch);
    const safeGasLimit = BASE_BLOCK_GAS_LIMIT - smartWalletOverhead;
    const calculatedMaxBatch = Number(safeGasLimit / avgGasPerCall);

    // Apply conservative limits
    const finalRecommendation = Math.min(
      calculatedMaxBatch,
      50, // Max 50 for RPC simulation safety
      claimableItems.length // Can't batch more than we have
    );

    return NextResponse.json({
      address,
      landsCount: lands.length,
      claimableBuildings: claimableItems.length,
      knownLimits: KNOWN_LIMITS,
      gasEstimates: results,
      analysis: {
        avgGasPerCall: avgGasPerCall.toString(),
        smartWalletOverheadEstimate: smartWalletOverhead.toString(),
        baseBlockGasLimit: BASE_BLOCK_GAS_LIMIT.toString(),
        calculatedMaxBatch,
        finalRecommendation,
        reasoning: [
          `Average gas per villageClaimProduction: ~${avgGasPerCall.toString()} gas`,
          `Base block gas limit: 30M`,
          `Smart wallet adds ~21k base + ~5k per call overhead`,
          `Calculated safe max: ${calculatedMaxBatch} calls`,
          `Applied safety margin: ${finalRecommendation} calls recommended`,
          `Note: RPC simulation may fail before gas limits hit (timeout)`,
        ],
      },
      recommendation: {
        maxBatchSize: finalRecommendation,
        totalBatches: Math.ceil(claimableItems.length / finalRecommendation),
        message: claimableItems.length <= finalRecommendation
          ? 'All buildings can be claimed in a single batch!'
          : `Split into ${Math.ceil(claimableItems.length / finalRecommendation)} batches of ${finalRecommendation}`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      error: 'Failed to analyze batch limits',
      details: error.message,
      knownLimits: KNOWN_LIMITS,
    }, { status: 500 });
  }
}
