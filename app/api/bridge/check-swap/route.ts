/**
 * Check Swap Route API
 * 
 * Checks if the wSOL → SEED swap route works and estimates output.
 * GET /api/bridge/check-swap?wsolAmount=650948&strain=4
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { base } from 'viem/chains';

// Segment config: Always fetch fresh onchain data
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

// Contract addresses from SolanaTwinAdapterV2
const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as Address;
const PIXOTCHI = '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235' as Address;
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address;
const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;
const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' as Address;

const AERODROME_ROUTER_ABI = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      {
        name: 'routes', type: 'tuple[]', components: [
          { name: 'from', type: 'address' },
          { name: 'to', type: 'address' },
          { name: 'stable', type: 'bool' },
          { name: 'factory', type: 'address' },
        ]
      },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const BASESWAP_ROUTER_ABI = [
  {
    name: 'getAmountsOut',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
] as const;

const PIXOTCHI_ABI = [
  {
    name: 'getMintPriceByStrain',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'strain', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const wsolAmountStr = searchParams.get('wsolAmount') || '650948';
  const strainStr = searchParams.get('strain') || '4';

  const wsolAmount = BigInt(wsolAmountStr);
  const strain = BigInt(strainStr);

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    // Step 1: Get mint price
    let mintPrice: bigint;
    try {
      mintPrice = await publicClient.readContract({
        address: PIXOTCHI,
        abi: PIXOTCHI_ABI,
        functionName: 'getMintPriceByStrain',
        args: [strain],
      });
    } catch (e) {
      return NextResponse.json({
        error: 'Failed to get mint price',
        details: e instanceof Error ? e.message : 'Unknown',
        hint: `Strain ${strain} might not exist`,
      });
    }

    // Step 2: Try Aerodrome swap wSOL → USDC → WETH
    let wethFromAero: bigint;
    try {
      const aeroRoutes = [
        { from: WSOL, to: USDC, stable: false, factory: AERODROME_FACTORY },
        { from: USDC, to: WETH, stable: false, factory: AERODROME_FACTORY },
      ];

      const aeroAmounts = await publicClient.readContract({
        address: AERODROME_ROUTER,
        abi: AERODROME_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [wsolAmount, aeroRoutes],
      });

      wethFromAero = aeroAmounts[aeroAmounts.length - 1];
    } catch (e) {
      return NextResponse.json({
        error: 'Aerodrome swap quote FAILED',
        step: 'wSOL → USDC → WETH',
        details: e instanceof Error ? e.message : 'Unknown',
        hint: 'The wSOL/USDC or USDC/WETH pool might not exist or have no liquidity',
        wsolAmount: formatUnits(wsolAmount, 9) + ' SOL',
      });
    }

    // Step 3: Try BaseSwap swap WETH → SEED
    let seedFromBase: bigint;
    try {
      const basePath = [WETH, SEED];

      const baseAmounts = await publicClient.readContract({
        address: BASESWAP_ROUTER,
        abi: BASESWAP_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [wethFromAero, basePath],
      });

      seedFromBase = baseAmounts[baseAmounts.length - 1];
    } catch (e) {
      return NextResponse.json({
        error: 'BaseSwap swap quote FAILED',
        step: 'WETH → SEED',
        details: e instanceof Error ? e.message : 'Unknown',
        hint: 'The WETH/SEED pool might not exist or have no liquidity',
        wethAmount: formatUnits(wethFromAero, 18) + ' WETH',
      });
    }

    // Analysis
    const seedShortfall = mintPrice > seedFromBase ? mintPrice - seedFromBase : BigInt(0);
    const wouldSucceed = seedFromBase >= mintPrice;

    return NextResponse.json({
      success: true,
      input: {
        wsolAmount: formatUnits(wsolAmount, 9) + ' SOL',
        wsolAmountRaw: wsolAmount.toString(),
        strain: strain.toString(),
      },
      mintPrice: {
        raw: mintPrice.toString(),
        formatted: formatUnits(mintPrice, 18) + ' SEED',
      },
      swapQuote: {
        step1_wsolToWeth: {
          input: formatUnits(wsolAmount, 9) + ' wSOL',
          output: formatUnits(wethFromAero, 18) + ' WETH',
          route: 'Aerodrome: wSOL → USDC → WETH',
        },
        step2_wethToSeed: {
          input: formatUnits(wethFromAero, 18) + ' WETH',
          output: formatUnits(seedFromBase, 18) + ' SEED',
          route: 'BaseSwap: WETH → SEED',
        },
        finalSeedOutput: formatUnits(seedFromBase, 18) + ' SEED',
        finalSeedOutputRaw: seedFromBase.toString(),
      },
      analysis: {
        wouldSwapSucceed: wouldSucceed,
        seedNeeded: formatUnits(mintPrice, 18),
        seedReceived: formatUnits(seedFromBase, 18),
        shortfall: seedShortfall > 0 ? formatUnits(seedShortfall, 18) + ' SEED' : 'None',
        verdict: wouldSucceed
          ? '✅ Swap would produce enough SEED for mint'
          : `❌ NOT ENOUGH SEED: Need ${formatUnits(mintPrice, 18)} but would only get ${formatUnits(seedFromBase, 18)}`,
      },
    });

  } catch (error) {
    console.error('Check swap error:', error);
    return NextResponse.json({
      error: 'Failed to check swap',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

