import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function POST(req: NextRequest) {
  try {
    const { fid, address } = await req.json();
    if (typeof fid !== 'number' || !address || typeof address !== 'string') {
      return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
    }
    if (!redis) return NextResponse.json({ success: false, error: 'Redis unavailable' }, { status: 500 });
    await redis.set(`fidmap:${fid}`, address.toLowerCase());
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 });
  }
}


