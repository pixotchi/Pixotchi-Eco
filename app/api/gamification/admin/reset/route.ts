import { NextRequest, NextResponse } from 'next/server';
import { adminReset } from '@/lib/gamification-service';
import { validateAdminKey, createErrorResponse, logAdminAction } from '@/lib/auth-utils';

export async function POST(request: NextRequest) {
  try {
    if (!validateAdminKey(request)) {
      await logAdminAction('gm_admin_reset_failed', 'invalid_key', { reason: 'invalid_admin_key' }, false);
      const error = createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED');
      return NextResponse.json(error.body, { status: error.status });
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
  } catch (error) {
    const e = createErrorResponse('Failed to reset', 500);
    return NextResponse.json(e.body, { status: e.status });
  }
}


