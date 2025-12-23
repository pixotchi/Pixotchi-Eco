import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/admin/notifications/trigger
 * 
 * Manually trigger plant TOD notifications.
 * 
 * Query params:
 * - fid: Trigger for specific user only (optional)
 * - dry: Set to '1' for dry run (shows what would be sent without sending)
 * 
 * Examples:
 * - POST /api/admin/notifications/trigger - Trigger for all eligible users
 * - POST /api/admin/notifications/trigger?fid=123 - Trigger for specific user
 * - POST /api/admin/notifications/trigger?dry=1 - Dry run for all users
 * - POST /api/admin/notifications/trigger?fid=123&dry=1 - Dry run for specific user
 */
export async function POST(request: NextRequest) {
    if (!validateAdminKey(request)) {
        return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
    }

    try {
        const url = new URL(request.url);
        const targetFid = url.searchParams.get('fid');
        const dryRun = url.searchParams.get('dry') === '1' || url.searchParams.get('dry') === 'true';

        // Build the plant-care cron URL with params
        const cronUrl = new URL('/api/notifications/cron/plant-care', request.url);
        if (targetFid) cronUrl.searchParams.set('fid', targetFid);
        if (dryRun) cronUrl.searchParams.set('dry', '1');
        cronUrl.searchParams.set('debug', '1'); // Always include debug info for admin

        // Forward the request to the plant-care cron
        const response = await fetch(cronUrl.toString(), {
            method: 'GET',
            headers: {
                // Pass through admin authorization
                'x-admin-key': request.headers.get('x-admin-key') || '',
            },
        });

        const result = await response.json();

        return NextResponse.json({
            success: result.success,
            triggered: true,
            dryRun,
            targetFid: targetFid ? parseInt(targetFid, 10) : 'all',
            result,
        });
    } catch (e: any) {
        return NextResponse.json(createErrorResponse(e?.message || 'Trigger failed', 500).body, { status: 500 });
    }
}

// Also support GET for easy browser testing
export async function GET(request: NextRequest) {
    return POST(request);
}
