import type { MemoryWalletProfile, MemoryIdentityHandle } from '@/lib/memory-service';
import type { EthFollowStats } from '@/lib/efp-service';

export interface IdentitySummary {
  total: number;
  platforms: Array<{ platform: string; count: number }>;
  handles: MemoryIdentityHandle[];
}

export interface SocialProfilePayload {
  address: string;
  identifier: string;
  memoryProfile: MemoryWalletProfile | null;
  efpStats: EthFollowStats | null;
  fetchedAt: number;
  identitySummary?: IdentitySummary;
}

