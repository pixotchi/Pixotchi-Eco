import { redis, redisGetJSON, redisSetJSON, redisKeys, redisDel, withPrefix } from '@/lib/redis';
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
  } catch {
    return s;
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
  // Add to activity set for analytics
  try { await (redis as any)?.sadd?.(withPrefix(keys.todayActiveSet(day)), address.toLowerCase()); } catch {}
  // Update monthly leaderboard
  try { await (redis as any)?.zadd?.(withPrefix(keys.streakLeaderboard(toMonth(day))), { score: current, member: address.toLowerCase() }); } catch {}
  return updated;
}

export async function getMissionDay(address: string, day?: GmDay): Promise<GmMissionDay> {
  const d = day || getTodayDateString();
  const k = keys.missions(address, d);
  const data = await redisGetJSON<GmMissionDay>(k);
  if (data) return data;
  const init: GmMissionDay = {
    date: d,
    s1: { buy5: false, buyElementsCount: 0, buyShield: false, claimProduction: false, done: false },
    s2: { applyResources: false, attackPlant: false, chatMessage: false, done: false },
    s3: { sendQuest: false, placeOrder: false, claimStake: false, done: false },
    pts: 0,
  };
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

function awardPoints(m: GmMissionDay): number {
  let award = 0;
  if (!m.s1.done && sectionCompleteS1(m.s1)) { m.s1.done = true; award += 20; }
  if (!m.s2.done && sectionCompleteS2(m.s2)) { m.s2.done = true; award += 20; }
  if (!m.s3.done && sectionCompleteS3(m.s3)) { m.s3.done = true; award += 10; }
  const before = m.pts;
  m.pts = Math.min(50, m.pts + award);
  if (m.pts === 50 && !m.completedAt) m.completedAt = Date.now();
  return m.pts - before;
}

export async function markMissionTask(address: string, taskId: GmTaskId, proof?: GmProgressProof, count: number = 1): Promise<GmMissionDay> {
  const d = getTodayDateString();
  const k = keys.missions(address, d);
  const m = await getMissionDay(address, d);

  switch (taskId) {
    case 's1_buy5_elements': {
      const prev = m.s1.buyElementsCount || 0;
      const next = prev + (Number.isFinite(count) && count > 0 ? count : 1);
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
  }

  const gained = awardPoints(m);
  await redisSetJSON(k, m);

  // Store minimal proof (optional)
  if (proof && (proof.txHash || proof.meta)) {
    await redisSetJSON(keys.proof(address, d, taskId), proof);
  }

  // Update monthly leaderboard on any gain
  if (gained > 0) {
    try { await (redis as any)?.zincrby?.(withPrefix(keys.missionsLeaderboard(toMonth(d))), gained, address.toLowerCase()); } catch {}
  }

  return m;
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
  if (scope === 'streaks' || scope === 'all') patterns.push(`${PX}streak:*`, `${PX}streak:leaderboard:*`, `${PX}streak:activity:*`);
  if (scope === 'missions' || scope === 'all') patterns.push(`${PX}missions:*`, `${PX}missions:leaderboard:*`);

  let deleted = 0;
  for (const p of patterns) {
    const keysList = await redisKeys(p);
    if (keysList.length) {
      await redis?.del?.(...keysList as any);
      deleted += keysList.length;
    }
  }
  await redisSetJSON(keys.adminLastReset, { at: Date.now(), scope });
  return { deleted };
}


