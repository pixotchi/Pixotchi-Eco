import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, numberToHex, padHex, toBytes } from 'viem';
import { CLIENT_ENV } from '../lib/env-config';
import { getQuestSlotState } from '../lib/contracts';
import {
  getQuestFinalizeOutcome, isQuestFinalizeExpired, QUEST_EXPIRED_STATUS,
} from '../components/building-details/FarmerHousePanel';
import {
  getQuestFinalizeResult, describeQuestResult, loadQuestResult, saveQuestResult,
  questResultScope, questFinalizeBlocksRemaining,
} from '../lib/quest-ui';
import { calculateTimeLeft, calculateUpgradeProgress } from '../lib/utils';

const topicUint = (value: bigint) => padHex(numberToHex(value), { size: 32 });
const resetLog = {
  address: CLIENT_ENV.LAND_CONTRACT_ADDRESS,
  topics: [keccak256(toBytes('QuestReset(uint256,uint256,address)')), topicUint(BigInt("42")), topicUint(BigInt("1")), topicUint(BigInt("0xc0de"))],
  data: '0x',
};
const finalizedLog = {
  address: CLIENT_ENV.LAND_CONTRACT_ADDRESS,
  topics: [keccak256(toBytes('QuestFinalized(uint256,uint256,address,uint8,uint256)')), topicUint(BigInt("42")), topicUint(BigInt("1")), topicUint(BigInt("0xc0de"))],
  data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }], [0, BigInt("10")]),
};
assert.equal(getQuestFinalizeOutcome({ logs: [resetLog] }, BigInt("42"), 1), 'reset');
assert.equal(getQuestFinalizeOutcome({ logs: [finalizedLog] }, BigInt("42"), 1), 'finalized');
assert.equal(getQuestFinalizeOutcome({ logs: [] }, BigInt("42"), 1), 'unknown');
assert.equal(QUEST_EXPIRED_STATUS, 'Expired — reset required');
const committed = { difficulty: 0, startBlock: BigInt("50"), endBlock: BigInt("99"), pseudoRndBlock: BigInt("100"), coolDownBlock: BigInt("0") };
assert.equal(isQuestFinalizeExpired(committed, BigInt("356")), false);
assert.equal(isQuestFinalizeExpired(committed, BigInt("357")), true);
assert.equal(isQuestFinalizeExpired({ pseudoRndBlock: BigInt("0") }, BigInt("357")), false);
assert.equal(questFinalizeBlocksRemaining(committed, BigInt("100")), BigInt("256"));
assert.equal(questFinalizeBlocksRemaining(committed, BigInt("356")), BigInt("0"));
assert.equal(questFinalizeBlocksRemaining(committed, BigInt("357")), BigInt("0"));
assert.equal(getQuestSlotState(committed, BigInt("356")), 'committed');
assert.equal(getQuestSlotState(committed, BigInt("357")), 'expired');
assert.equal(getQuestSlotState({ ...committed, startBlock: BigInt("110"), endBlock: BigInt("200"), pseudoRndBlock: BigInt("0") }, BigInt("100")), 'in_progress', 'a confirmed non-zero start stays active when the block watcher is behind');

// Actual successful Base receipt from the audit, replayed without network access.
const liveReceipt = JSON.parse(readFileSync(new URL('./fixtures/quest-finalized-receipt.json', import.meta.url), 'utf8'));
const reward = getQuestFinalizeResult(liveReceipt, BigInt("712"), 0);
assert.deepEqual(reward, { outcome: 'finalized', rewardType: 3, amount: BigInt("20500495190215"), transactionHash: liveReceipt.transactionHash });
assert.equal(describeQuestResult(reward, BigInt("712")), '+20.5004 PTS → Land #712 Warehouse');
assert.equal(getQuestFinalizeResult(liveReceipt, BigInt("760"), 0).outcome, 'unknown');
assert.equal(getQuestFinalizeResult(liveReceipt, BigInt("712"), 1).outcome, 'unknown');
assert.equal(getQuestFinalizeResult({ logs: liveReceipt.logs.map((log: object) => ({ ...log, address: '0x0000000000000000000000000000000000000001' })) }, BigInt("712"), 0).outcome, 'unknown');
assert.equal(getQuestFinalizeResult({ transactionReceipts: [liveReceipt] }, BigInt("712"), 0).outcome, 'finalized');
assert.equal(getQuestFinalizeResult({ logs: [{ address: CLIENT_ENV.LAND_CONTRACT_ADDRESS, data: 'bad', topics: [] }] }, BigInt("712"), 0).outcome, 'unknown');
assert.match(describeQuestResult(getQuestFinalizeResult({ logs: [resetLog] }, BigInt("42"), 1), BigInt("42")), /No reward/);
assert.equal(describeQuestResult({ outcome: 'finalized', rewardType: 0, amount: BigInt("1250000000000000000") }, BigInt("712")), '+1.25 SEED → your wallet');
assert.equal(describeQuestResult({ outcome: 'finalized', rewardType: 1, amount: BigInt("1") }, BigInt("712")), '+<0.0001 LEAF → your wallet');
assert.equal(describeQuestResult({ outcome: 'finalized', rewardType: 2, amount: BigInt("3661") }, BigInt("712")), '+1h 1m 1s TOD → Land #712 Warehouse');
assert.equal(describeQuestResult({ outcome: 'finalized', rewardType: 4, amount: BigInt("42000000000000000000") }, BigInt("712")), '+42 XP → Land #712');

const stored = new Map<string, string>();
const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value); } };
const scope = questResultScope('0xAbC', BigInt("712"));
saveQuestResult(storage, scope, 0, reward);
assert.deepEqual(loadQuestResult(storage, questResultScope('0xabc', BigInt("712")), 0), reward, 'a remount restores the same wallet and land result');
assert.equal(loadQuestResult(storage, questResultScope('0xdef', BigInt("712")), 0), null, 'wallet switch cannot display a prior owner result');
assert.equal(loadQuestResult(storage, questResultScope('0xabc', BigInt("760")), 0), null, 'late results for a previous land cannot appear on the new land');
assert.equal(loadQuestResult(storage, scope, 1), null);
saveQuestResult(storage, scope, 0, { outcome: 'unknown' });
assert.deepEqual(loadQuestResult(storage, scope, 0), reward, 'unverified callbacks cannot erase verified rewards');
assert.doesNotThrow(() => saveQuestResult({ getItem: () => null, setItem: () => { throw Error('denied'); } }, scope, 0, reward));
assert.equal(loadQuestResult({ getItem: () => 'corrupt', setItem: () => {} }, scope, 0), null);

assert.equal(calculateTimeLeft({ blockHeightUntilUpgradeDone: BigInt("43200") }, BigInt("0")), '1d 0h 0m');
assert.equal(calculateUpgradeProgress({ isUpgrading: true, blockHeightUpgradeInitiated: BigInt("100"), blockHeightUntilUpgradeDone: BigInt("100") }, BigInt("100")), 100);
console.log('Quest UI smoke passed');
