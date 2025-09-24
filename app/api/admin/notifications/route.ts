import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }
  try {
    const plantSentCount = Number((await (redis as any)?.get?.('notif:plant1h:sentCount')) || '0');
    const plantLastMap = (await (redis as any)?.hgetall?.('notif:plant1h:last')) as Record<string, string> | null;
    const plantRecentRaw = await (redis as any)?.lrange?.('notif:plant1h:log', 0, 20);
    const plantRecent = (plantRecentRaw || []).map((s: string) => { try { return JSON.parse(s); } catch { return s; } });

    const globalSent = Number((await (redis as any)?.get?.('notif:global:sentCount')) || '0');
    const globalRecentRaw = await (redis as any)?.lrange?.('notif:global:log', 0, 50);
    const globalRecent = (globalRecentRaw || []).map((s: string) => { try { return JSON.parse(s); } catch { return s; } });
    const globalLast = await (redis as any)?.hgetall?.('notif:global:last');

    // Eligible fids are those with notification tokens; we store a rolling set as we see them
    const eligibleSet = await redis?.smembers?.('notif:eligible:fids');
    const lastRun = await (redis as any)?.get?.('notif:plant1h:lastRun');

    return NextResponse.json({
      success: true,
      stats: {
        plant1h: { sentCount: plantSentCount, lastPerFid: plantLastMap || {}, recent: plantRecent, lastRun: (() => { try { return JSON.parse(lastRun || 'null'); } catch { return null; } })() },
        global: { sentCount: globalSent, lastPerFid: globalLast || {}, recent: globalRecent },
        eligibleFids: eligibleSet || [],
      },
    });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
  }
}


