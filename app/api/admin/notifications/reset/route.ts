import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fencePrefixes = [
  'notif:fence:warned:fid:',
  'notif:fence:expired:fid:',
  'notif:fence:pending:fid:',
  'notif:fencev2:warned:fid:',
  'notif:fencev2:expired:fid:',
  'notif:fencev2:pending:fid:',
];

function buildFencePattern(prefix: string, fid?: string, plantId?: string): string {
  if (fid && plantId) return `${prefix}${fid}:plant:${plantId}`;
  if (fid) return `${prefix}${fid}:plant:*`;
  return `${prefix}*`;
}

async function scanAndDelete(pattern: string) {
  try {
    let cursor = '0';
    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await (redis as any)?.scan?.(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = resp?.[0] || '0';
      const keys: string[] = resp?.[1] || [];
      if (keys.length) await (redis as any)?.del?.(...keys);
    } while (cursor !== '0');
  } catch {}
}

async function clearFenceKeys(fid?: string, plantId?: string) {
  const scans = fencePrefixes.map((prefix) => scanAndDelete(buildFencePattern(prefix, fid, plantId)));
  await Promise.all(scans);
}

// DELETE /api/admin/notifications/reset?scope=all|fid|plant&fid=123&plantId=456
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
      ops.push((redis as any)?.del?.('notif:plant1h:log'));
      ops.push((redis as any)?.del?.('notif:plant1h:last'));
      ops.push((redis as any)?.del?.('notif:plant1h:sentCount'));
      ops.push((redis as any)?.del?.('notif:plant1h:runs'));

      await scanAndDelete('notif:plant1h:fid:*:plant:*');

      ops.push((redis as any)?.del?.('notif:fence:warn:log'));
      ops.push((redis as any)?.del?.('notif:fence:warn:last'));
      ops.push((redis as any)?.del?.('notif:fence:warn:sentCount'));
      ops.push((redis as any)?.del?.('notif:fence:expire:log'));
      ops.push((redis as any)?.del?.('notif:fence:expire:last'));
      ops.push((redis as any)?.del?.('notif:fence:expire:sentCount'));
      ops.push((redis as any)?.del?.('notif:fence:lastRun'));
      ops.push((redis as any)?.del?.('notif:fence:runs'));
      ops.push((redis as any)?.del?.('notif:fencev2:warn:log'));
      ops.push((redis as any)?.del?.('notif:fencev2:warn:last'));
      ops.push((redis as any)?.del?.('notif:fencev2:warn:sentCount'));
      ops.push((redis as any)?.del?.('notif:fencev2:expire:log'));
      ops.push((redis as any)?.del?.('notif:fencev2:expire:last'));
      ops.push((redis as any)?.del?.('notif:fencev2:expire:sentCount'));
      ops.push((redis as any)?.del?.('notif:fencev2:lastRun'));
      ops.push((redis as any)?.del?.('notif:fencev2:runs'));
      await clearFenceKeys();
    } else if (scope === 'fid' && fid) {
      ops.push((redis as any)?.del?.(`notif:plant1h:fid:${fid}`));
      await scanAndDelete(`notif:plant1h:fid:${fid}:plant:*`);
      await clearFenceKeys(fid || undefined);
    } else if (scope === 'plant' && fid && plantId) {
      ops.push((redis as any)?.del?.(`notif:plant1h:fid:${fid}:plant:${plantId}`));
      await clearFenceKeys(fid, plantId);
    } else if (scope === 'fence') {
      await clearFenceKeys(fid || undefined, plantId || undefined);
      if (!fid && !plantId) {
        ops.push((redis as any)?.del?.('notif:fence:warn:log'));
        ops.push((redis as any)?.del?.('notif:fence:warn:last'));
        ops.push((redis as any)?.del?.('notif:fence:warn:sentCount'));
        ops.push((redis as any)?.del?.('notif:fence:expire:log'));
        ops.push((redis as any)?.del?.('notif:fence:expire:last'));
        ops.push((redis as any)?.del?.('notif:fence:expire:sentCount'));
        ops.push((redis as any)?.del?.('notif:fence:lastRun'));
        ops.push((redis as any)?.del?.('notif:fence:runs'));
        ops.push((redis as any)?.del?.('notif:fencev2:warn:log'));
        ops.push((redis as any)?.del?.('notif:fencev2:warn:last'));
        ops.push((redis as any)?.del?.('notif:fencev2:warn:sentCount'));
        ops.push((redis as any)?.del?.('notif:fencev2:expire:log'));
        ops.push((redis as any)?.del?.('notif:fencev2:expire:last'));
        ops.push((redis as any)?.del?.('notif:fencev2:expire:sentCount'));
        ops.push((redis as any)?.del?.('notif:fencev2:lastRun'));
        ops.push((redis as any)?.del?.('notif:fencev2:runs'));
      }
    }

    await Promise.all(ops);
    return NextResponse.json({ success: true, scope, fid, plantId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'reset_failed' }, { status: 500 });
  }
}


