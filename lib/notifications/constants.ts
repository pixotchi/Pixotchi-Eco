import type { NotificationProvider } from '@/lib/notifications/provider';

export const PLANT_CARE_THRESHOLD_SECONDS = 12 * 60 * 60;
export const PLANT_CARE_THROTTLE_SECONDS = 12 * 60 * 60;

export const BASE_NOTIFICATIONS_API_BASE_URL = 'https://dashboard.base.org/api/v1/notifications';
export const BASE_AUDIENCE_PAGE_SIZE = 100;
export const BASE_SEND_BATCH_SIZE = 1000;
export const BASE_REQUEST_INTERVAL_MS = 6500;
export const BASE_REQUEST_LOCK_TTL_SECONDS = 15 * 60;
export const BASE_SYNC_HISTORY_LIMIT = 24;
export const BASE_CAMPAIGN_HISTORY_LIMIT = 50;
export const PLANT_CARE_HISTORY_LIMIT = 50;

export const BASE_API_LOCK_KEY = 'notif:base:api:lock';
export const BASE_AUDIENCE_CURRENT_SNAPSHOT_KEY = 'notif:base:audience:current';
export const BASE_AUDIENCE_SYNC_STATE_KEY = 'notif:base:audience:sync:state';
export const BASE_AUDIENCE_HISTORY_KEY = 'notif:base:audience:history';
export const BASE_AUDIENCE_SNAPSHOT_PREFIX = 'notif:base:audience:snapshot';

export const NOTIFICATION_CAMPAIGN_INDEX_KEY = 'notif:campaign:list';
export const NOTIFICATION_CAMPAIGN_PREFIX = 'notif:campaign';

export const NEYNAR_ENABLED_FIDS_CACHE_KEY = 'notif:neynar:enabled_fids';
export const NEYNAR_ENABLED_FIDS_CACHE_TTL_SECONDS = 5 * 60;

export function getBaseAudienceSnapshotAddressesKey(snapshotId: string): string {
  return `${BASE_AUDIENCE_SNAPSHOT_PREFIX}:${snapshotId}:addresses`;
}

export function getBaseAudienceSnapshotMetaKey(snapshotId: string): string {
  return `${BASE_AUDIENCE_SNAPSHOT_PREFIX}:${snapshotId}:meta`;
}

export function getPlantCarePrefix(provider: NotificationProvider): string {
  return `notif:${provider}:plant12h`;
}

export function getPlantCareUserThrottleKey(
  provider: NotificationProvider,
  recipient: number | string,
): string {
  const scope = provider === 'base' ? 'wallet' : 'fid';
  return `${getPlantCarePrefix(provider)}:${scope}:${String(recipient).toLowerCase()}`;
}

export function getPlantCarePlantThrottleKey(
  provider: NotificationProvider,
  recipient: number | string,
  plantId: number,
): string {
  return `${getPlantCareUserThrottleKey(provider, recipient)}:plant:${plantId}`;
}

export function getPlantCareLogKey(provider: NotificationProvider): string {
  return `${getPlantCarePrefix(provider)}:log`;
}

export function getPlantCareLastKey(provider: NotificationProvider): string {
  return `${getPlantCarePrefix(provider)}:last`;
}

export function getPlantCareSentCountKey(provider: NotificationProvider): string {
  return `${getPlantCarePrefix(provider)}:sent:count`;
}

export function getPlantCareRunsKey(provider: NotificationProvider): string {
  return `${getPlantCarePrefix(provider)}:runs`;
}

export function getCampaignMetaKey(campaignId: string): string {
  return `${NOTIFICATION_CAMPAIGN_PREFIX}:${campaignId}:meta`;
}

export function getCampaignProgressKey(campaignId: string): string {
  return `${NOTIFICATION_CAMPAIGN_PREFIX}:${campaignId}:progress`;
}

export function getCampaignResultsKey(campaignId: string): string {
  return `${NOTIFICATION_CAMPAIGN_PREFIX}:${campaignId}:results`;
}
