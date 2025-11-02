export interface EthFollowStats {
  followersCount: number;
  followingCount: number;
}

export interface EthFollowEnsData {
  name: string;
  address: string;
}

// EFP Contract on Base L2
export const EFP_CONTRACT_ADDRESS = '0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c';

// EFP List operations ABI for follow/unfollow
export const EFP_LIST_ABI = [
  {
    inputs: [
      { name: 'listOp', type: 'uint256' },
      { name: 'data', type: 'bytes' }
    ],
    name: 'applyListOp',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export async function fetchEfpStats(addressOrENS: string): Promise<EthFollowStats | null> {
  try {
    const resp = await fetch(`https://api.ethfollow.xyz/api/v1/users/${encodeURIComponent(addressOrENS)}/stats`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return {
      followersCount: parseInt(data.followers_count || '0', 10),
      followingCount: parseInt(data.following_count || '0', 10),
    };
  } catch (error) {
    console.error('EFP stats fetch error:', error);
    return null;
  }
}

export async function fetchEfpEnsData(addressOrENS: string): Promise<EthFollowEnsData | null> {
  try {
    const resp = await fetch(`https://api.ethfollow.xyz/api/v1/users/${encodeURIComponent(addressOrENS)}/ens`);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.ens || null;
  } catch (error) {
    console.error('ENS data fetch error:', error);
    return null;
  }
}

// Construct EFP follow transaction (adds to following list)
export function createEfpFollowCall(targetAddress: `0x${string}`) {
  return {
    address: EFP_CONTRACT_ADDRESS,
    abi: EFP_LIST_ABI,
    functionName: 'applyListOp',
    args: [
      BigInt(1), // ListOp type for follow
      targetAddress, // address to follow
    ],
  };
}

