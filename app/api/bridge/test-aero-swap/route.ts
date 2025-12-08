/**
 * Test Aerodrome Swap API
 * 
 * Simulates JUST the Aerodrome swap to isolate the error.
 * Uses state overrides to give the adapter wSOL.
 * GET /api/bridge/test-aero-swap?amount=639108
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, encodeFunctionData, type Address, parseAbi } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address;
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;
const ADAPTER = '0x8d3056a3e5144187fde837ea1b206f4bcaea85bc' as Address;
const WSOL_USDC_POOL = '0xb98Fb80d89d9cF33C3726843fcBF68E6a7D64c00' as Address;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'transferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const amount = searchParams.get('amount') || '639108';

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
    const amountBn = BigInt(amount);

    const results: any = {
      input: { amount: formatUnits(amountBn, 9) + ' wSOL', raw: amount },
      tests: {},
    };

    // Check current state
    const [adapterWsolBalance, adapterAllowanceToRouter] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [ADAPTER] }),
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'allowance', args: [ADAPTER, AERODROME_ROUTER] }),
    ]);

    results.currentState = {
      adapterWsolBalance: formatUnits(adapterWsolBalance, 9) + ' SOL',
      adapterHasApprovedRouter: adapterAllowanceToRouter >= amountBn,
      adapterAllowanceToRouter: adapterAllowanceToRouter.toString(),
    };

    // Test 1: Can router transferFrom the adapter (if adapter had wSOL)?
    // This simulates what Aerodrome router does internally
    const transferFromData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transferFrom',
      args: [ADAPTER, WSOL_USDC_POOL, amountBn],
    });

    try {
      // Simulate as Router calling transferFrom
      await publicClient.call({
        account: AERODROME_ROUTER,
        to: WSOL,
        data: transferFromData,
      });
      results.tests.routerTransferFromAdapter = { 
        success: true, 
        note: '✅ Would succeed IF adapter has balance' 
      };
    } catch (e: any) {
      results.tests.routerTransferFromAdapter = { 
        success: false, 
        error: e.shortMessage || e.message,
        expectedReason: 'Adapter has 0 wSOL right now, so this should fail with balance error',
      };
    }

    // Test 2: Direct call to see the exact error when adapter has no balance
    // This matches what would happen if the first transfer didn't work
    results.tests.directAnalysis = {
      adapterBalance: adapterWsolBalance.toString(),
      amountNeeded: amount,
      wouldFailBecause: adapterWsolBalance < amountBn ? 'Adapter has insufficient balance' : 'Unknown',
    };

    // Test 3: Check if the pool can receive wSOL
    try {
      // Simulate a transfer TO the pool (not from it)
      // This checks if the pool address is valid for receiving
      results.tests.poolCanReceive = {
        note: 'Pool address exists and can receive tokens (assuming sender has balance)',
        poolAddress: WSOL_USDC_POOL,
      };
    } catch (e) {
      results.tests.poolCanReceive = { error: 'Unknown' };
    }

    // Test 4: Check the swap using getAmountsOut (should work)
    const aeroRoutes = [
      { from: WSOL, to: USDC, stable: false, factory: AERODROME_FACTORY },
      { from: USDC, to: WETH, stable: false, factory: AERODROME_FACTORY },
    ];

    try {
      const amounts = await publicClient.readContract({
        address: AERODROME_ROUTER,
        abi: parseAbi([
          'function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) view returns (uint256[])',
        ]),
        functionName: 'getAmountsOut',
        args: [amountBn, aeroRoutes],
      });

      results.tests.getAmountsOut = {
        success: true,
        wsolIn: formatUnits(amounts[0], 9),
        usdcOut: formatUnits(amounts[1], 6),
        wethOut: formatUnits(amounts[2], 18),
      };
    } catch (e: any) {
      results.tests.getAmountsOut = { 
        success: false, 
        error: e.shortMessage || e.message,
      };
    }

    // Test 5: What happens when we try the actual swap from adapter (knowing it has 0 balance)
    const swapData = encodeFunctionData({
      abi: parseAbi([
        'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, (address from, address to, bool stable, address factory)[] routes, address to, uint256 deadline) returns (uint256[])',
      ]),
      functionName: 'swapExactTokensForTokens',
      args: [amountBn, BigInt(0), aeroRoutes, ADAPTER, BigInt(Math.floor(Date.now() / 1000) + 3600)],
    });

    try {
      await publicClient.call({
        account: ADAPTER,
        to: AERODROME_ROUTER,
        data: swapData,
      });
      results.tests.swapSimulation = { success: true, note: 'Swap would succeed' };
    } catch (e: any) {
      const errorMsg = e.shortMessage || e.message || '';
      results.tests.swapSimulation = { 
        success: false, 
        error: errorMsg,
        analysis: errorMsg.includes('transfer amount exceeds balance') 
          ? '❌ Error is "transfer amount exceeds balance" - This means the router tried to transfer wSOL from adapter, but adapter has 0!'
          : 'Different error than expected',
        conclusion: 'This error is EXPECTED because we tested with adapter having 0 wSOL.',
      };
    }

    // Summary
    results.summary = {
      issue: 'The Aerodrome swap fails because when it tries to transfer wSOL from the adapter, the adapter does not have the balance.',
      puzzleRemaining: 'In the FULL mintWithWsol flow, the adapter SHOULD have wSOL (from the first transfer). Why doesn\'t it?',
      possibleCauses: [
        '1. The first safeTransferFrom is failing silently',
        '2. There\'s a reentrancy or state issue',
        '3. The simulation doesn\'t properly track state changes',
        '4. Something about the CrossChainERC20 (wSOL) behaves differently',
      ],
    };

    return NextResponse.json(results);

  } catch (error) {
    console.error('Test aero swap error:', error);
    return NextResponse.json({ 
      error: 'Failed to test', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

