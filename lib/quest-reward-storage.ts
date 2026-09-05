import { keccak256, toBytes, toHex } from 'viem';

const PAYMENT_STORAGE_BASE_SLOT = BigInt(
  keccak256(toBytes('eth.pixotchi.land.payment.storage')),
);

export const SEED_REWARD_ADDRESS_SLOT_OFFSET = BigInt(4);
export const LEAF_REWARD_ADDRESS_SLOT_OFFSET = BigInt(5);

export const getPaymentStorageSlot = (offset: bigint): `0x${string}` =>
  toHex(PAYMENT_STORAGE_BASE_SLOT + offset, { size: 32 });

const QUEST_REWARD_STORAGE_SLOTS = new Set([
  getPaymentStorageSlot(SEED_REWARD_ADDRESS_SLOT_OFFSET).toLowerCase(),
  getPaymentStorageSlot(LEAF_REWARD_ADDRESS_SLOT_OFFSET).toLowerCase(),
]);

/**
 * The anonymous RPC tier only needs the two public storage words used to show
 * Farmer House reward funding. Keep this check next to the slot derivation so
 * the contract reader and the relay policy cannot drift apart.
 */
export function isLatestQuestRewardStorageRead(
  params: unknown,
  landContractAddress: string,
): boolean {
  if (!Array.isArray(params) || (params.length !== 2 && params.length !== 3)) return false;
  const [address, slot, blockTag = 'latest'] = params;
  return typeof address === 'string'
    && address.toLowerCase() === landContractAddress.toLowerCase()
    && typeof slot === 'string'
    && QUEST_REWARD_STORAGE_SLOTS.has(slot.toLowerCase())
    && blockTag === 'latest';
}
