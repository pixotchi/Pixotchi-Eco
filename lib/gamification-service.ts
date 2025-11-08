import { redis, redisGetJSON, redisSetJSON, redisKeys, redisScanKeys, redisDel, withPrefix, redisCompareAndSetJSON } from '@/lib/redis';
import { getTodayDateString } from '@/lib/invite-utils';
import type { GmDay, GmLeaderEntry, GmMissionDay, GmProgressProof, GmSectionKey, GmStreak, GmTaskId } from './gamification-types';

const PX = 'pixotchi:gm:';

const keys = {
  streak: (address: string) => `${PX}streak:${address.toLowerCase()}`,
  streakLeaderboard: (yyyymm: string) => `${PX}streak:leaderboard:${yyyymm}`,
  missions: (address: string, day: GmDay) => `${PX}missions:${address.toLowerCase()}:${day}`,
  missionsLeaderboard: (yyyymm: string) => `${PX}missions:leaderboard:${yyyymm}`,
  proof: (address: string, day: GmDay, taskId: string) => `${PX}missions:proof:${address.toLowerCase()}:${day}:${taskId}`,
  todayActiveSet: (day: GmDay) => `${PX}streak:activity:${day}`,
  idemp: (address: string, rewardId: string) => `${PX}idemp:${address.toLowerCase()}:${rewardId}`,
  adminLastReset: `${PX}admin:lastResetAt`,
};

function toMonth(day: GmDay): string {
  return day.replace(/\-/g, '').slice(0, 6); // YYYYMM
}

function createInitialMissionDay(day: GmDay): GmMissionDay {
  return {
    date: day,
    s1: { buy5: false, buyElementsCount: 0, buyShield: false, claimProduction: false, done: false },
    s2: { applyResources: false, attackPlant: false, chatMessage: false, done: false },
    s3: { sendQuest: false, placeOrder: false, claimStake: false, done: false },
    s4: { makeSwap: false, collectStar: false, playArcade: false, done: false },
    pts: 0,
  };
}

function hydrateMissionDay(data: any, day: GmDay): GmMissionDay {
  if (!data) return createInitialMissionDay(day);
  const normalizeNumber = (value: unknown, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const normalizeBoolean = (value: unknown) => Boolean(value);

  return {
    date: typeof data?.date === 'string' ? data.date : day,
    s1: {
      buy5: normalizeBoolean(data?.s1?.buy5),
      buyElementsCount: Math.max(0, Math.floor(normalizeNumber(data?.s1?.buyElementsCount))),
      buyShield: normalizeBoolean(data?.s1?.buyShield),
      claimProduction: normalizeBoolean(data?.s1?.claimProduction),
      done: normalizeBoolean(data?.s1?.done),
    },
    s2: {
      applyResources: normalizeBoolean(data?.s2?.applyResources),
      attackPlant: normalizeBoolean(data?.s2?.attackPlant),
      chatMessage: normalizeBoolean(data?.s2?.chatMessage),
      done: normalizeBoolean(data?.s2?.done),
    },
    s3: {
      sendQuest: normalizeBoolean(data?.s3?.sendQuest),
      placeOrder: normalizeBoolean(data?.s3?.placeOrder),
      claimStake: normalizeBoolean(data?.s3?.claimStake),
      done: normalizeBoolean(data?.s3?.done),
    },
    s4: {
      makeSwap: normalizeBoolean(data?.s4?.makeSwap),
      collectStar: normalizeBoolean(data?.s4?.collectStar),
      playArcade: normalizeBoolean(data?.s4?.playArcade),
      done: normalizeBoolean(data?.s4?.done),
    },
    pts: Math.min(80, Math.max(0, normalizeNumber(data?.pts))),
    completedAt: typeof data?.completedAt === 'number' ? data.completedAt : undefined,
  };
}

function applyMissionTaskProgress(m: GmMissionDay, taskId: GmTaskId, count: number): void {
  switch (taskId) {
    case 's1_buy5_elements': {
      const prev = m.s1.buyElementsCount || 0;
      const increment = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
      const next = prev + increment;
      m.s1.buyElementsCount = next;
      if (next >= 5) m.s1.buy5 = true;
      break;
    }
    case 's1_buy_shield':
      m.s1.buyShield = true; break;
    case 's1_claim_production':
      m.s1.claimProduction = true; break;
    case 's2_apply_resources':
      m.s2.applyResources = true; break;
    case 's2_attack_plant':
      m.s2.attackPlant = true; break;
    case 's2_chat_message':
      m.s2.chatMessage = true; break;
    case 's3_send_quest':
      m.s3.sendQuest = true; break;
    case 's3_place_order':
      m.s3.placeOrder = true; break;
    case 's3_claim_stake':
      m.s3.claimStake = true; break;
    case 's4_make_swap':
      m.s4.makeSwap = true; break;
    case 's4_collect_star':
      m.s4.collectStar = true; break;
    case 's4_play_arcade':
      m.s4.playArcade = true; break;
  }
}

export async function getStreak(address: string): Promise<GmStreak> {
  const data = await redisGetJSON<GmStreak>(keys.streak(address));
  if (data) return data;
  return { current: 0, best: 0, lastActive: '' };
}

/**
 * Normalize a streak on read: if the user has missed at least one full UTC day
 * since lastActive, their current streak should be 0 while preserving best.
 * This persists the normalized value so subsequent reads are consistent.
 */
export async function normalizeStreakIfMissed(address: string, s: GmStreak): Promise<GmStreak> {
  try {
    const day = getTodayDateString();
    if (!s?.lastActive || s.lastActive === day) return s;

    const yesterday = new Date(day);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const ystr = yesterday.toISOString().slice(0, 10);

    const missed = s.lastActive !== ystr; // not yesterday → at least one day gap
    if (!missed) return s;

    const updated: GmStreak = { current: 0, best: s.best || 0, lastActive: s.lastActive };
    await redisSetJSON(keys.streak(address), updated);
    return updated;
  } catch (error) {
    console.warn('Failed to normalize streak:', error);
    return s; // Return original on error
  }
}

export async function trackDailyActivity(address: string): Promise<GmStreak> {
  const day = getTodayDateString();
  const k = keys.streak(address);
  const s = (await redisGetJSON<GmStreak>(k)) || { current: 0, best: 0, lastActive: '' };
  if (s.lastActive === day) return s; // already counted today

  // Determine if consecutive (yesterday)
  const yesterday = new Date(day);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const ystr = yesterday.toISOString().slice(0, 10);

  const consecutive = s.lastActive === ystr;
  const current = consecutive ? (s.current || 0) + 1 : 1;
  const best = Math.max(s.best || 0, current);
  const updated: GmStreak = { current, best, lastActive: day };
  await redisSetJSON(k, updated);
  // Add to activity set for analytics (best-effort, non-blocking)
  Promise.resolve().then(async () => {
    try {
      await (redis as any)?.sadd?.(withPrefix(keys.todayActiveSet(day)), address.toLowerCase());
    } catch (error) {
      console.warn('Failed to update activity set:', error);
    }
  });
  // Update monthly leaderboard (best-effort, non-blocking)
  Promise.resolve().then(async () => {
    try {
      await (redis as any)?.zadd?.(withPrefix(keys.streakLeaderboard(toMonth(day))), { score: current, member: address.toLowerCase() });
    } catch (error) {
      console.warn('Failed to update streak leaderboard:', error);
    }
  });
  return updated;
}

export async function getMissionDay(address: string, day?: GmDay): Promise<GmMissionDay> {
  const d = day || getTodayDateString();
  const k = keys.missions(address, d);
  const data = await redisGetJSON<GmMissionDay>(k);
  if (data) return hydrateMissionDay(data, d);
  const init = createInitialMissionDay(d);
  await redisSetJSON(k, init);
  return init;
}

function sectionCompleteS1(s1: GmMissionDay['s1']): boolean {
  return s1.buy5 && s1.buyShield && s1.claimProduction;
}
function sectionCompleteS2(s2: GmMissionDay['s2']): boolean {
  return s2.applyResources && s2.attackPlant && s2.chatMessage;
}
function sectionCompleteS3(s3: GmMissionDay['s3']): boolean {
  return s3.sendQuest && s3.placeOrder && s3.claimStake;
}
function sectionCompleteS4(s4: GmMissionDay['s4']): boolean {
  return s4.makeSwap && s4.collectStar && s4.playArcade;
}

function awardPoints(m: GmMissionDay): number {
  let award = 0;
  if (!m.s1.done && sectionCompleteS1(m.s1)) { m.s1.done = true; award += 20; }
  if (!m.s2.done && sectionCompleteS2(m.s2)) { m.s2.done = true; award += 20; }
  if (!m.s3.done && sectionCompleteS3(m.s3)) { m.s3.done = true; award += 10; }
  if (!m.s4.done && sectionCompleteS4(m.s4)) { m.s4.done = true; award += 30; }
  const before = m.pts;
  m.pts = Math.min(80, m.pts + award);
  if (m.pts === 80 && !m.completedAt) m.completedAt = Date.now();
  return m.pts - before;
}

export async function markMissionTask(address: string, taskId: GmTaskId, proof?: GmProgressProof, count: number = 1): Promise<GmMissionDay> {
  const d = getTodayDateString();
  const k = keys.missions(address, d);
  const safeCount = Number.isFinite(count) && count > 0 ? Math.min(1000, Math.floor(count)) : 1;
  const redisClient = redis;

  if (!redisClient) {
    const fallback = await getMissionDay(address, d);
    applyMissionTaskProgress(fallback, taskId, safeCount);
    const awarded = awardPoints(fallback);
    await redisSetJSON(k, fallback);
    if (proof && (proof.txHash || proof.meta)) {
      await redisSetJSON(keys.proof(address, d, taskId), proof);
    }
    if (awarded > 0) {
      Promise.resolve().then(async () => {
        try {
          await (redis as any)?.zincrby?.(withPrefix(keys.missionsLeaderboard(toMonth(d))), awarded, address.toLowerCase());
        } catch (error) {
          console.warn('Failed to update missions leaderboard:', error);
        }
      });
    }
    return fallback;
  }

  const prefixedKey = withPrefix(k);
  const maxAttempts = 5;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let raw = await (redisClient as any)?.get?.(prefixedKey);
      if (raw && typeof raw !== 'string') {
        try {
          raw = JSON.stringify(raw);
        } catch {
          raw = null;
        }
      }

      let parsed: any = null;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = null;
        }
      }

      const mission = hydrateMissionDay(parsed, d);
      applyMissionTaskProgress(mission, taskId, safeCount);
      const gained = awardPoints(mission);
      const nextRaw = JSON.stringify(mission);

      const setSuccess = await redisCompareAndSetJSON(k, typeof raw === 'string' ? raw : null, nextRaw);
      if (!setSuccess) {
        continue;
      }

      if (proof && (proof.txHash || proof.meta)) {
        await redisSetJSON(keys.proof(address, d, taskId), proof);
      }

      if (gained > 0) {
        Promise.resolve().then(async () => {
          try {
            await (redis as any)?.zincrby?.(withPrefix(keys.missionsLeaderboard(toMonth(d))), gained, address.toLowerCase());
          } catch (error) {
            console.warn('Failed to update missions leaderboard:', error);
          }
        });
      }

      return mission;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Failed to update mission progress after retries${lastError ? `: ${String(lastError)}` : ''}`);
}

export async function getLeaderboards(month?: string): Promise<{ streakTop: GmLeaderEntry[]; missionTop: GmLeaderEntry[] }> {
  const d = getTodayDateString();
  const yyyymm = month || toMonth(d);
  const sKey = keys.streakLeaderboard(yyyymm);
  const mKey = keys.missionsLeaderboard(yyyymm);

  const [s, m] = await Promise.all([
    (redis as any)?.zrange?.(withPrefix(sKey), 0, 49, { rev: true, withScores: true }) || [],
    (redis as any)?.zrange?.(withPrefix(mKey), 0, 49, { rev: true, withScores: true }) || [],
  ]);

  const convert = (arr: any[]): GmLeaderEntry[] => {
    const out: GmLeaderEntry[] = [];
    for (let i = 0; i < arr.length; i += 2) {
      out.push({ address: arr[i], value: Number(arr[i + 1]) });
    }
    return out;
  };

  return { streakTop: convert(s as any), missionTop: convert(m as any) };
}

export async function adminReset(scope: 'streaks' | 'missions' | 'all'): Promise<{ deleted: number }> {
  const patterns = [] as string[];
  if (scope === 'streaks' || scope === 'all') {
    patterns.push(`${PX}streak:*`, `${PX}streak:leaderboard:*`, `${PX}streak:activity:*`);
  }
  if (scope === 'missions' || scope === 'all') {
    // Use multiple patterns to ensure we catch all mission-related keys
    patterns.push(
      `${PX}missions:*`,              // All mission data keys (should match missions:{address}:{date} and missions:proof:*)
      `${PX}missions:proof:*`,        // Explicit pattern for proof keys
      `${PX}missions:leaderboard:*`,  // Mission leaderboards
      `${PX}idemp:*`                  // Idempotency keys for reward claims
    );
  }

  let deleted = 0;
  const allKeys = new Set<string>(); // Use Set to deduplicate keys across patterns
  
  // Collect all keys first (deduplicated)
  for (const p of patterns) {
    try {
      // Use redisScanKeys for more reliable pattern matching, especially for large datasets
      // Note: redisScanKeys handles prefixing automatically, so we pass the full pattern
      const keysList = await redisScanKeys(p, 1000);
      if (keysList && keysList.length > 0) {
        keysList.forEach(key => {
          // Ensure we're working with the actual key format from Redis
          // Keys from redisScanKeys are already fully qualified
          if (key && typeof key === 'string') {
            allKeys.add(key);
          }
        });
      }
    } catch (error) {
      console.error(`[adminReset] Failed to scan pattern ${p}:`, error);
    }
  }

  // Delete all collected keys in batches
  if (allKeys.size > 0) {
    const keysArray = Array.from(allKeys);
    const batchSize = 100; // Delete in batches to avoid overwhelming Redis
    for (let i = 0; i < keysArray.length; i += batchSize) {
      const batch = keysArray.slice(i, i + batchSize);
      if (batch.length > 0) {
        try {
          // Keys returned from redisScanKeys are already fully qualified (with prefix)
          // So we delete them directly without adding prefix again
          const result = await redis?.del?.(...batch as any);
          deleted += batch.length;
          // Log if deletion count doesn't match (for debugging)
          if (result !== undefined && typeof result === 'number' && result !== batch.length) {
            console.warn(`[adminReset] Deletion mismatch: expected ${batch.length}, got ${result}`);
          }
        } catch (error) {
          console.error(`[adminReset] Failed to delete batch (${i}-${i + batch.length}):`, error);
          // Try deleting keys individually as fallback
          for (const key of batch) {
            try {
              await redis?.del?.(key);
              deleted++;
            } catch (e) {
              console.error(`[adminReset] Failed to delete individual key ${key}:`, e);
            }
          }
        }
      }
    }
  }
  
  await redisSetJSON(keys.adminLastReset, { at: Date.now(), scope });
  return { deleted };
}

export async function getMissionScore(address: string, month?: string): Promise<number> {
  if (!address) return 0;
  const d = getTodayDateString();
  const yyyymm = month || toMonth(d);
  const key = withPrefix(keys.missionsLeaderboard(yyyymm));
  try {
    const raw = await (redis as any)?.zscore?.(key, address.toLowerCase());
    if (raw == null) return 0;
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  } catch (error) {
    console.warn('getMissionScore failed', error);
    return 0;
  }
}


