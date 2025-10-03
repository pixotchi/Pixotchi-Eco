// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - module types may not be present in local dev until deps are installed
import { Redis } from "@upstash/redis";
import { logger } from "./logger";

// Only check environment variables on server side
const isServer = typeof window === 'undefined';

// Access environment safely without requiring Node types
const env: Record<string, string | undefined> = (globalThis as any)?.process?.env || {};

// Check for environment variables (support multiple provider envs)
const hasUpstashVars = isServer && !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
const hasKVVars = isServer && !!(env.KV_REST_API_URL && env.KV_REST_API_TOKEN);
const hasKVDoubleVars = isServer && !!(env.KV_KV_REST_API_URL && env.KV_KV_REST_API_TOKEN);
const hasCustomVars = isServer && !!(env.REDIS_URL && env.REDIS_TOKEN);

// Only show warning on server side in development
if (isServer && !hasUpstashVars && !hasKVVars && !hasKVDoubleVars && !hasCustomVars && env.NODE_ENV === 'development') {
  logger.warn(
    "Redis environment variables not found. Please set either: " +
    "UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (recommended), " +
    "KV_REST_API_URL and KV_REST_API_TOKEN (from Vercel KV integration), " +
    "KV_KV_REST_API_URL and KV_KV_REST_API_TOKEN (alternative Vercel KV), or " +
    "REDIS_URL and REDIS_TOKEN (custom)"
  );
}

// Create a single Redis instance for server runtime
export const redis = (() => {
  if (!isServer) return null;
  try {
    let instance: Redis | null = null as any;
    if (hasUpstashVars) {
      instance = Redis.fromEnv();
    } else if (hasKVVars) {
      instance = new Redis({ url: env.KV_REST_API_URL!, token: env.KV_REST_API_TOKEN! });
    } else if (hasKVDoubleVars) {
      instance = new Redis({ url: env.KV_KV_REST_API_URL!, token: env.KV_KV_REST_API_TOKEN! });
    } else if (hasCustomVars) {
      instance = new Redis({ url: env.REDIS_URL!, token: env.REDIS_TOKEN! });
    } else {
      logger.error('No valid environment variables found for Redis');
      return null;
    }

    // Async connectivity check (non-blocking)
    setTimeout(async () => {
      try {
        await instance!.ping();
        logger.debug('Redis connection test successful');
      } catch (e) {
        logger.error('Redis connection test failed', e);
      }
    }, 0);

    return instance;
  } catch (error) {
    logger.error('Exception during Redis initialization', error);
    return null;
  }
})();

// Safe key prefixing to avoid collisions
const KEY_PREFIX = env.UPSTASH_KEY_PREFIX || 'pixotchi:';

export const withPrefix = (key: string) => (key.startsWith(KEY_PREFIX) ? key : `${KEY_PREFIX}${key}`);

// JSON helpers with type-safety and error-guarding
export async function redisGetJSON<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(withPrefix(key));
    if (raw == null) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch (e) {
        // Some providers may already return objects
        logger.warn('Failed to parse JSON value; returning raw', { key });
        return raw as unknown as T;
      }
    }
    return raw as T;
  } catch (error) {
    logger.error('redisGetJSON failed', error, { key });
    return null;
  }
}

export async function redisSetJSON<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
  if (!redis) return false;
  try {
    const k = withPrefix(key);
    const v = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(k, v, { ex: ttlSeconds });
    } else {
      await redis.set(k, v);
    }
    return true;
  } catch (error) {
    logger.error('redisSetJSON failed', error, { key });
    return false;
  }
}

export async function redisDel(key: string): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.del(withPrefix(key));
    return true;
  } catch (error) {
    logger.error('redisDel failed', error, { key });
    return false;
  }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  if (!redis) return [];
  try {
    // If consumer passes a fully-qualified key, keep as-is; otherwise prefix
    const pat = pattern.startsWith(KEY_PREFIX) ? pattern : withPrefix(pattern);
    const keys = await redis.keys(pat);
    return keys as unknown as string[];
  } catch (error) {
    logger.error('redisKeys failed', error, { pattern });
    return [];
  }
}

// Safer alternative to KEYS: iterate with SCAN to avoid blocking Redis on large datasets
export async function redisScanKeys(pattern: string, count: number = 1000): Promise<string[]> {
  if (!redis) return [];
  try {
    const pat = pattern.startsWith(KEY_PREFIX) ? pattern : withPrefix(pattern);
    let cursor = 0;
    const results: string[] = [];
    // Upstash scan returns [nextCursor, keys]
    do {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp: any = await (redis as any).scan(cursor, { match: pat, count });
      if (Array.isArray(resp)) {
        cursor = typeof resp[0] === 'string' ? parseInt(resp[0], 10) : resp[0];
        const batch: string[] = (resp[1] || []) as string[];
        results.push(...batch);
      } else if (resp && typeof resp === 'object' && 'cursor' in resp) {
        cursor = Number(resp.cursor) || 0;
        results.push(...((resp.keys || []) as string[]));
      } else {
        break;
      }
    } while (cursor !== 0);
    return results;
  } catch (error) {
    logger.error('redisScanKeys failed', error, { pattern, count });
    // Fallback to KEYS (still dangerous, but better than failing silently)
    return redisKeys(pattern);
  }
}

export async function redisIncrBy(key: string, amount: number = 1): Promise<number | null> {
  if (!redis) return null;
  try {
    const val = await redis.incrby(withPrefix(key), amount);
    return val as unknown as number;
  } catch (error) {
    logger.error('redisIncrBy failed', error, { key, amount });
    return null;
  }
}

export async function redisExpire(key: string, ttlSeconds: number): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.expire(withPrefix(key), ttlSeconds);
    return true;
  } catch (error) {
    logger.error('redisExpire failed', error, { key, ttlSeconds });
    return false;
  }
}

export type RedisClient = typeof redis;
