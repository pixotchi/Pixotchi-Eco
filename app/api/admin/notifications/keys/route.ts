import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Raw scan without prefix - notification keys are stored WITHOUT pixotchi: prefix
async function rawScanKeys(pattern: string, maxKeys: number = 1000): Promise<string[]> {
    if (!redis) return [];
    const results: string[] = [];
    try {
        let cursor = 0;
        do {
            const resp: any = await (redis as any).scan(cursor, { match: pattern, count: 100 });
            if (Array.isArray(resp)) {
                cursor = typeof resp[0] === 'string' ? parseInt(resp[0], 10) : resp[0];
                const keys: string[] = (resp[1] || []) as string[];
                for (const key of keys) {
                    if (results.length < maxKeys && !results.includes(key)) {
                        results.push(key);
                    }
                }
            } else {
                break;
            }
        } while (cursor !== 0 && results.length < maxKeys);
    } catch (e) {
        console.error('[rawScanKeys] Error:', e);
    }
    return results;
}

const NOTIFICATION_KEY_PATTERNS = [
    'notif:plant12h:*',   // Current notification system
    'notif:plant3h:*',    // Legacy 3h keys
    'notif:plant1h:*',    // Legacy 1h keys
    'notif:fence:*',      // Legacy fence keys
    'notif:fencev2:*',    // Legacy fence v2 keys
    'notif:eligible:*',   // Eligible FIDs
    'notif:rate:*',       // Rate limiting keys
    'notif:global:*',     // Global notification stats
    'notif:type:*',       // Per-type notification stats
    'notif:neynar:*',     // Neynar cache
    'fidmap:*',           // FID to address mappings
];

type KeyInfo = {
    key: string;
    value: string | number | object | null;
    ttl: number | null;
    type: string;
};

async function getKeyInfo(key: string): Promise<KeyInfo> {
    if (!redis) return { key, value: null, ttl: null, type: 'unknown' };

    try {
        const type = await (redis as any)?.type?.(key) || 'unknown';
        let value: string | number | object | null = null;

        switch (type) {
            case 'string':
                const strVal = await redis.get(key);
                // Try to parse as JSON, otherwise return as string
                if (typeof strVal === 'string') {
                    try {
                        value = JSON.parse(strVal);
                    } catch {
                        value = strVal;
                    }
                } else {
                    value = strVal !== null && strVal !== undefined ? String(strVal) : null;
                }
                break;
            case 'list':
                const listVal = await (redis as any)?.lrange?.(key, 0, 10);
                value = (listVal || []).map((item: string) => {
                    try { return JSON.parse(item); } catch { return item; }
                });
                break;
            case 'set':
                const setVal = await redis.smembers(key);
                value = setVal?.slice(0, 50) || [];
                break;
            case 'hash':
                value = await (redis as any)?.hgetall?.(key) || {};
                break;
            default:
                value = `<${type}>`;
        }

        const ttl = await redis.ttl(key);

        return { key, value, ttl: typeof ttl === 'number' ? ttl : null, type };
    } catch (error) {
        return { key, value: null, ttl: null, type: 'error' };
    }
}

/**
 * GET /api/admin/notifications/keys
 * 
 * List all notification-related Redis keys with their values and TTLs.
 * 
 * Query params:
 * - pattern: Optional pattern to filter keys (default: all notification patterns)
 * - limit: Max keys to return (default: 100, max: 500)
 */
export async function GET(request: NextRequest) {
    if (!validateAdminKey(request)) {
        return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
    }

    if (!redis) {
        return NextResponse.json({ success: false, error: 'Redis not available' }, { status: 500 });
    }

    try {
        const url = new URL(request.url);
        const customPattern = url.searchParams.get('pattern');
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);

        // Collect all keys matching notification patterns
        const allKeys: string[] = [];
        const patterns = customPattern ? [customPattern] : NOTIFICATION_KEY_PATTERNS;

        for (const pattern of patterns) {
            try {
                const keys = await rawScanKeys(pattern, 1000);
                for (const key of keys) {
                    if (!allKeys.includes(key) && allKeys.length < limit) {
                        allKeys.push(key);
                    }
                }
            } catch (e) {
                console.warn(`Failed to scan pattern ${pattern}:`, e);
            }
        }

        // Sort keys for consistent output
        allKeys.sort();

        // Get info for each key (limited for performance)
        const keyInfos: KeyInfo[] = [];
        for (const key of allKeys.slice(0, limit)) {
            keyInfos.push(await getKeyInfo(key));
        }

        // Group keys by prefix for easier navigation
        const grouped: Record<string, KeyInfo[]> = {};
        for (const info of keyInfos) {
            const prefix = info.key.split(':').slice(0, 2).join(':');
            if (!grouped[prefix]) grouped[prefix] = [];
            grouped[prefix].push(info);
        }

        return NextResponse.json({
            success: true,
            totalKeys: allKeys.length,
            returnedKeys: keyInfos.length,
            patterns,
            grouped,
            keys: keyInfos,
        });
    } catch (e: any) {
        console.error('[keys] Error:', e);
        return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
    }
}

/**
 * DELETE /api/admin/notifications/keys
 * 
 * Delete specific Redis keys.
 * 
 * Query params:
 * - key: Specific key to delete (can be repeated for multiple keys)
 * - pattern: Delete all keys matching pattern (use with caution!)
 * - confirm: Must be 'true' for pattern deletion
 */
export async function DELETE(request: NextRequest) {
    if (!validateAdminKey(request)) {
        return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
    }

    if (!redis) {
        return NextResponse.json({ success: false, error: 'Redis not available' }, { status: 500 });
    }

    try {
        const url = new URL(request.url);
        const keys = url.searchParams.getAll('key');
        const pattern = url.searchParams.get('pattern');
        const confirm = url.searchParams.get('confirm') === 'true';

        const deletedKeys: string[] = [];

        // Delete specific keys
        if (keys.length > 0) {
            for (const key of keys) {
                try {
                    await redis.del(key);
                    deletedKeys.push(key);
                } catch (e) {
                    console.warn(`Failed to delete key ${key}:`, e);
                }
            }
        }

        // Delete by pattern (requires confirmation)
        if (pattern) {
            if (!confirm) {
                return NextResponse.json({
                    success: false,
                    error: 'Pattern deletion requires confirm=true parameter',
                    pattern,
                }, { status: 400 });
            }

            // Only allow notification-related patterns for safety
            const isAllowedPattern = NOTIFICATION_KEY_PATTERNS.some(p => {
                const basePattern = p.replace('*', '');
                return pattern.startsWith(basePattern) || pattern === p;
            }) || pattern.startsWith('fidmap:');

            if (!isAllowedPattern) {
                return NextResponse.json({
                    success: false,
                    error: 'Pattern must start with a known notification prefix',
                    allowedPrefixes: NOTIFICATION_KEY_PATTERNS,
                }, { status: 400 });
            }

            const matchingKeys = await rawScanKeys(pattern, 1000);
            for (const key of matchingKeys) {
                try {
                    await redis.del(key);
                    deletedKeys.push(key);
                } catch (e) {
                    console.warn(`Failed to delete key ${key}:`, e);
                }
            }
        }

        if (deletedKeys.length === 0 && !pattern && keys.length === 0) {
            return NextResponse.json({
                success: false,
                error: 'No keys specified. Use ?key=keyname or ?pattern=prefix:*&confirm=true',
            }, { status: 400 });
        }

        return NextResponse.json({
            success: true,
            deletedCount: deletedKeys.length,
            deletedKeys,
        });
    } catch (e: any) {
        console.error('[keys] Delete error:', e);
        return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
    }
}
