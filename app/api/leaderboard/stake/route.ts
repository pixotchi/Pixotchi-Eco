import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 86400; // 24 hours cache - matches midnight cron schedule

/**
 * GET /api/leaderboard/stake
 * 
 * Returns the stake leaderboard with cached data.
 * Cache is warmed daily at midnight by cron job.
 * Revalidates every 24 hours.
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

