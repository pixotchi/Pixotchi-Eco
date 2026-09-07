import 'server-only';
import { parseAbi } from 'viem';
import { getReadClient, PIXOTCHI_NFT_ABI, PIXOTCHI_NFT_ADDRESS } from './contracts';
import { redis } from './redis';
import { parsePlayerRanking, readPlayerRanking, serializePlayerRanking, type PlayerRankingSnapshot } from './player-ranking';

const CACHE_KEY = `ranking:players:v1:${PIXOTCHI_NFT_ADDRESS.toLowerCase()}`;
const CACHE_SECONDS = 60;
let cached: { snapshot: PlayerRankingSnapshot; expiresAt: number } | null = null;
let pending: Promise<PlayerRankingSnapshot> | null = null;

/** Shared server cache and in-flight deduplication; never scan all plants per browser. */
export async function getPlayerRanking(): Promise<PlayerRankingSnapshot> {
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  if (pending) return pending;
  pending = (async () => {
    if (redis) {
      try {
        const value = await redis.get(CACHE_KEY);
        if (value) {
          const snapshot = parsePlayerRanking(typeof value === 'string' ? JSON.parse(value) : value);
          const expiresAt = snapshot.updatedAt + CACHE_SECONDS * 1000;
          if (expiresAt > Date.now()) {
            cached = { snapshot, expiresAt };
            return snapshot;
          }
        }
      } catch { /* Cache misses or invalid entries fall back to a complete chain read. */ }
    }
    const client = getReadClient();
    const snapshot = await readPlayerRanking({
      getBlock: () => client.getBlock(),
      getPlantIds: blockNumber => client.readContract({ address: PIXOTCHI_NFT_ADDRESS, abi: PIXOTCHI_NFT_ABI, functionName: 'airdropGetAliveAndDeadTokenIds', blockNumber }),
      getPlantCount: blockNumber => client.readContract({ address: PIXOTCHI_NFT_ADDRESS, abi: parseAbi(['function totalSupply() view returns (uint256)']), functionName: 'totalSupply', blockNumber }),
      getPlants: (ids, blockNumber) => client.readContract({ address: PIXOTCHI_NFT_ADDRESS, abi: PIXOTCHI_NFT_ABI, functionName: 'getPlantsInfoExtended', args: [ids], blockNumber }),
      getPlantOwner: (id, blockNumber) => client.readContract({ address: PIXOTCHI_NFT_ADDRESS, abi: parseAbi(['function ownerOf(uint256) view returns (address)']), functionName: 'ownerOf', args: [id], blockNumber }),
    });
    cached = { snapshot, expiresAt: Date.now() + CACHE_SECONDS * 1000 };
    if (redis) {
      try { await redis.set(CACHE_KEY, JSON.stringify(serializePlayerRanking(snapshot)), { ex: CACHE_SECONDS }); }
      catch { /* A cache-write failure does not invalidate the verified snapshot. */ }
    }
    return snapshot;
  })();
  try { return await pending; }
  finally { pending = null; }
}
