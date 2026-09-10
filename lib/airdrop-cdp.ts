import 'server-only';
import { CdpClient } from '@coinbase/cdp-sdk';
import { generateJwt } from '@coinbase/cdp-sdk/auth';
import type { Hex } from 'viem';
import { getBaseReadClient, getBaseTransactionReceipt } from './base-rpc';
import type { AirdropAdapter, AirdropCall, AirdropOperation } from './airdrop-execution';

/** Resolve exactly the CDP sponsorship used by SDK sendUserOperation, now explicitly for prepare. */
export async function resolveAirdropPaymaster(): Promise<string> {
  if (process.env.AIRDROP_PAYMASTER_URL) return process.env.AIRDROP_PAYMASTER_URL;
  const apiKeyId = process.env.CDP_API_KEY_ID ?? process.env.CDP_API_KEY_NAME;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;
  if (!apiKeyId || !apiKeySecret) throw new Error('Airdrop sponsorship unavailable');
  const jwt = await generateJwt({ apiKeyId, apiKeySecret, requestMethod: 'GET', requestHost: 'api.cdp.coinbase.com', requestPath: '/apikeys/v1/tokens/active' });
  const response = await fetch('https://api.cdp.coinbase.com/apikeys/v1/tokens/active', {
    headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error('Airdrop sponsorship unavailable');
  const value: unknown = await response.json();
  const id = value && typeof value === 'object' && 'id' in value ? value.id : null;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Airdrop sponsorship unavailable');
  return `https://api.cdp.coinbase.com/rpc/v1/base/${id}`;
}

function operation(value: unknown): AirdropOperation {
  if (!value || typeof value !== 'object') throw new Error('Invalid operation response');
  const data = value as Record<string, unknown>;
  if (typeof data.userOpHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(data.userOpHash)
    || typeof data.network !== 'string' || typeof data.status !== 'string' || !Array.isArray(data.calls)) throw new Error('Invalid operation response');
  const calls = data.calls.map((call: unknown): AirdropCall => {
    if (!call || typeof call !== 'object') throw new Error('Invalid operation calls');
    const c = call as Record<string, unknown>;
    if (typeof c.to !== 'string' || !/^0x[0-9a-f]{40}$/i.test(c.to) || typeof c.data !== 'string' || !/^0x[0-9a-f]*$/i.test(c.data)
      || !['string', 'bigint'].includes(typeof c.value)) throw new Error('Invalid operation calls');
    return { to: c.to as Hex, data: c.data as Hex, value: BigInt(c.value as string | bigint).toString() };
  });
  return { userOpHash: data.userOpHash as Hex, network: data.network, status: data.status, calls,
    transactionHash: typeof data.transactionHash === 'string' ? data.transactionHash as Hex : undefined,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined };
}

/** Public fetch is inherited by CdpClient; it preserves configured JWT + wallet auth. */
export async function broadcastPreparedAirdrop(client: Pick<CdpClient, 'fetch'>, address: string, hash: Hex, signature: Hex, key: string): Promise<AirdropOperation> {
  const response = await client.fetch(`/v2/evm/smart-accounts/${address}/user-operations/${hash}/send`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key }, body: JSON.stringify({ signature }),
  }, { timeoutInSeconds: 20, maxRetries: 0 });
  // Never propagate the response body or SDK error object into logs or public responses.
  if (!response.ok) throw new Error('Airdrop broadcast response unavailable');
  return operation(await response.json());
}

let adapter: AirdropAdapter | undefined;
export function getAirdropAdapter(): AirdropAdapter {
  if (adapter) return adapter;
  const client = new CdpClient();
  let accountPromise: Promise<{ owner: Awaited<ReturnType<typeof client.evm.getAccount>>; smartAccount: Awaited<ReturnType<typeof client.evm.getSmartAccount>> }> | undefined;
  const account = () => accountPromise ??= (async () => {
    // Identity lookup is read-only even when invoked by public GET reconciliation.
    const owner = await client.evm.getAccount({ name: 'pixotchi-agent' });
    const smartAccount = await client.evm.getSmartAccount({ name: 'pixotchi-agent-sa-sp', owner });
    return { owner, smartAccount };
  })().catch(() => { accountPromise = undefined; throw new Error('Airdrop account unavailable'); });
  adapter = {
    address: async () => (await account()).smartAccount.address,
    prepare: async calls => {
      const { smartAccount } = await account();
      const paymasterUrl = await resolveAirdropPaymaster();
      const startedAt = Date.now();
      const prepared = operation(await client.evm.prepareUserOperation({ smartAccount, network: 'base', paymasterUrl,
        calls: calls.map(call => ({ ...call, value: BigInt(call.value) })) }));
      // Older CDP responses omit expiresAt. A two-minute local send deadline is
      // conservative; its expiry NEVER proves a possibly broadcast payout failed.
      const providerExpiry = prepared.expiresAt ? Date.parse(prepared.expiresAt) : Infinity;
      return { ...prepared, expiresAt: new Date(Math.min(startedAt + 120_000, providerExpiry)).toISOString() };
    },
    sign: async hash => (await account()).owner.sign({ hash }),
    broadcast: async (hash, signature, key) => broadcastPreparedAirdrop(client, (await account()).smartAccount.address, hash, signature, key),
    observe: async (address, hash) => operation(await client.evm.getUserOperation({ smartAccount: address as Hex, userOpHash: hash })),
    receipt: async hash => {
      const receipt = await getBaseTransactionReceipt(hash);
      const [block, safeBlock] = await Promise.all([
        getBaseReadClient().getBlock({ blockNumber: receipt.blockNumber }),
        getBaseReadClient().getBlock({ blockTag: 'safe' }),
      ]);
      if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || block.hash !== receipt.blockHash
        || safeBlock.number === null || receipt.blockNumber > safeBlock.number) throw new Error('Canonical safe receipt unavailable');
      return receipt;
    },
  };
  return adapter;
}
