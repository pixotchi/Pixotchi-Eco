import {
  redis,
  redisGetJSON,
  redisGetJSONResult,
  redisScanKeys,
  redisSetJSON,
  withPrefix,
  type RedisJSONReadResult,
} from '@/lib/redis';
import { isGamificationDisabled } from './gamification-feature';
import type { GmDay,GmLeaderEntry,GmMissionDay,GmProgressProof,GmStreak,GmTaskId } from './gamification-types';
import { GM_SECTION_REWARDS } from './gamification-types';

const PX = 'pixotchi:gm:';

function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

const keys = {
  streak: (address: string) => `${PX}streak:${address.toLowerCase()}`,
  streakLeaderboard: (yyyymm: string) => `${PX}streak:leaderboard:${yyyymm}`,
  missions: (address: string, day: GmDay) => `${PX}missions:${address.toLowerCase()}:${day}`,
  missionsLeaderboard: (yyyymm: string) => `${PX}missions:leaderboard:${yyyymm}`,
  proof: (address: string, day: GmDay, taskId: string) => `${PX}missions:proof:${address.toLowerCase()}:${day}:${taskId}`,
  legacyProofUsed: (txHash: string) => `${PX}missions:proof-used:${txHash.toLowerCase()}`,
  proofUsed: (address: string, taskId: string, txHash: string) => `${PX}missions:proof-used:v2:8453:${address.toLowerCase()}:${taskId}:${txHash.toLowerCase()}`,
  evidence: (txHash: string, taskId: string, id: string) => `${PX}missions:evidence:v2:8453:${txHash.toLowerCase()}:${taskId}:${id}`,
  todayActiveSet: (day: GmDay) => `${PX}streak:activity:${day}`,
  idemp: (address: string, rewardId: string) => `${PX}idemp:${address.toLowerCase()}:${rewardId}`,
  adminLastReset: `${PX}admin:lastResetAt`,
};

export class MissionProofAlreadyUsedError extends Error {
  readonly code = 'MISSION_PROOF_ALREADY_USED';

  constructor() {
    super('Transaction proof has already been used');
    this.name = 'MissionProofAlreadyUsedError';
  }
}

export class MissionProofPersistenceError extends Error {
  readonly code = 'MISSION_PROOF_PERSISTENCE_UNAVAILABLE';

  constructor(message = 'Mission proof persistence is unavailable') {
    super(message);
    this.name = 'MissionProofPersistenceError';
  }
}

/** Exact retries return the committed day without repeating chain reads. */
export async function getMissionProofReplay(address: string, taskId: GmTaskId, txHash: string): Promise<GmMissionDay | null> {
  const result = await redisGetJSONResult<unknown>(keys.proofUsed(address, taskId, txHash));
  if (result.status === 'unavailable') throw new MissionProofPersistenceError();
  const legacy = result.status === 'missing'
    ? await redisGetJSONResult<unknown>(keys.legacyProofUsed(txHash)) : result;
  if (legacy.status === 'unavailable') throw new MissionProofPersistenceError();
  if (legacy.status === 'missing') return null;
  const value = legacy.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MissionProofPersistenceError('Stored proof is invalid');
  const record = value as Record<string, unknown>;
  if (typeof record.address !== 'string' || typeof record.day !== 'string' || typeof record.taskId !== 'string') {
    throw new MissionProofPersistenceError('Stored proof is invalid');
  }
  // v2 writes an old-format key only to fence older deployed workers.
  if (result.status === 'missing' && record.version === 2) return null;
  if (result.status === 'missing' && record.taskId !== taskId) return null;
  // Legacy records did not retain log identities. Keep same-task legacy
  // receipts conservative across actors until their mission day has expired.
  if (record.address.toLowerCase() !== address.toLowerCase() || record.taskId !== taskId || record.day !== getTodayDateString()) {
    throw new MissionProofAlreadyUsedError();
  }
  return getMissionDay(address, record.day);
}

const MISSION_PROOF_CAS_SCRIPT = `
local missionKey = KEYS[1]
local proofUsedKey = KEYS[2]
local taskProofKey = KEYS[3]
local leaderboardKey = KEYS[4]
local expected = ARGV[1]
local nextMission = ARGV[2]
local proofRecord = ARGV[3]
local gained = tonumber(ARGV[4])
local actor = ARGV[5]

-- Validate types before the first write: Lua does not roll back script errors.
for i, key in ipairs(KEYS) do
  local kind = redis.call("TYPE", key).ok
  local wanted = i == 4 and "zset" or "string"
  if kind ~= "none" and kind ~= wanted then return redis.error_reply("Invalid mission storage type") end
end
if proofRecord ~= "" then
  if redis.call("EXISTS", proofUsedKey) == 1 then return 2 end
  local legacy = redis.call("GET", KEYS[5])
  if legacy then
    local prior = cjson.decode(legacy)
    local candidate = cjson.decode(proofRecord)
    if prior.version ~= 2 and prior.taskId == candidate.taskId then
      if prior.address == candidate.address and prior.day == candidate.day then return 2 end
      return -1
    end
  end
  for i = 6, #KEYS do
    if redis.call("EXISTS", KEYS[i]) == 1 then return -1 end
  end
end
if expected == "__nil__" then
  if redis.call("EXISTS", missionKey) == 1 then return 0 end
elseif redis.call("GET", missionKey) ~= expected then return 0 end

redis.call("SET", missionKey, nextMission)
if proofRecord ~= "" then
  redis.call("SET", proofUsedKey, proofRecord)
  redis.call("SET", taskProofKey, proofRecord)
  -- Older workers only check this transaction-wide key. Keep them fenced.
  redis.call("SET", KEYS[5], proofRecord, "NX")
  for i = 6, #KEYS do redis.call("SET", KEYS[i], proofRecord) end
end
if gained > 0 then redis.call("ZINCRBY", leaderboardKey, gained, actor) end
return 1
`;

async function compareAndSetMission(
  missionKey: string, expected: string | null, nextMission: string,
  address: string, day: GmDay, taskId: GmTaskId, gained: number, proof?: GmProgressProof,
): Promise<'updated' | 'conflict' | 'duplicate' | 'replayed'> {
  if (!redis) throw new MissionProofPersistenceError();
  const hash = proof?.txHash;
  const record = hash ? JSON.stringify({ version: 2, address: address.toLowerCase(), day, taskId, txHash: hash }) : '';
  try {
    const result = Number(await redis.eval(MISSION_PROOF_CAS_SCRIPT, [
      missionKey,
      hash ? keys.proofUsed(address, taskId, hash) : `${missionKey}:unused`,
      keys.proof(address, day, taskId),
      keys.missionsLeaderboard(toMonth(day)),
      hash ? keys.legacyProofUsed(hash) : `${missionKey}:unused`,
      ...(hash ? proof.evidenceIds!.map(id => keys.evidence(hash, taskId, id)) : []),
    ].map(withPrefix), [expected ?? '__nil__', nextMission, record, String(gained), address.toLowerCase()]));
    if (result === 1) return 'updated';
    if (result === 2) return 'replayed';
    if (result === -1) return 'duplicate';
    return 'conflict';
  } catch (error) {
    console.warn('Atomic mission persistence failed:', error);
    throw new MissionProofPersistenceError();
  }
}

function toMonth(day: GmDay): string {
  return day.replace(/\-/g, '').slice(0, 6); // YYYYMM
}

function isCombinedMonth(month?: string | null): boolean {
  if (!month) return true;
  const normalized = month.toLowerCase();
  return normalized === 'all' || normalized === 'combined' || normalized === 'lifetime';
}

function createInitialMissionDay(day: GmDay): GmMissionDay {
  return {
    date: day,
    s1: { makeSwap: false, stakeSeed: false, claimStake: false, placeOrder: false, done: false },
    s2: { followPlayer: false, chatMessage: false, visitProfile: false, done: false },
    s3: { applyResources: false, sendQuest: false, claimProduction: false, playCasinoGame: false, done: false },
    s4: { buy10: false, buyElementsCount: 0, buyShield: false, collectStar: false, playArcade: false, done: false },
    pts: 0,
  };
}

function hydrateMissionDay(data: UntypedValue, day: GmDay): GmMissionDay {
  if (!data) return createInitialMissionDay(day);
  const normalizeNumber = (value: UntypedValue, fallback = 0) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const normalizeBoolean = (value: UntypedValue) => Boolean(value);
  const legacyBuyElementsCount = Math.max(
    0,
    Math.floor(normalizeNumber(data?.s1?.buyElementsCount, normalizeBoolean(data?.s1?.buy5) ? 5 : 0)),
  );
  const buyElementsCount = Math.max(
    0,
    Math.floor(normalizeNumber(data?.s4?.buyElementsCount, legacyBuyElementsCount)),
  );

  return {
    date: typeof data?.date === 'string' ? data.date : day,
    s1: {
      makeSwap: normalizeBoolean(data?.s1?.makeSwap ?? data?.s4?.makeSwap),
      stakeSeed: normalizeBoolean(data?.s1?.stakeSeed),
      claimStake: normalizeBoolean(data?.s1?.claimStake ?? data?.s3?.claimStake),
      placeOrder: normalizeBoolean(data?.s1?.placeOrder ?? data?.s3?.placeOrder),
      done: normalizeBoolean(data?.s1?.done),
    },
    s2: {
      followPlayer: normalizeBoolean(data?.s2?.followPlayer),
      chatMessage: normalizeBoolean(data?.s2?.chatMessage),
      visitProfile: normalizeBoolean(data?.s2?.visitProfile),
      done: normalizeBoolean(data?.s2?.done),
    },
    s3: {
      applyResources: normalizeBoolean(data?.s3?.applyResources ?? data?.s2?.applyResources),
      sendQuest: normalizeBoolean(data?.s3?.sendQuest),
      claimProduction: normalizeBoolean(data?.s3?.claimProduction ?? data?.s1?.claimProduction),
      playCasinoGame: normalizeBoolean(data?.s3?.playCasinoGame),
      done: normalizeBoolean(data?.s3?.done),
    },
    s4: {
      buy10: normalizeBoolean(data?.s4?.buy10) || buyElementsCount >= 10,
      buyElementsCount,
      buyShield: normalizeBoolean(data?.s4?.buyShield ?? data?.s1?.buyShield),
      collectStar: normalizeBoolean(data?.s4?.collectStar),
      playArcade: normalizeBoolean(data?.s4?.playArcade),
      done: normalizeBoolean(data?.s4?.done),
    },
    pts: Math.min(100, Math.max(0, normalizeNumber(data?.pts))),
    completedAt: typeof data?.completedAt === 'number' ? data.completedAt : undefined,
  };
}

function applyMissionTaskProgress(m: GmMissionDay, taskId: GmTaskId, count: number): void {
  switch (taskId) {
    case 's1_make_swap':
      m.s1.makeSwap = true; break;
    case 's1_stake_seed':
      m.s1.stakeSeed = true; break;
    case 's1_claim_stake':
      m.s1.claimStake = true; break;
    case 's1_place_order':
      m.s1.placeOrder = true; break;
    case 's2_follow_player':
      m.s2.followPlayer = true; break;
    case 's2_chat_message':
      m.s2.chatMessage = true; break;
    case 's2_visit_profile':
      m.s2.visitProfile = true; break;
    case 's3_apply_resources':
      m.s3.applyResources = true; break;
    case 's3_send_quest':
      m.s3.sendQuest = true; break;
    case 's3_claim_production':
      m.s3.claimProduction = true; break;
    case 's3_play_casino_game':
      m.s3.playCasinoGame = true; break;
    case 's4_buy10_elements': {
      const prev = m.s4.buyElementsCount || 0;
      const increment = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
      const next = prev + increment;
      m.s4.buyElementsCount = next;
      if (next >= 10) m.s4.buy10 = true;
      break;
    }
    case 's4_buy_shield':
      m.s4.buyShield = true; break;
    case 's4_collect_star':
      m.s4.collectStar = true; break;
    case 's4_play_arcade':
      m.s4.playArcade = true; break;
  }
}

function parseStreak(value: unknown): GmStreak {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MissionProofPersistenceError('Stored streak is invalid');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.current) || Number(record.current) < 0 || !Number.isSafeInteger(record.best) || Number(record.best) < 0
    || typeof record.lastActive !== 'string' || (record.lastActive !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(record.lastActive))) {
    throw new MissionProofPersistenceError('Stored streak is invalid');
  }
  return { current: Number(record.current), best: Number(record.best), lastActive: record.lastActive };
}

export async function getStreak(address: string): Promise<GmStreak> {
  const result = await redisGetJSONResult<unknown>(keys.streak(address));
  if (result.status === 'unavailable') throw new MissionProofPersistenceError('Streak persistence is unavailable');
  const streak = result.status === 'missing' ? { current: 0, best: 0, lastActive: '' } : parseStreak(result.value);
  return normalizeStreakIfMissed(address, streak);
}

/** Read-only projection: a stale read must never overwrite a newer activity. */
export async function normalizeStreakIfMissed(_address: string, s: GmStreak): Promise<GmStreak> {
  const day = getTodayDateString();
  const yesterday = new Date(day);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return s.lastActive && s.lastActive < yesterday.toISOString().slice(0, 10) ? { ...s, current: 0 } : s;
}

const STREAK_ACTIVITY_SCRIPT = `
local raw = redis.call("GET", KEYS[1])
local streak = raw and cjson.decode(raw) or {current=0, best=0, lastActive=""}
if type(streak.current) ~= "number" or type(streak.best) ~= "number" or type(streak.lastActive) ~= "string"
  or streak.current < 0 or streak.best < 0 or streak.current % 1 ~= 0 or streak.best % 1 ~= 0 then
  return redis.error_reply("Invalid stored streak")
end
local leaderboardType = redis.call("TYPE", KEYS[2]).ok
local activityType = redis.call("TYPE", KEYS[3]).ok
if (leaderboardType ~= "none" and leaderboardType ~= "zset") or (activityType ~= "none" and activityType ~= "set") then
  return redis.error_reply("Invalid streak storage type")
end
if streak.lastActive > ARGV[1] then return raw end
if streak.lastActive ~= ARGV[1] then
  streak.current = streak.lastActive == ARGV[2] and streak.current + 1 or 1
  streak.best = math.max(streak.best, streak.current)
  streak.lastActive = ARGV[1]
end
local encoded = cjson.encode(streak)
redis.call("SET", KEYS[1], encoded)
redis.call("ZADD", KEYS[2], streak.current, ARGV[3])
redis.call("SADD", KEYS[3], ARGV[3])
return encoded
`;

export async function trackDailyActivity(address: string): Promise<GmStreak> {
  if (isGamificationDisabled()) return getStreak(address);
  if (!redis) throw new MissionProofPersistenceError('Streak persistence is unavailable');
  const day = getTodayDateString();
  const yesterday = new Date(day);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  try {
    const raw = await redis.eval(STREAK_ACTIVITY_SCRIPT, [
      keys.streak(address), keys.streakLeaderboard(toMonth(day)), keys.todayActiveSet(day),
    ].map(withPrefix), [day, yesterday.toISOString().slice(0, 10), address.toLowerCase()]);
    return parseStreak(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    throw new MissionProofPersistenceError('Streak persistence is unavailable');
  }
}

export async function getMissionDay(address: string, day?: GmDay): Promise<GmMissionDay> {
  const d = day || getTodayDateString();
  const k = keys.missions(address, d);
  const result = await redisGetJSONResult<unknown>(k);
  return resolveMissionDayRead(result, d);
}

export function resolveMissionDayRead(
  result: RedisJSONReadResult<unknown>,
  day: GmDay,
): GmMissionDay {
  if (result.status === 'unavailable') {
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }
  if (result.status === 'missing') return createInitialMissionDay(day);
  if (!result.value || typeof result.value !== 'object' || Array.isArray(result.value)) {
    throw new MissionProofPersistenceError('Stored mission summary is invalid');
  }
  return hydrateMissionDay(result.value, day);
}

function sectionCompleteS1(s1: GmMissionDay['s1']): boolean {
  return s1.makeSwap && s1.stakeSeed && s1.claimStake && s1.placeOrder;
}
function sectionCompleteS2(s2: GmMissionDay['s2']): boolean {
  return s2.followPlayer && s2.chatMessage && s2.visitProfile;
}
function sectionCompleteS3(s3: GmMissionDay['s3']): boolean {
  return s3.applyResources && s3.sendQuest && s3.claimProduction && s3.playCasinoGame;
}
function sectionCompleteS4(s4: GmMissionDay['s4']): boolean {
  return s4.buy10 && s4.buyShield && s4.collectStar && s4.playArcade;
}

function awardPoints(m: GmMissionDay): number {
  let award = 0;
  if (!m.s1.done && sectionCompleteS1(m.s1)) { m.s1.done = true; award += GM_SECTION_REWARDS.s1; }
  if (!m.s2.done && sectionCompleteS2(m.s2)) { m.s2.done = true; award += GM_SECTION_REWARDS.s2; }
  if (!m.s3.done && sectionCompleteS3(m.s3)) { m.s3.done = true; award += GM_SECTION_REWARDS.s3; }
  if (!m.s4.done && sectionCompleteS4(m.s4)) { m.s4.done = true; award += GM_SECTION_REWARDS.s4; }
  const before = m.pts;
  m.pts = Math.min(100, m.pts + award);
  if (m.pts === 100 && !m.completedAt) m.completedAt = Date.now();
  return m.pts - before;
}

export async function markMissionTask(address: string, taskId: GmTaskId, proof?: GmProgressProof, count: number = 1): Promise<GmMissionDay> {
  const d = getTodayDateString();
  if (isGamificationDisabled()) {
    const existing = await redisGetJSON<GmMissionDay>(keys.missions(address, d));
    return hydrateMissionDay(existing, d);
  }

  const k = keys.missions(address, d);
  const safeCount = Number.isFinite(count) && count > 0 ? Math.min(120, Math.floor(count)) : 1;
  const redisClient = redis;
  const proofTxHash = typeof proof?.txHash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(proof.txHash)
    ? proof.txHash.toLowerCase()
    : null;

  if (!redisClient) throw new MissionProofPersistenceError('Mission progress persistence is unavailable');

  if (proofTxHash && (!proof?.evidenceIds?.length || proof.evidenceIds.length > 120
    || new Set(proof.evidenceIds).size !== proof.evidenceIds.length
    || proof.evidenceIds.some(id => !/^(log:\d+|call:0)$/.test(id)))) {
    throw new MissionProofPersistenceError('Verified receipt evidence is required');
  }

  const prefixedKey = withPrefix(k);
  const maxAttempts = 5;
  let lastError: UntypedValue = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let raw = await (redisClient as UntypedValue)?.get?.(prefixedKey);
      if (raw && typeof raw !== 'string') {
        try {
          raw = JSON.stringify(raw);
        } catch {
          raw = null;
        }
      }

      let parsed: UntypedValue = null;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new MissionProofPersistenceError('Stored mission progress is invalid');
        }
      }
      if (parsed !== null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
        throw new MissionProofPersistenceError('Stored mission progress is invalid');
      }

      const mission = hydrateMissionDay(parsed, d);
      applyMissionTaskProgress(mission, taskId, safeCount);
      const gained = awardPoints(mission);
      const nextRaw = JSON.stringify(mission);

      const result = await compareAndSetMission(k, typeof raw === 'string' ? raw : null, nextRaw,
        address, d, taskId, gained, proofTxHash ? { ...proof, txHash: proofTxHash } : undefined);
      if (result === 'duplicate') throw new MissionProofAlreadyUsedError();
      if (result === 'replayed') return getMissionDay(address, d);
      if (result === 'conflict') continue;

      return mission;
    } catch (error) {
      if (error instanceof MissionProofAlreadyUsedError || error instanceof MissionProofPersistenceError) {
        throw error;
      }
      lastError = error;
    }
  }

  throw new Error(`Failed to update mission progress after retries${lastError ? `: ${String(lastError)}` : ''}`);
}

async function getCombinedMissionLeaderboard(limit: number = 50): Promise<GmLeaderEntry[]> {
  if (!redis) return [];
  const totals = new Map<string, number>();
  const missionKeys = await redisScanKeys(`${PX}missions:leaderboard:*`);
  if (!missionKeys.length) return [];

  for (const rawKey of missionKeys) {
    const prefixedKey = rawKey.startsWith(PX) ? rawKey : withPrefix(rawKey);
    try {
      const entries = (await (redis as UntypedValue)?.zrange?.(prefixedKey, 0, -1, { withScores: true })) || [];
      if (!Array.isArray(entries)) continue;
      for (let i = 0; i < entries.length; i += 2) {
        const address = typeof entries[i] === 'string' ? entries[i].toLowerCase() : String(entries[i] || '').toLowerCase();
        const value = Number(entries[i + 1]);
        if (!address || !Number.isFinite(value)) continue;
        totals.set(address, (totals.get(address) || 0) + value);
      }
    } catch (error) {
      console.warn('Failed to aggregate mission leaderboard key:', prefixedKey, error);
    }
  }

  return Array.from(totals.entries())
    .map(([address, value]) => ({ address, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}
/**
 * Get combined streak leaderboard across all time.
 * Reads from individual streak records (streak:{address}) and uses the 'best' field.
 */
async function getCombinedStreakLeaderboard(limit: number = 50): Promise<GmLeaderEntry[]> {
  if (!redis) return [];

  // Scan all individual streak keys (not leaderboard sorted sets)
  const streakPattern = `${PX}streak:0*`; // Streak keys start with address (0x...)
  const streakKeys = await redisScanKeys(streakPattern, 1000);

  if (!streakKeys.length) return [];

  const results: GmLeaderEntry[] = [];

  // Read each streak record and extract the 'best' value
  for (const key of streakKeys) {
    try {
      // Extract address from key (pixotchi:gm:streak:0x123... -> 0x123...)
      const address = key.slice(withPrefix(`${PX}streak:`).length).toLowerCase();
      if (!address.startsWith('0x')) continue; // Skip non-address keys like leaderboard:*

      const data = await redisGetJSON<GmStreak>(key);
      if (data && typeof data.best === 'number' && data.best > 0) {
        results.push({ address, value: data.best });
      }
    } catch (error) {
      console.warn('Failed to read streak record:', key, error);
    }
  }

  return results
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function convertZRangeResponse(arr: UntypedValue[]): GmLeaderEntry[] {
  if (!Array.isArray(arr)) return [];
  const out: GmLeaderEntry[] = [];
  for (let i = 0; i < arr.length; i += 2) {
    const address = arr[i];
    const value = Number(arr[i + 1]);
    if (typeof address === 'string' && Number.isFinite(value)) {
      out.push({ address, value });
    }
  }
  return out;
}

async function getMonthlyMissionLeaderboard(yyyymm: string): Promise<GmLeaderEntry[]> {
  if (!redis) return [];
  const raw = (await (redis as UntypedValue)?.zrange?.(withPrefix(keys.missionsLeaderboard(yyyymm)), 0, 49, { rev: true, withScores: true })) || [];
  return convertZRangeResponse(raw as UntypedValue);
}

async function getMissionScoreKeys(): Promise<string[]> {
  if (!redis) {
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }

  const scan = (redis as UntypedValue).scan;
  if (typeof scan !== 'function') {
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }

  const pattern = withPrefix(`${PX}missions:leaderboard:*`);
  const results: string[] = [];
  let cursor = '0';
  try {
    do {
      const response: UntypedValue = await scan.call(redis, cursor, { match: pattern, count: 1000 });
      let batch: unknown;
      if (Array.isArray(response) && response.length >= 2) {
        cursor = String(response[0]);
        batch = response[1];
      } else if (response && typeof response === 'object' && 'cursor' in response) {
        cursor = String(response.cursor);
        batch = response.keys;
      } else {
        throw new Error('Unexpected Redis SCAN response');
      }
      if (!Array.isArray(batch) || batch.some((key) => typeof key !== 'string')) {
        throw new Error('Invalid Redis SCAN key list');
      }
      results.push(...batch);
    } while (cursor !== '0');
  } catch (error) {
    console.warn('Failed to scan mission score keys:', error);
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }

  return results;
}

export function resolveMissionScoreRead(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new MissionProofPersistenceError('Stored mission score is invalid');
  }
  if (typeof raw === 'string' && raw.trim() === '') {
    throw new MissionProofPersistenceError('Stored mission score is invalid');
  }
  const score = Number(raw);
  if (!Number.isFinite(score)) {
    throw new MissionProofPersistenceError('Stored mission score is invalid');
  }
  return score;
}

async function getCombinedMissionScore(address: string): Promise<number> {
  if (!address) return 0;
  const normalized = address.toLowerCase();
  const missionKeys = await getMissionScoreKeys();
  if (!missionKeys.length) return 0;

  const scores = await Promise.all(
    missionKeys.map(async (rawKey) => {
      const prefixedKey = rawKey.startsWith(PX) ? rawKey : withPrefix(rawKey);
      try {
        const rawScore = await (redis as UntypedValue)?.zscore?.(prefixedKey, normalized);
        return resolveMissionScoreRead(rawScore);
      } catch (error) {
        if (error instanceof MissionProofPersistenceError) throw error;
        console.warn('Failed to read mission score for key:', prefixedKey, error);
        throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
      }
    }),
  );
  return scores.reduce((total, score) => total + score, 0);
}

export async function getLeaderboards(month?: string): Promise<{ streakTop: GmLeaderEntry[]; missionTop: GmLeaderEntry[] }> {
  const d = getTodayDateString();
  const yyyymm = month && !isCombinedMonth(month) ? month : toMonth(d);

  // Both leaderboards now show all-time/combined by default (or specific month if requested)
  const streakPromise = isCombinedMonth(month)
    ? getCombinedStreakLeaderboard()
    : (async () => {
      const raw = (await (redis as UntypedValue)?.zrange?.(withPrefix(keys.streakLeaderboard(yyyymm)), 0, 49, { rev: true, withScores: true })) || [];
      return convertZRangeResponse(raw as UntypedValue);
    })();
  const missionPromise = isCombinedMonth(month) ? getCombinedMissionLeaderboard() : getMonthlyMissionLeaderboard(yyyymm);

  const [streakTop, missionTop] = await Promise.all([streakPromise, missionPromise]);

  return { streakTop, missionTop };
}

export async function getMissionLeaderboard(month?: string): Promise<GmLeaderEntry[]> {
  const d = getTodayDateString();
  const yyyymm = month && !isCombinedMonth(month) ? month : toMonth(d);
  return isCombinedMonth(month) ? getCombinedMissionLeaderboard() : getMonthlyMissionLeaderboard(yyyymm);
}

export async function adminReset(scope: 'streaks' | 'missions' | 'all'): Promise<{ deleted: number }> {
  const patterns = [] as string[];
  // Keys are stored as pixotchi:gm:streak:* etc (PX already starts with KEY_PREFIX)
  if (scope === 'streaks' || scope === 'all') {
    patterns.push(
      `${PX}streak:*`,
      `${PX}streak:leaderboard:*`,
      `${PX}streak:activity:*`
    );
  }
  if (scope === 'missions' || scope === 'all') {
    patterns.push(
      `${PX}missions:*`,
      `${PX}missions:leaderboard:*`
    );
  }

  let deleted = 0;
  for (const p of patterns) {
    // Use SCAN instead of KEYS to handle large datasets (KEYS fails on Upstash with many keys)
    const keysList = await redisScanKeys(p, 1000);
    console.log(`[adminReset] Pattern ${p} found ${keysList.length} keys`);
    if (keysList.length) {
      // Delete in batches of 100 to avoid hitting limits
      for (let i = 0; i < keysList.length; i += 100) {
        const batch = keysList.slice(i, i + 100);
        await redis?.del?.(...batch as UntypedValue);
      }
      deleted += keysList.length;
    }
  }
  await redisSetJSON(keys.adminLastReset, { at: Date.now(), scope });
  return { deleted };
}


export async function getMissionScore(address: string, month?: string): Promise<number> {
  if (!address) return 0;
  if (isCombinedMonth(month)) {
    return getCombinedMissionScore(address);
  }
  if (!redis) {
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }
  const d = getTodayDateString();
  const yyyymm = month || toMonth(d);
  const key = withPrefix(keys.missionsLeaderboard(yyyymm));
  try {
    const raw = await (redis as UntypedValue)?.zscore?.(key, address.toLowerCase());
    return resolveMissionScoreRead(raw);
  } catch (error) {
    if (error instanceof MissionProofPersistenceError) throw error;
    console.warn('getMissionScore failed', error);
    throw new MissionProofPersistenceError('Mission summary persistence is unavailable');
  }
}
