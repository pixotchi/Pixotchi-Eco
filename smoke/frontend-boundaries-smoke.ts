import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics as encodeTopics, parseAbiItem, type Hex } from 'viem';
import { normalizeBarracksConfigV2, normalizeBarracksLandStateV2, normalizeBarracksRaidReportV2, normalizeBarracksRaidPreviewV2 } from '../lib/barracks-state';
import { parseStakeRanking, parseRocksRanking } from '../lib/ranking-response';
import { parseSpinCommit, parseSpinMetadata } from '../lib/spin-metadata';
import { parseSwapBuildStep, parseSwapQuote } from '../lib/swap/response';
import { parsePublicChatHistory, parseAIChatHistory, mergePublicHistory } from '../lib/chat-history';
import { monitorSubmittedBatch, withMonitoringAbort, waitForMonitorDelay } from '../lib/transaction-monitor';
import { parseBlackjackTransactionResult } from '../lib/blackjack-events';
import { getBoxResult } from '../lib/box-result';
import { getAttackOutcome } from '../lib/ranking-outcome';
import { isTransactionActionPending } from '../lib/transaction-lifecycle';
import { blackjackAbi, BlackjackAction, BlackjackResult } from '../public/abi/blackjack-abi';
import { SPIN_GAME_V2_COMMITTED_EVENT } from '../lib/spin-game-events';
import { fixtureAddress as address, fixtureBarracks, fixtureConfig, fixtureQuote, fixtureReport } from '../app/qa/frontend/controller-data';

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function encodeEventTopics(...args: Parameters<typeof encodeTopics>): Hex[] {
  return encodeTopics(...args).map(topic => { if (typeof topic !== 'string') throw new Error('Fixture must specify every indexed argument'); return topic; });
}

async function main() {
  const snapshot = fixtureBarracks();
  assert.equal(snapshot.landState.stationedSwordsmanTroops, BigInt(10));
  assert.deepEqual(normalizeBarracksConfigV2(snapshot.config), snapshot.config, 'Named and tuple ABI responses agree');
  for (const malformed of [null, {}, [], { ...snapshot.config, enabled: 'false' }, { ...snapshot.config, swordsman: {} }, { ...snapshot.config, buildToken: 'invalid' }, { ...snapshot.config, buildCost: -1 }, { ...snapshot.config, attackCooldown: Number.MAX_SAFE_INTEGER + 1 }]) assert.throws(() => normalizeBarracksConfigV2(malformed));
  for (const malformed of [null, {}, [], { ...snapshot.landState, trainingQueueTroopType: 256 }, { ...snapshot.landState, stationedSwordsmanTroops: true }]) assert.throws(() => normalizeBarracksLandStateV2(malformed));
  assert.equal(normalizeBarracksRaidReportV2(fixtureReport).raidId, BigInt(0), 'A complete zero report is a legitimate empty state');
  for (const malformed of [null, {}, fixtureReport.slice(0, 24), { ...snapshot.lastOutgoingReport, attackerWon: 'false' }]) assert.throws(() => normalizeBarracksRaidReportV2(malformed));
  assert.throws(() => normalizeBarracksRaidPreviewV2({}), 'Missing preview is never permission to raid');
  assert.equal(normalizeBarracksConfigV2(fixtureConfig).swordsman.trainingCost, BigInt(5));

  const stake = { success: true, leaderboard: [{ rank: 1, address, stakedAmount: '9007199254740993123456' }] };
  assert.equal(parseStakeRanking(stake)[0].stakedAmount, BigInt('9007199254740993123456'));
  assert.deepEqual(parseStakeRanking({ success: true, leaderboard: [] }), []);
  for (const bad of [{}, { success: false, leaderboard: [] }, { ...stake, leaderboard: [{}] }, { ...stake, leaderboard: [{ ...stake.leaderboard[0], stakedAmount: false }] }]) assert.throws(() => parseStakeRanking(bad));
  const disabled = parseRocksRanking({ success: true, disabled: true, message: 'Season paused', leaderboard: [] });
  assert.deepEqual(disabled, { disabled: true, message: 'Season paused', rows: [] });
  for (const bad of [{ success: true }, { success: true, disabled: 'false', leaderboard: [] }, { success: true, leaderboard: [{ rank: 1, address, rocks: Number.NaN }] }]) assert.throws(() => parseRocksRanking(bad));

  const rewards = Array.from({ length: 6 }, () => [BigInt('-1000000000000'), BigInt(60), BigInt('9007199254740993123456')]);
  assert.equal(parseSpinMetadata(BigInt(60), BigInt(2), BigInt(0), rewards).rewards[0].pointsDelta, -1e12);
  for (const args of [[60, 2, 0, rewards.slice(0, 5)], [60, -1, 0, rewards], [60, 2, Number.MAX_SAFE_INTEGER + 1, rewards], [60, 2, null, rewards]]) assert.throws(() => parseSpinMetadata(args[0], args[1], args[2], args[3]));
  const commitment: Hex = `0x${'a'.repeat(64)}`;
  const spinLog = { data: encodeAbiParameters([{ type: 'bytes32' }], [commitment]),
    topics: encodeEventTopics({ abi: [SPIN_GAME_V2_COMMITTED_EVENT], eventName: 'SpinGameV2Committed', args: { nftId: BigInt(7), player: address } }), blockNumber: BigInt(100) };
  assert.equal(parseSpinCommit(spinLog, address, 7).commitment, commitment);
  assert.throws(() => parseSpinCommit(spinLog, address, 8));
  assert.throws(() => parseSpinCommit({ ...spinLog, blockNumber: null }, address, 7));

  const quote = fixtureQuote();
  const request = { sellToken: 'ETH' as const, buyToken: 'SEED' as const, amountIn: BigInt(1) };
  assert.deepEqual(parseSwapQuote(quote, request), quote);
  for (const bad of [{ ...quote, amountIn: '2' }, { ...quote, expectedOut: false }, { ...quote, steps: [] }, { ...quote, minOut: '201' }, { ...quote, expiresAt: 999 }, { ...quote, sellToken: 'WETH' }]) assert.throws(() => parseSwapQuote(bad, request));
  const built = { step: quote.steps[0], approval: null, transaction: { to: address, data: '0x1234', value: '1', chainId: 8453 } };
  assert.equal(parseSwapBuildStep(built, quote.steps[0], '1').transaction.value, '1');
  assert.equal(parseSwapBuildStep(built, { ...quote.steps[0], key: 'step2' }, '1').step.key, 'step2', 'A standalone build response retains the requested second-leg identity');
  assert.throws(() => parseSwapBuildStep({ ...built, transaction: { ...built.transaction, chainId: 1 } }, quote.steps[0], '1'));
  assert.throws(() => parseSwapBuildStep(built, quote.steps[0], '2'));

  const message = { id: 'confirmed-1', address, message: 'hello', displayName: 'Player', timestamp: 1000 };
  assert.deepEqual(parsePublicChatHistory({ messages: [message] }), [message]);
  assert.throws(() => parsePublicChatHistory({ messages: [null] }));
  assert.throws(() => parsePublicChatHistory({}));
  assert.deepEqual(mergePublicHistory([message], [{ ...message, id: 'optimistic-1' }, message]).map(m => m.id), ['confirmed-1', 'optimistic-1']);
  assert.throws(() => parseAIChatHistory({ conversationId: 'one', messages: [{ ...message, conversationId: 'two', type: 'assistant', model: 'fixture' }] }));

  const resultLog = { address, topics: encodeEventTopics({ abi: blackjackAbi, eventName: 'BlackjackResult', args: { landId: BigInt(1), player: address } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }], [BlackjackResult.PLAYER_WIN, 20, 19, BigInt('2000000'), address]) };
  const parsed = parseBlackjackTransactionResult([{ logs: [resultLog] }], 'action', BlackjackAction.STAND, 6, address);
  assert.equal(parsed.result.gameResult, BlackjackResult.PLAYER_WIN, 'A result-only receipt settles the game');
  assert.equal(parsed.result.payout, '2');
  const dealtLog = { address, topics: encodeEventTopics({ abi: blackjackAbi, eventName: 'BlackjackDealt', args: { landId: BigInt(1), player: address } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bool' }], [9, 22, 5, 20, false]) };
  const dealt = parseBlackjackTransactionResult([{ logs: [dealtLog] }], 'deal', undefined, 6, address).result;
  assert.deepEqual(dealt.cards, [9, 22]);
  assert.equal(dealt.handValue, 20);
  const hitLog = { address, topics: encodeEventTopics({ abi: blackjackAbi, eventName: 'BlackjackHit', args: { landId: BigInt(1), player: address } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'bool' }], [1, 3, 18, false]) };
  const hit = parseBlackjackTransactionResult([{ logs: [hitLog] }], 'action', BlackjackAction.HIT, 6, address).result;
  assert.equal(hit.handIndex, 1);
  assert.deepEqual(hit.cards, [3], 'The receipt appends the new card to the correct split hand');
  const splitLog = { address, topics: encodeEventTopics({ abi: blackjackAbi, eventName: 'BlackjackSplit', args: { landId: BigInt(1), player: address } }),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }], [3, 4]) };
  const split = parseBlackjackTransactionResult([{ logs: [splitLog] }], 'action', BlackjackAction.SPLIT, 6, address).result;
  assert.equal(split.splitHand1Card, 3);
  assert.equal(split.splitHand2Card, 4);
  assert.equal(parseBlackjackTransactionResult([{ logs: [resultLog, resultLog] }], 'action', BlackjackAction.STAND, 6, address).result.payout, '2', 'Duplicate logs cannot double a payout');
  assert.equal(parseBlackjackTransactionResult([{ logs: [{ ...resultLog, address: `0x${'2'.repeat(40)}` }] }], 'action', BlackjackAction.STAND, 6, address).result.gameResult, undefined);
  const boxEvent = parseAbiItem('event PlayedV2(uint256 indexed id, int256 points, int256 timeExtension, string gameName)');
  const boxLog = { address, topics: encodeEventTopics({ abi: [boxEvent], eventName: 'PlayedV2', args: { id: BigInt(7) } }), data: encodeAbiParameters([{ type: 'int256' }, { type: 'int256' }, { type: 'string' }], [BigInt(-5), BigInt(-60), 'Box']) };
  assert.deepEqual(getBoxResult([{ logs: [boxLog] }], 7, address), { pointsDelta: -5, timeAdded: -60 });
  assert.equal(getBoxResult([{ logs: [boxLog] }], 8, address), null, 'Missing reward evidence is distinct from a zero reward');
  const attackEvent = parseAbiItem('event Attack(uint256 attacker, uint256 winner, uint256 loser, uint256 scoresWon)');
  const attackLog = { address, topics: encodeEventTopics({ abi: [attackEvent], eventName: 'Attack' }), data: encodeAbiParameters(Array.from({ length: 4 }, () => ({ type: 'uint256' })), [BigInt(1), BigInt(1), BigInt(2), BigInt('1000000000000')]) };
  assert.equal(getAttackOutcome([attackLog], address)?.didWin, true);
  assert.equal(isTransactionActionPending('buildingTransaction'), true);
  for (const status of ['transactionRejected', 'cancelled', 'reverted', 'transactionStale', 'success'] as const) assert.equal(isTransactionActionPending(status), false);

  const wallet = deferred<number>();
  let reads = 0;
  const uiTimeout = new Error('UI timeout');
  const waiting = monitorSubmittedBatch({ request: () => { reads++; return wallet.promise; }, initialWait: async () => { throw uiTimeout; },
    wait: pending => pending, resolved: value => value === 2, retryable: error => error === uiTimeout, onUnresolved: () => {}, delay: async () => {} });
  wallet.resolve(2);
  assert.equal(await waiting, 2);
  assert.equal(reads, 1, 'A UI timeout preserves the existing wallet request');
  reads = 0;
  assert.equal(await monitorSubmittedBatch({ request: async () => ++reads, initialWait: p => p, wait: p => p, resolved: value => value === 3,
    retryable: () => true, onUnresolved: () => {}, delay: async () => {} }), 3);
  assert.equal(reads, 3, 'Pending responses re-read status without a submission callback');
  const abort = new AbortController();
  const late = deferred<number>();
  const observed = withMonitoringAbort(late.promise, abort.signal);
  abort.abort();
  await assert.rejects(observed, { name: 'AbortError' });
  late.reject(new Error('Old wallet transport failed after handoff'));
  await assert.rejects(waitForMonitorDelay(1000, abort.signal), { name: 'AbortError' });
  await assert.rejects(monitorSubmittedBatch({ request: async () => { throw new Error('Must not read'); }, initialWait: p => p, wait: p => p,
    resolved: () => true, retryable: () => false, onUnresolved: () => {}, delay: async () => {}, signal: abort.signal }), { name: 'AbortError' });
  console.log('Frontend boundaries: malformed game/API data, scoped events, result-only settlement and interrupted batch monitoring passed.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
