import { BaseError, ContractFunctionRevertedError, isAddress, type Abi } from 'viem';
import { classifyBaseRpcError } from './base-rpc-errors';
import type { PixotchiReadClient } from './contracts';
import stakeAbi from '@/public/abi/stakeabi.json';

const MAX_STAKERS = 100_000;
const BATCH_SIZE = 100;
const MIN_STAKE = BigInt(5) * BigInt(10) ** BigInt(17);

function isArrayBoundsError(error: unknown): boolean {
  const decoded = error instanceof BaseError
    ? error.walk(cause => cause instanceof ContractFunctionRevertedError) : undefined;
  if (decoded instanceof ContractFunctionRevertedError && decoded.data?.errorName === 'Panic') {
    return decoded.data.args?.[0] === BigInt(0x32);
  }
  // This deployment's generated public-array getter returns an empty EVM
  // revert for out-of-range indexes (verified on Base). Accept that precise
  // contract error only here; transport errors and unknown custom errors fail.
  if (decoded instanceof ContractFunctionRevertedError && decoded.data == null
    && decoded.signature == null && (decoded.raw == null || decoded.raw === '0x')
    && decoded.details === 'execution reverted') return true;
  // Some RPC wrappers retain bytes rather than Viem's decoded error.
  return classifyBaseRpcError(error).revertData?.toLowerCase()
    === `0x4e487b71${BigInt(0x32).toString(16).padStart(64, '0')}`;
}

/** A complete snapshot at one block. Provider errors never mean "no staker". */
export async function readStakeLeaderboard(
  client: PixotchiReadClient,
  contractAddress: `0x${string}`,
): Promise<Array<{ address: string; staked: bigint }>> {
  const blockNumber = await client.getBlockNumber();
  const exists = async (index: number) => {
    try {
      const value = await client.readContract({ address: contractAddress, abi: stakeAbi as Abi,
        functionName: 'stakersArray', args: [BigInt(index)], blockNumber });
      if (typeof value !== 'string' || !isAddress(value)) throw new Error('Invalid staker address');
      return true; // Zero-address slots do not prove the end of an array.
    } catch (error) {
      if (isArrayBoundsError(error)) return false;
      throw error;
    }
  };
  if (!await exists(0)) return [];
  let low = 1;
  let high = 1;
  while (await exists(high)) {
    if (high === MAX_STAKERS) throw new Error('Staker enumeration exceeds the supported snapshot size');
    low = high + 1;
    high = Math.min(high * 2, MAX_STAKERS);
  }
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (await exists(mid)) low = mid + 1;
    else high = mid;
  }
  const stakers: Array<{ address: string; staked: bigint }> = [];
  for (let offset = 0; offset < low; offset += BATCH_SIZE) {
    const addresses = await client.multicall({ allowFailure: false, blockNumber,
      contracts: Array.from({ length: Math.min(BATCH_SIZE, low - offset) }, (_, i) => ({
        address: contractAddress, abi: stakeAbi as Abi, functionName: 'stakersArray', args: [BigInt(offset + i)],
      })),
    });
    if (addresses.length !== Math.min(BATCH_SIZE, low - offset)
      || addresses.some(address => typeof address !== 'string' || !isAddress(address))) {
      throw new Error('Incomplete staker addresses');
    }
    const stakes = await client.multicall({ allowFailure: false, blockNumber,
      contracts: addresses.map(address => ({ address: contractAddress, abi: stakeAbi as Abi,
        functionName: 'stakers', args: [address] })),
    });
    if (stakes.length !== addresses.length) throw new Error('Incomplete stake balances');
    for (let i = 0; i < stakes.length; i++) {
      const info = stakes[i];
      const amount = Array.isArray(info) ? info[2] : undefined;
      if (typeof amount !== 'bigint' || amount < BigInt(0)) throw new Error('Invalid stake balance');
      if (amount >= MIN_STAKE) stakers.push({ address: String(addresses[i]).toLowerCase(), staked: amount });
    }
  }
  return stakers;
}
