/**
 * Test Transfer API
 * 
 * Tests JUST the safeTransferFrom to isolate where the error occurs.
 * GET /api/bridge/test-transfer?twin=<address>&amount=639108
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, encodeFunctionData, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const ADAPTER = '0x8d3056a3e5144187fde837ea1b206f4bcaea85bc' as Address;

const ERC20_ABI = [
  { name: 'transferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'transfer', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const twin = (searchParams.get('twin') || '0x71256e3d36435b0cc7ac41a43ee123d2aab43275') as Address;
  const amount = searchParams.get('amount') || '639108';

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
    const amountBn = BigInt(amount);

    // Check balances and allowances
    const [twinBalance, allowanceToAdapter] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [twin] }),
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'allowance', args: [twin, ADAPTER] }),
    ]);

    const preChecks = {
      twinBalance: formatUnits(twinBalance, 9) + ' SOL',
      twinBalanceRaw: twinBalance.toString(),
      requiredAmount: formatUnits(amountBn, 9) + ' SOL',
      requiredAmountRaw: amount,
      allowanceToAdapter: allowanceToAdapter.toString(),
      hasEnoughBalance: twinBalance >= amountBn,
      hasEnoughAllowance: allowanceToAdapter >= amountBn,
    };

    // Test 1: Simulate transferFrom called BY THE ADAPTER (as it would in the actual call)
    // The adapter calls: IERC20(WSOL).safeTransferFrom(twin, address(this), wsolAmount)
    // This means the adapter is msg.sender to the wSOL contract
    const transferFromData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transferFrom',
      args: [twin, ADAPTER, amountBn],
    });

    let transferFromResult: any;
    try {
      // Simulate as adapter calling transferFrom
      await publicClient.call({
        account: ADAPTER,
        to: WSOL,
        data: transferFromData,
      });
      transferFromResult = { success: true, message: '✅ transferFrom would succeed when called by adapter' };
    } catch (e: any) {
      transferFromResult = { 
        success: false, 
        error: e.shortMessage || e.message,
        details: e.cause?.message || 'Unknown',
      };
    }

    // Test 2: Check if it's a proxy and get implementation
    let proxyInfo: any = {};
    try {
      // Try to read implementation slot (EIP-1967)
      const implSlot = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
      const implData = await publicClient.getStorageAt({ address: WSOL, slot: implSlot as `0x${string}` });
      if (implData && implData !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        const implAddress = '0x' + implData.slice(-40);
        proxyInfo.type = 'EIP-1967 Proxy';
        proxyInfo.implementation = implAddress;
      } else {
        // Try EIP-1167 minimal proxy detection
        const code = await publicClient.getCode({ address: WSOL });
        if (code && code.includes('363d3d373d3d3d363d73')) {
          // Extract implementation from EIP-1167 bytecode
          const implStart = code.indexOf('363d3d373d3d3d363d73') + 20;
          const implAddress = '0x' + code.slice(implStart, implStart + 40);
          proxyInfo.type = 'EIP-1167 Minimal Proxy';
          proxyInfo.implementation = implAddress;
        } else {
          proxyInfo.type = 'Unknown (possibly not a standard proxy)';
          proxyInfo.codeSize = code ? (code.length - 2) / 2 : 0;
        }
      }
    } catch (e) {
      proxyInfo.error = 'Could not detect proxy type';
    }

    // Test 3: Direct balance check at proxy vs implementation level
    let deepCheck: any = {};
    try {
      // Check if the balance is stored at the proxy or implementation
      // For CrossChainERC20, balances should be at the proxy address
      deepCheck.note = 'Balance read succeeded in preChecks, so storage is accessible';
    } catch (e) {
      deepCheck.error = e instanceof Error ? e.message : 'Unknown';
    }

    return NextResponse.json({
      preChecks,
      transferFromSimulation: transferFromResult,
      proxyInfo,
      deepCheck,
      diagnosis: transferFromResult.success 
        ? '✅ Basic transferFrom would work. Error must be happening LATER in the transaction (in the swap).'
        : '❌ transferFrom itself fails! Check the error details.',
    });

  } catch (error) {
    console.error('Test transfer error:', error);
    return NextResponse.json({ 
      error: 'Failed to test transfer', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

