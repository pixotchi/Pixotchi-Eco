import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, type Address, type Hex } from 'viem';
import { getBlackjackSettlementProofs } from '../lib/blackjack-mission-proof';
import { validateMissionProofEvidence, type MissionEvidenceLog, type MissionProofDependencies } from '../lib/gamification-proof';
import { LAND_CONTRACT_ADDRESS } from '../lib/contracts';

const player: Address = '0x1111111111111111111111111111111111111111';
const other: Address = '0x2222222222222222222222222222222222222222';
const hash: Hex = `0x${'a'.repeat(64)}`;
const subject = { player, landId: BigInt(1) };
const dependencies: MissionProofDependencies = { hasLandAccess: async () => false, hasPlantAccess: async () => false, isFenceShopItem: async () => false };
const resultEvent = parseAbiItem('event BlackjackResult(uint256 indexed landId, address indexed player, uint8 result, uint8 playerFinalValue, uint8 dealerFinalValue, uint256 payout, address bettingToken)');
const completeEvent = parseAbiItem('event BlackjackGameComplete(uint256 indexed landId, address indexed player, uint8 result, uint8[] playerCards, uint8[] splitCards, uint8[] dealerCards, uint8 playerFinalValue, uint8 splitFinalValue, uint8 dealerFinalValue, uint256 payout, address bettingToken)');

function resultLog(result: number, actor = player, landId = BigInt(1)): MissionEvidenceLog {
  return {
    address: LAND_CONTRACT_ADDRESS,
    topics: encodeEventTopics({ abi: [resultEvent], eventName: 'BlackjackResult', args: { landId, player: actor } }).filter((topic): topic is Hex => typeof topic === 'string'),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }], [result, 21, 18, BigInt(25), other]),
  };
}
function completeLog(result: number): MissionEvidenceLog {
  return {
    address: LAND_CONTRACT_ADDRESS,
    topics: encodeEventTopics({ abi: [completeEvent], eventName: 'BlackjackGameComplete', args: { landId: BigInt(1), player } }).filter((topic): topic is Hex => typeof topic === 'string'),
    data: encodeAbiParameters([{ type: 'uint8' }, { type: 'uint8[]' }, { type: 'uint8[]' }, { type: 'uint8[]' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint8' }, { type: 'uint256' }, { type: 'address' }], [result, [0, 12], [], [8, 22], 21, 0, 18, BigInt(25), other]),
  };
}

async function main() {
  for (const log of [resultLog(2), completeLog(2), resultLog(1), completeLog(0)]) {
    const receipt = { status: 'success', transactionHash: hash, logs: [log] };
    assert.deepEqual(getBlackjackSettlementProofs([receipt, receipt], subject, LAND_CONTRACT_ADDRESS), [hash]);
    assert.equal((await validateMissionProofEvidence(player, 's3_play_casino_game', receipt, {}, dependencies)).valid, true, 'The actual backend verifier accepts natural or ordinary settlement evidence without requiring an Action call');
  }
  const rejectedLogs = [resultLog(0), resultLog(2, other), resultLog(2, player, BigInt(2)), { ...resultLog(2), address: other }, { ...resultLog(2), data: '0x' as Hex }];
  for (const log of rejectedLogs) {
    assert.deepEqual(getBlackjackSettlementProofs([{ transactionHash: hash, logs: [log] }], subject, LAND_CONTRACT_ADDRESS), []);
  }
  assert.deepEqual(getBlackjackSettlementProofs([{ transactionHash: hash, status: 'reverted', logs: [resultLog(2)] }], subject, LAND_CONTRACT_ADDRESS), []);
  assert.deepEqual(getBlackjackSettlementProofs([{ logs: [resultLog(2)] }], subject, LAND_CONTRACT_ADDRESS), []);
  assert.equal((await validateMissionProofEvidence(player, 's3_play_casino_game', { status: 'success', logs: [resultLog(2, other)] }, {}, dependencies)).valid, false, 'Backend binds the credited player');
  assert.equal((await validateMissionProofEvidence(player, 's3_play_casino_game', { status: 'reverted', logs: [resultLog(2)] }, {}, dependencies)).valid, false, 'Backend rejects reverted receipts');
  console.log('PASS BB-16: 17 client/backend settlement proof checks');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
