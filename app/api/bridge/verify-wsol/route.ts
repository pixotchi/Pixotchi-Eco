/**
 * Verify wSOL Token Match API
 * 
 * Checks if the wSOL in the Aerodrome LP pool is the same as the bridge's wSOL.
 * GET /api/bridge/verify-wsol
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';

// Segment config: Always fetch fresh onchain data
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

// The wSOL we're trying to use (from Base-Solana bridge)
const BRIDGE_WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;

// The Aerodrome wSOL/USDC pool
const WSOL_USDC_POOL = '0xb98Fb80d89d9cF33C3726843fcBF68E6a7D64c00' as Address;

const POOL_ABI = [
  { name: 'token0', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'token1', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const;

const ERC20_ABI = [
  { name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

export async function GET(request: NextRequest) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    // Get tokens in the pool
    const [token0, token1] = await Promise.all([
      publicClient.readContract({ address: WSOL_USDC_POOL, abi: POOL_ABI, functionName: 'token0' }),
      publicClient.readContract({ address: WSOL_USDC_POOL, abi: POOL_ABI, functionName: 'token1' }),
    ]);

    // Get token info for both
    const [token0Name, token0Symbol, token0Decimals, token1Name, token1Symbol, token1Decimals] = await Promise.all([
      publicClient.readContract({ address: token0, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: token0, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: token0, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 0),
      publicClient.readContract({ address: token1, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: token1, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: token1, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 0),
    ]);

    // Get bridge wSOL info
    const [bridgeWsolName, bridgeWsolSymbol, bridgeWsolDecimals] = await Promise.all([
      publicClient.readContract({ address: BRIDGE_WSOL, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: BRIDGE_WSOL, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'Unknown'),
      publicClient.readContract({ address: BRIDGE_WSOL, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 0),
    ]);

    // Check if bridge wSOL matches either token in the pool
    const isToken0Match = token0.toLowerCase() === BRIDGE_WSOL.toLowerCase();
    const isToken1Match = token1.toLowerCase() === BRIDGE_WSOL.toLowerCase();
    const hasMatch = isToken0Match || isToken1Match;

    // Identify which token is wSOL and which is USDC in the pool
    const poolWsol = isToken0Match ? token0 : (isToken1Match ? token1 : null);
    const poolOther = isToken0Match ? token1 : token0;

    return NextResponse.json({
      bridgeWsol: {
        address: BRIDGE_WSOL,
        name: bridgeWsolName,
        symbol: bridgeWsolSymbol,
        decimals: bridgeWsolDecimals,
      },
      pool: {
        address: WSOL_USDC_POOL,
        token0: {
          address: token0,
          name: token0Name,
          symbol: token0Symbol,
          decimals: token0Decimals,
          isBridgeWsol: isToken0Match,
        },
        token1: {
          address: token1,
          name: token1Name,
          symbol: token1Symbol,
          decimals: token1Decimals,
          isBridgeWsol: isToken1Match,
        },
      },
      verification: {
        bridgeWsolInPool: hasMatch,
        matchedToken: hasMatch ? (isToken0Match ? 'token0' : 'token1') : 'NONE',
        diagnosis: hasMatch
          ? '✅ Bridge wSOL IS in the pool - token addresses match!'
          : '❌ MISMATCH! The pool uses a DIFFERENT wSOL token than the bridge!',
      },
      critical: !hasMatch ? {
        issue: 'TOKEN MISMATCH',
        explanation: 'The Aerodrome wSOL/USDC pool uses a different wSOL token than what the bridge produces.',
        bridgeProduces: BRIDGE_WSOL,
        poolExpects: token0Symbol?.toLowerCase().includes('sol') ? token0 : token1,
        solution: 'Need to find a pool that uses the bridge\'s wSOL, or create one.',
      } : null,
    });

  } catch (error) {
    console.error('Verify wSOL error:', error);
    return NextResponse.json({
      error: 'Failed to verify wSOL',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

