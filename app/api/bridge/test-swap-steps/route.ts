/**
 * Test Swap Steps API
 * 
 * Tests each swap step individually to find where the error occurs.
 * GET /api/bridge/test-swap-steps?wsolAmount=639108
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, encodeFunctionData, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as Address;
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address;
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;
const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' as Address;
const ADAPTER = '0x8d3056a3e5144187fde837ea1b206f4bcaea85bc' as Address;
const TWIN = '0x71256e3d36435b0cc7ac41a43ee123d2aab43275' as Address;

// A whale address with tokens (for simulation testing)
const WETH_WHALE = '0x4200000000000000000000000000000000000006' as Address; // WETH contract itself

const AERODROME_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokens',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'routes', type: 'tuple[]', components: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'stable', type: 'bool' },
        { name: 'factory', type: 'address' },
      ]},
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'routes', type: 'tuple[]', components: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'stable', type: 'bool' },
        { name: 'factory', type: 'address' },
      ]},
    ],
    outputs: [{ type: 'uint256[]' }],
  },
] as const;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const wsolAmount = searchParams.get('wsolAmount') || '639108';

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
    const wsolAmountBn = BigInt(wsolAmount);

    const results: any = {
      input: { wsolAmount: formatUnits(wsolAmountBn, 9) + ' SOL', raw: wsolAmount },
      steps: {},
    };

    // Step 0: Check adapter's current state
    const [adapterWsolBalance, adapterWsolAllowance, adapterWethBalance, adapterWethAllowance] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [ADAPTER] }),
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'allowance', args: [ADAPTER, AERODROME_ROUTER] }),
      publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [ADAPTER] }),
      publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'allowance', args: [ADAPTER, BASESWAP_ROUTER] }),
    ]);

    results.adapterState = {
      wsolBalance: formatUnits(adapterWsolBalance, 9) + ' SOL',
      wsolAllowanceToAerodrome: adapterWsolAllowance > BigInt(0) ? 'approved' : 'NOT approved ❌',
      wethBalance: formatUnits(adapterWethBalance, 18) + ' WETH',
      wethAllowanceToBaseSwap: adapterWethAllowance > BigInt(0) ? 'approved' : 'NOT approved ❌',
    };

    // Step 1: Test getAmountsOut for Aerodrome (wSOL → USDC → WETH)
    const aeroRoutes = [
      { from: WSOL, to: USDC, stable: false, factory: AERODROME_FACTORY },
      { from: USDC, to: WETH, stable: false, factory: AERODROME_FACTORY },
    ];

    try {
      const aeroAmounts = await publicClient.readContract({
        address: AERODROME_ROUTER,
        abi: AERODROME_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [wsolAmountBn, aeroRoutes],
      });

      results.steps.aerodromeQuote = {
        success: true,
        input: formatUnits(wsolAmountBn, 9) + ' wSOL',
        usdcOutput: formatUnits(aeroAmounts[1], 6) + ' USDC',
        wethOutput: formatUnits(aeroAmounts[2], 18) + ' WETH',
      };
    } catch (e) {
      results.steps.aerodromeQuote = {
        success: false,
        error: e instanceof Error ? e.message : 'Unknown error',
      };
    }

    // Step 2: Try to simulate the ACTUAL Aerodrome swap from adapter
    // This requires the adapter to have wSOL, which it won't in a clean simulation
    // So we test by using state overrides or just note that this would require wSOL
    
    results.steps.aerodromeSwapSimulation = {
      note: 'Cannot simulate swap without adapter having wSOL first. The adapter receives wSOL from Twin during the actual call.',
      workaround: 'Testing if the adapter has approved Aerodrome router...',
      adapterApproval: adapterWsolAllowance > wsolAmountBn ? '✅ Approved (enough for this swap)' : '❌ NOT enough approval',
    };

    // Step 3: Check if there are any weird issues with the wSOL token itself
    // Get wSOL total supply and check if it's a standard ERC20
    try {
      const wsolCode = await publicClient.getCode({ address: WSOL });
      results.steps.wsolToken = {
        isContract: wsolCode && wsolCode !== '0x',
        contractSize: wsolCode ? (wsolCode.length - 2) / 2 + ' bytes' : '0',
      };
    } catch (e) {
      results.steps.wsolToken = { error: e instanceof Error ? e.message : 'Unknown' };
    }

    // Step 4: Check the pools more deeply
    const WSOL_USDC_POOL = '0xb98Fb80d89d9cF33C3726843fcBF68E6a7D64c00' as Address;
    
    try {
      const [poolWsolBalance, poolUsdcBalance] = await Promise.all([
        publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [WSOL_USDC_POOL] }),
        publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [WSOL_USDC_POOL] }),
      ]);

      results.steps.wsolUsdcPoolActualBalances = {
        wsolInPool: formatUnits(poolWsolBalance, 9) + ' wSOL',
        usdcInPool: formatUnits(poolUsdcBalance, 6) + ' USDC',
        note: poolWsolBalance > wsolAmountBn ? '✅ Pool has enough wSOL liquidity' : '⚠️ Pool liquidity might be low',
      };
    } catch (e) {
      results.steps.wsolUsdcPoolActualBalances = { error: e instanceof Error ? e.message : 'Unknown' };
    }

    // Step 5: Check if the Aerodrome router supports this exact route format
    // Some Aerodrome versions have different function signatures
    const routerCode = await publicClient.getCode({ address: AERODROME_ROUTER });
    results.steps.aerodromeRouter = {
      isContract: routerCode && routerCode !== '0x',
      address: AERODROME_ROUTER,
      note: 'Router exists',
    };

    // Summary
    const issues: string[] = [];
    if (adapterWsolAllowance === BigInt(0)) issues.push('❌ Adapter has not approved wSOL to Aerodrome');
    if (adapterWethAllowance === BigInt(0)) issues.push('❌ Adapter has not approved WETH to BaseSwap');
    if (!results.steps.aerodromeQuote?.success) issues.push('❌ Aerodrome quote failed');

    results.summary = {
      issues: issues.length > 0 ? issues : ['✅ No obvious issues found in static checks'],
      diagnosis: issues.length > 0 
        ? 'Found potential issues' 
        : 'Static checks pass. The error might be in the actual swap execution or in how the pools handle this token.',
      nextStep: 'Try simulating the full flow with the actual Bridge contract to see the complete execution path.',
    };

    return NextResponse.json(results);

  } catch (error) {
    console.error('Test swap steps error:', error);
    return NextResponse.json({ 
      error: 'Failed to test swap steps', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

