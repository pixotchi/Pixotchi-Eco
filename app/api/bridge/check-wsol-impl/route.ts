/**
 * Check wSOL Implementation API
 * 
 * Analyzes the wSOL proxy and its implementation.
 * GET /api/bridge/check-wsol-impl
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;

export async function GET(request: NextRequest) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    // Get the proxy bytecode
    const proxyCode = await publicClient.getCode({ address: WSOL });
    
    if (!proxyCode) {
      return NextResponse.json({ error: 'No code at wSOL address' });
    }

    const results: any = {
      proxy: {
        address: WSOL,
        codeLength: (proxyCode.length - 2) / 2,
        code: proxyCode,
      },
    };

    // EIP-1167 minimal proxy format:
    // 363d3d373d3d3d363d73<implementation-address>5af43d82803e903d91602b57fd5bf3
    if (proxyCode.toLowerCase().includes('363d3d373d3d3d363d73')) {
      const startIndex = proxyCode.toLowerCase().indexOf('363d3d373d3d3d363d73') + 20;
      const implAddress = '0x' + proxyCode.slice(startIndex, startIndex + 40);
      
      results.proxyType = 'EIP-1167 Minimal Proxy';
      results.implementation = {
        address: implAddress,
      };

      // Get implementation code
      const implCode = await publicClient.getCode({ address: implAddress as Address });
      results.implementation.codeLength = implCode ? (implCode.length - 2) / 2 : 0;
      results.implementation.exists = implCode && implCode !== '0x';

      // Try to identify the implementation
      if (implCode && implCode.length > 10) {
        // Check for known patterns in the bytecode
        // Solady ERC20 uses custom errors, not string reverts
        results.implementation.analysis = {
          note: 'Implementation exists',
          isSolady: !implCode.includes('4552433230'), // "ERC20" in hex would indicate OpenZeppelin
        };
      }
    } else {
      results.proxyType = 'Unknown proxy type';
      results.analysis = 'Could not detect EIP-1167 pattern';
    }

    // Check the CrossChainERC20Factory to understand how these tokens are created
    const FACTORY = '0x3eff766C76a1be2Ce1aCF2B69c78bCae257D5188' as Address; // Bridge contract
    
    // Try to read CrossChainERC20 implementation from factory
    try {
      const factoryCode = await publicClient.getCode({ address: FACTORY });
      results.bridgeContract = {
        address: FACTORY,
        hasCode: factoryCode && factoryCode !== '0x',
      };
    } catch (e) {
      results.bridgeContract = { error: 'Could not check' };
    }

    return NextResponse.json(results);

  } catch (error) {
    console.error('Check wSOL impl error:', error);
    return NextResponse.json({ 
      error: 'Failed to check', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

