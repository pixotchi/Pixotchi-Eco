/**
 * Check Adapter Status API
 * 
 * Checks if the SolanaTwinAdapter is properly configured.
 * GET /api/bridge/check-adapter?adapter=<address>
 */

import { NextRequest, NextResponse } from 'next/server';
import { createPublicClient, http, formatUnits, type Address } from 'viem';
import { base } from 'viem/chains';

const BASE_RPC = process.env.NEXT_PUBLIC_RPC_NODE || undefined;

const WSOL = '0x311935Cd80B76769bF2ecC9D8Ab7635b2139cf82' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const WETH = '0x4200000000000000000000000000000000000006' as Address;
const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as Address;
const AERODROME_ROUTER = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43' as Address;
const BASESWAP_ROUTER = '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' as Address;
const PIXOTCHI = '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235' as Address;

const ERC20_ABI = [
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const ADAPTER_ABI = [
  { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'paused', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { name: 'slippageBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const adapter = searchParams.get('adapter') as Address;

  if (!adapter) {
    return NextResponse.json({ error: 'Missing adapter parameter' }, { status: 400 });
  }

  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });

    // Check if contract exists
    const code = await publicClient.getCode({ address: adapter });
    if (!code || code === '0x') {
      return NextResponse.json({
        error: 'Adapter contract does not exist',
        adapter,
        hint: 'The contract might not be deployed or the address is wrong',
      });
    }

    // Get adapter state
    let owner: string | null = null;
    let paused: boolean | null = null;
    let slippageBps: bigint | null = null;

    try {
      owner = await publicClient.readContract({ address: adapter, abi: ADAPTER_ABI, functionName: 'owner' });
    } catch { /* not ownable or different interface */ }

    try {
      paused = await publicClient.readContract({ address: adapter, abi: ADAPTER_ABI, functionName: 'paused' });
    } catch { /* not pausable */ }

    try {
      slippageBps = await publicClient.readContract({ address: adapter, abi: ADAPTER_ABI, functionName: 'slippageBps' });
    } catch { /* no slippageBps */ }

    // Check adapter's token allowances to routers
    const [wsolAllowanceToAero, usdcAllowanceToAero, wethAllowanceToBase, seedAllowanceToPixotchi] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'allowance', args: [adapter, AERODROME_ROUTER] }),
      publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'allowance', args: [adapter, AERODROME_ROUTER] }),
      publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'allowance', args: [adapter, BASESWAP_ROUTER] }),
      publicClient.readContract({ address: SEED, abi: ERC20_ABI, functionName: 'allowance', args: [adapter, PIXOTCHI] }),
    ]);

    // Check adapter's token balances (should be ~0 normally)
    const [wsolBalance, usdcBalance, wethBalance, seedBalance] = await Promise.all([
      publicClient.readContract({ address: WSOL, abi: ERC20_ABI, functionName: 'balanceOf', args: [adapter] }),
      publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [adapter] }),
      publicClient.readContract({ address: WETH, abi: ERC20_ABI, functionName: 'balanceOf', args: [adapter] }),
      publicClient.readContract({ address: SEED, abi: ERC20_ABI, functionName: 'balanceOf', args: [adapter] }),
    ]);

    const MAX_UINT = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
    const isMaxApproval = (v: bigint) => v >= MAX_UINT / BigInt(2);

    const issues: string[] = [];
    
    if (paused === true) issues.push('❌ Adapter is PAUSED');
    if (!isMaxApproval(wsolAllowanceToAero)) issues.push('❌ wSOL not approved to Aerodrome');
    if (!isMaxApproval(usdcAllowanceToAero)) issues.push('❌ USDC not approved to Aerodrome');
    if (!isMaxApproval(wethAllowanceToBase)) issues.push('❌ WETH not approved to BaseSwap');
    if (!isMaxApproval(seedAllowanceToPixotchi)) issues.push('❌ SEED not approved to Pixotchi');

    return NextResponse.json({
      adapter,
      exists: true,
      state: {
        owner,
        paused,
        slippageBps: slippageBps?.toString(),
        slippagePercent: slippageBps ? `${Number(slippageBps) / 100}%` : null,
      },
      allowances: {
        wsolToAerodrome: { approved: isMaxApproval(wsolAllowanceToAero), raw: wsolAllowanceToAero.toString() },
        usdcToAerodrome: { approved: isMaxApproval(usdcAllowanceToAero), raw: usdcAllowanceToAero.toString() },
        wethToBaseSwap: { approved: isMaxApproval(wethAllowanceToBase), raw: wethAllowanceToBase.toString() },
        seedToPixotchi: { approved: isMaxApproval(seedAllowanceToPixotchi), raw: seedAllowanceToPixotchi.toString() },
      },
      balances: {
        wsol: formatUnits(wsolBalance, 9),
        usdc: formatUnits(usdcBalance, 6),
        weth: formatUnits(wethBalance, 18),
        seed: formatUnits(seedBalance, 18),
      },
      issues: issues.length > 0 ? issues : ['✅ All checks passed'],
      diagnosis: issues.length > 0 
        ? `Found ${issues.length} issue(s) that could cause failures`
        : '✅ Adapter appears correctly configured',
    });

  } catch (error) {
    console.error('Check adapter error:', error);
    return NextResponse.json({ 
      error: 'Failed to check adapter', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}

