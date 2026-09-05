import { readAddress, readRecord, readSafeUint, readUint } from './contract-value';

export type StakeLeaderboardEntry = { rank: number; address: string; stakedAmount: bigint; ensName?: string };
export type RocksLeaderboardEntry = { rank: number; address: string; rocks: number; name: string | null };
export type RocksRanking = { disabled: false; rows: RocksLeaderboardEntry[] } | { disabled: true; message: string; rows: [] };

function optionalName(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('Invalid ranking name');
  return value;
}

function entries(value: unknown): unknown[] {
  const payload = readRecord(value);
  if (payload.success !== true || !Array.isArray(payload.leaderboard)) throw new Error('Invalid ranking response');
  return payload.leaderboard;
}

function rank(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Invalid ranking position');
  return value;
}

export function parseStakeRanking(value: unknown): StakeLeaderboardEntry[] {
  return entries(value).map(raw => {
    const entry = readRecord(raw);
    return { rank: rank(entry.rank), address: readAddress(entry.address), stakedAmount: readUint(entry.stakedAmount), ensName: optionalName(entry.ensName) };
  });
}

export function parseRocksRanking(value: unknown): RocksRanking {
  const payload = readRecord(value);
  if (payload.success !== true) throw new Error('Invalid Rocks response');
  if (payload.disabled !== undefined && typeof payload.disabled !== 'boolean') throw new Error('Invalid Rocks availability');
  if (payload.disabled === true) {
    if (typeof payload.message !== 'string' || !payload.message.trim()) throw new Error('Missing Rocks availability message');
    return { disabled: true, message: payload.message, rows: [] };
  }
  return { disabled: false, rows: entries(value).map(raw => {
    const entry = readRecord(raw);
    return { rank: rank(entry.rank), address: readAddress(entry.address), rocks: readSafeUint(entry.rocks), name: optionalName(entry.name) ?? null };
  }) };
}
