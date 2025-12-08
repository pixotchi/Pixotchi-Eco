/**
 * Check Twin Status API
 * 
 * Checks wSOL balance and allowances for a Twin address.
 * GET /api/bridge/check-twin?twin=<address>&adapter=<address>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;
const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const twin = searchParams.get('twin') as Address;
  const adapter = searchParams.get('adapter') as Address;

  if (!twin) {
    return NextResponse.json({ error: 'Missing twin parameter' }, { status: 400 });
  }

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const [balance, decimals] = await Promise.all([
      publicClient.readContract({
        address: WSOL,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [twin],
      }),
      publicClient.readContract({
        address: WSOL,
        abi: ERC20_ABI,
        functionName: 'decimals',
      }),
    ]);

    let allowance = BigInt(0);
    if (adapter) {
      allowance = await publicClient.readContract({
        address: WSOL,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [twin, adapter],
      });
    }

    return NextResponse.json({
      twin,
      adapter: adapter || 'not specified',
      wsolContract: WSOL,
      wsolBalance: {
        raw: balance.toString(),
        formatted: formatUnits(balance, decimals),
        decimals,
      },
      allowanceToAdapter: adapter ? {
        raw: allowance.toString(),
        formatted: formatUnits(allowance, decimals),
        isZero: allowance === BigInt(0),
      } : null,
      diagnosis: allowance === BigInt(0) && adapter 
        ? '❌ ZERO ALLOWANCE: Twin has NOT approved adapter to spend wSOL. This is the bug!'
        : allowance > BigInt(0) 
          ? '✅ Allowance exists - approval is not the issue'
          : 'Specify adapter address to check allowance',
    });

  } catch (error) {
    console.error('Check twin error:', error);
    return NextResponse.json({ 
      error: 'Failed to check twin', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

