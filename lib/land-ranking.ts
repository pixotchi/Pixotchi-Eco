import { asRecord, parseReceiptBlock } from '@/lib/transaction-utils';

export type LandLeaderboardEntry = { landId: number; experiencePoints: bigint; name: string; owner: string };
export type LandLeaderboardRow = { rank: number; landId: number; name: string; exp: number };

export function parseLandLeaderboard(value: unknown): LandLeaderboardEntry[] {
  if (!Array.isArray(value)) throw new Error('Land ranking response is unavailable.');
  return value.map(entry => {
    const record = asRecord(entry);
    const field = (name: string, index: number): unknown => Array.isArray(entry) ? entry[index] : record?.[name];
    const landId = parseReceiptBlock(field('landId', 0));
    const experiencePoints = parseReceiptBlock(field('experiencePoints', 1));
    const name = field('name', 2);
    const owner = field('owner', 3);
    if (landId === undefined || landId > BigInt(Number.MAX_SAFE_INTEGER) || experiencePoints === undefined
      || typeof name !== 'string' || typeof owner !== 'string' || !/^0x[\da-f]{40}$/i.test(owner)) throw new Error('Land ranking response is incomplete.');
    return { landId: Number(landId), experiencePoints, name, owner };
  });
}

export function rankLands(entries: LandLeaderboardEntry[]): LandLeaderboardRow[] {
  return [...entries].sort((a, b) => a.experiencePoints === b.experiencePoints ? a.landId - b.landId : a.experiencePoints > b.experiencePoints ? -1 : 1)
    .map((land, index) => ({ rank: index + 1, landId: land.landId, name: land.name || `Land #${land.landId}`, exp: Number(land.experiencePoints) / 1e18 }));
}
