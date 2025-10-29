export interface EthFollowStats {
  followersCount: number;
  followingCount: number;
}

export interface EthFollowEnsData {
  name: string;
  address: string;
  avatar?: string;
  records?: Record<string, unknown>;
  updated_at?: string;
}

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

