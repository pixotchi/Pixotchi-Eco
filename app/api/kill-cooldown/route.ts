import { NextRequest, NextResponse } from 'next/server';
import { redis, withPrefix, redisTTL } from '@/lib/redis';

const KILL_COOLDOWN_SECONDS = 3600; // 1 hour

function getKillCooldownKey(address: string): string {
    return `kill:cooldown:${address.toLowerCase()}`;
}

/**
 * GET /api/kill-cooldown?address=0x...
 * Check if wallet can perform a kill
 */
export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
        return NextResponse.json({ error: 'Address required' }, { status: 400 });
    }

    if (!redis) {
        // If Redis is unavailable, allow kills (graceful degradation)
        return NextResponse.json({ canKill: true, remainingSeconds: 0 });
    }

    try {
        const key = getKillCooldownKey(address);
        const ttl = await redisTTL(key);

        if (ttl === null || ttl <= 0) {
            // No cooldown active
            return NextResponse.json({ canKill: true, remainingSeconds: 0 });
        }

        // Cooldown is active
        return NextResponse.json({ canKill: false, remainingSeconds: ttl });
    } catch (error) {
        console.error('Error checking kill cooldown:', error);
        // On error, allow kills (graceful degradation)
        return NextResponse.json({ canKill: true, remainingSeconds: 0 });
    }
}

/**
 * POST /api/kill-cooldown
 * Record a kill and start cooldown
 * Body: { address: "0x..." }
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { address } = body;

        if (!address) {
            return NextResponse.json({ error: 'Address required' }, { status: 400 });
        }

        if (!redis) {
            // If Redis is unavailable, just acknowledge
            return NextResponse.json({
                success: true,
                cooldownUntil: Math.floor(Date.now() / 1000) + KILL_COOLDOWN_SECONDS
            });
        }

        const key = getKillCooldownKey(address);
        const cooldownUntil = Math.floor(Date.now() / 1000) + KILL_COOLDOWN_SECONDS;

        // Set the cooldown with TTL
        await redis.set(withPrefix(key), cooldownUntil.toString(), { ex: KILL_COOLDOWN_SECONDS });

        return NextResponse.json({
            success: true,
            cooldownUntil
        });
    } catch (error) {
        console.error('Error setting kill cooldown:', error);
        return NextResponse.json({ error: 'Failed to set cooldown' }, { status: 500 });
    }
}
