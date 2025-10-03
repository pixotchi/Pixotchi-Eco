import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboards } from '@/lib/gamification-service';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  // Require admin authentication to view leaderboards
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || undefined; // YYYYMM optional
    const data = await getLeaderboards(month || undefined);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('Failed to fetch leaderboards:', error);
    return NextResponse.json({ error: 'Failed to fetch leaderboards' }, { status: 500 });
  }
}


