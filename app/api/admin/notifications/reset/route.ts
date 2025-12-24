import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Scan and delete notification keys - uses raw scan WITHOUT pixotchi: prefix
// because notification keys are stored without the prefix
async function scanAndDelete(pattern: string): Promise<number> {
  if (!redis) return 0;
  let deletedCount = 0;
  try {
    let cursor = 0;
    do {
      // Use raw scan with pattern (notification keys don't have pixotchi: prefix)
      const resp: any = await (redis as any).scan(cursor, { match: pattern, count: 100 });
      if (Array.isArray(resp)) {
        cursor = typeof resp[0] === 'string' ? parseInt(resp[0], 10) : resp[0];
        const keys: string[] = (resp[1] || []) as string[];
        for (const key of keys) {
          try {
            await (redis as any).del(key);
            deletedCount++;
          } catch { }
        }
      } else {
        break;
      }
    } while (cursor !== 0);
  } catch (e) {
    console.error('[scanAndDelete] Error:', e);
  }
  return deletedCount;
}

/**
 * DELETE /api/admin/notifications/reset
 * 
 * Reset notification throttle keys to allow re-sending notifications.
 * 
 * Query params:
 * - scope: 'all' | 'fid' | 'plant' (default: 'all')
 * - fid: Required for 'fid' and 'plant' scopes
 * - plantId: Required for 'plant' scope
 * 
 * Examples:
 * - DELETE /api/admin/notifications/reset?scope=all - Clear all notification keys
 * - DELETE /api/admin/notifications/reset?scope=fid&fid=123 - Clear keys for specific user
 * - DELETE /api/admin/notifications/reset?scope=plant&fid=123&plantId=456 - Clear keys for specific plant
 */
export async function DELETE(req: NextRequest) {
  if (!validateAdminKey(req)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') || 'all';
    const fid = url.searchParams.get('fid');
    const plantId = url.searchParams.get('plantId');

    const ops: Array<Promise<any>> = [];

    if (scope === 'all') {
      // Clear all plant12h notification keys
      ops.push((redis as any)?.del?.('notif:plant12h:log'));
      ops.push((redis as any)?.del?.('notif:plant12h:last'));
      ops.push((redis as any)?.del?.('notif:plant12h:sent:count'));
      ops.push((redis as any)?.del?.('notif:plant12h:runs'));
      await scanAndDelete('notif:plant12h:fid:*');

      // Also clean up legacy plant1h keys
      ops.push((redis as any)?.del?.('notif:plant1h:log'));
      ops.push((redis as any)?.del?.('notif:plant1h:last'));
      ops.push((redis as any)?.del?.('notif:plant1h:sentCount'));
      ops.push((redis as any)?.del?.('notif:plant1h:runs'));
      ops.push((redis as any)?.del?.('notif:plant1h:lastRun'));
      await scanAndDelete('notif:plant1h:fid:*');

      // Clean up legacy fence keys
      await scanAndDelete('notif:fence:*');
      await scanAndDelete('notif:fencev2:*');

    } else if (scope === 'fid' && fid) {
      // Clear keys for specific fid
      ops.push((redis as any)?.del?.(`notif:plant12h:fid:${fid}`));
      await scanAndDelete(`notif:plant12h:fid:${fid}:plant:*`);

    } else if (scope === 'plant' && fid && plantId) {
      // Clear key for specific plant
      ops.push((redis as any)?.del?.(`notif:plant12h:fid:${fid}:plant:${plantId}`));

    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid scope or missing params. Use scope=all, scope=fid&fid=123, or scope=plant&fid=123&plantId=456'
      }, { status: 400 });
    }

    await Promise.all(ops);

    return NextResponse.json({
      success: true,
      scope,
      fid: fid || null,
      plantId: plantId || null,
      message: `Cleared notification throttle keys for scope: ${scope}`,
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'reset_failed' }, { status: 500 });
  }
}
