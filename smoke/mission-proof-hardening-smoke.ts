import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  parseAbiItem,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import {
  validateMissionProofEvidence,
  type MissionEvidenceLog,
  type MissionProofDependencies,
} from '../lib/gamification-proof';
import {
  PIXOTCHI_NFT_ADDRESS,
  STAKE_CONTRACT_ADDRESS,
} from '../lib/contracts';
import { GM_TASK_IDS, isGmTaskId } from '../lib/gamification-types';

const USER = '0x1111111111111111111111111111111111111111' as Address;
const OTHER = '0x2222222222222222222222222222222222222222' as Address;

const dependencies: MissionProofDependencies = {
  hasLandAccess: async () => false,
  hasPlantAccess: async () => false,
  isFenceShopItem: async () => false,
};

function eventLog(
  address: Address,
  event: AbiEvent,
  args: Record<string, unknown>,
): MissionEvidenceLog {
  const topics = encodeEventTopics({
    abi: [event],
    eventName: event.name,
    args,
  } as UntypedValue);
  const nonIndexed = event.inputs.filter(input => !input.indexed);
  const values = nonIndexed.map(input => args[input.name || '']);
  const data = encodeAbiParameters(nonIndexed, values as UntypedValue);
  return { address, data, topics: topics as readonly Hex[] };
}

async function main() {
  assert.equal(GM_TASK_IDS.every(isGmTaskId), true, 'all declared tasks must pass runtime validation');
  assert.equal(isGmTaskId('s1_make_swap\0attacker'), false, 'task ids must be exact');
  assert.equal(isGmTaskId('__proto__'), false, 'object-property names are not task ids');

  const staked = parseAbiItem('event TokensStaked(address indexed staker, uint256 amount)');
  const validStake = await validateMissionProofEvidence(
    USER,
    's1_stake_seed',
    { status: 'success', logs: [eventLog(STAKE_CONTRACT_ADDRESS, staked, { staker: USER, amount: BigInt(10) })] },
    {},
    dependencies,
  );
  assert.equal(validStake.valid, true, 'stake proof binds the configured contract, event, actor, and positive amount');

  const wrongActor = await validateMissionProofEvidence(
    USER,
    's1_stake_seed',
    { status: 'success', logs: [eventLog(STAKE_CONTRACT_ADDRESS, staked, { staker: OTHER, amount: BigInt(10) })] },
    {},
    dependencies,
  );
  assert.equal(wrongActor.valid, false, 'another wallet stake cannot satisfy the mission');

  const wrongTask = await validateMissionProofEvidence(
    USER,
    's1_claim_stake',
    { status: 'success', logs: [eventLog(STAKE_CONTRACT_ADDRESS, staked, { staker: USER, amount: BigInt(10) })] },
    {},
    dependencies,
  );
  assert.equal(wrongTask.valid, false, 'a valid event for one task cannot prove another task');

  const consumed = parseAbiItem('event ItemConsumed(uint256 nftId, address giver, uint256 itemId)');
  const purchaseLog = eventLog(PIXOTCHI_NFT_ADDRESS, consumed, {
    nftId: BigInt(7),
    giver: USER,
    itemId: BigInt(3),
  });
  const purchases = await validateMissionProofEvidence(
    USER,
    's4_buy10_elements',
    { status: 'success', logs: [purchaseLog, purchaseLog] },
    {},
    dependencies,
  );
  assert.deepEqual(purchases, { valid: true, count: 2 }, 'purchase count comes from matching receipt events');

  const fenceFunction = parseAbiItem('function fenceV2Purchase(uint256 nftId, uint256 days) payable');
  const fenceInput = encodeFunctionData({
    abi: [fenceFunction],
    functionName: 'fenceV2Purchase',
    args: [BigInt(7), BigInt(1)],
  });
  const directFence = await validateMissionProofEvidence(
    USER,
    's4_buy_shield',
    { status: 'success', logs: [] },
    { from: USER, to: PIXOTCHI_NFT_ADDRESS, input: fenceInput },
    dependencies,
  );
  assert.equal(directFence.valid, true, 'legacy fence purchases bind both sender and function selector');
  const wrongFenceActor = await validateMissionProofEvidence(
    USER,
    's4_buy_shield',
    { status: 'success', logs: [] },
    { from: OTHER, to: PIXOTCHI_NFT_ADDRESS, input: fenceInput },
    dependencies,
  );
  assert.equal(wrongFenceActor.valid, false, 'another wallet fence call cannot satisfy the mission');

  const routeSource = readFileSync(resolve('app/api/gamification/missions/route.ts'), 'utf8');
  assert.match(routeSource, /A valid transaction proof is required/);
  assert.match(routeSource, /count does not match the verified purchase events/);
  assert.match(routeSource, /MAX_POST_BODY_CHARS/);
  assert.match(
    routeSource,
    /enforceRateLimit\(request,[\s\S]*failClosed: true[\s\S]*kind: 'address'[\s\S]*getTransactionReceiptWithRetry/,
    'wallet rate limiting must fail closed before transaction RPC reads',
  );

  const serviceSource = readFileSync(resolve('lib/gamification-service.ts'), 'utf8');
  assert.match(serviceSource, /EXISTS", proofUsedKey/);
  assert.match(serviceSource, /SET", missionKey, nextMission/);
  assert.match(serviceSource, /SET", proofUsedKey, proofRecord/);
  assert.match(serviceSource, /MissionProofAlreadyUsedError/);

  console.log('mission proof hardening smoke: ok');
}

void main();
