import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

function parseList(raw: string[] | null) {
  return (raw || []).map((s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  });
}

function parseJSON(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    // Plant TOD notification stats (3h threshold)
    const plantSentCount = Number((await (redis as any)?.get?.('notif:plant3h:sentCount')) || '0');
    const plantLastMap = (await (redis as any)?.hgetall?.('notif:plant3h:last')) as Record<string, string> | null;
    const plantRecent = parseList(await (redis as any)?.lrange?.('notif:plant3h:log', 0, 20));
    const plantLastRun = parseJSON(await (redis as any)?.get?.('notif:plant3h:lastRun'));
    const plantRuns = parseList(await (redis as any)?.lrange?.('notif:plant3h:runs', 0, 20));

    // Legacy 1h stats (for migration visibility)
    const legacySentCount = Number((await (redis as any)?.get?.('notif:plant1h:sentCount')) || '0');

    // Eligible fids
    const eligibleSet = await redis?.smembers?.('notif:eligible:fids');

    return NextResponse.json({
      success: true,
      stats: {
        plantTOD: {
          thresholdHours: 3,
          sentCount: plantSentCount,
          lastPerFid: plantLastMap || {},
          recent: plantRecent,
          lastRun: plantLastRun,
          runs: plantRuns,
        },
        legacy: {
          plant1hSentCount: legacySentCount,
        },
        eligibleFids: eligibleSet || [],
        eligibleFidsCount: eligibleSet?.length || 0,
      },
      endpoints: {
        eligible: '/api/admin/notifications/eligible - List plants eligible for notification',
        trigger: '/api/admin/notifications/trigger - Manually trigger notifications',
      },
    });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
  }
}
