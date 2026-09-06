import { asRecord, parseReceiptBlock } from '@/lib/transaction-utils';

// getLeaderboard returns these three fields; ownership is a separate contract read.
export type LandLeaderboardEntry = { landId: number; experiencePoints: bigint; name: string };
export type LandLeaderboardRow = { rank: number; landId: number; name: string; exp: number };

export function parseLandLeaderboard(value: unknown): LandLeaderboardEntry[] {
  if (!Array.isArray(value)) throw new Error('Land ranking response is unavailable.');
  return value.map(entry => {
    const record = asRecord(entry);
    const field = (name: string, index: number): unknown => Array.isArray(entry) ? entry[index] : record?.[name];
    const landId = parseReceiptBlock(field('landId', 0));
    const experiencePoints = parseReceiptBlock(field('experiencePoints', 1));
    const name = field('name', 2);
    if (landId === undefined || landId > BigInt(Number.MAX_SAFE_INTEGER) || experiencePoints === undefined
      || typeof name !== 'string') throw new Error('Land ranking response is incomplete.');
    return { landId: Number(landId), experiencePoints, name };
  });
}

export function rankLands(entries: LandLeaderboardEntry[]): LandLeaderboardRow[] {
  return [...entries].sort((a, b) => a.experiencePoints === b.experiencePoints ? a.landId - b.landId : a.experiencePoints > b.experiencePoints ? -1 : 1)
    .map((land, index) => ({ rank: index + 1, landId: land.landId, name: land.name || `Land #${land.landId}`, exp: Number(land.experiencePoints) / 1e18 }));
}
