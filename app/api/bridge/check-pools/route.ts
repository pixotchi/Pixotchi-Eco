/**
 * Check Aerodrome/BaseSwap Pool Status API
 * 
 * Verifies that the swap pools exist and have liquidity.
 * GET /api/bridge/check-pools
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as Address;
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;

const FACTORY_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'stable', type: 'bool' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

const POOL_ABI = [
  { name: 'getReserves', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

export async function GET(request: NextRequest) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const results: any = {
      pools: {},
      issues: [],
    };

    // Check wSOL/USDC pool (volatile)
    try {
      const wsolUsdcPool = await publicClient.readContract({
        address: AERODROME_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [WSOL, USDC, false],
      });

      if (wsolUsdcPool === '0x0000000000000000000000000000000000000000') {
        results.pools.wsolUsdc = { exists: false, address: null };
        results.issues.push('❌ wSOL/USDC volatile pool does NOT exist on Aerodrome!');
      } else {
        // Get reserves
        const [reserve0, reserve1] = await publicClient.readContract({
          address: wsolUsdcPool,
          abi: POOL_ABI,
          functionName: 'getReserves',
        });

        const token0 = await publicClient.readContract({ address: wsolUsdcPool, abi: POOL_ABI, functionName: 'token0' });
        
        const isWsolToken0 = token0.toLowerCase() === WSOL.toLowerCase();
        const wsolReserve = isWsolToken0 ? reserve0 : reserve1;
        const usdcReserve = isWsolToken0 ? reserve1 : reserve0;

        results.pools.wsolUsdc = {
          exists: true,
          address: wsolUsdcPool,
          wsolReserve: formatUnits(wsolReserve, 9) + ' wSOL',
          usdcReserve: formatUnits(usdcReserve, 6) + ' USDC',
          wsolReserveRaw: wsolReserve.toString(),
          usdcReserveRaw: usdcReserve.toString(),
        };

        if (wsolReserve < BigInt(1000000)) { // Less than 0.001 SOL
          results.issues.push('⚠️ wSOL/USDC pool has very low wSOL liquidity');
        }
      }
    } catch (e) {
      results.pools.wsolUsdc = { error: e instanceof Error ? e.message : 'Unknown error' };
      results.issues.push('❌ Failed to check wSOL/USDC pool');
    }

    // Check USDC/WETH pool (volatile)
    try {
      const usdcWethPool = await publicClient.readContract({
        address: AERODROME_FACTORY,
        abi: FACTORY_ABI,
        functionName: 'getPool',
        args: [USDC, WETH, false],
      });

      if (usdcWethPool === '0x0000000000000000000000000000000000000000') {
        results.pools.usdcWeth = { exists: false, address: null };
        results.issues.push('❌ USDC/WETH volatile pool does NOT exist on Aerodrome!');
      } else {
        const [reserve0, reserve1] = await publicClient.readContract({
          address: usdcWethPool,
          abi: POOL_ABI,
          functionName: 'getReserves',
        });

        const token0 = await publicClient.readContract({ address: usdcWethPool, abi: POOL_ABI, functionName: 'token0' });
        
        const isUsdcToken0 = token0.toLowerCase() === USDC.toLowerCase();
        const usdcReserve = isUsdcToken0 ? reserve0 : reserve1;
        const wethReserve = isUsdcToken0 ? reserve1 : reserve0;

        results.pools.usdcWeth = {
          exists: true,
          address: usdcWethPool,
          usdcReserve: formatUnits(usdcReserve, 6) + ' USDC',
          wethReserve: formatUnits(wethReserve, 18) + ' WETH',
        };
      }
    } catch (e) {
      results.pools.usdcWeth = { error: e instanceof Error ? e.message : 'Unknown error' };
      results.issues.push('❌ Failed to check USDC/WETH pool');
    }

    // Check WETH/SEED pool on BaseSwap (UniswapV2)
    // BaseSwap factory: 0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB
    const BASESWAP_FACTORY = '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB' as Address;
    
    try {
      const wethSeedPool = await publicClient.readContract({
        address: BASESWAP_FACTORY,
        abi: [{ name: 'getPair', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'address' }] }],
        functionName: 'getPair',
        args: [WETH, SEED],
      });

      if (wethSeedPool === '0x0000000000000000000000000000000000000000') {
        results.pools.wethSeed = { exists: false, address: null };
        results.issues.push('❌ WETH/SEED pair does NOT exist on BaseSwap!');
      } else {
        const [reserve0, reserve1] = await publicClient.readContract({
          address: wethSeedPool,
          abi: POOL_ABI,
          functionName: 'getReserves',
        });

        const token0 = await publicClient.readContract({ address: wethSeedPool, abi: POOL_ABI, functionName: 'token0' });
        
        const isWethToken0 = token0.toLowerCase() === WETH.toLowerCase();
        const wethReserve = isWethToken0 ? reserve0 : reserve1;
        const seedReserve = isWethToken0 ? reserve1 : reserve0;

        results.pools.wethSeed = {
          exists: true,
          address: wethSeedPool,
          wethReserve: formatUnits(wethReserve, 18) + ' WETH',
          seedReserve: formatUnits(seedReserve, 18) + ' SEED',
        };
      }
    } catch (e) {
      results.pools.wethSeed = { error: e instanceof Error ? e.message : 'Unknown error' };
      results.issues.push('❌ Failed to check WETH/SEED pool');
    }

    results.diagnosis = results.issues.length > 0 
      ? `Found ${results.issues.length} potential issue(s)`
      : '✅ All pools exist and appear to have liquidity';

    return NextResponse.json(results);

  } catch (error) {
    console.error('Check pools error:', error);
    return NextResponse.json({ 
      error: 'Failed to check pools', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

