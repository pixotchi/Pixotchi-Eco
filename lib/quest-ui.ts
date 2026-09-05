import { decodeEventLog, type Hex } from 'viem';
import { formatTokenDisplay } from './token-display';
import { formatDurationSeconds } from './duration-display';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { CLIENT_ENV } from '@/lib/env-config';

export const QUEST_FINALIZE_EXPIRY_BLOCKS = BigInt(256);
export const QUEST_EXPIRED_STATUS = 'Expired — reset required';

export function isQuestFinalizeExpired(slot: { pseudoRndBlock: bigint }, currentBlock: bigint) {
  return slot.pseudoRndBlock !== BigInt(0)
    && currentBlock > slot.pseudoRndBlock + QUEST_FINALIZE_EXPIRY_BLOCKS;
}

export function questFinalizeBlocksRemaining(slot: { pseudoRndBlock: bigint }, currentBlock: bigint) {
  const remaining = slot.pseudoRndBlock + QUEST_FINALIZE_EXPIRY_BLOCKS - currentBlock;
  return remaining > BigInt(0) ? remaining : BigInt(0);
}

type RewardType = 0 | 1 | 2 | 3 | 4;
export type QuestFinalizeResult =
  | { outcome: 'finalized'; rewardType: RewardType; amount: bigint; transactionHash?: Hex }
  | { outcome: 'reset'; transactionHash?: Hex }
  | { outcome: 'unknown' };
export type QuestFinalizeOutcome = QuestFinalizeResult['outcome'];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function transactionHash(value: unknown): Hex | undefined {
  return typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value) ? value as Hex : undefined;
}

/** Only matching events from the land diamond prove a reward or an expired reset. */
export function getQuestFinalizeResult(proof: unknown, landId: bigint, slotIndex: number): QuestFinalizeResult {
  const root = record(proof);
  const receipts = [...(Array.isArray(root?.transactionReceipts) ? root.transactionReceipts : []), proof];
  for (const value of receipts) {
    const receipt = record(value);
    if (!Array.isArray(receipt?.logs)) continue;
    for (const raw of receipt.logs) {
      const log = record(raw);
      if (typeof log?.address !== 'string'
        || log.address.toLowerCase() !== CLIENT_ENV.LAND_CONTRACT_ADDRESS.toLowerCase()
        || typeof log.data !== 'string' || !Array.isArray(log.topics)) continue;
      try {
        const decoded = decodeEventLog({
          abi: landAbi,
          data: log.data as Hex,
          topics: log.topics as [Hex, ...Hex[]],
        });
        if (decoded.eventName !== 'QuestFinalized' && decoded.eventName !== 'QuestReset') continue;
        const args = decoded.args;
        if (args.landId !== landId || args.farmerSlotId !== BigInt(slotIndex)) continue;
        const hash = transactionHash(receipt.transactionHash) ?? transactionHash(log.transactionHash)
          ?? transactionHash(root?.transactionHash);
        if (decoded.eventName === 'QuestReset') return { outcome: 'reset', transactionHash: hash };
        if (decoded.args.rewardType < 0 || decoded.args.rewardType > 4) continue;
        return {
          outcome: 'finalized', rewardType: decoded.args.rewardType as RewardType,
          amount: decoded.args.amount, transactionHash: hash,
        };
      } catch {
        // Other diamond events (including the facet's alternate signature) are unrelated.
      }
    }
  }
  return { outcome: 'unknown' };
}

export function getQuestFinalizeOutcome(proof: unknown, landId: bigint, slotIndex: number): QuestFinalizeOutcome {
  return getQuestFinalizeResult(proof, landId, slotIndex).outcome;
}

function compactAmount(amount: bigint, decimals: number): string {
  return formatTokenDisplay(amount, decimals, 4);
}

export function describeQuestResult(result: QuestFinalizeResult, landId: bigint): string {
  if (result.outcome === 'reset') return 'Quest expired and was reset. No reward was earned.';
  if (result.outcome === 'unknown') return 'Quest updated, but the reward could not be verified.';
  const { amount, rewardType } = result;
  switch (rewardType) {
    case 0: return `+${compactAmount(amount, 18)} SEED → your wallet`;
    case 1: return `+${compactAmount(amount, 18)} LEAF → your wallet`;
    case 2: {
      return `+${formatDurationSeconds(amount, 'exact')} lifetime → Land #${landId} Warehouse`;
    }
    case 3: return `+${compactAmount(amount, 12)} PTS → Land #${landId} Warehouse`;
    case 4: return `+${compactAmount(amount, 18)} XP → Land #${landId}`;
  }
}

export const questResultScope = (owner: string | undefined, landId: bigint) =>
  `${owner?.toLowerCase() ?? 'disconnected'}:${landId}`;

type ResultStorage = Pick<Storage, 'getItem' | 'setItem'>;
const storageKey = (scope: string, slot: number) => `pixotchi:quest-result:v1:${scope}:${slot}`;

/** One latest result per slot, scoped to this browser session and wallet. */
export function saveQuestResult(storage: ResultStorage, scope: string, slot: number, result: QuestFinalizeResult) {
  if (result.outcome === 'unknown') return;
  try {
    storage.setItem(storageKey(scope, slot), JSON.stringify(result, (_, value) => typeof value === 'bigint' ? value.toString() : value));
  } catch { /* Storage denial must never turn a successful transaction into an error. */ }
}

export function loadQuestResult(storage: ResultStorage, scope: string, slot: number): QuestFinalizeResult | null {
  try {
    const value = record(JSON.parse(storage.getItem(storageKey(scope, slot)) ?? 'null'));
    const hash = transactionHash(value?.transactionHash);
    if (value?.outcome === 'reset') return { outcome: 'reset', transactionHash: hash };
    if (value?.outcome !== 'finalized' || typeof value.rewardType !== 'number'
      || !Number.isInteger(value.rewardType) || value.rewardType < 0 || value.rewardType > 4
      || typeof value.amount !== 'string' || !/^\d+$/.test(value.amount)) return null;
    return { outcome: 'finalized', rewardType: value.rewardType as RewardType, amount: BigInt(value.amount), transactionHash: hash };
  } catch { return null; }
}
