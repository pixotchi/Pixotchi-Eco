import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { SERVER_ENV, CLIENT_ENV } from '@/lib/env-config';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30; // Should be fast - just calling Neynar API

const REDIS_KEY_PREFIX = 'notif:plant12h';
const THROTTLE_SECONDS = 6 * 60 * 60; // 6 hours

/**
 * POST /api/admin/notifications/trigger
 * 
 * Directly send plant TOD notification to specific FID(s).
 * This is a FAST operation - just calls Neynar API.
 * 
 * Query params:
 * - fid: Target FID (required for direct send)
 * - dry: Set to '1' for dry run (shows what would be sent without sending)
 * 
 * Examples:
 * - POST /api/admin/notifications/trigger?fid=123 - Send to specific user
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
        const skipThrottle = url.searchParams.get('force') === '1';

        if (!targetFid) {
            return NextResponse.json({
                success: false,
                error: 'FID required. Use ?fid=123 to send to specific user.',
            }, { status: 400 });
        }

        const fid = parseInt(targetFid, 10);
        if (isNaN(fid)) {
            return NextResponse.json({
                success: false,
                error: 'Invalid FID format',
            }, { status: 400 });
        }

        // Check throttle (unless force flag is set)
        if (!skipThrottle && redis) {
            const throttleKey = `${REDIS_KEY_PREFIX}:fid:${fid}`;
            const isThrottled = await redis.get(throttleKey);
            if (isThrottled) {
                return NextResponse.json({
                    success: false,
                    error: 'User throttled. Use ?force=1 to bypass or wait for cooldown.',
                    throttled: true,
                    fid,
                });
            }
        }

        // Notification content
        const title = '🪴 Plant Health Alert';
        const body = 'Your plant has under 12h left before it dies. Tap to feed it now!';
        const targetUrl = CLIENT_ENV.APP_URL;

        if (dryRun) {
            return NextResponse.json({
                success: true,
                dryRun: true,
                fid,
                wouldSend: {
                    title,
                    body,
                    target_url: targetUrl,
                },
            });
        }

        // Send notification via Neynar API
        const apiKey = SERVER_ENV.NEYNAR_API_KEY;
        if (!apiKey) {
            return NextResponse.json({
                success: false,
                error: 'NEYNAR_API_KEY not configured',
            }, { status: 500 });
        }

        const startTime = Date.now();
        const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
            },
            body: JSON.stringify({
                target_fids: [fid],
                notification: {
                    title,
                    body,
                    target_url: targetUrl,
                },
            }),
        });

        const result = await response.json();
        const duration = Date.now() - startTime;

        if (!response.ok) {
            return NextResponse.json({
                success: false,
                error: 'Neynar API error',
                status: response.status,
                details: result,
                duration,
            }, { status: 500 });
        }

        // Set throttle for this user
        if (redis && !skipThrottle) {
            const throttleKey = `${REDIS_KEY_PREFIX}:fid:${fid}`;
            await redis.setex(throttleKey, THROTTLE_SECONDS, '1');
        }

        // Log the send
        if (redis) {
            try {
                await redis.lpush(`${REDIS_KEY_PREFIX}:log`, JSON.stringify({
                    ts: Date.now(),
                    fid,
                    manual: true,
                }));
                await redis.ltrim(`${REDIS_KEY_PREFIX}:log`, 0, 99);
                await redis.incr(`${REDIS_KEY_PREFIX}:sent:count`);
            } catch { }
        }

        return NextResponse.json({
            success: true,
            fid,
            sent: true,
            notification: { title, body, target_url: targetUrl },
            neynarResponse: result,
            duration,
        });
    } catch (e: any) {
        console.error('[trigger] Error:', e);
        return NextResponse.json(createErrorResponse(e?.message || 'Trigger failed', 500).body, { status: 500 });
    }
}

// Also support GET for easy browser testing
export async function GET(request: NextRequest) {
    return POST(request);
}
