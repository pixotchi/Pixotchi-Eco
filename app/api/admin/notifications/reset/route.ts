import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAdmin, createErrorResponse } from '@/lib/auth-utils';
import { SERVER_ENV } from '@/lib/env-config';
import {
  clearBaseApiLock,
  deleteBaseAudienceSnapshot,
  getBaseAudienceCurrentSnapshotId,
  getBaseAudienceSyncState,
} from '@/lib/notifications/storage';
import {
  BASE_AUDIENCE_HISTORY_KEY,
  BASE_AUDIENCE_SYNC_STATE_KEY,
  NOTIFICATION_CAMPAIGN_INDEX_KEY,
  getPlantCareLastKey,
  getPlantCareLogKey,
  getPlantCareRunsKey,
  getPlantCareSentCountKey,
  getPlantCareUserThrottleKey,
} from '@/lib/notifications/constants';
import type { NotificationProvider } from '@/lib/notifications/provider';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function scanAndDelete(pattern: string): Promise<number> {
  if (!redis) return 0;

  let deleted = 0;
  let cursor = 0;

  do {
    const resp: UntypedValue = await (redis as UntypedValue).scan(cursor, { match: pattern, count: 100 });
    if (!Array.isArray(resp)) {
      break;
    }

    cursor = typeof resp[0] === 'string' ? Number.parseInt(resp[0], 10) : resp[0];
    const keys: string[] = (resp[1] || []) as string[];

    for (const key of keys) {
      await redis.del(key);
      deleted += 1;
    }
  } while (cursor !== 0);

  return deleted;
}

async function clearProviderPlantCare(provider: NotificationProvider): Promise<number> {
  if (!redis) return 0;

  let deleted = 0;
  const keys = [
    getPlantCareLogKey(provider),
    getPlantCareLastKey(provider),
    getPlantCareSentCountKey(provider),
    getPlantCareRunsKey(provider),
  ];

  for (const key of keys) {
    await redis.del(key);
    deleted += 1;
  }

  deleted += await scanAndDelete(provider === 'base' ? 'notif:base:plant12h:wallet:*' : 'notif:neynar:plant12h:fid:*');
  return deleted;
}

async function clearBaseCampaigns(): Promise<number> {
  if (!redis) return 0;

  let deleted = 0;
  deleted += await scanAndDelete('notif:campaign:*');
  await redis.del(NOTIFICATION_CAMPAIGN_INDEX_KEY);
  deleted += 1;
  return deleted;
}

export async function DELETE(req: NextRequest) {
  const adminDenied = await requireAdmin(req);
  if (adminDenied) return adminDenied;

  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get('scope') || 'all';
    const provider = (url.searchParams.get('provider') || SERVER_ENV.NOTIFICATION_PROVIDER) as NotificationProvider | 'all';
    const fid = url.searchParams.get('fid');
    const address = url.searchParams.get('address');
    const plantId = url.searchParams.get('plantId');

    let deletedCount = 0;

    if (scope === 'all') {
      const providers: NotificationProvider[] =
        provider === 'all' ? ['neynar', 'base'] : [provider];

      for (const currentProvider of providers) {
        deletedCount += await clearProviderPlantCare(currentProvider);
      }

      if (providers.includes('base')) {
        deletedCount += await clearBaseCampaigns();
        const syncState = await getBaseAudienceSyncState();
        const currentSnapshotId = await getBaseAudienceCurrentSnapshotId();
        if (syncState?.id && syncState.id !== currentSnapshotId) {
          await deleteBaseAudienceSnapshot(syncState.id);
          deletedCount += 2;
        }
        await redis?.del(BASE_AUDIENCE_SYNC_STATE_KEY);
        await redis?.del(BASE_AUDIENCE_HISTORY_KEY);
        await clearBaseApiLock();
        deletedCount += 3;
      }
    } else if ((scope === 'fid' || scope === 'recipient') && fid) {
      await redis?.del(getPlantCareUserThrottleKey('neynar', fid));
      deletedCount += 1;
      deletedCount += await scanAndDelete(`notif:neynar:plant12h:fid:${fid}:plant:*`);
    } else if ((scope === 'address' || scope === 'recipient') && address) {
      await redis?.del(getPlantCareUserThrottleKey('base', address));
      deletedCount += 1;
      deletedCount += await scanAndDelete(`notif:base:plant12h:wallet:${String(address).toLowerCase()}:plant:*`);
    } else if (scope === 'plant' && plantId && (fid || address)) {
      if (fid) {
        await redis?.del(`notif:neynar:plant12h:fid:${fid}:plant:${plantId}`);
      }
      if (address) {
        await redis?.del(`notif:base:plant12h:wallet:${String(address).toLowerCase()}:plant:${plantId}`);
      }
      deletedCount += 1;
    } else {
      return NextResponse.json({
        success: false,
        error: 'Invalid scope or missing params',
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      deletedCount,
      scope,
      provider,
    });
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'reset_failed', 500).body,
      { status: 500 },
    );
  }
}
