import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboards } from '@/lib/gamification-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') || undefined; // YYYYMM optional
    const data = await getLeaderboards(month || undefined);
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch leaderboards' }, { status: 500 });
  }
}


