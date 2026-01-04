import { NextRequest, NextResponse } from 'next/server';
import { getStreak, trackDailyActivity } from '@/lib/gamification-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';

// Segment config: Always fetch fresh user data
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const streak = await getStreak(address);
    return NextResponse.json({ success: true, streak });
  } catch (error) {
    console.error('Error fetching streak:', error);
    return NextResponse.json({ error: 'Failed to fetch streak' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address } = body || {};
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const streak = await trackDailyActivity(address);
    return NextResponse.json({ success: true, streak });
  } catch (error) {
    console.error('Error tracking activity:', error);
    return NextResponse.json({ error: 'Failed to track activity' }, { status: 500 });
  }
}


