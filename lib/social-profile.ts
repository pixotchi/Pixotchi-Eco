import type { MemoryWalletProfile, MemoryIdentityHandle } from '@/lib/memory-service';
import type { EthFollowStats } from '@/lib/efp-service';

export interface IdentitySummary {
  total: number;
  platforms: Array<{ platform: string; count: number }>;
  handles: MemoryIdentityHandle[];
}

export interface TwitterPostMedia {
  type?: string | null;
  url?: string | null;
}

export interface TwitterPostMetrics {
  likes?: number;
  reposts?: number;
  quotes?: number;
  replies?: number;
  bookmarks?: number;
}

export interface TwitterPost {
  id: string;
  text: string;
  createdAt?: string | null;
  url?: string | null;
  metrics?: TwitterPostMetrics;
  media?: TwitterPostMedia[];
}

export interface SocialProfileTwitterProfile {
  id?: string;
  username?: string;
  displayName?: string;
  avatarUrl?: string;
  followersCount?: number;
  followingCount?: number;
}

export interface SocialProfileTwitterData {
  username: string;
  status: string;
  fetchedAt: number | null;
  posts: TwitterPost[];
  profile?: SocialProfileTwitterProfile | null;
}

export interface SocialProfilePayload {
  address: string;
  identifier: string;
  memoryProfile: MemoryWalletProfile | null;
  efpStats: EthFollowStats | null;
  fetchedAt: number;
  identitySummary?: IdentitySummary;
  twitter?: SocialProfileTwitterData;
}

