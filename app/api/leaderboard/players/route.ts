import { NextResponse } from 'next/server';
import { getPlayerRanking } from '@/lib/player-ranking-service';
import { serializePlayerRanking } from '@/lib/player-ranking';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return NextResponse.json(serializePlayerRanking(await getPlayerRanking()), {
      headers: { 'Cache-Control': 'public, max-age=15, s-maxage=30' },
    });
  } catch {
    return NextResponse.json({ error: 'Player rankings could not be loaded. Please try again.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
