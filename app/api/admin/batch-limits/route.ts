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

// Base per-transaction gas limits
// Pre-Fusaka: 25,000,000 gas per transaction
// Post-Fusaka (EIP-7825, ~Jan 2026): 16,777,216 gas (2^24)
// See: https://docs.base.org/chain/gas-limit
const PRE_FUSAKA_TX_GAS_LIMIT = BigInt(25_000_000);
const POST_FUSAKA_TX_GAS_LIMIT = BigInt(16_777_216); // 2^24

// Use the post-Fusaka limit since it's the current constraint on mainnet
const PER_TX_GAS_LIMIT = POST_FUSAKA_TX_GAS_LIMIT;

// Known limits to report
const KNOWN_LIMITS = {
  // Per-transaction gas limit (NOT block gas limit)
  perTxGasLimit: PER_TX_GAS_LIMIT.toString(),
  preFusakaLimit: PRE_FUSAKA_TX_GAS_LIMIT.toString(),
  postFusakaLimit: POST_FUSAKA_TX_GAS_LIMIT.toString(),
  // Coinbase Smart Wallet bundler must fit within per-tx limit
  // Bundler adds overhead: ~21k base + ~5-10k per call
  smartWalletOverheadBase: 21_000,
  smartWalletOverheadPerCall: 5_000,
  // RPC simulation typically times out around 100-200 calls
  rpcSimulationSafe: 100,
  // Conservative recommendation based on gas limits
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
        if ((id === 0 || id === 3 || id === 5) && (points > BigInt(0) || lifetime > BigInt(0))) {
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
      fitsInTxLimit: boolean;
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
        let totalGas = BigInt(0);
        
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
            totalGas += BigInt(100_000);
          }
        }

        const gasPerCall = totalGas / BigInt(batchSize);
        const fitsInTxLimit = totalGas < PER_TX_GAS_LIMIT;
        
        // Calculate recommended max based on gas per call
        // Leave 20% headroom for smart wallet bundler overhead
        const recommendedMax = Number((PER_TX_GAS_LIMIT * BigInt(80) / BigInt(100)) / gasPerCall);

        results.push({
          batchSize,
          gasEstimate: totalGas.toString(),
          gasPerCall: gasPerCall.toString(),
          fitsInTxLimit,
          recommendedMax: Math.min(recommendedMax, 100), // Cap at 100 for safety
        });
      } catch (error: any) {
        results.push({
          batchSize,
          gasEstimate: 'FAILED',
          gasPerCall: 'N/A',
          fitsInTxLimit: false,
          recommendedMax: 0,
          error: error.message?.slice(0, 100),
        });
      }
    }

    // Calculate recommended batch size
    const successfulResults = results.filter(r => r.gasEstimate !== 'FAILED');
    const avgGasPerCall = successfulResults.length > 0
      ? successfulResults.reduce((acc, r) => acc + BigInt(r.gasPerCall), BigInt(0)) / BigInt(successfulResults.length)
      : BigInt(80_000);

    // Smart wallet bundler overhead: ~21k base + ~5k per call
    // Must fit within per-transaction gas limit (16.77M post-Fusaka)
    const smartWalletOverhead = BigInt(21_000) + BigInt(5_000) * BigInt(maxBatch);
    const safeGasLimit = PER_TX_GAS_LIMIT - smartWalletOverhead;
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
        perTxGasLimit: PER_TX_GAS_LIMIT.toString(),
        safeGasLimit: safeGasLimit.toString(),
        calculatedMaxBatch,
        finalRecommendation,
        reasoning: [
          `Average gas per villageClaimProduction: ~${avgGasPerCall.toString()} gas`,
          `Per-transaction gas limit (post-Fusaka EIP-7825): 16.77M`,
          `Smart wallet bundler adds ~21k base + ~5k per call overhead`,
          `Safe gas budget after overhead: ${safeGasLimit.toString()}`,
          `Calculated safe max: ${calculatedMaxBatch} calls`,
          `Applied safety margin: ${finalRecommendation} calls recommended`,
          `Note: RPC simulation may also timeout before gas limits hit`,
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
