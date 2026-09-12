import { NextRequest, NextResponse } from 'next/server';
import { getTokenBalance } from '@/lib/contracts';
import { isAddress } from 'viem';
import { enforcePublicReadLimit } from '@/lib/public-read-limit';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!isAddress(address)) {
      return NextResponse.json(
        { success: false, error: 'Invalid address format' },
        { status: 400 }
      );
    }

    const limited = await enforcePublicReadLimit(request);
    if (limited) return limited;
    const balance = await getTokenBalance(address.toLowerCase());

    return NextResponse.json({
      success: true,
      balance: balance?.toString() || '0', // Convert bigint to string for JSON
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch {
    console.error('❌ Error fetching SEED balance');
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch balance'
      },
      { status: 500 }
    );
  }
}
