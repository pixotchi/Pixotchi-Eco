/**
 * Deep Debug API
 * 
 * Tests each step of the mintWithWsol flow individually.
 * GET /api/bridge/debug-deep
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, encodeFunctionData, type Address, parseAbi } from 'viem';
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
const PIXOTCHI = '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235' as Address;

export async function GET(request: NextRequest) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const wsolAmount = BigInt(639108);
    const results: any = {
      tests: [],
    };

    // Test 1: Check SEED token - is it a standard ERC20?
    try {
      const seedCode = await publicClient.getCode({ address: SEED });
      const seedCodeSize = seedCode ? (seedCode.length - 2) / 2 : 0;
      
      // Try to read name/symbol
      const [seedName, seedSymbol, seedDecimals] = await Promise.all([
        publicClient.readContract({ address: SEED, abi: parseAbi(['function name() view returns (string)']), functionName: 'name' }).catch(() => 'Unknown'),
        publicClient.readContract({ address: SEED, abi: parseAbi(['function symbol() view returns (string)']), functionName: 'symbol' }).catch(() => 'Unknown'),
        publicClient.readContract({ address: SEED, abi: parseAbi(['function decimals() view returns (uint8)']), functionName: 'decimals' }).catch(() => 0),
      ]);

      results.tests.push({
        name: 'SEED Token Check',
        address: SEED,
        codeSize: seedCodeSize,
        tokenName: seedName,
        symbol: seedSymbol,
        decimals: seedDecimals,
        isProxy: seedCodeSize < 500 ? '⚠️ Possibly a proxy (small code)' : 'Likely not a proxy',
      });
    } catch (e: any) {
      results.tests.push({ name: 'SEED Token Check', error: e.message });
    }

    // Test 2: Check if Pixotchi mintFor would work
    try {
      const mintForData = encodeFunctionData({
        abi: parseAbi(['function mintFor(address owner, uint256 strain) external']),
        functionName: 'mintFor',
        args: [TWIN, BigInt(4)],
      });

      await publicClient.call({
        account: ADAPTER,
        to: PIXOTCHI,
        data: mintForData,
      });
      results.tests.push({
        name: 'Pixotchi mintFor Simulation',
        caller: 'Adapter',
        result: '✅ Would succeed (if SEED payment handled)',
      });
    } catch (e: any) {
      results.tests.push({
        name: 'Pixotchi mintFor Simulation',
        caller: 'Adapter',
        result: '❌ FAILED',
        error: e.shortMessage || e.message,
      });
    }

    // Test 3: Check WETH token
    try {
      const wethCode = await publicClient.getCode({ address: WETH });
      results.tests.push({
        name: 'WETH Token Check',
        address: WETH,
        codeSize: wethCode ? (wethCode.length - 2) / 2 : 0,
        note: 'WETH uses OpenZeppelin-style errors',
      });
    } catch (e: any) {
      results.tests.push({ name: 'WETH Token Check', error: e.message });
    }

    // Test 4: Check BaseSwap router
    try {
      const routerCode = await publicClient.getCode({ address: BASESWAP_ROUTER });
      results.tests.push({
        name: 'BaseSwap Router Check',
        address: BASESWAP_ROUTER,
        exists: routerCode && routerCode !== '0x',
        codeSize: routerCode ? (routerCode.length - 2) / 2 : 0,
      });
    } catch (e: any) {
      results.tests.push({ name: 'BaseSwap Router Check', error: e.message });
    }

    // Test 5: Check WETH/SEED pool on BaseSwap
    const BASESWAP_FACTORY = '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB' as Address;
    try {
      const wethSeedPair = await publicClient.readContract({
        address: BASESWAP_FACTORY,
        abi: parseAbi(['function getPair(address, address) view returns (address)']),
        functionName: 'getPair',
        args: [WETH, SEED],
      });

      if (wethSeedPair === '0x0000000000000000000000000000000000000000') {
        results.tests.push({
          name: 'WETH/SEED Pair on BaseSwap',
          result: '❌ PAIR DOES NOT EXIST!',
          issue: 'This could be the problem - no WETH/SEED liquidity on BaseSwap',
        });
      } else {
        // Check reserves
        const [reserve0, reserve1] = await publicClient.readContract({
          address: wethSeedPair,
          abi: parseAbi(['function getReserves() view returns (uint112, uint112, uint32)']),
          functionName: 'getReserves',
        });

        const token0 = await publicClient.readContract({
          address: wethSeedPair,
          abi: parseAbi(['function token0() view returns (address)']),
          functionName: 'token0',
        });

        const isWethToken0 = token0.toLowerCase() === WETH.toLowerCase();
        const wethReserve = isWethToken0 ? reserve0 : reserve1;
        const seedReserve = isWethToken0 ? reserve1 : reserve0;

        results.tests.push({
          name: 'WETH/SEED Pair on BaseSwap',
          pairAddress: wethSeedPair,
          wethReserve: formatUnits(wethReserve, 18) + ' WETH',
          seedReserve: formatUnits(seedReserve, 18) + ' SEED',
          result: wethReserve > BigInt(0) ? '✅ Pair exists with liquidity' : '⚠️ Low/no liquidity',
        });
      }
    } catch (e: any) {
      results.tests.push({ name: 'WETH/SEED Pair on BaseSwap', error: e.message });
    }

    // Test 6: Simulate BaseSwap getAmountsOut for a small WETH amount
    try {
      const testWethAmount = BigInt('27656974535675'); // ~0.000027 WETH (expected from Aerodrome)
      const amounts = await publicClient.readContract({
        address: BASESWAP_ROUTER,
        abi: parseAbi(['function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])']),
        functionName: 'getAmountsOut',
        args: [testWethAmount, [WETH, SEED]],
      });

      results.tests.push({
        name: 'BaseSwap getAmountsOut (WETH → SEED)',
        input: formatUnits(testWethAmount, 18) + ' WETH',
        output: formatUnits(amounts[1], 18) + ' SEED',
        result: '✅ Quote works',
      });
    } catch (e: any) {
      results.tests.push({
        name: 'BaseSwap getAmountsOut (WETH → SEED)',
        result: '❌ FAILED',
        error: e.shortMessage || e.message,
        possibleIssue: 'BaseSwap router might not have liquidity or path might be wrong',
      });
    }

    // Test 7: Check adapter's approval to BaseSwap
    try {
      const adapterWethAllowance = await publicClient.readContract({
        address: WETH,
        abi: parseAbi(['function allowance(address owner, address spender) view returns (uint256)']),
        functionName: 'allowance',
        args: [ADAPTER, BASESWAP_ROUTER],
      });

      results.tests.push({
        name: 'Adapter WETH Approval to BaseSwap',
        allowance: adapterWethAllowance.toString(),
        isApproved: adapterWethAllowance > BigInt(0) ? '✅ Approved' : '❌ NOT Approved!',
      });
    } catch (e: any) {
      results.tests.push({ name: 'Adapter WETH Approval to BaseSwap', error: e.message });
    }

    // Summary
    const issues = results.tests.filter((t: any) => 
      t.result?.includes('FAILED') || 
      t.result?.includes('NOT') ||
      t.issue
    );

    results.summary = {
      totalTests: results.tests.length,
      issues: issues.length,
      diagnosis: issues.length > 0 
        ? 'Found potential issues - check the tests above'
        : 'All tests pass - issue might be in transaction sequencing or gas',
    };

    return NextResponse.json(results);

  } catch (error) {
    console.error('Debug deep error:', error);
    return NextResponse.json({ 
      error: 'Failed', 
      details: error instanceof Error ? error.message : 'Unknown' 
    }, { status: 500 });
  }
}

