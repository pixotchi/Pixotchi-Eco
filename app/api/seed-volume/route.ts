import { NextResponse } from 'next/server';

const SEED_PAIR_ADDRESS = '0xaa6a81a7df94dab346e2d677225cad47220540c5';
const DEXSCREENER_API = `https://api.dexscreener.com/latest/dex/pairs/base/${SEED_PAIR_ADDRESS}`;

// Cache duration for volume data (5 minutes)
const CACHE_DURATION = 5 * 60 * 1000;

type DexTimeWindow = 'm5' | 'h1' | 'h6' | 'h24';
type DexPairWindowStats = Partial<Record<DexTimeWindow, number>>;
type DexTxnStats = Partial<Record<DexTimeWindow, { buys?: number; sells?: number }>>;
type SeedMarketData = {
    cached?: boolean;
    dexId?: string;
    fdv: number | null;
    liquidityBase: number | null;
    liquidityQuote: number | null;
    liquidityUsd: number | null;
    marketCap: number | null;
    pairAddress?: string;
    pairCreatedAt: number | null;
    pairUrl?: string;
    priceChange: DexPairWindowStats;
    priceNative: string | null;
    priceUsd: string | null;
    rewards: number;
    stale?: boolean;
    timestamp: number;
    txns: DexTxnStats;
    volume: DexPairWindowStats;
    volume24h: number;
};
type DexScreenerPair = {
    dexId?: string;
    fdv?: number | null;
    liquidity?: {
        base?: number | null;
        quote?: number | null;
        usd?: number | null;
    } | null;
    marketCap?: number | null;
    pairAddress?: string;
    pairCreatedAt?: number | null;
    priceChange?: DexPairWindowStats | null;
    priceNative?: string | null;
    priceUsd?: string | null;
    txns?: DexTxnStats | null;
    url?: string;
    volume?: DexPairWindowStats | null;
};

let cachedData: SeedMarketData | null = null;

function normalizeNumber(value: UntypedValue): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeWindowStats(value: UntypedValue): DexPairWindowStats {
    const source = value && typeof value === 'object' ? value as Record<string, UntypedValue> : {};
    return {
        ...(normalizeNumber(source.m5) !== null ? { m5: normalizeNumber(source.m5)! } : {}),
        ...(normalizeNumber(source.h1) !== null ? { h1: normalizeNumber(source.h1)! } : {}),
        ...(normalizeNumber(source.h6) !== null ? { h6: normalizeNumber(source.h6)! } : {}),
        ...(normalizeNumber(source.h24) !== null ? { h24: normalizeNumber(source.h24)! } : {}),
    };
}

function normalizeTxns(value: UntypedValue): DexTxnStats {
    const source = value && typeof value === 'object' ? value as Record<string, UntypedValue> : {};
    const result: DexTxnStats = {};

    (['m5', 'h1', 'h6', 'h24'] as const).forEach((window) => {
        const entry = source[window];
        if (!entry || typeof entry !== 'object') {
            return;
        }

        const record = entry as Record<string, UntypedValue>;
        const buys = normalizeNumber(record.buys);
        const sells = normalizeNumber(record.sells);
        result[window] = {
            ...(buys !== null ? { buys } : {}),
            ...(sells !== null ? { sells } : {}),
        };
    });

    return result;
}

/**
 * GET /api/seed-volume
 * Fetches SEED pair market data from DexScreener and calculates 2% rewards.
 */
export async function GET() {
    try {
        // Return cached data if still valid
        const now = Date.now();
        if (cachedData && (now - cachedData.timestamp) < CACHE_DURATION) {
            return NextResponse.json({
                ...cachedData,
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

        const data = await response.json() as UntypedValue;
        const pair = ((data?.pair ?? data?.pairs?.[0]) ?? {}) as DexScreenerPair;
        const volume = normalizeWindowStats(pair.volume);
        const priceChange = normalizeWindowStats(pair.priceChange);
        const txns = normalizeTxns(pair.txns);

        // Extract 24h volume from the pair data
        const volume24h = volume.h24 ?? 0;

        // Calculate 2% of volume as rewards
        const rewards = volume24h * 0.02;

        // Cache the result
        cachedData = {
            dexId: pair.dexId,
            fdv: normalizeNumber(pair.fdv),
            liquidityBase: normalizeNumber(pair.liquidity?.base),
            liquidityQuote: normalizeNumber(pair.liquidity?.quote),
            liquidityUsd: normalizeNumber(pair.liquidity?.usd),
            marketCap: normalizeNumber(pair.marketCap),
            pairAddress: pair.pairAddress,
            pairCreatedAt: normalizeNumber(pair.pairCreatedAt),
            pairUrl: pair.url,
            priceChange,
            priceNative: typeof pair.priceNative === 'string' ? pair.priceNative : null,
            priceUsd: typeof pair.priceUsd === 'string' ? pair.priceUsd : null,
            rewards,
            volume24h,
            volume,
            txns,
            timestamp: now,
        };

        return NextResponse.json({
            ...cachedData,
            cached: false,
        });
    } catch (error) {
        console.error('Error fetching SEED volume:', error);

        // Return cached data if available, even if stale
        if (cachedData) {
            return NextResponse.json({
                ...cachedData,
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
