import { NextRequest, NextResponse } from 'next/server';
import { resolvePrimaryNames, ensDebugLog } from '@/lib/ens-resolver';
import { isAddress } from 'viem';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const addresses: unknown = body?.addresses;

    if (!Array.isArray(addresses) || addresses.length === 0) {
      ensDebugLog('API resolve called with invalid payload', { payload: body });
      return NextResponse.json(
        { success: false, error: 'addresses must be a non-empty array' },
        { status: 400 },
      );
    }

    const validAddresses = addresses
      .filter((addr): addr is string => typeof addr === 'string')
      .map((addr) => addr.toLowerCase())
      .filter((addr) => isAddress(addr));

    ensDebugLog('API resolve incoming', {
      total: addresses.length,
      valid: validAddresses.length,
    });

    if (validAddresses.length === 0) {
      return NextResponse.json({ success: true, names: {} });
    }

    const resolved = await resolvePrimaryNames(validAddresses);
    const names: Record<string, string | null> = {};

    resolved.forEach((value, key) => {
      names[key] = value ?? null;
    });

    ensDebugLog('API resolve response', {
      resolved: Object.entries(names)
        .filter(([, value]) => value)
        .length,
    });

    return NextResponse.json({ success: true, names });
  } catch (error) {
    ensDebugLog('API resolve failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to resolve names' },
      { status: 500 },
    );
  }
}
