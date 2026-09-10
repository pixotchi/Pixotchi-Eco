import { redis, withPrefix } from './redis';
import { BLACKJACK_INVENTORY_KEY, BlackjackLockServiceError, isStableBlackjackInventory } from './blackjack-locks';

/** No GET/SET fallback: all decisions and migration changes require Redis Lua CAS. */
export interface BlackjackLockStore {
  read(key: string): Promise<string | null>;
  scan(cursor: string, count: number): Promise<{ cursor: string; keys: string[] }>;
  compareAndSet(key: string, expected: string | null, value: string): Promise<boolean>;
  guardedWrite(key: string, expected: string | null, value: string, guards: Array<[string, string | null]>): Promise<boolean>;
}

export const BLACKJACK_GUARDED_WRITE_SCRIPT = `
for i = 2, #KEYS do
  local current = redis.call('GET', KEYS[i])
  local expected = ARGV[i + 1]
  if expected == '__nil__' then
    if current then return 0 end
  elseif current ~= expected then return 0 end
end
local current = redis.call('GET', KEYS[1])
if ARGV[1] == '__nil__' then
  if current then return 0 end
elseif current ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1
`;

export function createBlackjackRedisStore(client = redis, prefixKey = withPrefix): BlackjackLockStore {
  if (!client) throw new BlackjackLockServiceError('unavailable');
  const guardedWrite: BlackjackLockStore['guardedWrite'] = async (key, expected, value, guards) => {
    try {
      const result = await client.eval(BLACKJACK_GUARDED_WRITE_SCRIPT,
        [key, ...guards.map(([guard]) => guard)].map(prefixKey),
        [expected ?? '__nil__', value, ...guards.map(([, raw]) => raw ?? '__nil__')]);
      return Number(result) === 1;
    } catch { throw new BlackjackLockServiceError('unavailable'); }
  };
  return {
    async read(key) {
      try {
        // Prefix the Lua result to bypass Upstash's automatic JSON decoding.
        // CAS must compare the exact stored bytes, including JSON whitespace.
        const raw = await client.eval<[], string | null>("local v = redis.call('GET', KEYS[1]); if not v then return nil end; return 'raw:' .. v", [prefixKey(key)], []);
        if (raw === null) return null;
        if (typeof raw !== 'string' || !raw.startsWith('raw:')) throw new Error('Invalid Redis record');
        return raw.slice(4);
      } catch { throw new BlackjackLockServiceError('unavailable'); }
    },
    async scan(cursor, count) {
      try {
        const result = await client.scan(cursor, { match: prefixKey('blackjack:action-lock:*'), count });
        if (!Array.isArray(result) || result.length !== 2 || !/^\d+$/.test(String(result[0]))
          || !Array.isArray(result[1]) || !result[1].every(key => typeof key === 'string' && key.startsWith(prefixKey('blackjack:action-lock:')))) {
          throw new Error('Invalid SCAN response');
        }
        const prefix = prefixKey('');
        return { cursor: String(result[0]), keys: result[1].map(key => key.slice(prefix.length)) };
      } catch { throw new BlackjackLockServiceError('unavailable'); }
    },
    compareAndSet: (key, expected, value) => guardedWrite(key, expected, value, []),
    guardedWrite,
  };
}

export async function requireBlackjackInventory(store: BlackjackLockStore, signer: string, rolloutId: string): Promise<string> {
  const raw = await store.read(BLACKJACK_INVENTORY_KEY);
  let parsed: unknown;
  try { parsed = raw === null ? null : JSON.parse(raw); } catch { throw new BlackjackLockServiceError('invalid'); }
  if (!raw || !isStableBlackjackInventory(parsed, signer, rolloutId)) throw new BlackjackLockServiceError('inventory_required');
  return raw;
}
