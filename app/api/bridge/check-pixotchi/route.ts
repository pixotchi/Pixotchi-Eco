/**
 * Check Pixotchi Authorization API
 * 
 * Checks if the adapter is authorized to call mintFor on Pixotchi.
 * GET /api/bridge/check-pixotchi?adapter=<address>
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireBridgeDebugAccess } from '@/lib/bridge-debug-access';
import { getBaseReadClient } from '@/lib/base-rpc';
import { type Address } from 'viem';

const PIXOTCHI = '0xeb4e16c804AE9275a655AbBc20cD0658A91F9235' as Address;

const PIXOTCHI_ABI = [
  { name: 'getSolanaAdapter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'getMintPriceByStrain', type: 'function', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
] as const;

export async function GET(request: NextRequest) {
  const accessDenied = requireBridgeDebugAccess(request);
  if (accessDenied) return accessDenied;

  const searchParams = request.nextUrl.searchParams;
  const adapter = searchParams.get('adapter') as Address;

  if (!adapter) {
    return NextResponse.json({ error: 'Missing adapter parameter' }, { status: 400 });
  }

  try {
    const publicClient = getBaseReadClient();

    // Check what adapter is registered in Pixotchi
    let registeredAdapter: string | null = null;
    try {
      registeredAdapter = await publicClient.readContract({
        address: PIXOTCHI,
        abi: PIXOTCHI_ABI,
        functionName: 'getSolanaAdapter',
      });
    } catch (e) {
      return NextResponse.json({
        error: 'Could not read getSolanaAdapter from Pixotchi',
        details: e instanceof Error ? e.message : 'Unknown',
        hint: 'The function might not exist or have a different name',
      });
    }

    // Check mint price for strain 4 to verify contract works
    let mintPrice: bigint | null = null;
    try {
      mintPrice = await publicClient.readContract({
        address: PIXOTCHI,
        abi: PIXOTCHI_ABI,
        functionName: 'getMintPriceByStrain',
        args: [BigInt(4)],
      });
    } catch { /* ignore */ }

    const isAuthorized = registeredAdapter?.toLowerCase() === adapter.toLowerCase();

    return NextResponse.json({
      pixotchiContract: PIXOTCHI,
      yourAdapter: adapter,
      registeredAdapter,
      isAuthorized,
      mintPriceStrain4: mintPrice?.toString(),
      diagnosis: isAuthorized 
        ? '✅ Your adapter IS authorized to call mintFor'
        : `❌ MISMATCH! Pixotchi expects adapter ${registeredAdapter} but you\'re using ${adapter}`,
    });

  } catch (error) {
    console.error('Check pixotchi error:', error);
    return NextResponse.json({ 
      error: 'Failed to check pixotchi', 
      details: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
