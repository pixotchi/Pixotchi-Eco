import { useState, useEffect, useRef, useCallback } from 'react';
import { getLandSupply, getLandLeaderboard, LandLeaderboardEntry } from '@/lib/contracts';
import { Land } from '@/lib/types';
import { getCoordinateFromTokenId } from '@/lib/land-utils';

// Cache neighbor data to avoid refetching
let cachedLeaderboard: LandLeaderboardEntry[] = [];
let lastFetchTime = 0;
const CACHE_DURATION = 60000; // 1 minute

export function useLandMap(initialUserLands: Land[]) {
  const [totalSupply, setTotalSupply] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [neighborData, setNeighborData] = useState<Record<number, LandLeaderboardEntry>>({});
  
  // Fetch total supply and leaderboard data (which contains name/xp/id for all minted lands)
  // We use getLandLeaderboard because it efficiently returns basic metadata for range of IDs
  // This is a "hack" to get map data without a dedicated indexer API
  useEffect(() => {
    let mounted = true;
    
    const fetchData = async () => {
      try {
        // 1. Get Total Supply
        const { totalSupply: supply } = await getLandSupply();
        if (!mounted) return;
        setTotalSupply(supply);
        
        // 2. Get Neighbor Data (using leaderboard cache)
        const now = Date.now();
        if (cachedLeaderboard.length === 0 || now - lastFetchTime > CACHE_DURATION) {
            try {
                const entries = await getLandLeaderboard();
                cachedLeaderboard = entries;
                lastFetchTime = now;
            } catch (e) {
                console.warn("Failed to fetch map neighbor data", e);
            }
        }
        
        // Convert array to map for O(1) lookup
        const map: Record<number, LandLeaderboardEntry> = {};
        cachedLeaderboard.forEach(entry => {
            map[entry.landId] = entry;
        });
        
        if (mounted) {
            setNeighborData(map);
            setIsLoading(false);
        }

      } catch (err) {
        console.error("Failed to fetch land map data:", err);
        if (mounted) {
          // Fallback
          const maxUserTokenId = initialUserLands.reduce((max, land) => Math.max(max, Number(land.tokenId)), 0);
          setTotalSupply(Math.max(500, maxUserTokenId));
          setIsLoading(false);
        }
      }
    };

    fetchData();
    
    return () => {
      mounted = false;
    };
  }, [initialUserLands]);

  return {
    totalSupply,
    neighborData,
    isLoading
  };
}
