import { getAddress, isAddress } from 'viem';

export const CUSTODY_DATA_REFUSAL =
  'I cannot disclose team, custody, rewards, quest, casino, treasury, revenue-share, or internal wallet addresses, balances, transfers, funding levels, or token-flow destinations. I can still help with visible Pixotchi gameplay availability and the next safe in-app step.';

const DEFAULT_CUSTODY_WALLET_ADDRESSES = [
  '0xd528071FB9dC9715ea8da44e2c4433EAc017d1DB',
  '0x93023ED94724af40Da8dd7AD03304fB28F1765d6',
] as const;

function parseAddressList(value: string | undefined): `0x${string}`[] {
  if (!value) return [];

  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => isAddress(entry))
    .map((entry) => getAddress(entry));
}

export function getCustodyWalletAddressSet(): Set<string> {
  return new Set([
    ...DEFAULT_CUSTODY_WALLET_ADDRESSES.map((address) => getAddress(address).toLowerCase()),
    ...parseAddressList(process.env.AI_CUSTODY_WALLET_ADDRESSES).map((address) => address.toLowerCase()),
    ...parseAddressList(process.env.VERIFY_CLAIM_AGENT_ADDRESS).map((address) => address.toLowerCase()),
  ]);
}

export function isKnownCustodyWalletAddress(address: string | null | undefined): boolean {
  if (!address || !isAddress(address)) return false;
  return getCustodyWalletAddressSet().has(getAddress(address).toLowerCase());
}

export function createCustodyRedaction(scope: string) {
  return {
    redacted: true,
    reason: 'Custody and internal wallet addresses, balances, transfers, funding levels, and token-flow destinations are not exposed by Neural Seed.',
    scope,
  };
}

export function isCustodyWalletDataRequest(message: string): boolean {
  const normalized = message.toLowerCase().replace(/[_-]+/g, ' ');
  const mentionsCustodySubject = [
    /\b(team|internal|custody|treasury|project treasury|admin|ops|operations)\s+(wallet|wallets|address|addresses|fund|funds|balance|balances|transfer|transfers)\b/i,
    /\b(quest|quests|farmer house|farmer quest|rewards?|reward|casino|seed|revenue share|rev share|tax|burn|unburned|liquidity)\s+(wallet|wallets|address|addresses|fund|funds|balance|balances|transfer|transfers|pool|destination|destinations)\b/i,
    /\b(wallet|wallets|address|addresses|fund|funds|balance|balances|transfer|transfers|pool|destination|destinations)\s+(for|of|from|to|used by)\s+(quest|quests|farmer house|farmer quest|rewards?|reward|casino|team|internal|custody|treasury|revenue share|rev share|seed)\b/i,
    /\b(where|which|what)\b.{0,80}\b(unburned|remaining|non burned|not burned|taxed|recycled)\b.{0,80}\b(seed|seeds|tokens?)\b.{0,80}\b(go|goes|get|gets|receive|receives|sent|transferred|allocated|recycled|end up|destination)\b/i,
    /\b(which|what)\s+wallet\b.{0,80}\b(get|gets|receive|receives|sent|transferred|allocated|recycled)\b.{0,80}\b(unburned|remaining|non burned|not burned|taxed|recycled)\b.{0,80}\b(seed|seeds|tokens?)\b/i,
  ].some((pattern) => pattern.test(message));

  const asksForSensitiveData = [
    /\b(how much|amount|balance|balances|available|left|funds?|funding|funded|refill|refilled|added|removed|transferred|sent|received|outflow|inflow|history|transactions?|txs?|address|addresses|wallet|wallets|destination|where.*go)\b/i,
  ].some((pattern) => pattern.test(normalized));

  return mentionsCustodySubject && asksForSensitiveData;
}
