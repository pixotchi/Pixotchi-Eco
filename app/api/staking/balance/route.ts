import { NextRequest, NextResponse } from 'next/server';
import { getTokenBalance } from '@/lib/contracts';

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
    if (!address.startsWith('0x') || address.length !== 42) {
      return NextResponse.json(
        { success: false, error: 'Invalid address format' },
        { status: 400 }
      );
    }

    const balance = await getTokenBalance(address);

    return NextResponse.json({
      success: true,
      balance: balance?.toString() || '0', // Convert bigint to string for JSON
    });

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
