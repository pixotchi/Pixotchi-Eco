import { NextResponse } from 'next/server';
import { getLeaderboards } from '@/lib/gamification-service';
import { resolvePrimaryNames } from '@/lib/ens-resolver';
import { getGamificationDisabledMessage, isGamificationDisabled } from '@/lib/gamification-feature';

export const runtime = 'nodejs';
export const revalidate = 300;
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    if (isGamificationDisabled()) {
      return NextResponse.json(
        {
          success: true,
          disabled: true,
          message: getGamificationDisabledMessage(),
          leaderboard: [],
          totalEntries: 0,
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const { missionTop } = await getLeaderboards();
    const addresses = missionTop.map((entry) => entry.address?.toLowerCase?.()).filter(Boolean) as string[];
    const nameMap = addresses.length > 0 ? await resolvePrimaryNames(addresses) : new Map<string, string | null>();

    const leaderboard = missionTop.map((entry, index) => ({
      rank: index + 1,
      address: entry.address,
      rocks: entry.value,
      name: entry.address ? nameMap.get(entry.address.toLowerCase()) ?? null : null,
    }));

    return NextResponse.json(
      { success: true, leaderboard, totalEntries: leaderboard.length },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' } },
    );
  } catch (error) {
    console.error('[RocksLeaderboard] Failed to load rocks leaderboard', error);
    return NextResponse.json({ success: false, error: 'Failed to load rocks leaderboard' }, { status: 500 });
  }
}
