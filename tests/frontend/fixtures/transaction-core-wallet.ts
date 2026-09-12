import { base } from 'viem/chains';

type CapabilityMode = 'supported' | 'unsupported' | 'missing' | 'failure' | 'deferred';
export const fixtureWallet = {
  accountAddress: `0x${'1'.repeat(40)}`,
  capability: 'supported' as CapabilityMode,
  walletCalls: 0,
  notify: () => {},
  capabilityCalls: 0,
  rejectWallet: true,
  walletError: null as string | null,
  nftApprovals: false,
  ambiguousWallet: false,
  deferWallet: false,
  direct: false,
  replacement: 'none' as 'none' | 'repriced' | 'replaced' | 'cancelled',
  deferReceipt: false,
  resolveReceipt: null as null | (() => void),
  telemetry: [] as Array<{ name: string; properties: Record<string, unknown> }>,
  resolveWallet: null as null | (() => void),
  resolveCapabilities: null as null | (() => void),
};
const transactionHash = `0x${'a'.repeat(64)}` as const;
const replacementHash = `0x${'c'.repeat(64)}` as const;
export const receipt = { transactionHash, status: 'success', blockNumber: BigInt(123), logs: [] };
const client = {
  account: { address: `0x${'1'.repeat(40)}` },
  chain: base,
  async getCapabilities() {
    fixtureWallet.capabilityCalls++;
    if (fixtureWallet.capability === 'failure') throw new Error('Capability transport unavailable');
    if (fixtureWallet.capability === 'missing') return {};
    if (fixtureWallet.capability === 'deferred') await new Promise<void>(resolve => { fixtureWallet.resolveCapabilities = resolve; });
    return { '0x2105': { atomic: { status: fixtureWallet.capability === 'unsupported' ? 'unsupported' : 'supported' } } };
  },
  async sendCalls() {
    fixtureWallet.walletCalls++;
    const shouldReject = fixtureWallet.rejectWallet;
    fixtureWallet.notify();
    if (fixtureWallet.deferWallet) {
      fixtureWallet.deferWallet = false;
      await new Promise<void>(resolve => { fixtureWallet.resolveWallet = resolve; });
    }
    if (fixtureWallet.ambiguousWallet) throw new Error('Wallet response lost after broadcast; network timeout');
    if (fixtureWallet.walletError) throw new Error(fixtureWallet.walletError);
    if (shouldReject) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
    return { id: `0x${'b'.repeat(64)}` };
  },
  async sendTransaction() {
    fixtureWallet.walletCalls++;
    fixtureWallet.notify();
    if (fixtureWallet.rejectWallet) throw Object.assign(new Error('User rejected the request'), { code: 4001 });
    return transactionHash;
  },
  async waitForCallsStatus() {
    return { status: 'success', statusCode: 200, atomic: true, receipts: [receipt] };
  },
};
const clients = new Map<string, typeof client>();
const getClient = () => {
  if (!clients.has(fixtureWallet.accountAddress)) clients.set(fixtureWallet.accountAddress, { ...client, account: { address: fixtureWallet.accountAddress } });
  return clients.get(fixtureWallet.accountAddress)!;
};
export const useAccount = () => ({ address: fixtureWallet.accountAddress, connector: { id: 'transaction-core-fixture' } });
export const useChainId = () => base.id;
export const useWalletClient = () => ({ data: getClient() });
export const useShowCallsStatus = () => ({ showCallsStatus() {} });
export const useSmartWallet = () => ({ isLoading: false, isSmartWallet: !fixtureWallet.direct, walletType: fixtureWallet.direct ? 'eoa' : 'other-smart', refetch: async () => {} });
export const waitForBaseReceipt = async (hash: `0x${string}` = transactionHash, options?: { onReplaced?: (value: unknown) => void }) => {
  let resolvedHash = hash;
  if (hash === transactionHash && fixtureWallet.replacement !== 'none') {
    resolvedHash = replacementHash;
    options?.onReplaced?.({
      reason: fixtureWallet.replacement,
      transaction: { hash: replacementHash },
    });
  }
  if (fixtureWallet.deferReceipt) {
    fixtureWallet.deferReceipt = false;
    await new Promise<void>(resolve => { fixtureWallet.resolveReceipt = resolve; });
  }
  return { ...receipt, transactionHash: resolvedHash };
};
export const getBaseReceiptClient = () => ({
  getTransaction: async ({ hash }: { hash: `0x${string}` }) => ({
    hash, from: fixtureWallet.accountAddress, to: `0x${'2'.repeat(40)}`,
    input: fixtureWallet.replacement === 'replaced' ? '0x03' : '0x01', value: BigInt(0), chainId: base.id,
  }),
});
export class BaseRpcError extends Error {}
export const getBaseReadClient = () => ({
  getBytecode: async () => '0x',
  readContract: async ({ functionName }: { functionName: string }) => {
    if (functionName === 'getPlantsByOwnerExtended') return [];
    if (functionName === 'landGetByOwner') return [{ tokenId: BigInt(1112), name: 'Fixture land' }];
    if (functionName === 'isApprovedForAll') return fixtureWallet.nftApprovals;
    throw new Error(`Unexpected fixture read: ${functionName}`);
  },
});
export const reconcileOwnerResources = async () => true;
export const onOwnerResourceInvalidation = () => () => {};
export const ownerInvalidationMatches = () => false;
export const invalidateOwnerResources = () => null;
export const track = (name: string, properties: Record<string, unknown> = {}) => {
  fixtureWallet.telemetry.push({ name, properties });
  fixtureWallet.notify();
};
export const handleExternalAnchorClick = () => {};
export const openExternalUrl = async () => {};
