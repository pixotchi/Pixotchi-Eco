import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leaderboard/stake/warm
 * 
 * Warms the stake leaderboard cache.
 * Called by QStash scheduler to keep cache always hot.
 */
export async function GET(request: Request) {
  // Optional: Verify CRON_SECRET for security
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');
  
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  try {
    console.log('🔥 Warming stake leaderboard cache...');
    const startTime = Date.now();
    
    const leaderboard = await getStakeLeaderboard();
    
    const duration = Date.now() - startTime;
    
    return NextResponse.json({
      success: true,
      message: 'Cache warmed successfully',
      stakers: leaderboard.length,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error warming cache:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to warm cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

