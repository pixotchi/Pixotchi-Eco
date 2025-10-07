import { NextResponse } from 'next/server';
import { getStakeLeaderboard } from '@/lib/stake-leaderboard-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/leaderboard/stake/warm
 * 
 * Warms the stake leaderboard cache.
 * Called by QStash scheduler to keep cache always hot.
 */
export async function POST(request: Request) {
  // QStash sends signature headers for verification
  // Optional: Verify QStash signature for security
  const signature = request.headers.get('upstash-signature');
  
  // You can also use CRON_SECRET for simple auth
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

