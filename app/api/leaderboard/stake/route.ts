import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard/stake
 * 
 * Returns the stake leaderboard with cached data.
 * Cache is warmed daily at midnight by cron job.
 * The response is cached by browsers/CDN for 24 hours; execution itself stays
 * dynamic because the service cache is warmed by the midnight cron.
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
        // ✅ Add cache headers for browser/CDN (24 hours)
        headers: {
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        }
      }
    );
  } catch (error) {
    console.error('❌ API: Error fetching stake leaderboard:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch stake leaderboard',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

