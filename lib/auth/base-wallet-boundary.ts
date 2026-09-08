import { isAddress } from 'viem';

export type BaseAuthPayload = { address: string; message: string; signature: `0x${string}` };
export type WalletRpcProvider = { request: (input: { method: string; params?: readonly unknown[] }) => Promise<unknown> };

export function readWalletRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readWalletAddress(value: unknown): string | null {
  return typeof value === 'string' && isAddress(value, { strict: false }) ? value.toLowerCase() : null;
}

export function getPrimaryAccountAddress(accounts: unknown): string | null {
  if (!Array.isArray(accounts)) return null;
  return readWalletAddress(typeof accounts[0] === 'string' ? accounts[0] : readWalletRecord(accounts[0])?.address);
}

export function readWalletSignature(value: unknown): `0x${string}` | null {
  // EIP-1271 signatures may be arbitrary-length byte strings, so do not impose
  // an EOA-only 65-byte length. Require nonempty, whole hexadecimal bytes.
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value) ? value as `0x${string}` : null;
}

export function readWalletProvider(value: unknown): WalletRpcProvider | null {
  const candidate = readWalletRecord(value);
  if (typeof candidate?.request !== 'function') return null;
  const request = candidate.request;
  return { request: async input => request.call(value, input) as unknown };
}

export function extractBasePayload(result: unknown, fallbackAddress?: string | null): BaseAuthPayload | null {
  const accounts = readWalletRecord(result)?.accounts;
  const primary = Array.isArray(accounts) ? accounts[0] as unknown : null;
  const account = readWalletRecord(primary);
  const address = readWalletAddress(typeof primary === 'string' ? primary : account?.address) ?? readWalletAddress(fallbackAddress);
  const capability = readWalletRecord(readWalletRecord(account?.capabilities)?.signInWithEthereum);
  if (capability && typeof capability.message === 'string' && typeof capability.signature !== 'string') {
    throw new Error(capability.message);
  }
  if (!address || typeof capability?.message !== 'string' || !capability.message.trim()) return null;
  const signature = readWalletSignature(capability.signature);
  if (!signature) throw new Error('The wallet returned an invalid sign-in signature. Please try again.');
  return { address, message: capability.message, signature };
}

export function summarizeBaseAccounts(accounts: unknown) {
  if (!Array.isArray(accounts)) return { isArray: false, type: typeof accounts };
  return accounts.map((value: unknown) => {
    if (typeof value === 'string') return { kind: 'string', value };
    const account = readWalletRecord(value);
    if (!account) return { kind: typeof value };
    const capabilities = readWalletRecord(account.capabilities);
    const siwe = readWalletRecord(capabilities?.signInWithEthereum);
    return { kind: 'object', address: readWalletAddress(account.address), capabilityKeys: Object.keys(capabilities ?? {}),
      hasSiweCapability: Boolean(siwe), messageType: typeof siwe?.message, signatureType: typeof siwe?.signature };
  });
}
