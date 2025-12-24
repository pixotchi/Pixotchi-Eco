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
    // Plant TOD notification stats (12h threshold)
    const plantSentCount = Number((await (redis as any)?.get?.('notif:plant12h:sent:count')) || '0');
    const plantLast = Number((await (redis as any)?.get?.('notif:plant12h:last')) || '0');
    const plantRecent = parseList(await (redis as any)?.lrange?.('notif:plant12h:log', 0, 20));
    const plantRuns = Number((await (redis as any)?.get?.('notif:plant12h:runs')) || '0');

    // Legacy 1h stats (for migration visibility)
    const legacySentCount = Number((await (redis as any)?.get?.('notif:plant1h:sentCount')) || '0');

    // Eligible fids
    const eligibleSet = await redis?.smembers?.('notif:eligible:fids');

    return NextResponse.json({
      success: true,
      stats: {
        plantTOD: {
          thresholdHours: 12,
          sentCount: plantSentCount,
          lastRun: plantLast ? new Date(plantLast).toISOString() : null,
          recent: plantRecent,
          totalRuns: plantRuns,
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
        keys: '/api/admin/notifications/keys - View and delete notification Redis keys',
        reset: '/api/admin/notifications/reset - Reset throttle keys (scope=all|fid|plant)',
      },
    });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
  }
}
