export type AirdropAdminEntry = { address: string; seed: string; leaf: string; pixotchi: string };
export interface AirdropAdminStore {
  keys(): Promise<string[]>;
  read(key: string): Promise<string | null>;
  /** Returns 1 for applied, 0 for concurrent change, -1 for protected. */
  mutate(key: string, expected: string | null, next: string | null): Promise<number>;
}

/** Replacement preserves all claim history, including recipients omitted from CSV. */
export async function replaceUnattemptedAirdrops(store: AirdropAdminStore, entries: AirdropAdminEntry[], now = Date.now()) {
  const desired = new Map(entries.map(entry => [`airdrop:eligible:${entry.address.toLowerCase()}`, entry]));
  const keys = [...new Set([...await store.keys(), ...desired.keys()])];
  const counts = { updatedCount: 0, createdCount: 0, deletedCount: 0, protectedCount: 0, conflictCount: 0 };
  // Bounded batches; each record is independently atomic with the claim worker.
  for (let start = 0; start < keys.length; start += 20) {
    await Promise.all(keys.slice(start, start + 20).map(async key => {
      const raw = await store.read(key);
      const entry = desired.get(key);
      if (raw === null && !entry) return;
      const next = entry ? JSON.stringify({ seed: entry.seed, leaf: entry.leaf, pixotchi: entry.pixotchi, claimed: false, status: 'eligible', createdAt: now }) : null;
      const result = await store.mutate(key, raw, next);
      if (result === -1) counts.protectedCount++;
      else if (result !== 1) counts.conflictCount++;
      else if (!entry) counts.deletedCount++;
      else if (raw === null) counts.createdCount++;
      else counts.updatedCount++;
    }));
  }
  return counts;
}
