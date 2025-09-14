import { NextRequest, NextResponse } from 'next/server';
import { CdpClient } from '@coinbase/cdp-sdk';
import { parseUnits } from 'viem';

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userAddress, requiredAmount, tokenAddress } = body;

    if (!userAddress || !requiredAmount) {
      return NextResponse.json({ 
        error: 'Missing required parameters: userAddress, requiredAmount' 
      }, { status: 400 });
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
      address: userAddress as `0x${string}`,
    });

    // Filter permissions where agent is the spender
    const agentPermissions = allPermissions.spendPermissions?.filter(
      (p: any) => p.permission.spender.toLowerCase() === agentSmartAddress!.toLowerCase()
    ) || [];

    if (agentPermissions.length === 0) {
      return NextResponse.json({
        valid: false,
        error: 'No spend permissions found',
        recommendation: 'Please grant spend permission to the agent first',
        permissions: [],
      });
    }

    // Find permission for the specific token (default to SEED)
    const targetToken = tokenAddress || '0x546D239032b24eCEEE0cb05c92FC39090846adc7';
    const tokenPermission = agentPermissions.find(
      (p: any) => p.permission.token.toLowerCase() === targetToken.toLowerCase()
    );

    if (!tokenPermission) {
      return NextResponse.json({
        valid: false,
        error: 'No permission found for the requested token',
        recommendation: 'Please grant spend permission for the SEED token',
        availableTokens: agentPermissions.map(p => p.permission.token),
        permissions: agentPermissions,
      });
    }

    // Validate allowance
    const requiredAmountBigInt = BigInt(requiredAmount);
    const availableAllowance = BigInt(tokenPermission.permission.allowance);
    const hasEnoughAllowance = availableAllowance >= requiredAmountBigInt;

    // Check time validity
    const now = Math.floor(Date.now() / 1000);
    const startTime = typeof tokenPermission.permission.start === 'string' 
      ? parseInt(tokenPermission.permission.start) 
      : tokenPermission.permission.start;
    const endTime = typeof tokenPermission.permission.end === 'string' 
      ? parseInt(tokenPermission.permission.end) 
      : tokenPermission.permission.end;
    const isTimeValid = now >= startTime && now <= endTime;

    return NextResponse.json({
      valid: hasEnoughAllowance && isTimeValid,
      permission: {
        hash: tokenPermission.permissionHash,
        token: tokenPermission.permission.token,
        tokenSymbol: targetToken.toLowerCase() === '0x546d239032b24eceee0cb05c92fc39090846adc7' ? 'SEED' : 'UNKNOWN',
        allowance: tokenPermission.permission.allowance,
        allowanceFormatted: (availableAllowance / BigInt(10 ** 18)).toString(),
        spender: tokenPermission.permission.spender,
        account: tokenPermission.permission.account,
        period: tokenPermission.permission.period,
        start: tokenPermission.permission.start,
        end: tokenPermission.permission.end,
      },
      validation: {
        hasEnoughAllowance,
        isTimeValid,
        requiredAmount: requiredAmount,
        requiredAmountFormatted: (requiredAmountBigInt / BigInt(10 ** 18)).toString(),
        availableAllowance: availableAllowance.toString(),
        availableAllowanceFormatted: (availableAllowance / BigInt(10 ** 18)).toString(),
        remainingAllowance: (availableAllowance - requiredAmountBigInt).toString(),
        remainingAllowanceFormatted: ((availableAllowance - requiredAmountBigInt) / BigInt(10 ** 18)).toString(),
        timeRemaining: Math.max(0, endTime - now),
        periodInDays: Math.floor((typeof tokenPermission.permission.period === 'string' 
          ? parseInt(tokenPermission.permission.period) 
          : tokenPermission.permission.period) / 86400),
      },
      recommendations: hasEnoughAllowance && isTimeValid ? [] : [
        !hasEnoughAllowance ? `Increase allowance to at least ${(requiredAmountBigInt / BigInt(10 ** 18)).toString()} SEED` : null,
        !isTimeValid ? 'Permission has expired, please create a new spend permission' : null,
      ].filter(Boolean),
      network: (process.env.NETWORK_ID || 'base'),
      paymasterUrl: process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL || null,
    });

  } catch (error: any) {
    console.error('Permission validation error:', error);
    return NextResponse.json({ 
      valid: false,
      error: error.message || 'Failed to validate permissions' 
    }, { status: 500 });
  }
}
