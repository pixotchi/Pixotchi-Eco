import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  QUEST_DIFFICULTIES,
  QUEST_REWARD_FALLBACK_ADDRESS,
  buildQuestStartCall,
  getPaymentStorageSlot,
  getQuestSlotState,
  isQuestDifficultyId,
  storageWordToAddress,
  toQuestSlotSnapshots,
  LAND_CONTRACT_ADDRESS,
} from '../lib/contracts';
import type { QuestSlot } from '../lib/contracts';
import {
  clearBatchQuestRun,
  isBatchQuestRunPaid,
  markBatchQuestRunPaid,
} from '../lib/quest-preferences';

const projectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const slot = (over: Partial<QuestSlot> = {}): QuestSlot => ({
  coolDownBlock: BigInt(0),
  difficulty: 0,
  endBlock: BigInt(0),
  pseudoRndBlock: BigInt(0),
  startBlock: BigInt(0),
  ...over,
});

// ---------------------------------------------------------------------------
// Slot classification must mirror the require() ordering in LibQuest, or the UI
// will offer actions the contract rejects and revert the whole atomic bundle.
// ---------------------------------------------------------------------------

const NOW = BigInt(1_000);

// startQuest: require(block.number >= coolDownBlock) then require(startBlock == 0)
assert.equal(getQuestSlotState(slot(), NOW), 'available');
assert.equal(getQuestSlotState(slot({ coolDownBlock: NOW + BigInt(1) }), NOW), 'cooldown');
// A cooldown that has elapsed frees the slot again.
assert.equal(getQuestSlotState(slot({ coolDownBlock: NOW }), NOW), 'available');
assert.equal(getQuestSlotState(slot({ coolDownBlock: NOW - BigInt(1) }), NOW), 'available');

// commitQuest: require(endBlock <= block.number) and require(pseudoRndBlock == 0)
assert.equal(
  getQuestSlotState(slot({ startBlock: NOW - BigInt(10), endBlock: NOW + BigInt(10) }), NOW),
  'in_progress',
);
assert.equal(
  getQuestSlotState(slot({ startBlock: NOW - BigInt(50), endBlock: NOW }), NOW),
  'in_progress',
);
assert.equal(
  getQuestSlotState(slot({ startBlock: NOW - BigInt(50), endBlock: NOW - BigInt(1) }), NOW),
  'ready_to_commit',
);

// finalizeQuest: require(pseudoRndBlock != 0). Committed wins over the endBlock
// comparison because commitQuest does not clear startBlock/endBlock.
assert.equal(
  getQuestSlotState(
    slot({ startBlock: NOW - BigInt(50), endBlock: NOW - BigInt(1), pseudoRndBlock: NOW }),
    NOW,
  ),
  'committed',
);

// Cooldown outranks everything: finalizeQuest sets coolDownBlock while zeroing
// startBlock, so a resting slot must never be offered as available.
assert.equal(
  getQuestSlotState(slot({ coolDownBlock: NOW + BigInt(100) }), NOW),
  'cooldown',
);

// ---------------------------------------------------------------------------
// Only 'available' slots are ever startable. v1 batches questStart alone: the
// roll is locked at commit time, so batching commits would give every quest in
// the bundle one shared blockhash and therefore one identical reward.
// ---------------------------------------------------------------------------

const snapshots = toQuestSlotSnapshots(
  [
    {
      landId: BigInt(1),
      slots: [
        slot(),
        slot({ startBlock: NOW - BigInt(5), endBlock: NOW + BigInt(5) }),
        slot({ coolDownBlock: NOW + BigInt(9) }),
      ],
    },
    {
      landId: BigInt(2),
      slots: [slot({ startBlock: NOW - BigInt(9), endBlock: NOW - BigInt(1) })],
    },
    { landId: BigInt(3), slots: [] },
  ],
  NOW,
);

assert.equal(snapshots.length, 4);
// A failed read must be distinguishable from a land with no Farmer House,
// otherwise one flaky multicall entry silently shrinks the batch.
assert.deepEqual(
  toQuestSlotSnapshots([{ landId: BigInt(9), ok: false, slots: [] }], NOW),
  [],
);
assert.deepEqual(
  snapshots.map((entry) => entry.state),
  ['available', 'in_progress', 'cooldown', 'ready_to_commit'],
);
// slotIndex must be the position within its own land, since questStart takes it
// as farmerSlotId and the contract checks it against the Farmer House level.
assert.deepEqual(
  snapshots.map((entry) => [entry.landId.toString(), entry.slotIndex]),
  [['1', 0], ['1', 1], ['1', 2], ['2', 0]],
);

// ---------------------------------------------------------------------------
// Call builder
// ---------------------------------------------------------------------------

const call = buildQuestStartCall(BigInt(42), 2, 1);
assert.equal(call.address, LAND_CONTRACT_ADDRESS);
assert.equal(call.functionName, 'questStart');
assert.deepEqual(call.args, [BigInt(42), 2, BigInt(1)]);

assert.ok(isQuestDifficultyId(0) && isQuestDifficultyId(1) && isQuestDifficultyId(2));
assert.ok(!isQuestDifficultyId(3));
assert.ok(!isQuestDifficultyId(-1));
assert.ok(!isQuestDifficultyId('2'));
assert.deepEqual(
  QUEST_DIFFICULTIES.map((entry) => [entry.id, entry.durationHours]),
  [[0, 3], [1, 6], [2, 12]],
);

// ---------------------------------------------------------------------------
// Reward source resolution. The payer lives in diamond storage because
// QuestRewardsAdminFacet.setQuestRewardsWallet can rotate it; the env vars are
// break-glass only. These offsets are the whole contract of that read.
// ---------------------------------------------------------------------------

// keccak256("eth.pixotchi.land.payment.storage")
const PAYMENT_STORAGE_BASE = '0x1bb31551aec3170585cf49fb9d5c769345db66707d9be249f670328f328a2f71';
assert.equal(getPaymentStorageSlot(BigInt(0)), PAYMENT_STORAGE_BASE);
assert.equal(
  getPaymentStorageSlot(BigInt(4)),
  '0x1bb31551aec3170585cf49fb9d5c769345db66707d9be249f670328f328a2f75',
);
assert.equal(
  getPaymentStorageSlot(BigInt(5)),
  '0x1bb31551aec3170585cf49fb9d5c769345db66707d9be249f670328f328a2f76',
);

assert.equal(
  storageWordToAddress('0x000000000000000000000000654cb07aec203f36f96396e8310c802a5028d28b'),
  '0x654CB07Aec203F36F96396e8310C802a5028D28B',
);
// A zero word is the contract's own "fall back to the constant" signal.
assert.equal(
  storageWordToAddress('0x0000000000000000000000000000000000000000000000000000000000000000'),
  null,
);
assert.equal(storageWordToAddress(null), null);
assert.equal(storageWordToAddress(undefined), null);
assert.equal(storageWordToAddress('0x00'), null);
assert.equal(QUEST_REWARD_FALLBACK_ADDRESS, '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB');

// ---------------------------------------------------------------------------
// Run-scoped fee. The flat charge covers a whole run, however many transactions
// the fleet needs, so a 119-slot wallet pays once rather than once per bundle.
// ---------------------------------------------------------------------------

// A minimal localStorage stand-in; these helpers are otherwise no-ops off-DOM.
const store = new Map<string, string>();
(globalThis as UntypedValue).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    removeItem: (k: string) => { store.delete(k); },
    setItem: (k: string, v: string) => { store.set(k, v); },
  },
};

const RUN_A = '1,2,3';
const RUN_B = '1,2,3,4';
const T0 = 1_700_000_000_000;

clearBatchQuestRun();
assert.equal(isBatchQuestRunPaid(RUN_A, T0), false, 'a fresh run must charge the fee');

markBatchQuestRunPaid(RUN_A, T0);
assert.equal(isBatchQuestRunPaid(RUN_A, T0), true, 'continuation bundles must be free');
assert.equal(
  isBatchQuestRunPaid(RUN_A, T0 + 59 * 60 * 1000),
  true,
  'the run must stay open long enough to finish every bundle',
);

// A different land set is a different run.
assert.equal(isBatchQuestRunPaid(RUN_B, T0), false, 'changed holdings must start a new run');

// Time-boxed, so a half-finished run cannot hand out free bundles tomorrow.
assert.equal(
  isBatchQuestRunPaid(RUN_A, T0 + 61 * 60 * 1000),
  false,
  'an expired run must charge again',
);

// A clock that jumps backwards must not pin a run open forever.
assert.equal(
  isBatchQuestRunPaid(RUN_A, T0 - 5_000),
  false,
  'a backwards clock must not keep a run open',
);

clearBatchQuestRun();
assert.equal(isBatchQuestRunPaid(RUN_A, T0), false, 'clearing must end the run');

// ---------------------------------------------------------------------------
// Wiring: v1 must batch questStart only, and must not reintroduce the env-based
// reward wallet gate that made a funded Farmer House look empty.
// ---------------------------------------------------------------------------

const batchCard = projectFile('components/transactions/batch-quest-start-card.tsx');
assert.match(batchCard, /buildQuestStartCall/);
assert.doesNotMatch(batchCard, /questCommit|questFinalize/);
assert.match(batchCard, /NEXT_PUBLIC_BATCH_QUEST_BURN_AMOUNT \|\| 85000/);
assert.match(batchCard, /NEXT_PUBLIC_BATCH_QUEST_MAX_SIZE \|\| 100/);
assert.match(batchCard, /0x000000000000000000000000000000000000dEaD/);
assert.match(batchCard, /useQuestRewardsAvailability/);
assert.match(batchCard, /rewards\.isUnavailable \?/);
assert.match(batchCard, /taskId: "s3_send_quest"/);
// Partial read failures must surface, and the five-shot buildings:refresh burst
// must coalesce into one re-scan rather than five multicall sweeps per land.
assert.match(batchCard, /unreadableLands > 0 &&/);
assert.match(batchCard, /entry\) => !entry\.ok/);
assert.match(batchCard, /REFRESH_DEBOUNCE_MS/);
// The burn must be conditional, recorded on success, and cleared when the run
// finishes - otherwise a multi-transaction fleet pays the fee more than once.
assert.match(batchCard, /if \(!shouldBurn\) return startCalls;/);
assert.match(batchCard, /markBatchQuestRunPaid\(landIdsHash\)/);
assert.match(batchCard, /clearBatchQuestRun\(\)/);
assert.match(batchCard, /const hasEnoughTokens = !shouldBurn \|\| pixotchiBalance >= burnAmountWei;/);

// Gate order must match batch claim's semantics: "nothing to do" outranks every
// other blocker. Batch claim gets this free by returning early when nothing is
// claimable; this panel always renders the census, so the order is explicit and
// worth pinning - otherwise an EOA with zero idle farmers is told to go get a
// smart wallet for work that does not exist.
const idleGate = batchCard.indexOf('idleSlots.length === 0 ?');
const poolGate = batchCard.indexOf('rewards.isUnavailable ?');
const walletGate = batchCard.indexOf('!isSmartWallet ?');
const fundsGate = batchCard.indexOf('!hasEnoughTokens ?');
assert.ok(idleGate > 0 && poolGate > 0 && walletGate > 0 && fundsGate > 0, 'a gate branch is missing');
assert.ok(idleGate < poolGate, 'idle gate must precede the rewards pool gate');
assert.ok(poolGate < walletGate, 'rewards pool gate must precede the smart wallet gate');
assert.ok(walletGate < fundsGate, 'smart wallet gate must precede the balance gate');

// A slow smart-wallet probe must not flash "Smart Wallet Required" at a user who
// has one, and must not leave the action live before either probe resolves.
assert.match(batchCard, /!smartWalletLoading && !isSmartWallet \?/);
assert.match(batchCard, /disabled=\{!rewards\.isReady \|\| smartWalletLoading\}/);

const farmerHouse = projectFile('components/building-details/FarmerHousePanel.tsx');
assert.match(farmerHouse, /useQuestRewardsAvailability/);
assert.doesNotMatch(farmerHouse, /QUEST_SEED_REWARDS_WALLET|QUEST_LEAF_REWARDS_WALLET/);
assert.doesNotMatch(farmerHouse, /CLIENT_ENV/);

const rewardsHook = projectFile('hooks/useQuestRewardsAvailability.ts');
assert.match(rewardsHook, /getQuestRewardSources/);

const landsView = projectFile('components/tabs/lands-view.tsx');
assert.match(landsView, /type LandUtilityPanel = 'batch-claim' \| 'batch-quests';/);
assert.match(landsView, /BatchQuestStartCard/);
assert.match(landsView, /glyph="BQ"/);
assert.match(landsView, /glyph="BC"/);
// Selecting any utility panel must clear the building highlight, not just claim.
assert.doesNotMatch(landsView, /selectedUtilityPanel === 'batch-claim' \? null : selectedBuilding/);

const envExample = projectFile('.env.example');
for (const key of [
  'NEXT_PUBLIC_QUEST_REWARDS_WALLET',
  'NEXT_PUBLIC_QUEST_SEED_REWARDS_WALLET',
  'NEXT_PUBLIC_QUEST_LEAF_REWARDS_WALLET',
  'NEXT_PUBLIC_BATCH_QUEST_BURN_AMOUNT',
  'NEXT_PUBLIC_BATCH_QUEST_MAX_SIZE',
]) {
  assert.ok(envExample.includes(key), `.env.example is missing ${key}`);
}

// ---------------------------------------------------------------------------
// Batch sizing must stay under the EIP-7825 per-transaction cap that Base
// adopted in Azul. Measured on mainnet: 113,925 gas for a Hard questStart.
// ---------------------------------------------------------------------------

const PER_TX_GAS_CAP = 16_777_216;
const MEASURED_HARD_QUEST_START_GAS = 113_925;
const BUNDLER_OVERHEAD_PER_CALL = 5_000;
const BUNDLER_BASE_OVERHEAD = 21_000;
const MAX_BATCH_SIZE = 100;

const worstCaseBatchGas =
  BUNDLER_BASE_OVERHEAD +
  MAX_BATCH_SIZE * (MEASURED_HARD_QUEST_START_GAS + BUNDLER_OVERHEAD_PER_CALL);

assert.ok(
  worstCaseBatchGas < PER_TX_GAS_CAP,
  `batch of ${MAX_BATCH_SIZE} needs ${worstCaseBatchGas} gas, over the ${PER_TX_GAS_CAP} cap`,
);
// Keep a real safety margin rather than only just fitting.
assert.ok(
  worstCaseBatchGas < PER_TX_GAS_CAP * 0.8,
  `batch of ${MAX_BATCH_SIZE} leaves under 20% headroom (${worstCaseBatchGas}/${PER_TX_GAS_CAP})`,
);

console.log('Batch quest smoke passed');
