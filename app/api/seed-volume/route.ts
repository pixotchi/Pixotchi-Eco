import { fetchSeedMarketPulse } from '@/lib/seed-market';
import { NextResponse } from 'next/server';

/**
 * GET /api/seed-volume
 * Fetches SEED pair market data from DexScreener and calculates 2% rewards.
 */
export async function GET() {
  try {
    return NextResponse.json(await fetchSeedMarketPulse());
  } catch (error) {
    console.error('Error fetching SEED volume:', error);

    return NextResponse.json(
      { error: 'Failed to fetch volume data' },
      { status: 500 }
    );
  }
}
