import { NextRequest, NextResponse } from 'next/server';
import { trackWalletConnection } from '@/lib/wallet-tracking-service';

/**
 * POST /api/wallet/track - Track a wallet connection
 * This is called automatically when a user connects their wallet
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { address, walletType } = body;

    if (!address || !address.startsWith('0x')) {
      return NextResponse.json(
        { error: 'Valid wallet address is required' },
        { status: 400 }
      );
    }

    // Get user agent for metadata
    const userAgent = req.headers.get('user-agent') || undefined;

    // Track the connection
    const result = await trackWalletConnection(address, {
      walletType,
      userAgent,
    });

    if (!result.success) {
      return NextResponse.json(
        { error: 'Failed to track wallet' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      isFirstConnection: result.isFirstConnection,
    });
  } catch (error) {
    console.error('Track wallet error:', error);
    // Fail gracefully - don't break the app if tracking fails
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}

