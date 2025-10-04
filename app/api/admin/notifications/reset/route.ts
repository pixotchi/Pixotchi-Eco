import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      // Clear logs and counters
      ops.push((redis as any)?.del?.('notif:plant1h:log'));
      ops.push((redis as any)?.del?.('notif:plant1h:last'));
      ops.push((redis as any)?.del?.('notif:plant1h:sentCount'));
      ops.push((redis as any)?.del?.('notif:plant1h:runs'));
      // Clear all per-plant episode keys (best-effort: scan by pattern)
      // Upstash supports SCAN
      try {
        let cursor = '0';
        do {
          const resp = await (redis as any)?.scan?.(cursor, 'MATCH', 'notif:plant1h:fid:*:plant:*', 'COUNT', 100);
          cursor = resp?.[0] || '0';
          const keys: string[] = resp?.[1] || [];
          if (keys.length) await (redis as any)?.del?.(...keys);
        } while (cursor !== '0');
      } catch {}
    } else if (scope === 'fid' && fid) {
      // Clear per-user keys
      ops.push((redis as any)?.del?.(`notif:plant1h:fid:${fid}`));
      // Clear all plant episodes for fid
      try {
        let cursor = '0';
        do {
          const resp = await (redis as any)?.scan?.(cursor, 'MATCH', `notif:plant1h:fid:${fid}:plant:*`, 'COUNT', 100);
          cursor = resp?.[0] || '0';
          const keys: string[] = resp?.[1] || [];
          if (keys.length) await (redis as any)?.del?.(...keys);
        } while (cursor !== '0');
      } catch {}
    } else if (scope === 'plant' && fid && plantId) {
      ops.push((redis as any)?.del?.(`notif:plant1h:fid:${fid}:plant:${plantId}`));
    }

    await Promise.all(ops);
    return NextResponse.json({ success: true, scope, fid, plantId });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'reset_failed' }, { status: 500 });
  }
}


