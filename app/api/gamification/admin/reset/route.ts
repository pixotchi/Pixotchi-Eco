import { createErrorResponse,logAdminAction,requireAdmin } from '@/lib/auth-utils';
import { adminReset } from '@/lib/gamification-service';
import { NextRequest,NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const adminDenied = await requireAdmin(request);
    if (adminDenied) {
      await logAdminAction('gm_admin_reset_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      return adminDenied;
    }

    const body = await request.json().catch(() => ({}));
    const scope = body?.scope as 'streaks' | 'missions' | 'all' | undefined;
    if (!scope) {
      const error = createErrorResponse('Missing scope', 400);
      return NextResponse.json(error.body, { status: error.status });
    }

    const result = await adminReset(scope);
    await logAdminAction('gm_admin_reset_success', 'valid_key', { scope, deleted: result.deleted }, true);
    return NextResponse.json({ success: true, deleted: result.deleted });
  } catch {
    const e = createErrorResponse('Failed to reset', 500);
    return NextResponse.json(e.body, { status: e.status });
  }
}


