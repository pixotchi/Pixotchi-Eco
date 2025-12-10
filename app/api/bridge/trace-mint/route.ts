/**
 * Trace Mint Flow API
 * 
 * Traces through the mintWithWsol flow step by step.
 * GET /api/bridge/trace-mint?twin=<address>&strain=4&wsolAmount=639108&minSeedOut=10000000000000000000
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, encodeFunctionData, decodeFunctionResult, type Address, keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const ADAPTER = '0x8d3056a3e5144187fde837ea1b206f4bcaea85bc' as Address;
const BRIDGE = '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188' as Address;

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const TWIN_ABI = [
  { 
    name: 'execute', 
    type: 'function', 
    stateMutability: 'nonpayable',
    inputs: [{ 
      name: 'call', 
      type: 'tuple',
      components: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
        { name: 'ty', type: 'uint8' },
      ]
    }],
    outputs: []
  },
] as const;

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

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const twin = (searchParams.get('twin') || '0x71256e3d36435b0cc7ac41a43ee123d2aab43275') as Address;
  const strain = searchParams.get('strain') || '4';
  const wsolAmount = searchParams.get('wsolAmount') || '639108';
  const minSeedOut = searchParams.get('minSeedOut') || '10000000000000000000';

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    const results: any = {
      parameters: {
        twin,
        adapter: ADAPTER,
        strain,
        wsolAmount: formatUnits(BigInt(wsolAmount), 9) + ' SOL',
        minSeedOut: formatUnits(BigInt(minSeedOut), 18) + ' SEED',
      },
      traces: [],
    };

    // Step 1: Current state before any calls
    const [twinBalance, adapterBalance, twinAllowance] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [twin] }),
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [ADAPTER] }),
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'allowance', args: [twin, ADAPTER] }),
    ]);

    results.traces.push({
      step: 1,
      name: 'Initial State',
      twinWsolBalance: formatUnits(twinBalance, 9) + ' SOL',
      adapterWsolBalance: formatUnits(adapterBalance, 9) + ' SOL',
      twinAllowanceToAdapter: twinAllowance >= BigInt(wsolAmount) ? '✅ Sufficient' : '❌ Insufficient',
    });

    // Step 2: Build the call data for mintWithWsol
    const mintCalldata = encodeFunctionData({
      abi: ADAPTER_ABI,
      functionName: 'mintWithWsol',
      args: [BigInt(strain), BigInt(wsolAmount), BigInt(minSeedOut)],
    });

    results.traces.push({
      step: 2,
      name: 'Call Data Built',
      function: 'mintWithWsol(uint256,uint256,uint256)',
      selector: mintCalldata.slice(0, 10),
      fullCalldata: mintCalldata,
    });

    // Step 3: Try calling mintWithWsol directly from Twin
    try {
      await publicClient.call({
        account: twin,
        to: ADAPTER,
        data: mintCalldata,
        gas: BigInt(2000000),
      });
      results.traces.push({
        step: 3,
        name: 'Direct Call Simulation',
        caller: 'Twin',
        target: 'Adapter',
        result: '✅ SUCCESS - Call would succeed!',
      });
    } catch (e: any) {
      results.traces.push({
        step: 3,
        name: 'Direct Call Simulation',
        caller: 'Twin',
        target: 'Adapter',
        result: '❌ FAILED',
        error: e.shortMessage || e.message,
        details: e.cause?.message || 'Unknown',
      });
    }

    // Step 4: Try calling via Twin.execute (as the bridge would)
    const twinExecuteCall = {
      to: ADAPTER,
      value: BigInt(0),
      data: mintCalldata,
      ty: 0, // CallType.Call
    };

    const executeCalldata = encodeFunctionData({
      abi: TWIN_ABI,
      functionName: 'execute',
      args: [twinExecuteCall],
    });

    try {
      await publicClient.call({
        account: BRIDGE, // Bridge calling Twin.execute
        to: twin,
        data: executeCalldata,
        gas: BigInt(2000000),
      });
      results.traces.push({
        step: 4,
        name: 'Via Twin.execute Simulation',
        caller: 'Bridge',
        target: 'Twin.execute → Adapter',
        result: '✅ SUCCESS',
      });
    } catch (e: any) {
      results.traces.push({
        step: 4,
        name: 'Via Twin.execute Simulation',
        caller: 'Bridge',
        target: 'Twin.execute → Adapter',
        result: '❌ FAILED',
        error: e.shortMessage || e.message,
        details: e.cause?.message || 'Unknown',
      });
    }

    // Summary
    const step3Failed = results.traces[2]?.result?.includes('FAILED');
    const step4Failed = results.traces[3]?.result?.includes('FAILED');

    if (step3Failed && step4Failed) {
      results.summary = {
        diagnosis: '❌ Both direct call and Twin.execute fail',
        explanation: 'The issue is in the adapter\'s mintWithWsol function itself, not in how it\'s called.',
        likelyCause: 'The Aerodrome swap is failing, possibly due to pool/token interaction issues.',
      };
    } else if (!step3Failed && step4Failed) {
      results.summary = {
        diagnosis: '⚠️ Direct call works but Twin.execute fails',
        explanation: 'There\'s something different about calls coming through Twin.execute vs direct calls.',
        likelyCause: 'Check Twin contract for any restrictions or context differences.',
      };
    } else if (!step3Failed && !step4Failed) {
      results.summary = {
        diagnosis: '✅ All simulations pass!',
        explanation: 'The call should work. The issue might be in the bridge context (before Twin.execute is called).',
        likelyCause: 'Check if TokenLib.finalizeTransfer is properly minting wSOL before the call.',
      };
    }

    return NextResponse.json(results);

  } catch (error) {
    console.error('Trace mint error:', error);
    return NextResponse.json({ 
      error: 'Failed to trace', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

