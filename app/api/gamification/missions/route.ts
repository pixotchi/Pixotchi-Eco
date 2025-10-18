import { NextRequest, NextResponse } from 'next/server';
import { getMissionDay, markMissionTask } from '@/lib/gamification-service';
import { isValidEthereumAddressFormat } from '@/lib/utils';
import type { GmTaskId } from '@/lib/gamification-types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const day = await getMissionDay(address);
    return NextResponse.json({ success: true, day });
  } catch (error) {
    console.error('Error fetching mission day:', error);
    return NextResponse.json({ error: 'Failed to fetch mission day' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, taskId, proof, count } = body || {};
    if (!address || !isValidEthereumAddressFormat(address)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    if (!taskId) {
      return NextResponse.json({ error: 'taskId is required' }, { status: 400 });
    }
    const safeCount = typeof count === 'number' ? Math.max(1, Math.floor(count)) : 1;
    const updated = await markMissionTask(address, taskId as GmTaskId, proof, safeCount);
    return NextResponse.json({ success: true, day: updated });
  } catch (error) {
    console.error('Error updating mission:', error);
    return NextResponse.json({ error: 'Failed to update mission' }, { status: 500 });
  }
}


