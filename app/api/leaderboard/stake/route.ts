import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard/stake
 * 
 * Returns the stake leaderboard (cached for 4 hours).
 * Shows wallet addresses ranked by their staked SEED amount.
 */
export async function GET() {
  try {
    const leaderboard = await getStakeLeaderboard();
    
    // Convert bigint to string for JSON serialization
    const serialized = leaderboard.map(entry => ({
      address: entry.address,
      stakedAmount: entry.stakedAmount.toString(),
      rank: entry.rank
    }));
    
    return NextResponse.json({
      success: true,
      leaderboard: serialized,
      totalStakers: serialized.length,
      cachedFor: '4 hours'
    });
  } catch (error) {
    console.error('Error fetching stake leaderboard:', error);
    
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

