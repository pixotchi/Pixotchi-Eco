import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import { requireAdmin, createErrorResponse } from '@/lib/auth-utils';
import { SERVER_ENV } from '@/lib/env-config';
import {
  getBaseAudienceSyncState,
  getCurrentBaseAudienceSnapshotMeta,
  getPlantCareStats,
  listBaseAudienceHistory,
  listCampaigns,
} from '@/lib/notifications/storage';

function parseList(raw: string[] | null) {
  return (raw || []).map((entry: string) => {
    try {
      return JSON.parse(entry);
    } catch {
      return entry;
    }
  });
}

export async function GET(request: NextRequest) {
  const adminDenied = await requireAdmin(request);
  if (adminDenied) return adminDenied;

  try {
    const provider = SERVER_ENV.NOTIFICATION_PROVIDER;
    const plantCare = await getPlantCareStats(provider);

    if (provider === 'base') {
      const [syncState, currentSnapshot, history, campaigns] = await Promise.all([
        getBaseAudienceSyncState(),
        getCurrentBaseAudienceSnapshotMeta(),
        listBaseAudienceHistory(10),
        listCampaigns(10),
      ]);

      return NextResponse.json({
        success: true,
        provider,
        stats: {
          plantTOD: {
            thresholdHours: 12,
            sentCount: plantCare.sentCount,
            lastRun: plantCare.lastRun,
            recent: plantCare.recent,
            totalRuns: plantCare.totalRuns,
          },
          audience: {
            currentSnapshot,
            syncState,
            history,
            enabledCount: currentSnapshot?.uniqueAddresses || 0,
          },
          campaigns: {
            recent: campaigns,
          },
        },
        endpoints: {
          audienceSync: '/api/notifications/cron/base-audience-sync - Refresh enabled Base wallet snapshot',
          campaigns: '/api/admin/notifications/campaigns - List recent Base campaigns',
          campaignPreview: '/api/admin/notifications/campaigns/preview - Preview Base campaign recipients',
          campaignSend: '/api/admin/notifications/campaigns/send - Send Base campaign',
          keys: '/api/admin/notifications/keys - View and delete notification Redis keys',
          reset: '/api/admin/notifications/reset - Reset notification stats/throttles',
        },
      });
    }

    const [eligibleSet, globalRecentRaw, globalSentCountRaw] = await Promise.all([
      redis?.smembers?.('notif:eligible:fids'),
      (redis as UntypedValue)?.lrange?.('notif:global:log', 0, 20),
      redis?.get?.('notif:global:sentCount'),
    ]);

    return NextResponse.json({
      success: true,
      provider,
      stats: {
        plantTOD: {
          thresholdHours: 12,
          sentCount: plantCare.sentCount,
          lastRun: plantCare.lastRun,
          recent: plantCare.recent,
          totalRuns: plantCare.totalRuns,
        },
        global: {
          sentCount: Number(globalSentCountRaw || 0),
          recent: parseList(globalRecentRaw || []),
        },
        eligibleFids: eligibleSet || [],
        eligibleFidsCount: eligibleSet?.length || 0,
      },
      endpoints: {
        eligible: '/api/admin/notifications/eligible - List plants eligible for notification',
        trigger: '/api/admin/notifications/trigger - Manually trigger notifications',
        keys: '/api/admin/notifications/keys - View and delete notification Redis keys',
        reset: '/api/admin/notifications/reset - Reset notification throttle keys',
      },
    });
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'Failed', 500).body,
      { status: 500 },
    );
  }
}
