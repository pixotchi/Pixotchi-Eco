import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 900; // Revalidate every 15 minutes (shared cache)

/**
 * GET /api/leaderboard/stake
 * 
 * Returns the stake leaderboard with fresh data from the contract.
 * Shows wallet addresses ranked by their staked SEED amount.
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
    
    return NextResponse.json({
      success: true,
      leaderboard: serialized,
      totalStakers: serialized.length
    });
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

