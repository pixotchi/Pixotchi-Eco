import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard/stake
 * 
 * Returns the stake leaderboard with cached data.
 * The service owns the shared 15-minute snapshot cache. Do not extend its
 * lifetime with a second browser/CDN cache.
 */
export async function GET() {
  try {
    console.log('📊 API: Fetching stake leaderboard...');
    const leaderboard = await getStakeLeaderboard();
    
    // Convert bigint to string for JSON serialization
    const serialized = leaderboard.map(entry => ({
      address: entry.address,
      stakedAmount: entry.stakedAmount.toString(),
      rank: entry.rank,
      ensName: entry.ensName || undefined
    }));
    
    console.log(`📊 API: Returning ${serialized.length} stakers`);
    
    return NextResponse.json(
      {
        success: true,
        leaderboard: serialized,
        totalStakers: serialized.length
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        }
      }
    );
  } catch {
    console.error('Stake leaderboard snapshot unavailable');
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch stake leaderboard',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } }
    );
  }
}

