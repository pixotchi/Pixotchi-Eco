import { NextRequest, NextResponse } from 'next/server';
import { getLeaderboards } from '@/lib/gamification-service';
import { requireAdmin } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  // Require admin authentication to view leaderboards
  const adminDenied = await requireAdmin(request);
  if (adminDenied) return adminDenied;

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


