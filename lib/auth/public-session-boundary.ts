import { readWalletAddress, readWalletRecord } from './base-wallet-boundary';

export type PublicChatSession = {
  address: string;
  authenticated: true;
  method: 'privy-ethereum' | 'privy-solana' | 'farcaster-miniapp' | 'base-siwe';
  provider: 'privy' | 'farcaster' | 'base';
  sourceAddress?: string;
};

export function parsePublicChatSession(value: unknown): PublicChatSession | null {
  const record = readWalletRecord(value);
  const address = readWalletAddress(record?.address);
  if (!record || !address || record.authenticated !== true) return null;
  const { provider, method, sourceAddress } = record;
  if (!(provider === 'privy' && (method === 'privy-ethereum' || method === 'privy-solana'))
    && !(provider === 'base' && method === 'base-siwe')
    && !(provider === 'farcaster' && method === 'farcaster-miniapp')) return null;
  if (sourceAddress !== undefined && (typeof sourceAddress !== 'string' || !sourceAddress.trim())) return null;
  return { address, authenticated: true, provider, method, ...(typeof sourceAddress === 'string' ? { sourceAddress } : {}) };
}
