import 'server-only';
import { redis, withPrefix } from './redis';
import { parseAirdropEligibility } from './airdrop-claim-state';
import type { AirdropStore } from './airdrop-execution';
import { AIRDROP_CAS_SCRIPT, AIRDROP_RAW_PREFIX, AIRDROP_READ_RAW_SCRIPT } from './airdrop-store-cas';

export async function readAirdropRaw(key: string): Promise<string | null> {
  if (!redis) throw new Error('Airdrop storage unavailable');
  const result = await redis.eval(AIRDROP_READ_RAW_SCRIPT, [key], []);
  if (result == null || result === false) return null;
  if (typeof result !== 'string' || !result.startsWith(AIRDROP_RAW_PREFIX)) throw new Error('Invalid airdrop storage response');
  return result.slice(AIRDROP_RAW_PREFIX.length);
}

/** Exact-record CAS is mandatory; no non-atomic exists/get/set fallback for payouts. */
export function createAirdropStore(address: string): AirdropStore {
  const key = `airdrop:eligible:${address.toLowerCase()}`;
  return {
    read: async () => {
      if (!redis) throw new Error('Airdrop storage unavailable');
      const value = await readAirdropRaw(key);
      if (value == null) return null;
      const record = parseAirdropEligibility(value);
      if (!record) throw new Error('Invalid airdrop record');
      return { raw: value, record };
    },
    cas: async (raw, next) => {
      if (!redis) throw new Error('Airdrop storage unavailable');
      return Number(await redis.eval(AIRDROP_CAS_SCRIPT, [key], [raw, JSON.stringify(next)])) === 1;
    },
    metric: async event => {
      if (!redis) return;
      // Seven fixed event names and seven-day daily buckets; no wallet/hash/signature labels.
      const metricKey = withPrefix(`airdrop:metrics:${new Date().toISOString().slice(0, 10)}:${event}`);
      await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],604800) end; return n", [metricKey], []);
    },
  };
}
