import { NextResponse, type NextRequest } from 'next/server';
import { redisGetJSON, redisSetJSON } from '@/lib/redis';
import {
  fetchMemoryWalletProfile,
  fetchMemoryTwitterPosts,
  MemoryServiceError,
  deriveHandlesFromRaw,
} from '@/lib/memory-service';
import { fetchEfpStats } from '@/lib/efp-service';
import type {
  SocialProfilePayload,
  IdentitySummary,
  SocialProfileTwitterData,
  TwitterPost,
} from '@/lib/social-profile';

const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const SHORT_TTL_SECONDS = 2 * 60; // 2 minutes for incomplete twitter fetches
const SOCIAL_CACHE_PREFIX = 'profile:social:';

function buildCacheKey(address: string): string {
  return `${SOCIAL_CACHE_PREFIX}${address.toLowerCase()}`;
}

function parseTimestampToMillis(input?: string | null): number | null {
  if (!input) return null;
  const normalized = input.includes('T') ? input : `${input.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function normalizePostDate(post: any): string | null {
  const raw = post?.creationDate ?? post?.createdAt ?? null;
  const millis = parseTimestampToMillis(raw);
  if (millis) {
    return new Date(millis).toISOString();
  }
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  return null;
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

    let twitterData: SocialProfileTwitterData | undefined;
    const twitterHandle = handles?.find(
      (handle) => handle.platform?.toLowerCase?.() === 'twitter' && handle.value,
    );

    if (twitterHandle?.value) {
      try {
        console.log('[SocialProfile] fetching twitter posts', {
          address: addressParam,
          username: twitterHandle.value,
        });
        const twitterResponse = await fetchMemoryTwitterPosts(twitterHandle.value, { limit: 10 });
        if (twitterResponse) {
          const posts = Array.isArray(twitterResponse.posts)
            ? twitterResponse.posts.slice(0, 10).map((post: any) => {
                const id = post?.id ?? post?.post_id ?? post?.tweet_id;
                if (!id) {
                  return null;
                }
                const text = typeof post?.text === 'string' ? post.text : '';
                const url =
                  post?.url ||
                  (typeof id === 'string' || typeof id === 'number'
                    ? `https://x.com/i/web/status/${id}`
                    : null);
                const metrics = {
                  likes: typeof post?.likesCount === 'number' ? post.likesCount : undefined,
                  reposts: typeof post?.repostCount === 'number' ? post.repostCount : undefined,
                  quotes: typeof post?.quoteCount === 'number' ? post.quoteCount : undefined,
                  replies: typeof post?.replyCount === 'number' ? post.replyCount : undefined,
                  bookmarks: typeof post?.bookmarkCount === 'number' ? post.bookmarkCount : undefined,
                };
                const media = Array.isArray(post?.media)
                  ? post.media.map((item: any) => ({
                      type: item?.type ?? null,
                      url: item?.url ?? null,
                    }))
                  : undefined;

                return {
                  id: String(id),
                  text,
                  createdAt: normalizePostDate(post),
                  url: url ?? null,
                  metrics,
                  media,
                } satisfies TwitterPost;
              })
                .filter((post): post is TwitterPost => Boolean(post))
            : [];

          twitterData = {
            username: twitterResponse.profile?.username ?? twitterHandle.value,
            status: twitterResponse.status ?? 'unknown',
            fetchedAt:
              parseTimestampToMillis(twitterResponse.timestamp) ?? Date.now(),
            posts,
            profile: twitterResponse.profile
              ? {
                  id: twitterResponse.profile.id,
                  username: twitterResponse.profile.username,
                  displayName: twitterResponse.profile.displayName,
                  avatarUrl: twitterResponse.profile.avatarUrl,
                  followersCount: twitterResponse.profile.followersCount,
                  followingCount: twitterResponse.profile.followingCount,
                }
              : undefined,
          };
        }
      } catch (error) {
        console.warn('[SocialProfile] Failed to fetch twitter posts', error);
      }
    } else {
      console.log('[SocialProfile] no twitter handle found, skipping posts fetch', {
        address: addressParam,
      });
    }

    const payload: SocialProfilePayload = {
      address: addressParam,
      identifier: identifierForMemory,
      memoryProfile,
      efpStats,
      fetchedAt: Date.now(),
      identitySummary,
      twitter: twitterData,
    };

    const shouldDeferTwitterCache =
      Boolean(twitterData) &&
      (!twitterData?.posts?.length || twitterData.status !== 'completed');

    const cacheTtl = shouldDeferTwitterCache ? SHORT_TTL_SECONDS : CACHE_TTL_SECONDS;

    if (memoryProfile) {
      redisSetJSON(cacheKey, payload, cacheTtl).catch((error) => {
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

