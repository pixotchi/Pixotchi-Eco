import type { ZodType } from 'zod';

/** Redis REST clients may return JSON text or an already-decoded value. */
export function decodeRedisJson<T>(value: unknown, schema: ZodType<T>): T | null {
  try {
    const parsed = schema.safeParse(typeof value === 'string' ? JSON.parse(value) : value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
