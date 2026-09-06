import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getAddress } from 'viem';
import { aggregatePlayerPoints } from '../lib/player-ranking';

async function main() {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const { createReadOnlyAITools, executeReadOnlyAITool } = await import('../lib/ai-read-tools');
  const { getGameActionGuide } = await import('../lib/ai-action-guide');
  const { classifyAIUserMessage } = await import('../lib/ai-safety');
  const target = `0x${'a'.repeat(40)}`;
  const empty = `0x${'b'.repeat(40)}`;
  const custody = '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB';
  const scale = BigInt(10) ** BigInt(12);
  const snapshot = aggregatePlayerPoints([
    ...Array.from({ length: 24 }, (_, index) => ({
      id: BigInt(index + 1), owner: `0x${(index + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
      score: BigInt(206250) * scale,
    })),
    { id: BigInt(25), owner: target as `0x${string}`, score: BigInt(50000) * scale },
  ], BigInt(123456), 1800000000000);
  let reads = 0;
  const tools = createReadOnlyAITools({ readPlayerRanking: async () => { reads += 1; return snapshot; } });
  const run = (input: Record<string, unknown>, userAddress = target, selectedTools = tools) => {
    const schema = selectedTools.get_leaderboards.inputSchema;
    assert('parse' in schema && typeof schema.parse === 'function');
    return executeReadOnlyAITool(selectedTools, 'get_leaderboards', schema.parse(input), { userAddress });
  };
  const result = await run({ boards: ['players'], limit: 1 });
  assert.equal(result.status, 'ok');
  const board = result.data.players;
  assert.equal(board.gameTotalPts, '5000000');
  assert.equal(board.player.totalPts, '50000');
  assert.equal(board.player.ptsShare, '1%');
  assert.equal(board.player.rank, 25, 'Wallet summary must survive top-list truncation');
  assert.equal(board.leaders.length, 1);
  assert.equal(board.leadersTruncated, true);
  assert.equal(board.totalPlayers, 25);
  assert.equal(board.totalPlants, 25);
  assert.equal(board.snapshot.blockNumber, '123456');
  assert.equal(board.snapshot.updatedAt, new Date(snapshot.updatedAt).toISOString());
  assert.equal(result.blockNumber, undefined, 'Do not attach a newer AI RPC block to a cached player snapshot');
  assert(result.limitations.some((line: string) => /not a guaranteed/.test(line)));

  const explicit = await run({ boards: ['players'], address: getAddress(target) }, empty);
  assert.deepEqual(explicit.data.players.player, board.player);
  const unranked = await run({ boards: ['players'] }, empty);
  assert.deepEqual(unranked.data.players.player, { address: empty, rank: null, plantCount: 0, totalPts: '0', ptsShare: '0%' });

  const beforeBlocked = reads;
  const blocked = await run({ boards: ['players'], address: custody });
  assert.equal(blocked.status, 'error');
  assert.equal(reads, beforeBlocked, 'Reject protected wallet requests before reading the ranking');
  assert(!JSON.stringify(blocked).toLowerCase().includes(custody.toLowerCase()));
  const privateSnapshot = aggregatePlayerPoints([
    { id: BigInt(1), owner: custody as `0x${string}`, score: BigInt(900) * scale },
    { id: BigInt(2), owner: target as `0x${string}`, score: BigInt(100) * scale },
  ], BigInt(5), 1800000000000);
  const privacyTools = createReadOnlyAITools({ readPlayerRanking: async () => privateSnapshot });
  const privacy = await run({ boards: ['players'] }, target, privacyTools);
  assert(!JSON.stringify(privacy).toLowerCase().includes(custody.toLowerCase()));
  assert.equal(privacy.data.players.leaders[0].rank, 2);
  assert.equal(privacy.data.players.player.ptsShare, '10%', 'Redaction must not recalculate the public game denominator');

  const failedTools = createReadOnlyAITools({ readPlayerRanking: async () => { throw new Error('RPC error with private endpoint credentials'); } });
  const failed = await run({ boards: ['players'] }, target, failedTools);
  assert.equal(failed.status, 'error');
  assert.equal(failed.data, undefined);
  assert(!JSON.stringify(failed).includes('credentials'));
  const precisionSnapshot = aggregatePlayerPoints([
    { id: BigInt(1), owner: target as `0x${string}`, score: BigInt('900719925474099312345678') },
    { id: BigInt(2), owner: empty as `0x${string}`, score: BigInt(1) },
  ], BigInt(5), 1800000000000);
  const precision = await run({ boards: ['players'] }, empty, createReadOnlyAITools({ readPlayerRanking: async () => precisionSnapshot }));
  assert.equal(precision.data.players.gameTotalPts, '900719925474.099312345679');
  assert.equal(precision.data.players.player.ptsShare, '<0.01%');

  for (const query of ['What is my player PTS rank?', 'What percentage of game PTS do I own?', 'Who are the top players by total plant points?']) {
    assert.equal(classifyAIUserMessage(query).allowed, true, query);
  }
  assert(JSON.stringify(getGameActionGuide({ topic: 'leaderboards' })).includes('Ranking > Players'));
  console.log('AI Players ranking passed: wallet outside top list, shared totals/share, snapshot age, exact precision, unranked wallets, failure handling, and existing privacy rules.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
