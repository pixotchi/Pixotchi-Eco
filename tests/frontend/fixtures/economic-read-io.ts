import { useSyncExternalStore } from 'react';

export const economyFixture = {
  address: `0x${'1'.repeat(40)}`,
  switchWallet() {
    this.address = `0x${'5'.repeat(40)}`;
    window.dispatchEvent(new Event('economic-wallet'));
  },
};

export const useAccount = () => ({
  address: useSyncExternalStore(
    callback => { window.addEventListener('economic-wallet', callback); return () => window.removeEventListener('economic-wallet', callback); },
    () => economyFixture.address,
  ),
});

export class BaseRpcError extends Error {}
export const getBaseReadClient = () => ({
  async readContract({ functionName, address }: { functionName: string; address: string }) {
    const owner = economyFixture.address;
    if (functionName === 'landOverviewByOwner') return [{ tokenId: BigInt(1112) }];
    if (functionName === 'marketPlaceIsActive') return true;
    if (functionName === 'marketPlaceGetActiveOrders' || functionName === 'marketPlaceGetUserOrders') {
      const order = (id: number, seller: string) => ({ id: BigInt(id), seller, sellToken: 1, amount: BigInt(10 ** 18), amountAsk: BigInt(10 ** 18), isActive: true });
      return functionName === 'marketPlaceGetUserOrders' ? [order(2, owner)] : [order(2, owner), order(1, `0x${'2'.repeat(40)}`)];
    }
    if (functionName === 'balanceOf' || functionName === 'allowance') {
      const response = await fetch(`/rpc-fixture?kind=${functionName}&token=${address}`);
      if (!response.ok) throw new Error('RPC unavailable');
      return BigInt((await response.json()).amount);
    }
    throw new Error(`Unexpected economic fixture read: ${functionName}`);
  },
});
