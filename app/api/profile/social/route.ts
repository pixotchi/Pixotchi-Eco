import { NextResponse, type NextRequest } from 'next/server';
import { redisGetJSON, redisSetJSON } from '@/lib/redis';
import {
  fetchMemoryWalletProfile,
  MemoryServiceError,
  deriveHandlesFromRaw,
} from '@/lib/memory-service';
import { fetchEfpStats } from '@/lib/efp-service';
import type { SocialProfilePayload, IdentitySummary } from '@/lib/social-profile';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const SOCIAL_CACHE_PREFIX = 'profile:social:';

function buildCacheKey(address: string): string {
  return `${SOCIAL_CACHE_PREFIX}${address.toLowerCase()}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const addressParam = searchParams.get('address')?.trim();
  const identifierParam = searchParams.get('identifier')?.trim();

  if (!addressParam || addressParam.length === 0) {
    return NextResponse.json({
      success: false,
      error: 'Missing required "address" query parameter.',
    }, { status: 400 });
  }

  const cacheKey = buildCacheKey(addressParam);

  try {
    const cached = await redisGetJSON<SocialProfilePayload>(cacheKey);
    if (cached) {
      return NextResponse.json({
        success: true,
        cached: true,
        data: cached,
      });
    }
  } catch (error) {
    console.warn('[SocialProfile] Failed to read cache', error);
  }

  try {
    const identifierForMemory = identifierParam && identifierParam.length > 0
      ? identifierParam
      : addressParam;
    const [memoryProfile, efpStats] = await Promise.all([
      fetchMemoryWalletProfile(identifierForMemory),
      fetchEfpStats(addressParam),
    ]);

    const rawSource = memoryProfile?.raw ?? memoryProfile;
    const handles = memoryProfile?.handles && memoryProfile.handles.length > 0
      ? memoryProfile.handles
      : deriveHandlesFromRaw(rawSource);

    const platformCounts = new Map<string, number>();
    handles?.forEach((handle) => {
      const key = handle.platform?.toLowerCase?.() || 'unknown';
      platformCounts.set(key, (platformCounts.get(key) ?? 0) + 1);
    });

    const identitySummary: IdentitySummary | undefined = handles && handles.length > 0
      ? {
          total: handles.length,
          platforms: Array.from(platformCounts.entries())
            .map(([platform, count]) => ({ platform, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6),
          handles,
        }
      : undefined;

    const payload: SocialProfilePayload = {
      address: addressParam,
      identifier: identifierForMemory,
      memoryProfile,
      efpStats,
      fetchedAt: Date.now(),
      identitySummary,
    };

    if (memoryProfile) {
      redisSetJSON(cacheKey, payload, CACHE_TTL_SECONDS).catch((error) => {
        console.warn('[SocialProfile] Failed to write cache', error);
      });
    }

    return NextResponse.json({
      success: true,
      cached: false,
      data: payload,
    });
  } catch (error) {
    if (error instanceof MemoryServiceError) {
      const status = error.status && error.status >= 400 ? error.status : 502;
      return NextResponse.json({
        success: false,
        error: error.message || 'Memory service error',
        statusCode: error.status ?? status,
      }, { status });
    }

    console.error('[SocialProfile] Unexpected error', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to fetch social profile',
    }, { status: 500 });
  }
}

