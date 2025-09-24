import { NextRequest, NextResponse } from 'next/server';
import { getMissionDay, markMissionTask } from '@/lib/gamification-service';
import type { GmTaskId } from '@/lib/gamification-types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const day = await getMissionDay(address);
    return NextResponse.json({ success: true, day });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch missions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { address, taskId, proof, count } = body || {};
    if (!address || !address.match(/^0x[a-fA-F0-9]{40}$/)) {
      return NextResponse.json({ error: 'Valid wallet address is required' }, { status: 400 });
    }
    const validIds: GmTaskId[] = [
      's1_buy5_elements','s1_buy_shield','s1_claim_production',
      's2_apply_resources','s2_attack_plant','s2_chat_message',
      's3_send_quest','s3_place_order','s3_claim_stake'
    ];
    if (!validIds.includes(taskId)) {
      return NextResponse.json({ error: 'Invalid taskId' }, { status: 400 });
    }
    const safeCount = typeof count === 'number' ? Math.max(1, Math.floor(count)) : 1;
    const updated = await markMissionTask(address, taskId, proof, safeCount);
    return NextResponse.json({ success: true, day: updated });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update mission progress' }, { status: 500 });
  }
}


