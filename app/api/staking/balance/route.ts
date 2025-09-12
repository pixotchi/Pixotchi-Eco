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

    console.log('🔍 Fetching SEED balance for:', address);

    const balance = await getTokenBalance(address);

    return NextResponse.json({
      success: true,
      balance: balance?.toString() || '0', // Convert bigint to string for JSON
    });

  } catch (error) {
    console.error('❌ Error fetching SEED balance:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch balance',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
