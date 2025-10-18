import { NextRequest, NextResponse } from 'next/server';
import { CdpClient } from '@coinbase/cdp-sdk';
import { parseUnits } from 'viem';
import { PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';

// Create a single CDP client instance per runtime
let cdp: CdpClient | null = null;
function getClient() {
  if (!cdp) {
    cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_ID,
      privateKey: process.env.CDP_API_KEY_SECRET,
      wallet: { seed: process.env.CDP_WALLET_SECRET },
    } as any);
  }
  return cdp;
}

// Cache for agent smart account address
let agentSmartAddress: string | null = null;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address) {
      return NextResponse.json({ error: 'Address required' }, { status: 400 });
    }

    const client = getClient();
    
    // Get agent smart account address
    if (!agentSmartAddress) {
      const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
      const smart = await client.evm.getOrCreateSmartAccount({
        name: 'pixotchi-agent-sa-sp',
        owner,
        enableSpendPermissions: true,
      });
      agentSmartAddress = smart.address;
    }

    // Fetch spend permissions granted by the user
    const allPermissions = await client.evm.listSpendPermissions({
      address: address as `0x${string}`,
    });

    // Filter permissions where agent is the spender
    const agentPermissions = allPermissions.spendPermissions?.filter(
      (p: any) => p.permission.spender.toLowerCase() === agentSmartAddress!.toLowerCase()
    ) || [];

    // Format permissions for UI
    const formattedPermissions = agentPermissions.map((p: any) => ({
      permissionHash: p.permissionHash,
      token: p.permission.token,
      allowance: p.permission.allowance,
      period: p.permission.period,
      start: p.permission.start,
      end: p.permission.end,
      spender: p.permission.spender,
      account: p.permission.account,
      // Add token symbol for known tokens
      tokenSymbol: p.permission.token.toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase() ? 'SEED' : 'UNKNOWN',
      // Calculate human-readable allowance (assuming 18 decimals for SEED)
      allowanceFormatted: p.permission.token.toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase() 
        ? (BigInt(p.permission.allowance) / BigInt(10 ** 18)).toString() 
        : p.permission.allowance,
    }));

    return NextResponse.json({
      success: true,
      address,
      agentAddress: agentSmartAddress,
      permissions: formattedPermissions,
      totalPermissions: formattedPermissions.length,
      hasActivePermissions: formattedPermissions.length > 0,
    });

  } catch (error: any) {
    console.error('Permission summary error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Failed to fetch permission summary' 
    }, { status: 500 });
  }
}


