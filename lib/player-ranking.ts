import { readAddress, readRecord, readSafeUint, readUint } from './contract-value';

export type PlayerRankingRow = { rank: number; address: `0x${string}`; points: bigint; plantCount: number };
export type PlayerRankingSnapshot = {
  rows: PlayerRankingRow[];
  totalPoints: bigint;
  totalPlants: number;
  blockNumber: bigint;
  updatedAt: number;
};
export type PlayerPoints = { id: bigint; owner: `0x${string}`; score: bigint };
const ZERO = BigInt(0);

/** Each existing plant contributes once, before any pagination or wallet filtering. */
export function aggregatePlayerPoints(plants: PlayerPoints[], blockNumber: bigint, updatedAt: number): PlayerRankingSnapshot {
  const wallets = new Map<string, Omit<PlayerRankingRow, 'rank'>>();
  const seen = new Set<bigint>();
  let totalPoints = ZERO;
  for (const plant of plants) {
    if (seen.has(plant.id)) throw new Error('Duplicate plant in ranking snapshot');
    seen.add(plant.id);
    const address = readAddress(plant.owner).toLowerCase() as `0x${string}`;
    if (address === `0x${'0'.repeat(40)}`) throw new Error('Missing plant owner');
    const score = readUint(plant.score);
    const row = wallets.get(address) ?? { address, points: ZERO, plantCount: 0 };
    row.points += score;
    row.plantCount += 1;
    wallets.set(address, row);
    totalPoints += score;
  }
  const rows = [...wallets.values()].sort((a, b) =>
    a.points === b.points ? (a.address < b.address ? -1 : a.address > b.address ? 1 : 0) : a.points > b.points ? -1 : 1,
  ).map((row, index) => ({ ...row, rank: index + 1 }));
  return { rows, totalPoints, totalPlants: plants.length, blockNumber, updatedAt };
}

export function formatPointsShare(points: bigint, totalPoints: bigint): string {
  if (totalPoints === ZERO || points === ZERO) return '0%';
  const hundredths = points * BigInt(10000) / totalPoints;
  if (hundredths === ZERO) return '<0.01%';
  const whole = hundredths / BigInt(100);
  const fraction = (hundredths % BigInt(100)).toString().padStart(2, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

export function serializePlayerRanking(snapshot: PlayerRankingSnapshot) {
  return { ...snapshot, totalPoints: snapshot.totalPoints.toString(), blockNumber: snapshot.blockNumber.toString(),
    rows: snapshot.rows.map(row => ({ ...row, points: row.points.toString() })) };
}

/** Validate cached/API totals too; a partial leaderboard must never look complete. */
export function parsePlayerRanking(value: unknown): PlayerRankingSnapshot {
  const payload = readRecord(value);
  if (!Array.isArray(payload.rows)) throw new Error('Invalid player ranking');
  const totalPoints = readUint(payload.totalPoints);
  const totalPlants = readSafeUint(payload.totalPlants);
  const blockNumber = readUint(payload.blockNumber);
  const updatedAt = readSafeUint(payload.updatedAt, 8_640_000_000_000_000);
  const addresses = new Set<string>();
  let sum = ZERO;
  let plantCount = 0;
  const rows = payload.rows.map((value, index): PlayerRankingRow => {
    const raw = readRecord(value);
    const address = readAddress(raw.address).toLowerCase() as `0x${string}`;
    const points = readUint(raw.points);
    const count = readSafeUint(raw.plantCount);
    if (addresses.has(address) || count < 1 || readSafeUint(raw.rank) !== index + 1) throw new Error('Invalid player ranking row');
    addresses.add(address);
    sum += points;
    plantCount += count;
    return { address, points, plantCount: count, rank: index + 1 };
  });
  if (sum !== totalPoints || plantCount !== totalPlants) throw new Error('Incomplete player ranking');
  if (rows.some((row, index) => index > 0 && rows[index - 1].points < row.points)) throw new Error('Unsorted player ranking');
  return { rows, totalPoints, totalPlants, blockNumber, updatedAt };
}

export interface PlayerRankingReader {
  getBlock(): Promise<{ number: bigint; timestamp: bigint }>;
  getPlantIds(blockNumber: bigint): Promise<unknown>;
  getPlantCount(blockNumber: bigint): Promise<unknown>;
  getPlants(ids: bigint[], blockNumber: bigint): Promise<unknown>;
}

/** Pin every batch to one block. Any missing/failed batch fails the whole snapshot. */
export async function readPlayerRanking(reader: PlayerRankingReader): Promise<PlayerRankingSnapshot> {
  const block = await reader.getBlock();
  const [rawIds, rawCount] = await Promise.all([reader.getPlantIds(block.number), reader.getPlantCount(block.number)]);
  if (!Array.isArray(rawIds)) throw new Error('Invalid plant list');
  const ids = rawIds.map(id => readUint(id));
  if (BigInt(ids.length) !== readUint(rawCount)) throw new Error('Incomplete plant list');
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate plant IDs');
  const plants: PlayerPoints[] = [];
  const batchSize = 100;
  const concurrency = 3;
  for (let offset = 0; offset < ids.length; offset += batchSize * concurrency) {
    const batches = Array.from({ length: concurrency }, (_, index) => ids.slice(offset + index * batchSize, offset + (index + 1) * batchSize)).filter(batch => batch.length);
    const results = await Promise.all(batches.map(async batch => {
      const raw = await reader.getPlants(batch, block.number);
      if (!Array.isArray(raw) || raw.length !== batch.length) throw new Error('Incomplete plant batch');
      const expected = new Set(batch);
      return raw.map(value => {
        const plant = readRecord(value);
        const id = readUint(plant.id);
        if (!expected.delete(id)) throw new Error('Unexpected plant in batch');
        return { id, owner: readAddress(plant.owner), score: readUint(plant.score) };
      });
    }));
    plants.push(...results.flat());
  }
  return aggregatePlayerPoints(plants, block.number, readSafeUint(block.timestamp) * 1000);
}
