import { NextResponse, type NextRequest } from 'next/server';
import { redisGetJSON, redisSetJSON, redisScanKeys, redis } from '@/lib/redis';
import {
  fetchMemoryWalletProfile,
  MemoryServiceError,
  deriveHandlesFromRaw,
} from '@/lib/memory-service';
import { fetchEfpStats } from '@/lib/efp-service';
import type { SocialProfilePayload, IdentitySummary } from '@/lib/social-profile';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const SOCIAL_CACHE_PREFIX = 'profile:social:';
const SOCIAL_CACHE_VERSION_KEY = `${SOCIAL_CACHE_PREFIX}deploy-version`;
const REDIS_KEY_PREFIX = process.env.UPSTASH_KEY_PREFIX || 'pixotchi:';
const DEPLOYMENT_VERSION = process.env.VERCEL_GIT_COMMIT_SHA
  || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  || process.env.VERCEL_DEPLOYMENT_ID
  || process.env.VERCEL_BUILD_ID
  || process.env.COMMIT_REF
  || process.env.BUILD_ID
  || process.env.GIT_COMMIT_SHA
  || (typeof process !== 'undefined' && typeof process.pid === 'number' ? `local-${process.pid}` : 'local');

let ensuredDeploymentVersion: string | null = null;
let ensuringDeploymentPromise: Promise<void> | null = null;

function fullKey(key: string) {
  return key.startsWith(REDIS_KEY_PREFIX) ? key : `${REDIS_KEY_PREFIX}${key}`;
}

async function deleteKeys(keys: string[]) {
  if (!redis || !keys.length) return;
  const chunkSize = 256;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    if (chunk.length) {
      await redis.del(...chunk);
    }
  }
}

async function ensureFreshSocialCache() {
  if (!redis) return;
  if (!DEPLOYMENT_VERSION) return;
  if (ensuredDeploymentVersion === DEPLOYMENT_VERSION) return;
  if (ensuringDeploymentPromise) {
    await ensuringDeploymentPromise;
    return;
  }

  ensuringDeploymentPromise = (async () => {
    const versionKey = fullKey(SOCIAL_CACHE_VERSION_KEY);
    try {
      const storedVersionRaw = await redis.get(versionKey);
      const storedVersion = typeof storedVersionRaw === 'string'
        ? storedVersionRaw
        : storedVersionRaw != null
          ? String(storedVersionRaw)
          : null;

      if (storedVersion !== DEPLOYMENT_VERSION) {
        const keys = await redisScanKeys(`${SOCIAL_CACHE_PREFIX}*`);
        const keysToDelete = keys.filter((key) => key !== versionKey);
        if (keysToDelete.length) {
          await deleteKeys(keysToDelete);
        }
        await redis.set(versionKey, DEPLOYMENT_VERSION);
      }

      ensuredDeploymentVersion = DEPLOYMENT_VERSION;
    } catch (error) {
      console.warn('[SocialProfile] Failed to ensure fresh deployment cache', error);
    } finally {
      ensuringDeploymentPromise = null;
    }
  })();

  await ensuringDeploymentPromise;
}

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

  await ensureFreshSocialCache();

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

    if (memoryProfile || efpStats) {
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

