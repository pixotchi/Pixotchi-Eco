import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

let owner = `0x${'1'.repeat(40)}`;
export const useAccount = () => ({ address: useSyncExternalStore(callback => {
  window.addEventListener('swap-wallet', callback); return () => window.removeEventListener('swap-wallet', callback);
}, () => owner), chainId: 8453, connector: { id: 'fixture' } });
const wallet = { account: { address: owner }, sendTransaction: async () => { throw new Error('Fixture does not submit transactions'); } };
export const useWalletClient = () => ({ data: wallet });
export const useSwitchChain = () => ({ isPending: false, switchChainAsync: async () => undefined });
export const useBalance = ({ address, token }: { address?: string; token?: string }) => useQuery({
  queryKey: ['fixture-balance', address, token ?? 'ETH'], retry: false,
  queryFn: async () => { const response = await fetch(`/fixture-balance?owner=${address}&token=${token ?? 'ETH'}`);
    if (!response.ok) throw new Error('Balance RPC unavailable');
    return { value: BigInt((await response.json()).value), decimals: 18, symbol: token ? 'SEED' : 'ETH' };
  },
});
export const useSmartWallet = () => ({ isSmartWallet: false });
export const usePaymaster = () => ({ isSponsored: false });
export const useTabVisibility = () => ({ isTabVisible: () => true });
export class BaseRpcError extends Error {}
export const getBaseReadClient = () => ({});
export const waitForBaseReceipt = async () => { throw new Error('No receipt I/O in fixture'); };
export const estimateNextSwapFee = async () => ({ fee: BigInt(1000), stage: 'swap' });
export const requireSwapCallFunds = async () => undefined;
export function changeFixtureWallet() { owner = `0x${'2'.repeat(40)}`; window.dispatchEvent(new Event('swap-wallet')); }
