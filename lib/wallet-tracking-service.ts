import { redis, withPrefix, redisGetJSON, redisSetJSON } from './redis';

/**
 * Wallet Connection Record
 */
export type WalletConnection = {
  address: string;
  firstSeen: number;
  lastSeen: number;
  connectionCount: number;
  walletType?: 'privy' | 'coinbase' | 'miniapp' | 'injected' | 'unknown';
  userAgent?: string;
};

const KEYS = {
  walletList: 'pixotchi:wallets:list',
  walletData: (address: string) => `pixotchi:wallet:${address.toLowerCase()}`,
  walletsByDate: 'pixotchi:wallets:by-date',
};

/**
 * Track a wallet connection
 */
export async function trackWalletConnection(
  address: string,
  metadata?: {
    walletType?: 'privy' | 'coinbase' | 'miniapp' | 'injected' | 'unknown';
    userAgent?: string;
  }
): Promise<{ success: boolean; isFirstConnection: boolean }> {
  try {
    if (!address || !address.startsWith('0x')) {
      return { success: false, isFirstConnection: false };
    }

    const normalizedAddress = address.toLowerCase();
    const now = Date.now();

    // Check if wallet exists
    const existing = await redisGetJSON<WalletConnection>(KEYS.walletData(normalizedAddress));
    const isFirstConnection = !existing;

    const walletData: WalletConnection = {
      address: normalizedAddress,
      firstSeen: existing?.firstSeen || now,
      lastSeen: now,
      connectionCount: (existing?.connectionCount || 0) + 1,
      walletType: metadata?.walletType || existing?.walletType || 'unknown',
      userAgent: metadata?.userAgent || existing?.userAgent,
    };

    // Store wallet data
    await redisSetJSON(KEYS.walletData(normalizedAddress), walletData);

    // Add to wallet list (set - no duplicates)
    await redis?.sadd?.(withPrefix(KEYS.walletList), normalizedAddress);

    // Add to sorted set by first seen date (for chronological listing)
    await redis?.zadd?.(
      withPrefix(KEYS.walletsByDate),
      walletData.firstSeen,
      normalizedAddress
    );

    return { success: true, isFirstConnection };
  } catch (error) {
    console.error('Track wallet connection error:', error);
    return { success: false, isFirstConnection: false };
  }
}

/**
 * Get all tracked wallets
 */
export async function getAllWallets(options?: {
  limit?: number;
  offset?: number;
  sortBy?: 'firstSeen' | 'lastSeen' | 'connectionCount';
  sortOrder?: 'asc' | 'desc';
}): Promise<WalletConnection[]> {
  try {
    const { 
      limit = 100, 
      offset = 0,
      sortBy = 'firstSeen',
      sortOrder = 'desc'
    } = options || {};

    // Get all wallet addresses from sorted set (by first seen date)
    const isAscending = sortOrder === 'asc';
    const addresses = await redis?.zrange?.(
      withPrefix(KEYS.walletsByDate),
      offset,
      offset + limit - 1,
      { rev: !isAscending }
    ) as string[] || [];

    if (addresses.length === 0) {
      return [];
    }

    // Fetch wallet data for all addresses
    const wallets = await Promise.all(
      addresses.map(addr => redisGetJSON<WalletConnection>(KEYS.walletData(addr)))
    );

    // Filter out nulls and sort if needed
    let validWallets = wallets.filter((w): w is WalletConnection => w !== null);

    // Apply additional sorting if not by firstSeen (which is already sorted by Redis)
    if (sortBy !== 'firstSeen') {
      validWallets.sort((a, b) => {
        let aVal: number, bVal: number;
        
        if (sortBy === 'lastSeen') {
          aVal = a.lastSeen;
          bVal = b.lastSeen;
        } else if (sortBy === 'connectionCount') {
          aVal = a.connectionCount;
          bVal = b.connectionCount;
        } else {
          return 0;
        }

        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      });
    }

    return validWallets;
  } catch (error) {
    console.error('Get all wallets error:', error);
    return [];
  }
}

/**
 * Get wallet statistics
 */
export async function getWalletStats(): Promise<{
  totalWallets: number;
  totalConnections: number;
  walletsToday: number;
  walletsThisWeek: number;
  byWalletType: Record<string, number>;
}> {
  try {
    // Get total count
    const totalWallets = await redis?.scard?.(withPrefix(KEYS.walletList)) || 0;

    // Get time ranges
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Count wallets in time ranges
    const walletsToday = await redis?.zcount?.(
      withPrefix(KEYS.walletsByDate),
      oneDayAgo,
      now
    ) || 0;

    const walletsThisWeek = await redis?.zcount?.(
      withPrefix(KEYS.walletsByDate),
      oneWeekAgo,
      now
    ) || 0;

    // Get all wallets to calculate total connections and type breakdown
    const allAddresses = await redis?.smembers?.(withPrefix(KEYS.walletList)) as string[] || [];
    
    let totalConnections = 0;
    const byWalletType: Record<string, number> = {
      privy: 0,
      coinbase: 0,
      miniapp: 0,
      injected: 0,
      unknown: 0,
    };

    // Batch fetch wallet data
    const walletDataPromises = allAddresses.slice(0, 1000).map(addr => 
      redisGetJSON<WalletConnection>(KEYS.walletData(addr))
    );
    const walletDataList = await Promise.all(walletDataPromises);

    walletDataList.forEach(wallet => {
      if (!wallet) return;
      totalConnections += wallet.connectionCount || 0;
      const type = wallet.walletType || 'unknown';
      byWalletType[type] = (byWalletType[type] || 0) + 1;
    });

    return {
      totalWallets,
      totalConnections,
      walletsToday,
      walletsThisWeek,
      byWalletType,
    };
  } catch (error) {
    console.error('Get wallet stats error:', error);
    return {
      totalWallets: 0,
      totalConnections: 0,
      walletsToday: 0,
      walletsThisWeek: 0,
      byWalletType: {},
    };
  }
}

/**
 * Get wallet details
 */
export async function getWalletDetails(address: string): Promise<WalletConnection | null> {
  try {
    if (!address || !address.startsWith('0x')) {
      return null;
    }

    const normalizedAddress = address.toLowerCase();
    return await redisGetJSON<WalletConnection>(KEYS.walletData(normalizedAddress));
  } catch (error) {
    console.error('Get wallet details error:', error);
    return null;
  }
}

/**
 * Search wallets by address prefix
 */
export async function searchWallets(searchTerm: string): Promise<WalletConnection[]> {
  try {
    if (!searchTerm || searchTerm.length < 3) {
      return [];
    }

    const normalizedSearch = searchTerm.toLowerCase();
    
    // Get all addresses
    const allAddresses = await redis?.smembers?.(withPrefix(KEYS.walletList)) as string[] || [];
    
    // Filter addresses that match search term
    const matchingAddresses = allAddresses.filter(addr => 
      addr.toLowerCase().includes(normalizedSearch)
    ).slice(0, 50); // Limit results

    // Fetch wallet data
    const wallets = await Promise.all(
      matchingAddresses.map(addr => redisGetJSON<WalletConnection>(KEYS.walletData(addr)))
    );

    return wallets.filter((w): w is WalletConnection => w !== null);
  } catch (error) {
    console.error('Search wallets error:', error);
    return [];
  }
}

