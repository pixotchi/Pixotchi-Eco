import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { SERVER_ENV } from '@/lib/env-config';
import { getPlantsByOwnerWithRpc } from '@/lib/contracts';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { differenceInSeconds } from 'date-fns';

const THRESHOLD_SECONDS = 3 * 60 * 60; // 3 hours

async function fetchEnabledFids(): Promise<number[]> {
    const apiKey = SERVER_ENV.NEYNAR_API_KEY;
    if (!apiKey) return [];
    const url = new URL('https://api.neynar.com/v2/farcaster/frame/notification_tokens/');
    const res = await fetch(url.toString(), { headers: { 'x-api-key': apiKey } });
    if (!res.ok) return [];
    const json = await res.json();
    const tokens: Array<{ fid: number }> | undefined = json?.notification_tokens;
    return (tokens || []).map(t => t.fid).filter((v, i, a) => a.indexOf(v) === i);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/admin/notifications/eligible
 * 
 * List all plants eligible for TOD notification (under 3h lifetime).
 * 
 * Query params:
 * - fid: Filter to specific user
 */
export async function GET(request: NextRequest) {
    if (!validateAdminKey(request)) {
        return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
    }

    try {
        const url = new URL(request.url);
        const targetFid = url.searchParams.get('fid') ? parseInt(url.searchParams.get('fid')!, 10) : undefined;

        // Fetch eligible fids
        let fids: number[];
        if (targetFid) {
            fids = [targetFid];
        } else {
            fids = await fetchEnabledFids();
        }

        const rpcUrl = 'https://base-rpc.publicnode.com';
        const now = new Date();
        const nowSec = Math.floor(now.getTime() / 1000);

        const eligible: Array<{
            fid: number;
            address: string;
            plants: Array<{
                id: number;
                timeUntilStarving: number;
                secondsLeft: number;
                hoursLeft: number;
                eligible: boolean;
                wouldBeThrottled: boolean;
            }>;
        }> = [];

        let totalEligiblePlants = 0;
        let totalThrottled = 0;

        for (const fid of fids) {
            // Resolve address
            let address: string | null = null;
            try {
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

            if (!address) continue;

            const plants = await getPlantsByOwnerWithRpc(address, rpcUrl);
            if (!plants?.length) continue;

            const plantDetails = plants.map(p => {
                const plantId = Number(p.id);
                const t = Number(p.timeUntilStarving ?? 0);
                const plantDate = new Date(t * 1000);
                const secondsLeft = differenceInSeconds(plantDate, now);
                const isEligible = secondsLeft > 0 && secondsLeft <= THRESHOLD_SECONDS;

                // Check if would be throttled
                let wouldBeThrottled = false;
                // We'll check async but for simplicity in listing, just note it

                if (isEligible) totalEligiblePlants++;

                return {
                    id: plantId,
                    timeUntilStarving: t,
                    secondsLeft,
                    hoursLeft: Math.round((secondsLeft / 3600) * 100) / 100,
                    eligible: isEligible,
                    wouldBeThrottled,
                };
            });

            const hasEligible = plantDetails.some(p => p.eligible);
            if (hasEligible || targetFid) {
                eligible.push({
                    fid,
                    address,
                    plants: plantDetails,
                });
            }
        }

        return NextResponse.json({
            success: true,
            timestamp: nowSec,
            thresholdHours: 3,
            summary: {
                fidsChecked: fids.length,
                fidsWithEligiblePlants: eligible.length,
                totalEligiblePlants,
            },
            eligible,
        });
    } catch (e: any) {
        return NextResponse.json(createErrorResponse(e?.message || 'Failed', 500).body, { status: 500 });
    }
}
