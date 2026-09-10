import { encodePacked, isAddress, keccak256, verifyMessage, type Address, type Hex } from 'viem';

export const BLACKJACK_LOCK_PREFIX = 'blackjack:action-lock:';
export const BLACKJACK_INVENTORY_KEY = 'blackjack:alias-inventory:v1';
export const BLACKJACK_UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);

export interface BlackjackLock {
  randomSeed: Hex;
  signature: Hex;
  timestamp: number;
  signerAddress: string;
  actionNum: number;
  handIndex: number;
  bettingToken: string;
  playerAddress: string;
  betAmountWei?: string | null;
}

export function parseCanonicalBlackjackLandId(value: unknown): bigint | null {
  if (typeof value !== 'string' || value.length > 78 || !/^(0|[1-9]\d*)$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= BLACKJACK_UINT256_MAX ? parsed : null;
}

export function blackjackActionLockKey(landId: bigint, nonce: bigint): string {
  if (landId < BigInt(0) || landId > BLACKJACK_UINT256_MAX || nonce < BigInt(0) || nonce > BLACKJACK_UINT256_MAX) {
    throw new Error('Invalid Blackjack lock identity');
  }
  return `${BLACKJACK_LOCK_PREFIX}${landId.toString()}:${nonce.toString()}`;
}

export function blackjackQuarantineKey(landId: bigint, nonce: bigint): string {
  return blackjackActionLockKey(landId, nonce).replace(BLACKJACK_LOCK_PREFIX, 'blackjack:quarantine:');
}

/** Legacy keys may contain leading zeroes. Oversized/malformed keys are unknown, never absent. */
export function parseBlackjackAliasKey(key: string): { landId: bigint; nonce: bigint; canonicalKey: string } | null {
  if (key.length > 2048 || !key.startsWith(BLACKJACK_LOCK_PREFIX)) return null;
  const match = /^(\d+):(\d+)$/.exec(key.slice(BLACKJACK_LOCK_PREFIX.length));
  if (!match) return null;
  const landId = BigInt(match[1]);
  const nonce = BigInt(match[2]);
  if (landId > BLACKJACK_UINT256_MAX || nonce > BLACKJACK_UINT256_MAX) return null;
  return { landId, nonce, canonicalKey: blackjackActionLockKey(landId, nonce) };
}

export function isBlackjackLock(value: unknown): value is BlackjackLock {
  if (!value || typeof value !== 'object') return false;
  const lock = value as Partial<BlackjackLock>;
  return typeof lock.randomSeed === 'string' && /^0x[\da-f]{64}$/i.test(lock.randomSeed)
    && typeof lock.signature === 'string' && /^0x[\da-f]{130}$/i.test(lock.signature)
    && typeof lock.timestamp === 'number' && Number.isFinite(lock.timestamp) && lock.timestamp >= 0
    && typeof lock.signerAddress === 'string' && isAddress(lock.signerAddress)
    && typeof lock.actionNum === 'number' && [0, 1, 2, 3, 4, 255].includes(lock.actionNum)
    && typeof lock.handIndex === 'number' && [0, 1].includes(lock.handIndex)
    && typeof lock.bettingToken === 'string' && isAddress(lock.bettingToken)
    && typeof lock.playerAddress === 'string' && isAddress(lock.playerAddress)
    && (lock.betAmountWei == null || (typeof lock.betAmountWei === 'string'
      && lock.betAmountWei.length <= 78 && /^\d+$/.test(lock.betAmountWei)
      && BigInt(lock.betAmountWei) <= BLACKJACK_UINT256_MAX));
}

export function blackjackMessageHash(landId: bigint, nonce: bigint, lock: Pick<BlackjackLock, 'randomSeed' | 'actionNum' | 'handIndex' | 'bettingToken'>): Hex {
  return keccak256(encodePacked(
    ['uint256', 'uint256', 'bytes32', 'uint8', 'uint8', 'address'],
    [landId, nonce, lock.randomSeed, lock.actionNum, lock.handIndex, lock.bettingToken as Address],
  ));
}

export async function verifyBlackjackLock(landId: bigint, nonce: bigint, value: unknown, signer: Address): Promise<boolean> {
  if (!isBlackjackLock(value) || value.signerAddress.toLowerCase() !== signer.toLowerCase()) return false;
  try {
    return await verifyMessage({ address: signer, message: { raw: blackjackMessageHash(landId, nonce, value) }, signature: value.signature });
  } catch { return false; }
}

/** Include unsigned app intent too: different player/amount records need manual review. */
export function blackjackDecisionDigest(lock: BlackjackLock): Hex {
  return keccak256(new TextEncoder().encode(JSON.stringify([
    lock.randomSeed.toLowerCase(), lock.actionNum, lock.handIndex,
    lock.bettingToken.toLowerCase(), lock.playerAddress.toLowerCase(),
    lock.betAmountWei == null ? null : BigInt(lock.betAmountWei).toString(),
  ])));
}

export interface BlackjackInventory {
  v: 1;
  phase: 'scanning' | 'stable';
  signer: string;
  rolloutId: string;
  startedAt: number;
  completedAt?: number;
}

export function isStableBlackjackInventory(value: unknown, signer: string, rolloutId: string): value is BlackjackInventory {
  if (!value || typeof value !== 'object' || !rolloutId) return false;
  const inventory = value as Partial<BlackjackInventory>;
  return inventory.v === 1 && inventory.phase === 'stable'
    && typeof inventory.signer === 'string' && inventory.signer.toLowerCase() === signer.toLowerCase()
    && inventory.rolloutId === rolloutId && Number.isFinite(inventory.completedAt);
}

export class BlackjackLockServiceError extends Error {
  constructor(public readonly reason: 'unavailable' | 'inventory_required' | 'quarantined' | 'invalid') {
    super(reason === 'quarantined' ? 'This Blackjack nonce requires reconciliation.'
      : 'Blackjack randomness is temporarily unavailable while lock records are reconciled.');
    this.name = 'BlackjackLockServiceError';
  }
}
