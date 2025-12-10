/**
 * Simulate Mint API
 * 
 * Simulates the mintWithWsol call to see where it would fail.
 * GET /api/bridge/simulate-mint?twin=<address>&strain=4&wsolAmount=639108&minSeedOut=10000000000000000000
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, encodeFunctionData, decodeFunctionResult, formatUnits, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const ADAPTER = '0x8d3056a3e5144187fde837ea1b206f4bcaea85bc' as Address;

const ADAPTER_ABI = [
  {
    name: 'mintWithWsol',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'strain', type: 'uint256' },
      { name: 'wsolAmount', type: 'uint256' },
      { name: 'minSeedOut', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const twin = searchParams.get('twin') as Address;
  const strain = searchParams.get('strain') || '4';
  const wsolAmount = searchParams.get('wsolAmount') || '639108';
  const minSeedOut = searchParams.get('minSeedOut') || '10000000000000000000';

  if (!twin) {
    return NextResponse.json({ error: 'Missing twin parameter' }, { status: 400 });
  }

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    // Pre-check: Twin's wSOL balance
    const twinBalance = await publicClient.readContract({
      address: WSOL,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [twin],
    });

    // Pre-check: Twin's allowance to adapter
    const twinAllowance = await publicClient.readContract({
      address: WSOL,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [twin, ADAPTER],
    });

    const wsolAmountBn = BigInt(wsolAmount);
    
    const preChecks = {
      twinWsolBalance: formatUnits(twinBalance, 9) + ' SOL',
      twinWsolBalanceRaw: twinBalance.toString(),
      requiredWsol: formatUnits(wsolAmountBn, 9) + ' SOL',
      requiredWsolRaw: wsolAmount,
      hasEnoughBalance: twinBalance >= wsolAmountBn,
      twinAllowanceToAdapter: twinAllowance.toString(),
      hasEnoughAllowance: twinAllowance >= wsolAmountBn,
    };

    if (!preChecks.hasEnoughBalance) {
      return NextResponse.json({
        error: 'INSUFFICIENT_BALANCE',
        message: `Twin only has ${formatUnits(twinBalance, 9)} wSOL but needs ${formatUnits(wsolAmountBn, 9)}`,
        preChecks,
      });
    }

    if (!preChecks.hasEnoughAllowance) {
      return NextResponse.json({
        error: 'INSUFFICIENT_ALLOWANCE',
        message: `Twin has only approved ${twinAllowance} but needs ${wsolAmount}`,
        preChecks,
      });
    }

    // Build the call data
    const calldata = encodeFunctionData({
      abi: ADAPTER_ABI,
      functionName: 'mintWithWsol',
      args: [BigInt(strain), BigInt(wsolAmount), BigInt(minSeedOut)],
    });

    // Simulate the call FROM the twin address
    let simulationResult: any;
    try {
      simulationResult = await publicClient.call({
        account: twin, // Simulate as if Twin is calling
        to: ADAPTER,
        data: calldata,
        gas: BigInt(2000000), // 2M gas for simulation
      });
      
      return NextResponse.json({
        success: true,
        message: '✅ Simulation PASSED - the call would succeed!',
        preChecks,
        simulation: {
          from: twin,
          to: ADAPTER,
          data: calldata,
          result: simulationResult,
        },
      });
    } catch (simError: any) {
      // Extract revert reason
      let revertReason = 'Unknown';
      if (simError.cause?.data) {
        revertReason = simError.cause.data;
      } else if (simError.message) {
        revertReason = simError.message;
      } else if (simError.shortMessage) {
        revertReason = simError.shortMessage;
      }

      return NextResponse.json({
        success: false,
        error: 'SIMULATION_FAILED',
        message: '❌ Simulation FAILED - the call would revert!',
        revertReason,
        preChecks,
        simulation: {
          from: twin,
          to: ADAPTER,
          function: 'mintWithWsol',
          args: {
            strain,
            wsolAmount: formatUnits(BigInt(wsolAmount), 9) + ' SOL',
            minSeedOut: formatUnits(BigInt(minSeedOut), 18) + ' SEED',
          },
        },
        fullError: JSON.stringify(simError, Object.getOwnPropertyNames(simError), 2),
      });
    }

  } catch (error) {
    console.error('Simulate mint error:', error);
    return NextResponse.json({ 
      error: 'Failed to simulate', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

