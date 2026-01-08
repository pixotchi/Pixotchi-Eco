import { NextResponse } from 'next/server';

const SEED_PAIR_ADDRESS = '0xaa6a81a7df94dab346e2d677225cad47220540c5';
const DEXSCREENER_API = `https://api.dexscreener.com/latest/dex/pairs/base/${SEED_PAIR_ADDRESS}`;

// Cache duration for volume data (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

let cachedData: {
    volume24h: number;
    rewards: number;
    timestamp: number;
} | null = null;

/**
 * GET /api/seed-volume
 * Fetches 24h volume from DexScreener and calculates 2% rewards
 */
export async function GET() {
    try {
        // Return cached data if still valid
        const now = Date.now();
        if (cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
            return NextResponse.json({
                volume24h: cachedData.volume24h,
                rewards: cachedData.rewards,
                cached: true,
            });
        }

        // Fetch from DexScreener
        const response = await fetch(DEXSCREENER_API, {
            headers: {
                'Accept': 'application/json',
            },
            next: { revalidate: 300 }, // 5 minute revalidation
        });

        if (!response.ok) {
            throw new Error(`DexScreener API error: ${response.status}`);
        }

        const data = await response.json();

        // Extract 24h volume from the pair data
        const volume24h = data.pair?.volume?.h24 || data.pairs?.[0]?.volume?.h24 || 0;

        // Calculate 2% of volume as rewards
        const rewards = volume24h * 0.02;

        // Cache the result
        cachedData = {
            volume24h,
            rewards,
            timestamp: now,
        };

        return NextResponse.json({
            volume24h,
            rewards,
            cached: false,
        });
    } catch (error) {
        console.error('Error fetching SEED volume:', error);

        // Return cached data if available, even if stale
        if (cachedData) {
            return NextResponse.json({
                volume24h: cachedData.volume24h,
                rewards: cachedData.rewards,
                cached: true,
                stale: true,
            });
        }

        return NextResponse.json(
            { error: 'Failed to fetch volume data' },
            { status: 500 }
        );
    }
}
