import {
  decodeFunctionData,
  decodeEventLog,
  parseAbiItem,
  toFunctionSelector,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import {
  LAND_CONTRACT_ADDRESS,
  PIXOTCHI_NFT_ADDRESS,
  STAKE_CONTRACT_ADDRESS,
} from './contracts';
import {
  BASESWAP_ROUTER_ADDRESS,
  KYBER_ROUTER_ALLOWLIST,
  SEED_ADDRESS,
} from './swap/constants';
import { SEED_PAIR_ADDRESS } from './seed-market';
import type { GmTaskId } from './gamification-types';

export const MISSION_PROOF_TASKS: ReadonlySet<GmTaskId> = new Set([
  's1_make_swap',
  's1_stake_seed',
  's1_claim_stake',
  's1_place_order',
  's3_apply_resources',
  's3_send_quest',
  's3_claim_production',
  's3_play_casino_game',
  's4_buy10_elements',
  's4_buy_shield',
  's4_collect_star',
  's4_play_arcade',
]);

export function missionTaskRequiresProof(taskId: GmTaskId): boolean {
  return MISSION_PROOF_TASKS.has(taskId);
}

export type MissionEvidenceLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
};

export type MissionReceiptEvidence = {
  status: 'success' | 'reverted' | string;
  logs: readonly MissionEvidenceLog[];
};

export type MissionTransactionEvidence = {
  from?: Address | null;
  to?: Address | null;
  input?: Hex;
};

export type MissionProofDependencies = {
  hasLandAccess(address: Address, tokenId: bigint): Promise<boolean>;
  hasPlantAccess(address: Address, tokenId: bigint): Promise<boolean>;
  isFenceShopItem(itemId: bigint): Promise<boolean>;
};

export type MissionProofValidation = {
  valid: boolean;
  count?: number;
  /** Canonical receipt positions, assigned only by server verification. */
  evidenceIds?: string[];
};

const MAX_RECEIPT_LOGS = 512;
const MAX_ASSET_ACCESS_CHECKS = 4;

const EVENTS = {
  tokensStaked: parseAbiItem('event TokensStaked(address indexed staker, uint256 amount)'),
  rewardsClaimed: parseAbiItem('event RewardsClaimed(address indexed staker, uint256 rewardAmount)'),
  orderCreated: parseAbiItem('event OrderCreated(uint256 orderId, address seller, uint8 sellToken, uint256 amount, uint256 amountAsk)'),
  questStarted: [
    parseAbiItem('event QuestStarted(uint256 indexed landId, uint8 difficultyLevel, uint256 farmerSlotId)'),
    parseAbiItem('event QuestStarted(uint256 indexed landId, uint256 indexed farmerSlotId, uint8 difficulty, uint256 startBlock, uint256 endBlock)'),
  ],
  villageProductionClaimed: parseAbiItem('event VillageProductionClaimed(uint256 indexed landId, uint8 indexed buildingId)'),
  plantPointsAssigned: parseAbiItem('event PlantPointsAssigned(uint256 indexed landId, uint256 indexed plantId, uint256 addedPoints, uint256 newPlantPoints)'),
  plantLifetimeAssigned: parseAbiItem('event PlantLifetimeAssigned(uint256 indexed landId, uint256 indexed plantId, uint256 lifetime, uint256 newLifetime)'),
  rouletteResult: parseAbiItem('event RouletteSpinResult(uint256 indexed landId, address indexed player, uint8 winningNumber, bool won, uint256 payout, address bettingToken)'),
  blackjackResult: parseAbiItem('event BlackjackResult(uint256 indexed landId, address indexed player, uint8 result, uint8 playerFinalValue, uint8 dealerFinalValue, uint256 payout, address bettingToken)'),
  blackjackComplete: parseAbiItem('event BlackjackGameComplete(uint256 indexed landId, address indexed player, uint8 result, uint8[] playerCards, uint8[] splitCards, uint8[] dealerCards, uint8 playerFinalValue, uint8 splitFinalValue, uint8 dealerFinalValue, uint256 payout, address bettingToken)'),
  baccaratResult: parseAbiItem('event BaccaratRoundResult(uint256 indexed landId, address indexed player, uint8 betType, uint8 outcome, bool won, uint8 playerTotal, uint8 bankerTotal, uint256 payout, address bettingToken)'),
  itemConsumed: parseAbiItem('event ItemConsumed(uint256 nftId, address giver, uint256 itemId)'),
  shopItemPurchased: parseAbiItem('event ShopItemPurchased(uint256 indexed nftId, address indexed buyer, uint256 indexed itemId)'),
  killed: parseAbiItem('event Killed(uint256 nftId, uint256 deadId, string loserName, uint256 reward, address killer, string winnerName)'),
  spinPlayed: [
    parseAbiItem('event SpinGameV2Played(uint256 indexed nftId, address indexed player, uint256 indexed rewardIndex, int256 pointsDelta, uint256 timeAdded, uint256 leafAmount)'),
    parseAbiItem('event SpinGameV2Played(uint256 indexed nftId, address indexed player, uint256 rewardIndex, int256 pointsDelta, uint256 timeAdded, uint256 leafAmount)'),
  ],
  played: [
    parseAbiItem('event Played(uint256 indexed id, uint256 points, uint256 timeExtension, string gameName)'),
    parseAbiItem('event PlayedV2(uint256 indexed id, int256 points, int256 timeExtension, string gameName)'),
  ],
  transfer: parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
  swap: parseAbiItem('event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)'),
} as const;

const BASESWAP_SWAP_SELECTORS: ReadonlySet<string> = new Set([
  toFunctionSelector('swapExactETHForTokensSupportingFeeOnTransferTokens(uint256,address[],address,uint256)'),
  toFunctionSelector('swapExactTokensForETHSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'),
  toFunctionSelector('swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,address[],address,uint256)'),
]);
const FENCE_V2_SELECTOR = toFunctionSelector('fenceV2Purchase(uint256,uint256)');
const FENCE_V2_FUNCTION = parseAbiItem('function fenceV2Purchase(uint256 nftId, uint256 days) payable');

function sameAddress(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function positive(value: unknown): boolean {
  return typeof value === 'bigint' && value > BigInt(0);
}

function isValidFenceCallData(input: Hex | undefined): boolean {
  if (typeof input !== 'string' || input.slice(0, 10).toLowerCase() !== FENCE_V2_SELECTOR) return false;
  try {
    const decoded = decodeFunctionData({ abi: [FENCE_V2_FUNCTION], data: input });
    return decoded.functionName === 'fenceV2Purchase'
      && Array.isArray(decoded.args)
      && positive(decoded.args[1]);
  } catch {
    return false;
  }
}

function decodeArgs(log: MissionEvidenceLog, event: AbiEvent): Record<string, unknown> | null {
  if (!Array.isArray(log.topics) || log.topics.length === 0 || log.topics.length > 4) return null;
  try {
    const decoded = decodeEventLog({
      abi: [event],
      data: log.data,
      topics: log.topics as [Hex, ...Hex[]],
      strict: true,
    });
    return decoded.args as Record<string, unknown>;
  } catch {
    return null;
  }
}

function matchingLogs(
  receipt: MissionReceiptEvidence,
  contract: string,
  events: AbiEvent | readonly AbiEvent[],
): Array<Record<string, unknown> & { proofLogIndex: number }> {
  const candidates = Array.isArray(events) ? events : [events];
  const matches: Array<Record<string, unknown> & { proofLogIndex: number }> = [];
  for (const [proofLogIndex, log] of receipt.logs.entries()) {
    if (!sameAddress(log.address, contract)) continue;
    for (const event of candidates) {
      const args = decodeArgs(log, event);
      if (args) {
        matches.push({ ...args, proofLogIndex });
        break;
      }
    }
  }
  return matches;
}

function proofFromLogs(matches: Array<{ proofLogIndex: number }>, counted = false): MissionProofValidation {
  const selected = counted ? matches.slice(0, 120) : matches.slice(0, 1);
  return { valid: selected.length > 0, evidenceIds: selected.map(log => `log:${log.proofLogIndex}`),
    ...(counted ? { count: selected.length } : {}) };
}

async function anyAssetAccess(
  matches: Array<Record<string, unknown> & { proofLogIndex: number }>,
  field: string,
  check: (tokenId: bigint) => Promise<boolean>,
): Promise<MissionProofValidation> {
  const checked = new Set<string>();
  for (const args of matches) {
    const tokenId = args[field];
    if (typeof tokenId !== 'bigint' || tokenId < BigInt(0)) continue;
    const key = tokenId.toString();
    if (checked.has(key)) continue;
    if (checked.size >= MAX_ASSET_ACCESS_CHECKS) return { valid: false };
    checked.add(key);
    if (await check(tokenId)) return proofFromLogs([args]);
  }
  return { valid: false };
}

async function validateSwap(
  address: Address,
  receipt: MissionReceiptEvidence,
  transaction: MissionTransactionEvidence,
): Promise<boolean> {
  const transfers = matchingLogs(receipt, SEED_ADDRESS, EVENTS.transfer);
  const seedSentByUser = transfers.some(args => positive(args.value) && sameAddress(args.from, address));
  const seedReceivedByUser = transfers.some(args => positive(args.value) && sameAddress(args.to, address));
  const seedMovedForUser = seedSentByUser || seedReceivedByUser;
  if (!seedMovedForUser) return false;

  const pairSwaps = matchingLogs(receipt, SEED_PAIR_ADDRESS, EVENTS.swap);
  const pairSwapOccurred = pairSwaps.some(args =>
    positive(args.amount0In) || positive(args.amount1In) || positive(args.amount0Out) || positive(args.amount1Out),
  );
  const pairOutputToUser = pairSwaps.some(args => sameAddress(args.to, address));
  if (pairSwapOccurred && (seedSentByUser || (seedReceivedByUser && pairOutputToUser))) return true;

  if (!sameAddress(transaction.from, address) || !transaction.to) return false;
  const selector = typeof transaction.input === 'string' ? transaction.input.slice(0, 10).toLowerCase() : '';
  if (sameAddress(transaction.to, BASESWAP_ROUTER_ADDRESS)) {
    return BASESWAP_SWAP_SELECTORS.has(selector);
  }
  return Array.from(KYBER_ROUTER_ALLOWLIST).some(router => sameAddress(transaction.to, router))
    && selector.length === 10;
}

/**
 * Validate that a successful receipt contains the task-specific, actor-bound
 * evidence expected from Pixotchi's configured contracts. This function is
 * deliberately fail-closed: unknown logs and merely-successful transactions
 * never count as mission proof.
 */
export async function validateMissionProofEvidence(
  address: Address,
  taskId: GmTaskId,
  receipt: MissionReceiptEvidence,
  transaction: MissionTransactionEvidence,
  dependencies: MissionProofDependencies,
): Promise<MissionProofValidation> {
  if (receipt.status !== 'success' || !Array.isArray(receipt.logs) || receipt.logs.length > MAX_RECEIPT_LOGS) {
    return { valid: false };
  }

  switch (taskId) {
    case 's1_make_swap':
      return await validateSwap(address, receipt, transaction)
        ? proofFromLogs(matchingLogs(receipt, SEED_ADDRESS, EVENTS.transfer).filter(args => positive(args.value) && (sameAddress(args.from, address) || sameAddress(args.to, address))))
        : { valid: false };
    case 's1_stake_seed': {
      const matches = matchingLogs(receipt, STAKE_CONTRACT_ADDRESS, EVENTS.tokensStaked);
      return proofFromLogs(matches.filter(args => sameAddress(args.staker, address) && positive(args.amount)));
    }
    case 's1_claim_stake': {
      const matches = matchingLogs(receipt, STAKE_CONTRACT_ADDRESS, EVENTS.rewardsClaimed);
      return proofFromLogs(matches.filter(args => sameAddress(args.staker, address) && positive(args.rewardAmount)));
    }
    case 's1_place_order': {
      const matches = matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.orderCreated);
      return proofFromLogs(matches.filter(args => sameAddress(args.seller, address) && positive(args.amount) && positive(args.amountAsk)));
    }
    case 's3_apply_resources': {
      const pointMatches = matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.plantPointsAssigned)
        .filter(args => positive(args.addedPoints));
      const lifetimeMatches = matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.plantLifetimeAssigned)
        .filter(args => positive(args.lifetime));
      const proof = await anyAssetAccess(
        [...pointMatches, ...lifetimeMatches],
        'landId',
        landId => dependencies.hasLandAccess(address, landId),
      );
      return proof;
    }
    case 's3_send_quest': {
      const matches = matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.questStarted);
      return anyAssetAccess(matches, 'landId', landId => dependencies.hasLandAccess(address, landId));
    }
    case 's3_claim_production': {
      const matches = matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.villageProductionClaimed);
      return anyAssetAccess(matches, 'landId', landId => dependencies.hasLandAccess(address, landId));
    }
    case 's3_play_casino_game': {
      const matches = [
        ...matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.rouletteResult),
        ...matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.blackjackResult),
        ...matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.blackjackComplete),
        ...matchingLogs(receipt, LAND_CONTRACT_ADDRESS, EVENTS.baccaratResult),
      ];
      return proofFromLogs(matches.filter(args => sameAddress(args.player, address)));
    }
    case 's4_buy10_elements': {
      const matches = matchingLogs(receipt, PIXOTCHI_NFT_ADDRESS, EVENTS.itemConsumed)
        .filter(args => sameAddress(args.giver, address));
      return proofFromLogs(matches, true);
    }
    case 's4_buy_shield': {
      const matches = matchingLogs(receipt, PIXOTCHI_NFT_ADDRESS, EVENTS.shopItemPurchased)
        .filter(args => sameAddress(args.buyer, address));
      for (const args of matches) {
        if (typeof args.itemId === 'bigint' && await dependencies.isFenceShopItem(args.itemId)) {
          return proofFromLogs([args]);
        }
      }
      return {
        valid: sameAddress(transaction.from, address)
          && sameAddress(transaction.to, PIXOTCHI_NFT_ADDRESS)
          && isValidFenceCallData(transaction.input),
        evidenceIds: ['call:0'],
      };
    }
    case 's4_collect_star': {
      const matches = matchingLogs(receipt, PIXOTCHI_NFT_ADDRESS, EVENTS.killed);
      return proofFromLogs(matches.filter(args => sameAddress(args.killer, address) && positive(args.reward)));
    }
    case 's4_play_arcade': {
      const spinMatches = matchingLogs(receipt, PIXOTCHI_NFT_ADDRESS, EVENTS.spinPlayed);
      const ownedSpin = spinMatches.filter(args => sameAddress(args.player, address));
      if (ownedSpin.length) return proofFromLogs(ownedSpin);
      const legacyMatches = matchingLogs(receipt, PIXOTCHI_NFT_ADDRESS, EVENTS.played);
      return anyAssetAccess(legacyMatches, 'id', id => dependencies.hasPlantAccess(address, id));
    }
    case 's2_follow_player':
    case 's2_chat_message':
    case 's2_visit_profile':
      return { valid: false };
  }
}
