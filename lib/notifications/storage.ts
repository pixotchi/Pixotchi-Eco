import { nanoid } from 'nanoid';
import { redis } from '@/lib/redis';
import {
  BASE_API_LOCK_KEY,
  BASE_AUDIENCE_CURRENT_SNAPSHOT_KEY,
  BASE_AUDIENCE_HISTORY_KEY,
  BASE_AUDIENCE_SYNC_STATE_KEY,
  BASE_CAMPAIGN_HISTORY_LIMIT,
  BASE_SYNC_HISTORY_LIMIT,
  PLANT_CARE_HISTORY_LIMIT,
  getBaseAudienceSnapshotAddressesKey,
  getBaseAudienceSnapshotMetaKey,
  getCampaignMetaKey,
  getCampaignProgressKey,
  getCampaignResultsKey,
  getPlantCareLastKey,
  getPlantCareLogKey,
  getPlantCareRunsKey,
  getPlantCareSentCountKey,
  NOTIFICATION_CAMPAIGN_INDEX_KEY,
} from '@/lib/notifications/constants';
import type { NotificationProvider } from '@/lib/notifications/provider';
import { uniqueWalletAddresses } from '@/lib/notifications/utils';

export type BaseAudienceSyncTrigger = 'cron' | 'admin';
export type SyncStatus = 'running' | 'completed' | 'failed';
export type CampaignStatus =
  | 'draft'
  | 'dry_run'
  | 'running'
  | 'completed'
  | 'completed_with_failures'
  | 'failed';

export type BaseAudienceSyncState = {
  id: string;
  provider: 'base';
  status: SyncStatus;
  trigger: BaseAudienceSyncTrigger;
  startedAt: string;
  finishedAt?: string | null;
  cursor: string | null;
  pagesFetched: number;
  usersFetched: number;
  uniqueAddresses: number;
  rateLimitedCount: number;
  lastPageAt?: string | null;
  error?: string | null;
};

export type BaseAudienceSnapshotMeta = {
  id: string;
  provider: 'base';
  status: 'completed';
  trigger: BaseAudienceSyncTrigger;
  startedAt: string;
  completedAt: string;
  pagesFetched: number;
  usersFetched: number;
  uniqueAddresses: number;
};

export type PlantCareRunSummary = {
  id: string;
  provider: NotificationProvider;
  startedAt: string;
  completedAt: string;
  dryRun: boolean;
  totalRecipients: number;
  notified: number;
  skippedNoAddress?: number;
  skippedNoDue?: number;
  skippedThrottled?: number;
  skippedNotEnabled?: number;
  eligiblePlants: number;
  elapsedMs: number;
  debug?: boolean;
  result?: unknown;
};

export type NotificationCampaignAudienceMode = 'all' | 'selected';

export type NotificationCampaignMeta = {
  id: string;
  provider: NotificationProvider;
  status: CampaignStatus;
  audienceMode: NotificationCampaignAudienceMode;
  title: string;
  message: string;
  targetPath?: string;
  requestedCount: number;
  resolvedCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  dryRun: boolean;
  notes?: string[];
};

export type NotificationCampaignProgress = {
  processedBatches: number;
  totalBatches: number;
  lastBatchAt?: string | null;
};

type JsonRecord = Record<string, unknown>;

function toJsonString(value: unknown): string {
  return JSON.stringify(value);
}

async function readJsonRaw<T>(key: string): Promise<T | null> {
  if (!redis) {
    return null;
  }

  const raw = await redis.get(key);
  if (raw == null) {
    return null;
  }

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  return raw as T;
}

async function writeJsonRaw(key: string, value: unknown): Promise<void> {
  if (!redis) {
    return;
  }

  await redis.set(key, toJsonString(value));
}

async function appendJsonList(key: string, value: unknown, limit: number): Promise<void> {
  if (!redis) {
    return;
  }

  await (redis as any)?.lpush?.(key, toJsonString(value));
  await (redis as any)?.ltrim?.(key, 0, limit - 1);
}

async function getSetMembersRaw(key: string): Promise<string[]> {
  if (!redis) {
    return [];
  }

  const members = await redis.smembers(key);
  return Array.isArray(members) ? members.map((entry) => String(entry).toLowerCase()) : [];
}

async function getSetCardRaw(key: string): Promise<number> {
  if (!redis) {
    return 0;
  }

  const scard = await (redis as any)?.scard?.(key);
  if (typeof scard === 'number') {
    return scard;
  }
  if (typeof scard === 'string') {
    const parsed = Number.parseInt(scard, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return (await getSetMembersRaw(key)).length;
}

export async function acquireBaseApiLock(owner: string, ttlSeconds: number): Promise<boolean> {
  if (!redis) {
    return true;
  }

  const result = await redis.set(BASE_API_LOCK_KEY, owner, { nx: true, ex: ttlSeconds });
  return String(result || '') === 'OK';
}

export async function releaseBaseApiLock(owner: string): Promise<void> {
  if (!redis) {
    return;
  }

  await (redis as any)?.eval?.(
    'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) end return 0',
    [BASE_API_LOCK_KEY],
    [owner],
  );
}

export async function clearBaseApiLock(): Promise<void> {
  if (!redis) {
    return;
  }

  await redis.del(BASE_API_LOCK_KEY);
}

export async function getBaseAudienceSyncState(): Promise<BaseAudienceSyncState | null> {
  return readJsonRaw<BaseAudienceSyncState>(BASE_AUDIENCE_SYNC_STATE_KEY);
}

export async function setBaseAudienceSyncState(state: BaseAudienceSyncState | null): Promise<void> {
  if (!redis) {
    return;
  }

  if (!state) {
    await redis.del(BASE_AUDIENCE_SYNC_STATE_KEY);
    return;
  }

  await writeJsonRaw(BASE_AUDIENCE_SYNC_STATE_KEY, state);
}

export async function getBaseAudienceCurrentSnapshotId(): Promise<string | null> {
  if (!redis) {
    return null;
  }

  const current = await redis.get(BASE_AUDIENCE_CURRENT_SNAPSHOT_KEY);
  return current ? String(current) : null;
}

export async function getBaseAudienceSnapshotMeta(
  snapshotId: string,
): Promise<BaseAudienceSnapshotMeta | null> {
  return readJsonRaw<BaseAudienceSnapshotMeta>(getBaseAudienceSnapshotMetaKey(snapshotId));
}

export async function getCurrentBaseAudienceSnapshotMeta(): Promise<BaseAudienceSnapshotMeta | null> {
  const currentSnapshotId = await getBaseAudienceCurrentSnapshotId();
  if (!currentSnapshotId) {
    return null;
  }

  return getBaseAudienceSnapshotMeta(currentSnapshotId);
}

export async function getCurrentBaseAudienceAddresses(): Promise<string[]> {
  const currentSnapshotId = await getBaseAudienceCurrentSnapshotId();
  if (!currentSnapshotId) {
    return [];
  }

  return getSetMembersRaw(getBaseAudienceSnapshotAddressesKey(currentSnapshotId));
}

export async function deleteBaseAudienceSnapshot(snapshotId: string): Promise<void> {
  if (!redis) {
    return;
  }

  await redis.del(getBaseAudienceSnapshotAddressesKey(snapshotId));
  await redis.del(getBaseAudienceSnapshotMetaKey(snapshotId));
}

export async function addBaseAudienceAddresses(snapshotId: string, addresses: string[]): Promise<number> {
  const normalizedAddresses = uniqueWalletAddresses(addresses);
  if (!redis || normalizedAddresses.length === 0) {
    return getSetCardRaw(getBaseAudienceSnapshotAddressesKey(snapshotId));
  }

  await (redis as any)?.sadd?.(getBaseAudienceSnapshotAddressesKey(snapshotId), ...normalizedAddresses);
  return getSetCardRaw(getBaseAudienceSnapshotAddressesKey(snapshotId));
}

export async function createBaseAudienceSyncState(
  trigger: BaseAudienceSyncTrigger,
): Promise<BaseAudienceSyncState> {
  const state: BaseAudienceSyncState = {
    id: `aud_${Date.now()}_${nanoid(8)}`,
    provider: 'base',
    status: 'running',
    trigger,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    cursor: null,
    pagesFetched: 0,
    usersFetched: 0,
    uniqueAddresses: 0,
    rateLimitedCount: 0,
    lastPageAt: null,
    error: null,
  };

  await setBaseAudienceSyncState(state);
  return state;
}

export async function finalizeBaseAudienceSnapshot(
  state: BaseAudienceSyncState,
): Promise<BaseAudienceSnapshotMeta> {
  if (!redis) {
    throw new Error('Redis unavailable');
  }

  const now = new Date().toISOString();
  const uniqueAddresses = await getSetCardRaw(getBaseAudienceSnapshotAddressesKey(state.id));
  const snapshot: BaseAudienceSnapshotMeta = {
    id: state.id,
    provider: 'base',
    status: 'completed',
    trigger: state.trigger,
    startedAt: state.startedAt,
    completedAt: now,
    pagesFetched: state.pagesFetched,
    usersFetched: state.usersFetched,
    uniqueAddresses,
  };

  const previousSnapshotId = await getBaseAudienceCurrentSnapshotId();

  await writeJsonRaw(getBaseAudienceSnapshotMetaKey(state.id), snapshot);
  await redis.set(BASE_AUDIENCE_CURRENT_SNAPSHOT_KEY, state.id);
  await appendJsonList(BASE_AUDIENCE_HISTORY_KEY, snapshot, BASE_SYNC_HISTORY_LIMIT);

  if (previousSnapshotId && previousSnapshotId !== state.id) {
    await redis.del(getBaseAudienceSnapshotAddressesKey(previousSnapshotId));
  }

  return snapshot;
}

export async function listBaseAudienceHistory(limit: number = 10): Promise<BaseAudienceSnapshotMeta[]> {
  if (!redis) {
    return [];
  }

  const rows = await (redis as any)?.lrange?.(BASE_AUDIENCE_HISTORY_KEY, 0, limit - 1);
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      try {
        return JSON.parse(String(row)) as BaseAudienceSnapshotMeta;
      } catch {
        return null;
      }
    })
    .filter((row): row is BaseAudienceSnapshotMeta => row !== null);
}

export async function pruneBaseAudienceAddressesFromCurrentSnapshot(addresses: string[]): Promise<{
  snapshotId: string | null;
  removedCount: number;
  remainingCount: number;
}> {
  const normalizedAddresses = uniqueWalletAddresses(addresses);
  const snapshotId = await getBaseAudienceCurrentSnapshotId();

  if (!redis || normalizedAddresses.length === 0) {
    return {
      snapshotId,
      removedCount: 0,
      remainingCount: (await getCurrentBaseAudienceSnapshotMeta())?.uniqueAddresses || 0,
    };
  }

  if (!snapshotId) {
    return {
      snapshotId: null,
      removedCount: 0,
      remainingCount: 0,
    };
  }

  const addressesKey = getBaseAudienceSnapshotAddressesKey(snapshotId);
  const removedRaw = await (redis as any)?.srem?.(addressesKey, ...normalizedAddresses);
  const removedCount = typeof removedRaw === 'number' ? removedRaw : Number.parseInt(String(removedRaw || '0'), 10) || 0;
  const remainingCount = await getSetCardRaw(addressesKey);

  const snapshot = await getBaseAudienceSnapshotMeta(snapshotId);
  if (snapshot) {
    await writeJsonRaw(getBaseAudienceSnapshotMetaKey(snapshotId), {
      ...snapshot,
      uniqueAddresses: remainingCount,
    });
  }

  return {
    snapshotId,
    removedCount,
    remainingCount,
  };
}

export async function recordPlantCareRun(summary: PlantCareRunSummary): Promise<void> {
  if (!redis) {
    return;
  }

  await writeJsonRaw(getPlantCareLastKey(summary.provider), summary);
  await appendJsonList(getPlantCareLogKey(summary.provider), summary, PLANT_CARE_HISTORY_LIMIT);
  if (!summary.dryRun) {
    await (redis as any)?.incrby?.(getPlantCareSentCountKey(summary.provider), summary.notified);
  }
  await (redis as any)?.incr?.(getPlantCareRunsKey(summary.provider));
}

export async function getPlantCareStats(provider: NotificationProvider): Promise<{
  sentCount: number;
  totalRuns: number;
  lastRun: PlantCareRunSummary | null;
  recent: PlantCareRunSummary[];
}> {
  if (!redis) {
    return {
      sentCount: 0,
      totalRuns: 0,
      lastRun: null,
      recent: [],
    };
  }

  const [sentRaw, runsRaw, lastRun, recentRaw] = await Promise.all([
    redis.get(getPlantCareSentCountKey(provider)),
    redis.get(getPlantCareRunsKey(provider)),
    readJsonRaw<PlantCareRunSummary>(getPlantCareLastKey(provider)),
    (redis as any)?.lrange?.(getPlantCareLogKey(provider), 0, 19),
  ]);

  const recent = Array.isArray(recentRaw)
    ? recentRaw
        .map((row) => {
          try {
            return JSON.parse(String(row)) as PlantCareRunSummary;
          } catch {
            return null;
          }
        })
        .filter((row): row is PlantCareRunSummary => row !== null)
    : [];

  return {
    sentCount: Number(sentRaw || 0),
    totalRuns: Number(runsRaw || 0),
    lastRun,
    recent,
  };
}

export async function createCampaignMeta(
  payload: Omit<
    NotificationCampaignMeta,
    'id' | 'createdAt' | 'updatedAt' | 'finishedAt' | 'sentCount' | 'failedCount'
  >,
): Promise<NotificationCampaignMeta> {
  const now = new Date().toISOString();
  const meta: NotificationCampaignMeta = {
    ...payload,
    id: `camp_${Date.now()}_${nanoid(8)}`,
    sentCount: 0,
    failedCount: 0,
    createdAt: now,
    updatedAt: now,
    finishedAt: null,
  };

  if (redis) {
    await writeJsonRaw(getCampaignMetaKey(meta.id), meta);
    await (redis as any)?.lpush?.(NOTIFICATION_CAMPAIGN_INDEX_KEY, meta.id);
    await (redis as any)?.ltrim?.(NOTIFICATION_CAMPAIGN_INDEX_KEY, 0, BASE_CAMPAIGN_HISTORY_LIMIT - 1);
  }

  return meta;
}

export async function getCampaignMeta(campaignId: string): Promise<NotificationCampaignMeta | null> {
  return readJsonRaw<NotificationCampaignMeta>(getCampaignMetaKey(campaignId));
}

export async function updateCampaignMeta(
  campaignId: string,
  patch: Partial<NotificationCampaignMeta>,
): Promise<NotificationCampaignMeta | null> {
  const current = await getCampaignMeta(campaignId);
  if (!current || !redis) {
    return current;
  }

  const next: NotificationCampaignMeta = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  await writeJsonRaw(getCampaignMetaKey(campaignId), next);
  return next;
}

export async function setCampaignProgress(
  campaignId: string,
  progress: NotificationCampaignProgress,
): Promise<void> {
  await writeJsonRaw(getCampaignProgressKey(campaignId), progress);
}

export async function getCampaignProgress(
  campaignId: string,
): Promise<NotificationCampaignProgress | null> {
  return readJsonRaw<NotificationCampaignProgress>(getCampaignProgressKey(campaignId));
}

export async function setCampaignResults(campaignId: string, results: JsonRecord): Promise<void> {
  await writeJsonRaw(getCampaignResultsKey(campaignId), results);
}

export async function getCampaignResults(campaignId: string): Promise<JsonRecord | null> {
  return readJsonRaw<JsonRecord>(getCampaignResultsKey(campaignId));
}

export async function listCampaigns(limit: number = 20): Promise<NotificationCampaignMeta[]> {
  if (!redis) {
    return [];
  }

  const ids = await (redis as any)?.lrange?.(NOTIFICATION_CAMPAIGN_INDEX_KEY, 0, limit - 1);
  if (!Array.isArray(ids)) {
    return [];
  }

  const campaigns = await Promise.all(ids.map((id) => getCampaignMeta(String(id))));
  return campaigns.filter((campaign): campaign is NotificationCampaignMeta => campaign !== null);
}
