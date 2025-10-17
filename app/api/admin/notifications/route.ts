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
    const plantSentCount = Number((await (redis as any)?.get?.('notif:plant1h:sentCount')) || '0');
    const plantLastMap = (await (redis as any)?.hgetall?.('notif:plant1h:last')) as Record<string, string> | null;
    const plantRecent = parseList(await (redis as any)?.lrange?.('notif:plant1h:log', 0, 20));

    const globalSent = Number((await (redis as any)?.get?.('notif:global:sentCount')) || '0');
    const globalRecent = parseList(await (redis as any)?.lrange?.('notif:global:log', 0, 50));
    const globalLast = await (redis as any)?.hgetall?.('notif:global:last');

    const eligibleSet = await redis?.smembers?.('notif:eligible:fids');
    const plantLastRun = parseJSON(await (redis as any)?.get?.('notif:plant1h:lastRun'));

    const fenceWarnSent = Number((await (redis as any)?.get?.('notif:fence:warn:sentCount')) || '0');
    const fenceWarnRecent = parseList(await (redis as any)?.lrange?.('notif:fence:warn:log', 0, 20));
    const fenceWarnLast = await (redis as any)?.hgetall?.('notif:fence:warn:last');

    const fenceExpireSent = Number((await (redis as any)?.get?.('notif:fence:expire:sentCount')) || '0');
    const fenceExpireRecent = parseList(await (redis as any)?.lrange?.('notif:fence:expire:log', 0, 20));
    const fenceExpireLast = await (redis as any)?.hgetall?.('notif:fence:expire:last');

    const fenceLastRun = parseJSON(await (redis as any)?.get?.('notif:fence:lastRun'));
    const fenceRuns = parseList(await (redis as any)?.lrange?.('notif:fence:runs', 0, 20));

    return NextResponse.json({
      success: true,
      stats: {
        plant1h: {
          sentCount: plantSentCount,
          lastPerFid: plantLastMap || {},
          recent: plantRecent,
          lastRun: plantLastRun,
        },
        fence: {
          warn: {
            sentCount: fenceWarnSent,
            lastPerFid: fenceWarnLast || {},
            recent: fenceWarnRecent,
          },
          expire: {
            sentCount: fenceExpireSent,
            lastPerFid: fenceExpireLast || {},
            recent: fenceExpireRecent,
          },
          lastRun: fenceLastRun,
          runs: fenceRuns,
        },
        global: {
          sentCount: globalSent,
          lastPerFid: globalLast || {},
          recent: globalRecent,
        },
        eligibleFids: eligibleSet || [],
      },
    });
  } catch (e: any) {
    return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
  }
}


