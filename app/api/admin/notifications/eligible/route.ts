import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwnerWithRpc } from '@/lib/contracts';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { differenceInSeconds } from 'date-fns';

const THRESHOLD_SECONDS = 12 * 60 * 60; // 12 hours
const REDIS_KEY_PREFIX = 'notif:plant12h';
const NEYNAR_FIDS_CACHE_KEY = 'notif:neynar:enabled_fids';
const NEYNAR_FIDS_CACHE_TTL = 5 * 60; // 5 minutes

/**
 * Fetch ALL enabled FIDs from Neynar with proper pagination.
 * Results are cached for 5 minutes to avoid repeated API calls.
 */
async function fetchEnabledFids(): Promise<number[]> {
    const apiKey = SERVER_ENV.NEYNAR_API_KEY;
    if (!apiKey) return [];

    // Check cache first
    if (redis) {
        try {
            const cached = await redis.get(NEYNAR_FIDS_CACHE_KEY);
            if (cached) {
                const fids = JSON.parse(typeof cached === 'string' ? cached : JSON.stringify(cached));
                console.log(`[fetchEnabledFids] Using cached ${fids.length} FIDs`);
                return fids;
            }
        } catch { }
    }

    const allFids: number[] = [];
    let cursor: string | null = null;
    let pageCount = 0;
    const maxPages = 100;

    do {
        const url = new URL('https://api.neynar.com/v2/farcaster/frame/notification_tokens/');
        url.searchParams.set('limit', '100');
        if (cursor) {
            url.searchParams.set('cursor', cursor);
        }

        const res = await fetch(url.toString(), {
            headers: { 'x-api-key': apiKey },
        });

        if (!res.ok) {
            console.error(`[fetchEnabledFids] Neynar API error: ${res.status}`);
            break;
        }

        const json = await res.json();
        const tokens: Array<{ fid: number }> | undefined = json?.notification_tokens;

        if (tokens?.length) {
            for (const t of tokens) {
                if (!allFids.includes(t.fid)) {
                    allFids.push(t.fid);
                }
            }
        }

        cursor = json?.next?.cursor || null;
        pageCount++;

    } while (cursor && pageCount < maxPages);

    console.log(`[fetchEnabledFids] Fetched ${allFids.length} unique FIDs from ${pageCount} pages`);

    // Cache the result
    if (redis && allFids.length > 0) {
        try {
            await redis.setex(NEYNAR_FIDS_CACHE_KEY, NEYNAR_FIDS_CACHE_TTL, JSON.stringify(allFids));
        } catch { }
    }

    return allFids;
}

/**
 * Process a batch of FIDs in parallel with concurrency limit
 */
async function processFidsBatch(
    fids: number[],
    rpcUrl: string,
    now: Date
): Promise<{
    eligible: Array<{
        fid: number;
        address: string;
        plants: Array<{
            id: number;
            hoursLeft: number;
            eligible: boolean;
            throttled: boolean;
        }>;
    }>;
    stats: {
        processed: number;
        withAddress: number;
        withPlants: number;
        withEligiblePlants: number;
        totalEligiblePlants: number;
        throttledUsers: number;
        throttledPlants: number;
        wouldNotify: number;
    };
}> {
    const CONCURRENCY = 30; // Process 30 FIDs in parallel for speed
    const eligible: Array<{
        fid: number;
        address: string;
        userThrottled: boolean;
        plants: Array<{
            id: number;
            hoursLeft: number;
            eligible: boolean;
            throttled: boolean;
        }>;
    }> = [];

    let withAddress = 0;
    let withPlants = 0;
    let withEligiblePlants = 0;
    let totalEligiblePlants = 0;
    let throttledUsers = 0;
    let throttledPlants = 0;
    let wouldNotify = 0;

    // Process in batches with concurrency limit
    for (let i = 0; i < fids.length; i += CONCURRENCY) {
        const batch = fids.slice(i, i + CONCURRENCY);

        const results = await Promise.allSettled(batch.map(async (fid) => {
            // Resolve address
            let address: string | null = null;
            try {
                // Check cache first
                const cached = await (redis as any)?.get?.(`fidmap:${fid}`);
                if (cached) {
                    address = String(cached).toLowerCase();
                } else {
                    const res = await fetch(`https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`);
                    if (res.ok) {
                        const data = await res.json();
                        const addr = data?.result?.address?.address as string | undefined;
                        if (addr) {
                            address = addr.toLowerCase();
                            await (redis as any)?.set?.(`fidmap:${fid}`, address);
                        }
                    }
                }
            } catch { }

            if (!address) return null;

            // Get plants
            const plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
            if (!plants?.length) return { fid, address, plants: [], hasEligible: false };

            const plantDetails = await Promise.all(plants.map(async p => {
                const t = Number(p.timeUntilStarving ?? 0);
                const plantDate = new Date(t * 1000);
                const secondsLeft = differenceInSeconds(plantDate, now);
                const isEligible = secondsLeft > 0 && secondsLeft <= THRESHOLD_SECONDS;

                // Check plant throttle status
                let isThrottled = false;
                if (isEligible && redis) {
                    try {
                        const throttleKey = `${REDIS_KEY_PREFIX}:fid:${fid}:plant:${Number(p.id)}`;
                        const exists = await (redis as any)?.get?.(throttleKey);
                        isThrottled = !!exists;
                    } catch { }
                }

                return {
                    id: Number(p.id),
                    hoursLeft: Math.round((secondsLeft / 3600) * 100) / 100,
                    eligible: isEligible,
                    throttled: isThrottled,
                };
            }));

            const eligibleCount = plantDetails.filter(p => p.eligible).length;
            const throttledCount = plantDetails.filter(p => p.eligible && p.throttled).length;
            const notThrottledCount = eligibleCount - throttledCount;

            // Check user-level throttle
            let userThrottled = false;
            if (redis) {
                try {
                    const userThrottleKey = `${REDIS_KEY_PREFIX}:fid:${fid}`;
                    const exists = await (redis as any)?.get?.(userThrottleKey);
                    userThrottled = !!exists;
                } catch { }
            }

            return {
                fid,
                address,
                plants: plantDetails,
                hasEligible: eligibleCount > 0,
                eligibleCount,
                throttledCount,
                notThrottledCount,
                userThrottled
            };
        }));

        // Collect results
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value) {
                if (result.value.address) withAddress++;
                if (result.value.plants?.length > 0) withPlants++;
                if (result.value.hasEligible) {
                    withEligiblePlants++;
                    totalEligiblePlants += result.value.eligibleCount || 0;
                    throttledPlants += result.value.throttledCount || 0;
                    if (result.value.userThrottled) {
                        throttledUsers++;
                    } else if ((result.value.notThrottledCount || 0) > 0) {
                        wouldNotify++;
                    }
                    eligible.push({
                        fid: result.value.fid,
                        address: result.value.address,
                        userThrottled: result.value.userThrottled || false,
                        plants: result.value.plants,
                    });
                }
            }
        }
    }

    return {
        eligible,
        stats: {
            processed: fids.length,
            withAddress,
            withPlants,
            withEligiblePlants,
            totalEligiblePlants,
            throttledUsers,
            throttledPlants,
            wouldNotify,
        }
    };
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes (Pro plan limit)

/**
 * GET /api/admin/notifications/eligible
 * 
 * List all plants eligible for TOD notification (under 3h lifetime).
 * 
 * Query params:
 * - fid: Filter to specific user
 * - limit: Max FIDs to check (default: 100, max: 500)
 * - offset: Skip first N FIDs (for pagination)
 */
export async function GET(request: NextRequest) {
    if (!validateAdminKey(request)) {
        return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
    }

    try {
        const url = new URL(request.url);
        const targetFid = url.searchParams.get('fid') ? parseInt(url.searchParams.get('fid')!, 10) : undefined;
        const limit = url.searchParams.get('limit') ? Math.min(parseInt(url.searchParams.get('limit')!, 10), 5000) : undefined;
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        // Fetch eligible fids
        let allFids: number[];
        if (targetFid) {
            allFids = [targetFid];
        } else {
            allFids = await fetchEnabledFids();
        }

        // Apply pagination only if limit is specified
        const totalFids = allFids.length;
        const paginatedFids = targetFid ? allFids : (limit ? allFids.slice(offset, offset + limit) : allFids);

        const rpcUrl = 'https://base-rpc.publicnode.com';
        const now = new Date();
        const startTime = Date.now();

        // Process with parallel batching
        const { eligible, stats } = await processFidsBatch(paginatedFids, rpcUrl, now);

        const processingTime = Date.now() - startTime;

        return NextResponse.json({
            success: true,
            timestamp: Math.floor(now.getTime() / 1000),
            thresholdHours: 12,
            pagination: {
                total: totalFids,
                offset,
                limit: limit || totalFids,
                returned: paginatedFids.length,
                hasMore: limit ? (offset + limit < totalFids) : false,
            },
            summary: {
                fidsChecked: stats.processed,
                fidsWithAddress: stats.withAddress,
                fidsWithPlants: stats.withPlants,
                fidsWithEligiblePlants: stats.withEligiblePlants,
                totalEligiblePlants: stats.totalEligiblePlants,
                processingTimeMs: processingTime,
            },
            eligible,
        });
    } catch (e: any) {
        console.error('[eligible] Error:', e);
        return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
    }
}
