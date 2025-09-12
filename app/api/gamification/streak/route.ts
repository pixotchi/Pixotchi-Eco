import { NextRequest, NextResponse } from 'next/server';
import { getStreak, trackDailyActivity } from '@/lib/gamification-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const streak = await getStreak(address);
    return NextResponse.json({ success: true, streak });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch streak' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const address = body?.address as string | undefined;
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const streak = await trackDailyActivity(address);
    return NextResponse.json({ success: true, streak });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to track streak' }, { status: 500 });
  }
}


