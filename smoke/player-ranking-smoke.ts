import assert from 'node:assert/strict';
import { aggregatePlayerPoints, formatPointsShare, parsePlayerRanking, readPlayerRanking, serializePlayerRanking, type PlayerRankingReader } from '../lib/player-ranking';

const a = `0x${'a'.repeat(40)}` as const;
const b = `0x${'b'.repeat(40)}` as const;
const c = `0x${'c'.repeat(40)}` as const;
const blockNumber = BigInt(12345);
const timestamp = BigInt(1800000000);
const scale = BigInt(10) ** BigInt(12);

async function main() {
  const snapshot = aggregatePlayerPoints([
    { id: BigInt(1), owner: a, score: BigInt(30000) * scale },
    { id: BigInt(2), owner: a.toUpperCase().replace('0X', '0x') as `0x${string}`, score: BigInt(20000) * scale },
    { id: BigInt(3), owner: b, score: BigInt(4950000) * scale },
    { id: BigInt(4), owner: c, score: BigInt(0) },
  ], blockNumber, Number(timestamp) * 1000);
  assert.equal(snapshot.totalPoints, BigInt(5000000) * scale);
  assert.equal(snapshot.totalPlants, 4);
  assert.equal(snapshot.rows.length, 3);
  assert.equal(snapshot.rows[1].address, a);
  assert.equal(snapshot.rows[1].plantCount, 2);
  assert.equal(snapshot.rows[1].points, BigInt(50000) * scale);
  assert.equal(formatPointsShare(snapshot.rows[1].points, snapshot.totalPoints), '1%');
  assert.equal(formatPointsShare(BigInt(1), BigInt(100000000000)), '<0.01%');
  assert.equal(formatPointsShare(BigInt(0), BigInt(0)), '0%');
  assert.equal(formatPointsShare(BigInt(1), BigInt(1)), '100%');

  const huge = BigInt('900719925474099312345678');
  const exact = aggregatePlayerPoints([
    { id: BigInt(1), owner: a, score: huge },
    { id: BigInt(2), owner: b, score: huge + BigInt(1) },
  ], blockNumber, Number(timestamp) * 1000);
  assert.equal(exact.rows[0].address, b, 'One raw PTS unit must remain distinguishable above Number.MAX_SAFE_INTEGER');
  const tied = aggregatePlayerPoints([
    { id: BigInt(2), owner: b, score: huge }, { id: BigInt(1), owner: a, score: huge },
  ], blockNumber, Number(timestamp) * 1000);
  assert.deepEqual(tied.rows.map(row => row.address), [a, b], 'Tied scores must have stable pagination');
  assert.deepEqual(parsePlayerRanking(serializePlayerRanking(snapshot)), snapshot);
  const serialized = serializePlayerRanking(snapshot);
  assert.throws(() => parsePlayerRanking({ ...serialized, rows: serialized.rows.slice(0, 1) }), /Incomplete/);
  assert.throws(() => parsePlayerRanking({ ...serialized, totalPoints: '0' }), /Incomplete/);
  assert.throws(() => aggregatePlayerPoints([{ id: BigInt(1), owner: a, score: BigInt(1) }, { id: BigInt(1), owner: b, score: BigInt(1) }], blockNumber, 1), /Duplicate/);

  // More than one wave: every call must use the same block even if the head moves.
  const ids = Array.from({ length: 351 }, (_, index) => BigInt(index + 1));
  const calls: Array<{ block: bigint; ids: bigint[] }> = [];
  const reader: PlayerRankingReader = {
    getBlock: async () => ({ number: blockNumber, timestamp }),
    getPlantIds: async block => { assert.equal(block, blockNumber); return ids; },
    getPlantCount: async block => { assert.equal(block, blockNumber); return BigInt(ids.length); },
    getPlants: async (batch, block) => {
      calls.push({ block, ids: batch });
      return [...batch].reverse().map(id => ({ id, owner: id % BigInt(2) === BigInt(0) ? a : b, score: scale }));
    },
  };
  const complete = await readPlayerRanking(reader);
  assert.equal(complete.totalPlants, 351);
  assert.equal(complete.totalPoints, BigInt(351) * scale);
  assert.equal(complete.rows[0].plantCount, 176);
  assert.equal(calls.length, 4);
  assert(calls.every(call => call.block === blockNumber && call.ids.length <= 100));
  assert.equal(new Set(calls.flatMap(call => call.ids)).size, 351);
  await assert.rejects(readPlayerRanking({ ...reader, getPlantCount: async () => BigInt(352) }), /Incomplete/);
  await assert.rejects(readPlayerRanking({ ...reader, getPlants: async batch => batch.slice(1).map(id => ({ id, owner: a, score: scale })) }), /Incomplete/);
  await assert.rejects(readPlayerRanking({ ...reader, getPlants: async () => { throw new Error('RPC unavailable'); } }), /RPC unavailable/);
  await assert.rejects(readPlayerRanking({ ...reader, getPlants: async batch => batch.map(() => ({ id: BigInt(1), owner: a, score: scale })) }), /Unexpected/);
  const empty = await readPlayerRanking({ ...reader, getPlantIds: async () => [], getPlantCount: async () => BigInt(0) });
  assert.equal(empty.totalPoints, BigInt(0));
  assert.deepEqual(empty.rows, []);
  console.log('Player ranking smoke passed: full snapshots, exact PTS, wallet aggregation, shares, stable ties, ABI validation and failed/partial reads.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
