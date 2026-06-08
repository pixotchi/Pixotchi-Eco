// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - module types may not be present in local dev until deps are installed
import { Redis } from "@upstash/redis";
import { logger } from "./logger";

// Only check environment variables on server side
const isServer = typeof window === 'undefined';

// Access environment safely without requiring Node types
const env: Record<string, string | undefined> = (globalThis as UntypedValue)?.process?.env || {};

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
    let instance: Redis | null = null as UntypedValue;
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

export const stripPrefix = (key: string) =>
  key.startsWith(KEY_PREFIX) ? key.slice(KEY_PREFIX.length) : key;

// JSON helpers with type-safety and error-guarding
export async function redisGetJSON<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(withPrefix(key));
    if (raw == null) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Some providers may already return objects
        logger.warn('Failed to parse JSON value; returning raw', { key });
        return raw as UntypedValue as T;
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

export async function redisGetJSONRaw<T>(key: string): Promise<T | null> {
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    if (raw == null) return null;
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        logger.warn('Failed to parse raw JSON value; returning raw', { key });
        return raw as UntypedValue as T;
      }
    }
    return raw as T;
  } catch (error) {
    logger.error('redisGetJSONRaw failed', error, { key });
    return null;
  }
}

export async function redisSetJSONRaw<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
  if (!redis) return false;
  try {
    const v = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redis.set(key, v, { ex: ttlSeconds });
    } else {
      await redis.set(key, v);
    }
    return true;
  } catch (error) {
    logger.error('redisSetJSONRaw failed', error, { key });
    return false;
  }
}

export async function redisDelRaw(key: string): Promise<boolean> {
  if (!redis) return false;
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    logger.error('redisDelRaw failed', error, { key });
    return false;
  }
}

export async function redisKeys(pattern: string): Promise<string[]> {
  if (!redis) return [];
  try {
    // If consumer passes a fully-qualified key, keep as-is; otherwise prefix
    const pat = pattern.startsWith(KEY_PREFIX) ? pattern : withPrefix(pattern);
    const keys = await redis.keys(pat);
    return keys as UntypedValue as string[];
  } catch (error) {
    logger.error('redisKeys failed', error, { pattern });
    return [];
  }
}

async function scanKeysInternal(pattern: string, count: number = 1000): Promise<string[]> {
  if (!redis) return [];
  try {
    let cursor = '0';
    const results: string[] = [];

    do {
      const resp: UntypedValue = await (redis as UntypedValue).scan(cursor, { match: pattern, count });
      if (Array.isArray(resp)) {
        cursor = String(resp[0]);
        const batch: string[] = (resp[1] || []) as string[];
        results.push(...batch);
      } else if (resp && typeof resp === 'object' && 'cursor' in resp) {
        cursor = String(resp.cursor);
        results.push(...((resp.keys || []) as string[]));
      } else {
        break;
      }
    } while (cursor !== '0');

    return results;
  } catch (error) {
    logger.error('scanKeysInternal failed', error, { pattern, count });
    try {
      const keys = await redis.keys(pattern);
      return keys as UntypedValue as string[];
    } catch (fallbackError) {
      logger.error('scanKeysInternal fallback failed', fallbackError, { pattern, count });
      return [];
    }
  }
}

// Safer alternative to KEYS: iterate with SCAN to avoid blocking Redis on large datasets
export async function redisScanKeys(pattern: string, count: number = 1000): Promise<string[]> {
  if (!redis) return [];
  const pat = pattern.startsWith(KEY_PREFIX) ? pattern : withPrefix(pattern);
  return scanKeysInternal(pat, count);
}

export async function redisScanKeysRaw(pattern: string, count: number = 1000): Promise<string[]> {
  return scanKeysInternal(pattern, count);
}

export async function redisIncrBy(key: string, amount: number = 1): Promise<number | null> {
  if (!redis) return null;
  try {
    const val = await redis.incrby(withPrefix(key), amount);
    return val as UntypedValue as number;
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

export async function redisTTL(key: string): Promise<number | null> {
  if (!redis) return null;
  try {
    const ttl = await redis.ttl(withPrefix(key));
    if (typeof ttl === 'number') {
      return ttl;
    }
    if (ttl && typeof ttl === 'object' && 'ttl' in ttl && typeof (ttl as { ttl: number }).ttl === 'number') {
      return (ttl as { ttl: number }).ttl;
    }
    return null;
  } catch (error) {
    logger.error('redisTTL failed', error, { key });
    return null;
  }
}

export async function redisPersist(key: string): Promise<boolean> {
  if (!redis) return false;
  try {
    if (typeof (redis as UntypedValue).persist === 'function') {
      await (redis as UntypedValue).persist(withPrefix(key));
    } else {
      const ttl = await redisTTL(key);
      if (ttl && ttl > 0) {
        await redisExpire(key, Math.max(ttl, 1));
      }
    }
    return true;
  } catch (error) {
    logger.error('redisPersist failed', error, { key });
    return false;
  }
}

export type RedisClient = typeof redis;

const REDIS_CAS_SCRIPT = `
local key = KEYS[1]
local expected = ARGV[1]
local value = ARGV[2]
local ttl = tonumber(ARGV[3] or "0")

if expected == "__nil__" then
  if redis.call("EXISTS", key) == 0 then
    if ttl and ttl > 0 then
      redis.call("SET", key, value, "EX", ttl)
    else
      redis.call("SET", key, value)
    end
    return 1
  else
    return 0
  end
end

local current = redis.call("GET", key)
if current == expected then
  if ttl and ttl > 0 then
    redis.call("SET", key, value, "EX", ttl)
  else
    redis.call("SET", key, value)
  end
  return 1
end
return 0
`;

export async function redisCompareAndSetJSON(key: string, expected: string | null, value: string, ttlSeconds?: number): Promise<boolean> {
  if (!redis) return false;
  const fullKey = withPrefix(key);
  const sentinel = '__nil__';
  const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : 0;
  try {
    const evalFn = (redis as UntypedValue)?.eval;
    if (typeof evalFn === 'function') {
      const result = await evalFn.call(redis, REDIS_CAS_SCRIPT, [fullKey], [expected ?? sentinel, value, String(ttl)]);
      return Number(result) === 1;
    }

    if (expected == null) {
      const exists = await (redis as UntypedValue)?.exists?.(fullKey);
      if (Number(exists) === 0) {
        if (ttl > 0) {
          await redis.set(fullKey, value, { ex: ttl });
        } else {
          await redis.set(fullKey, value);
        }
        return true;
      }
      return false;
    }

    const current = await redis.get(fullKey);
    if (current === expected) {
      if (ttl > 0) {
        await redis.set(fullKey, value, { ex: ttl });
      } else {
        await redis.set(fullKey, value);
      }
      return true;
    }
    return false;
  } catch (error) {
    logger.error('redisCompareAndSetJSON failed', error, { key });
    return false;
  }
}

export async function redisCompareAndSetJSONRaw(key: string, expected: string | null, value: string, ttlSeconds?: number): Promise<boolean> {
  if (!redis) return false;
  const sentinel = '__nil__';
  const ttl = ttlSeconds && ttlSeconds > 0 ? ttlSeconds : 0;
  try {
    const evalFn = (redis as UntypedValue)?.eval;
    if (typeof evalFn === 'function') {
      const result = await evalFn.call(redis, REDIS_CAS_SCRIPT, [key], [expected ?? sentinel, value, String(ttl)]);
      return Number(result) === 1;
    }

    if (expected == null) {
      const exists = await (redis as UntypedValue)?.exists?.(key);
      if (Number(exists) === 0) {
        if (ttl > 0) {
          await redis.set(key, value, { ex: ttl });
        } else {
          await redis.set(key, value);
        }
        return true;
      }
      return false;
    }

    const current = await redis.get(key);
    if (current === expected) {
      if (ttl > 0) {
        await redis.set(key, value, { ex: ttl });
      } else {
        await redis.set(key, value);
      }
      return true;
    }
    return false;
  } catch (error) {
    logger.error('redisCompareAndSetJSONRaw failed', error, { key });
    return false;
  }
}
