import { isQuestFinalizeExpired } from './quest-ui';
import { parseReceiptBlock } from './transaction-utils';

export type QuestSlot = {
  difficulty: number;
  startBlock: bigint;
  endBlock: bigint;
  pseudoRndBlock: bigint;
  coolDownBlock: bigint;
};

export type QuestSlotState = 'available' | 'in_progress' | 'ready_to_commit' | 'committed' | 'expired' | 'cooldown';

/** Both direct and multicall reads reject incomplete tuples instead of making
 * an unavailable slot look like an idle slot that is safe to start. */
export function parseQuestSlot(value: unknown): QuestSlot {
  if (!value || typeof value !== 'object') throw new Error('Invalid quest slot');
  const raw = value as Record<string, unknown>;
  const field = (name: string, index: number) => Array.isArray(value) ? value[index] : raw[name];
  const difficulty = field('difficulty', 0);
  if (typeof difficulty !== 'number' || !Number.isInteger(difficulty) || difficulty < 0 || difficulty > 2) throw new Error('Invalid quest difficulty');
  const block = (name: string, index: number) => {
    const parsed = parseReceiptBlock(field(name, index));
    if (parsed === undefined) throw new Error(`Invalid quest ${name}`);
    return parsed;
  };
  return { difficulty, startBlock: block('startBlock', 1), endBlock: block('endBlock', 2), pseudoRndBlock: block('pseudoRndBlock', 3), coolDownBlock: block('coolDownBlock', 4) };
}

export function parseQuestSlots(value: unknown): QuestSlot[] {
  if (!Array.isArray(value)) throw new Error('Invalid quest slots response');
  return value.map(parseQuestSlot);
}

/** The contract returns storage for locked slots as well. Level unlocks at most three. */
export function getUnlockedQuestSlots(slots: readonly QuestSlot[], level: number): readonly QuestSlot[] {
  return slots.slice(0, Number.isFinite(level) ? Math.max(0, Math.min(Math.floor(level), 3)) : 0);
}

/** Ordering matches the contract; the final eligible loot block is inclusive. */
export function getQuestSlotState(slot: QuestSlot, currentBlock: bigint): QuestSlotState {
  if (slot.coolDownBlock !== BigInt(0) && currentBlock < slot.coolDownBlock) return 'cooldown';
  if (slot.startBlock === BigInt(0)) return 'available';
  if (slot.pseudoRndBlock !== BigInt(0)) return isQuestFinalizeExpired(slot, currentBlock) ? 'expired' : 'committed';
  if (currentBlock <= slot.endBlock) return 'in_progress';
  return 'ready_to_commit';
}

export function summarizeQuestSlots(slots: readonly QuestSlot[], currentBlock: bigint): Record<QuestSlotState, number> | null {
  if (currentBlock <= BigInt(0)) return null;
  const counts: Record<QuestSlotState, number> = { available: 0, in_progress: 0, ready_to_commit: 0, committed: 0, expired: 0, cooldown: 0 };
  for (const slot of slots) counts[getQuestSlotState(slot, currentBlock)] += 1;
  return counts;
}
