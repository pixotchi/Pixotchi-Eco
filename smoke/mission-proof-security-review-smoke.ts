import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiItem,
  type Address,
  type Hex,
} from 'viem';
import { LAND_CONTRACT_ADDRESS } from '../lib/contracts';
import {
  validateMissionProofEvidence,
  type MissionEvidenceLog,
  type MissionProofDependencies,
} from '../lib/gamification-proof';

const USER = '0x1111111111111111111111111111111111111111' as Address;
const questStarted = parseAbiItem(
  'event QuestStarted(uint256 indexed landId, uint8 difficultyLevel, uint256 farmerSlotId)',
);

function questLog(landId: bigint): MissionEvidenceLog {
  const topics = encodeEventTopics({
    abi: [questStarted],
    eventName: 'QuestStarted',
    args: { landId },
  });
  const nonIndexed = questStarted.inputs.filter((input) => !('indexed' in input) || !input.indexed);
  const data = encodeAbiParameters(nonIndexed, [1, BigInt(0)]);
  return {
    address: LAND_CONTRACT_ADDRESS,
    data,
    topics: topics as readonly Hex[],
  };
}

async function main() {
  let accessChecks = 0;
  const dependencies: MissionProofDependencies = {
    hasLandAccess: async (_address, tokenId) => {
      accessChecks += 1;
      return tokenId === BigInt(5);
    },
    hasPlantAccess: async () => false,
    isFenceShopItem: async () => false,
  };

  const result = await validateMissionProofEvidence(
    USER,
    's3_send_quest',
    {
      status: 'success',
      logs: [1, 2, 3, 4, 5].map((id) => questLog(BigInt(id))),
    },
    {},
    dependencies,
  );
  assert.equal(result.valid, false, 'unbounded receipt assets must not fan out into RPC reads');
  assert.equal(accessChecks, 4, 'asset access verification must have a small hard cap');

  const routeSource = readFileSync(
    resolve(process.cwd(), 'app/api/gamification/missions/route.ts'),
    'utf8',
  );
  const replayPreflightIndex = routeSource.indexOf('await assertMissionProofUnused');
  const receiptReadIndex = routeSource.indexOf('getTransactionReceiptWithRetry(canonicalProof.txHash)');
  assert.ok(replayPreflightIndex > 0 && replayPreflightIndex < receiptReadIndex,
    'known replayed hashes must be rejected before receipt RPC reads');
  assert.match(routeSource, /kind: 'ip',[\s\S]*getRequestIp\(request\) \?\? 'unknown'/);
  assert.match(routeSource, /taskId === 's2_chat_message'[\s\S]*stored public message/,
    'the generic mission endpoint must not impersonate the authenticated chat action');
  assert.match(routeSource, /hasAssetAccess\([\s\S]*receipt\.blockNumber/);
  assert.match(routeSource, /functionName: 'ownerOf',[\s\S]*blockNumber/);
  assert.match(routeSource, /functionName: 'getApproved',[\s\S]*blockNumber/);
  assert.doesNotMatch(routeSource, /isApprovedForAll/,
    'proof access must mirror the deployed owner-or-token-approved modifier');

  const serviceSource = readFileSync(
    resolve(process.cwd(), 'lib/gamification-service.ts'),
    'utf8',
  );
  assert.match(serviceSource, /assertMissionProofUnused[\s\S]*result\.status === 'unavailable'[\s\S]*MissionProofPersistenceError/);
  assert.match(serviceSource, /if \(!redisClient\) throw new MissionProofPersistenceError/);
  assert.match(serviceSource, /Stored mission progress is invalid/);

  console.log('mission proof independent security review smoke: ok');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
