import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, numberToHex, padHex, toBytes } from 'viem';

import {
  getQuestFinalizeOutcome,
  isQuestFinalizeExpired,
  QUEST_EXPIRED_STATUS,
} from '../components/building-details/FarmerHousePanel';
import { calculateTimeLeft, calculateUpgradeProgress } from '../lib/utils';

const topicUint = (value: bigint) => padHex(numberToHex(value), { size: 32 });
const topicAddress = (value: `0x${string}`) => padHex(value, { size: 32 });
const questResetTopic = keccak256(toBytes('QuestReset(uint256,uint256,address)'));
const questFinalizedTopic = keccak256(
  toBytes('QuestFinalized(uint256,uint256,address,uint8,uint256)'),
);

const resetLog = {
  topics: [
    questResetTopic,
    topicUint(BigInt(42)),
    topicUint(BigInt(1)),
    topicAddress('0x000000000000000000000000000000000000c0de'),
  ],
  data: '0x',
};

const finalizedLog = {
  topics: [
    questFinalizedTopic,
    topicUint(BigInt(42)),
    topicUint(BigInt(1)),
    topicAddress('0x000000000000000000000000000000000000c0de'),
  ],
  data: encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint256' }],
    [0, BigInt(10)],
  ),
};

assert.equal(
  isQuestFinalizeExpired({ pseudoRndBlock: BigInt(100) }, BigInt(356)),
  false,
  'the contract still permits finalization at pseudoRndBlock + 256',
);
assert.equal(
  isQuestFinalizeExpired({ pseudoRndBlock: BigInt(100) }, BigInt(357)),
  true,
  'the UI must mark a quest expired after the 256-block window',
);
assert.equal(
  isQuestFinalizeExpired({ pseudoRndBlock: BigInt(0) }, BigInt(357)),
  false,
  'uncommitted slots are never expired loot bags',
);
assert.equal(QUEST_EXPIRED_STATUS, 'Expired — reset required');

assert.equal(getQuestFinalizeOutcome({ logs: [resetLog] }, BigInt(42), 1), 'reset');
assert.equal(getQuestFinalizeOutcome({ logs: [finalizedLog] }, BigInt(42), 1), 'finalized');
assert.equal(getQuestFinalizeOutcome({ logs: [] }, BigInt(42), 1), 'unknown');

const farmerHouseSource = readFileSync(
  new URL('../components/building-details/FarmerHousePanel.tsx', import.meta.url),
  'utf8',
);
assert.match(
  farmerHouseSource,
  /s\.startBlock !== BigInt\(0\) && now <= s\.endBlock/,
  'a confirmed non-zero quest start must stay blocked while the block watcher catches up',
);
assert.match(
  farmerHouseSource,
  /QUEST_RECONCILE_DELAYS_MS = \[500, 1_000, 1_500, 2_500, 4_000, 6_000\]/,
  'quest reconciliation must outlive the old three-second polling window',
);
assert.match(
  farmerHouseSource,
  /opts\.awaitUncommitted && s\?\.pseudoRndBlock === BigInt\(0\)/,
  'an expired-but-still-committed slot must not be mistaken for a completed reset',
);

assert.equal(
  calculateTimeLeft({ blockHeightUntilUpgradeDone: BigInt(43_200) }, BigInt(0)),
  '1d 0h 0m',
);
assert.equal(
  calculateUpgradeProgress({
    isUpgrading: true,
    blockHeightUpgradeInitiated: BigInt(100),
    blockHeightUntilUpgradeDone: BigInt(100),
  }, BigInt(100)),
  100,
);

console.log('Quest UI smoke passed');
