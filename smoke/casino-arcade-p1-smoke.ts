import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, type Hex } from 'viem';
import { resolveTokenMetadata } from '../lib/token-metadata-state';
import { getSpinRevealState, verifySpinReveal } from '../lib/spin-reveal-state';
import { readExpiredSpin, storeExpiredSpin } from '../lib/spin-expired-storage';
import { parseRouletteReceipt } from '../lib/roulette-receipt';
import { extractBestSpinRewardFromLogs, SPIN_GAME_V2_PLAYED_EVENT } from '../lib/spin-game-events';
import { formatSignedSpinValue, readSpinResultRecovery, storeSpinResultRecovery, clearSpinResultRecovery } from '../lib/spin-result-recovery';
import { casinoAbi } from '../public/abi/casino-abi';

async function main() {
  const success = (result: unknown) => ({ status: 'success', result });
  for (const reads of [undefined, [success('USDC')], [success('USDC'), { status: 'failure' }], [{ status: 'failure' }, success(6)], [success('USDC'), success(18.5)], [success('USDC'), success(-1)]]) {
    assert.deepEqual(resolveTokenMetadata(reads), { symbol: undefined, decimals: undefined, isReady: false });
  }
  for (const decimals of [0, 6, 18, 255]) {
    assert.deepEqual(resolveTokenMetadata([success('TOKEN'), success(decimals)]), { symbol: 'TOKEN', decimals, isReady: true });
  }
  assert.equal(resolveTokenMetadata([success('USDC'), success(6)], true).decimals, undefined, 'failed refresh must not make cached metadata spendable');

  assert.equal(getSpinRevealState(100, null).status, 'unknown');
  assert.equal(getSpinRevealState(0, 102).status, 'unknown', 'proof-only commit must wait for its block');
  assert.equal(getSpinRevealState(100, 100).status, 'waiting');
  assert.equal(getSpinRevealState(100, 101).status, 'waiting');
  assert.equal(getSpinRevealState(100, 102).status, 'ready');
  assert.equal(getSpinRevealState(100, 357).status, 'ready', 'last contract-valid block is retained');
  assert.equal(getSpinRevealState(100, 358).status, 'expired');
  let simulations = 0;
  const simulate = async () => { simulations += 1; };
  await assert.rejects(verifySpinReveal({ commitBlock: 100, readBlock: async () => BigInt(101), simulate }));
  assert.equal(simulations, 0, 'elapsed UI time cannot authorize a stalled chain');
  await assert.rejects(verifySpinReveal({ commitBlock: 100, readBlock: async () => { throw new Error('RPC unavailable'); }, simulate }));
  assert.equal(simulations, 0);
  await verifySpinReveal({ commitBlock: 100, readBlock: async () => BigInt(102), simulate });
  assert.equal(simulations, 1);
  await assert.rejects(verifySpinReveal({ commitBlock: 100, readBlock: async () => BigInt(102), simulate: async () => { throw new Error('contract rejected reveal'); } }));
  await assert.rejects(verifySpinReveal({ commitBlock: 100, readBlock: async () => BigInt(358), simulate }));

  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const player = '0x0000000000000000000000000000000000000001';
  const otherPlayer = '0x0000000000000000000000000000000000000002';
  const token = '0x0000000000000000000000000000000000000003';
  const contract = '0x0000000000000000000000000000000000000004';
  const round = { account: player, plantId: 7, commitBlock: 100, commitment: `0x${'11'.repeat(32)}`, starsSpent: null };
  assert.equal(storeExpiredSpin(storage, round), true);
  assert.deepEqual(readExpiredSpin(storage, player, 7), round, 'expired round survives reload');
  assert.equal(readExpiredSpin(storage, otherPlayer, 7), null);
  assert.equal(readExpiredSpin(storage, player, 8), null);
  assert.equal(storeExpiredSpin({ ...storage, setItem: () => { throw new Error('full'); } }, round), false, 'callers retain pending recovery when archive fails');

  const topics = encodeEventTopics({ abi: casinoAbi, eventName: 'RouletteSpinResult', args: { landId: BigInt(7), player } }) as [Hex, ...Hex[]];
  const data = encodeAbiParameters([{ type: 'uint8' }, { type: 'bool' }, { type: 'uint256' }, { type: 'address' }], [17, true, BigInt(1234567), token]);
  const receipt = { transactionHash: `0x${'22'.repeat(32)}`, logs: [{ address: contract, topics, data }] };
  const subject = { landId: BigInt(7), player, contract };
  const decoded = parseRouletteReceipt([receipt], subject);
  assert.equal(decoded?.payoutWei, BigInt(1234567), 'confirmed payout stays exact without metadata');
  assert.equal(decoded?.bettingToken, token, 'event currency is retained independently of current selector');
  assert.equal(decoded?.winningNumber, 17);
  assert.equal(parseRouletteReceipt([receipt], { ...subject, landId: BigInt(8) }), undefined);
  assert.equal(parseRouletteReceipt([receipt], { ...subject, player: otherPlayer }), undefined);
  assert.equal(parseRouletteReceipt([receipt], { ...subject, contract: token }), undefined);
  assert.equal(parseRouletteReceipt([{ logs: [{ ...receipt.logs[0], data: '0x' }] }], subject), undefined);
  const spinTopics = encodeEventTopics({ abi: [SPIN_GAME_V2_PLAYED_EVENT], eventName: 'SpinGameV2Played', args: { nftId: BigInt(7), player, rewardIndex: BigInt(2) } }) as [Hex, ...Hex[]];
  const spinLog = { address: contract, topics: spinTopics, data: encodeAbiParameters([{ type: 'int256' }, { type: 'uint256' }, { type: 'uint256' }], [BigInt(-120), BigInt(0), BigInt(0)]) };
  const spinSubject = { contract, player, plantId: 7 };
  assert.equal(extractBestSpinRewardFromLogs([spinLog], spinSubject)?.pointsDelta, -120);
  assert.equal(extractBestSpinRewardFromLogs([spinLog], { ...spinSubject, player: otherPlayer }), undefined);
  assert.equal(extractBestSpinRewardFromLogs([spinLog], { ...spinSubject, plantId: 8 }), undefined);
  assert.equal(extractBestSpinRewardFromLogs([spinLog], { ...spinSubject, contract: token }), undefined);
  assert.equal(extractBestSpinRewardFromLogs([], spinSubject), undefined, 'missing logs cannot synthesize a reward');
  assert.equal(formatSignedSpinValue(-120, String), '−120');
  assert.equal(formatSignedSpinValue(120, String), '+120');
  assert.equal(formatSignedSpinValue(0, String), '0');
  const resultStorage = { ...storage, removeItem: (key: string) => values.delete(key) };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: resultStorage });
  const recovery = { account: player, plantId: 7, transactionHash: `0x${'99'.repeat(32)}` as Hex };
  storeSpinResultRecovery(recovery);
  assert.deepEqual(readSpinResultRecovery(player, 7), recovery, 'unavailable confirmed result survives reopen');
  assert.equal(readSpinResultRecovery(otherPlayer, 7), null);
  assert.equal(readSpinResultRecovery(player, 8), null);
  const newerRecovery = { ...recovery, transactionHash: `0x${'88'.repeat(32)}` as Hex };
  storeSpinResultRecovery(newerRecovery);
  clearSpinResultRecovery(player, 7, recovery.transactionHash);
  assert.deepEqual(readSpinResultRecovery(player, 7), newerRecovery, 'late older receipt cannot erase a newer result');
  clearSpinResultRecovery(player, 7, newerRecovery.transactionHash);
  assert.equal(readSpinResultRecovery(player, 7), null);
  console.log('Casino/Arcade P1 + medium smoke passed: exact metadata, reveal readiness/preflight, expiry persistence, receipt subject/denomination, scoped Spin reward recovery, and signed outcomes.');
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
