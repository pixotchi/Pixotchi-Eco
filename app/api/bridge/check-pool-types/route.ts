/**
 * Check Pool Types API
 * 
 * Verifies that the Aerodrome pools are the correct type (stable vs volatile).
 * The adapter hardcodes stable: false, so pools MUST be volatile.
 * GET /api/bridge/check-pool-types
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;

const FACTORY_ABI = [
  { name: 'getPool', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }, { type: 'bool' }], outputs: [{ type: 'address' }] },
  { name: 'isPool', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
] as const;

const POOL_ABI = [
  { name: 'stable', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'factory', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export async function GET(request: NextRequest) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const results: any = {
      adapterExpects: { poolType: 'volatile (stable: false)' },
      pools: {},
      issues: [],
    };

    // Check wSOL/USDC volatile pool
    const wsolUsdcVolatile = await publicClient.readContract({
      address: AERODROME_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [WSOL, USDC, false], // stable = false
    });

    const wsolUsdcStable = await publicClient.readContract({
      address: AERODROME_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [WSOL, USDC, true], // stable = true
    });

    results.pools.wsolUsdc = {
      volatilePool: wsolUsdcVolatile !== ZERO_ADDRESS ? wsolUsdcVolatile : null,
      stablePool: wsolUsdcStable !== ZERO_ADDRESS ? wsolUsdcStable : null,
      adapterWouldUse: 'volatile',
      exists: wsolUsdcVolatile !== ZERO_ADDRESS,
    };

    if (wsolUsdcVolatile === ZERO_ADDRESS) {
      results.issues.push('❌ wSOL/USDC VOLATILE pool does NOT exist! Adapter expects volatile but none exists.');
      if (wsolUsdcStable !== ZERO_ADDRESS) {
        results.issues.push('⚠️ A STABLE wSOL/USDC pool exists but adapter is configured for volatile');
      }
    }

    // Check USDC/WETH volatile pool
    const usdcWethVolatile = await publicClient.readContract({
      address: AERODROME_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [USDC, WETH, false], // stable = false
    });

    const usdcWethStable = await publicClient.readContract({
      address: AERODROME_FACTORY,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [USDC, WETH, true], // stable = true
    });

    results.pools.usdcWeth = {
      volatilePool: usdcWethVolatile !== ZERO_ADDRESS ? usdcWethVolatile : null,
      stablePool: usdcWethStable !== ZERO_ADDRESS ? usdcWethStable : null,
      adapterWouldUse: 'volatile',
      exists: usdcWethVolatile !== ZERO_ADDRESS,
    };

    if (usdcWethVolatile === ZERO_ADDRESS) {
      results.issues.push('❌ USDC/WETH VOLATILE pool does NOT exist! Adapter expects volatile but none exists.');
      if (usdcWethStable !== ZERO_ADDRESS) {
        results.issues.push('⚠️ A STABLE USDC/WETH pool exists but adapter is configured for volatile');
      }
    }

    // If volatile pools exist, check their actual properties
    if (wsolUsdcVolatile !== ZERO_ADDRESS) {
      try {
        const isStable = await publicClient.readContract({ 
          address: wsolUsdcVolatile, 
          abi: POOL_ABI, 
          functionName: 'stable' 
        });
        const poolFactory = await publicClient.readContract({ 
          address: wsolUsdcVolatile, 
          abi: POOL_ABI, 
          functionName: 'factory' 
        });
        
        results.pools.wsolUsdc.poolDetails = {
          isActuallyStable: isStable,
          poolFactory: poolFactory,
          factoryMatch: poolFactory.toLowerCase() === AERODROME_FACTORY.toLowerCase(),
        };
        
        if (isStable) {
          results.issues.push('❌ wSOL/USDC pool returned by factory is actually STABLE, not volatile!');
        }
        if (poolFactory.toLowerCase() !== AERODROME_FACTORY.toLowerCase()) {
          results.issues.push(`⚠️ wSOL/USDC pool factory (${poolFactory}) doesn't match expected (${AERODROME_FACTORY})`);
        }
      } catch (e) {
        results.pools.wsolUsdc.poolDetails = { error: 'Could not read pool properties' };
      }
    }

    if (usdcWethVolatile !== ZERO_ADDRESS) {
      try {
        const isStable = await publicClient.readContract({ 
          address: usdcWethVolatile, 
          abi: POOL_ABI, 
          functionName: 'stable' 
        });
        const poolFactory = await publicClient.readContract({ 
          address: usdcWethVolatile, 
          abi: POOL_ABI, 
          functionName: 'factory' 
        });
        
        results.pools.usdcWeth.poolDetails = {
          isActuallyStable: isStable,
          poolFactory: poolFactory,
          factoryMatch: poolFactory.toLowerCase() === AERODROME_FACTORY.toLowerCase(),
        };
        
        if (isStable) {
          results.issues.push('❌ USDC/WETH pool returned by factory is actually STABLE, not volatile!');
        }
        if (poolFactory.toLowerCase() !== AERODROME_FACTORY.toLowerCase()) {
          results.issues.push(`⚠️ USDC/WETH pool factory (${poolFactory}) doesn't match expected (${AERODROME_FACTORY})`);
        }
      } catch (e) {
        results.pools.usdcWeth.poolDetails = { error: 'Could not read pool properties' };
      }
    }

    // Summary
    results.diagnosis = results.issues.length > 0 
      ? `Found ${results.issues.length} issue(s) with pool configuration`
      : '✅ All pools exist and are the correct type';

    return NextResponse.json(results);

  } catch (error) {
    console.error('Check pool types error:', error);
    return NextResponse.json({ 
      error: 'Failed to check pool types', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

