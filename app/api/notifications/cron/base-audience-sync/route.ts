import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAdminKey } from '@/lib/auth-utils';
import { fetchBaseNotificationUsers, isBaseNotificationsConfigured } from '@/lib/notifications/base-api';
import {
  BASE_AUDIENCE_SYNC_EXECUTION_HEADROOM_MS,
  BASE_AUDIENCE_SYNC_SAFE_MAX_DURATION_SECONDS,
  BASE_REQUEST_INTERVAL_MS,
  BASE_REQUEST_LOCK_TTL_SECONDS,
  BASE_AUDIENCE_PAGE_SIZE,
} from '@/lib/notifications/constants';
import {
  acquireBaseApiLock,
  addBaseAudienceAddresses,
  createBaseAudienceSyncState,
  deleteBaseAudienceSnapshot,
  finalizeBaseAudienceSnapshot,
  getBaseAudienceCurrentSnapshotId,
  getBaseAudienceSyncState,
  getCurrentBaseAudienceSnapshotMeta,
  listBaseAudienceHistory,
  releaseBaseApiLock,
  setBaseAudienceSyncState,
} from '@/lib/notifications/storage';
import { SERVER_ENV } from '@/lib/env-config';
import { sleep, uniqueWalletAddresses } from '@/lib/notifications/utils';
import { verifyVercelCron } from '@/lib/notifications/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

const QuerySchema = z.object({
  force: z.stringbool().optional(),
});

function parsePositiveInteger(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getExecutionBudgetMs(): { value: number; source: 'explicit_budget' | 'max_duration' | 'default_safe' } {
  const explicitBudgetMs = parsePositiveInteger(SERVER_ENV.BASE_AUDIENCE_SYNC_EXECUTION_BUDGET_MS);
  if (explicitBudgetMs) {
    return {
      value: explicitBudgetMs,
      source: 'explicit_budget',
    };
  }

  const configuredMaxDurationSeconds =
    parsePositiveInteger(SERVER_ENV.BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS) ||
    BASE_AUDIENCE_SYNC_SAFE_MAX_DURATION_SECONDS;

  if (SERVER_ENV.BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS) {
    return {
      value: Math.max(30_000, configuredMaxDurationSeconds * 1000 - BASE_AUDIENCE_SYNC_EXECUTION_HEADROOM_MS),
      source: 'max_duration',
    };
  }

  return {
    value: Math.max(
      30_000,
      BASE_AUDIENCE_SYNC_SAFE_MAX_DURATION_SECONDS * 1000 - BASE_AUDIENCE_SYNC_EXECUTION_HEADROOM_MS,
    ),
    source: 'default_safe',
  };
}

async function maybeDeleteStagingSnapshot(snapshotId: string): Promise<void> {
  const currentSnapshotId = await getBaseAudienceCurrentSnapshotId();
  if (currentSnapshotId !== snapshotId) {
    await deleteBaseAudienceSnapshot(snapshotId);
  }
}

async function handleRequest(req: NextRequest): Promise<NextResponse> {
  const isAdmin = validateAdminKey(req);
  const isCron = verifyVercelCron(req);

  if (!isAdmin && !isCron) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'base') {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: 'Notification provider is not Base',
    });
  }

  if (!isBaseNotificationsConfigured()) {
    return NextResponse.json({
      success: false,
      error: 'Base notifications configuration missing',
    }, { status: 503 });
  }

  const url = new URL(req.url);
  const query = QuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  const force = query.success ? (query.data.force ?? false) : false;
  const trigger = isAdmin ? 'admin' : 'cron';
  const lockOwner = `base-audience-sync:${Date.now()}`;
  const executionBudget = getExecutionBudgetMs();

  const lockAcquired = await acquireBaseApiLock(lockOwner, BASE_REQUEST_LOCK_TTL_SECONDS);
  if (!lockAcquired) {
    return NextResponse.json({
      success: false,
      error: 'Base notifications API is busy with another sync or send job',
      state: await getBaseAudienceSyncState(),
      snapshot: await getCurrentBaseAudienceSnapshotMeta(),
      executionBudgetMs: executionBudget.value,
      executionBudgetSource: executionBudget.source,
    }, { status: 409 });
  }

  const startedAtMs = Date.now();

  try {
    let state = await getBaseAudienceSyncState();
    if (force || !state || state.status !== 'running') {
      if (state) {
        await maybeDeleteStagingSnapshot(state.id);
      }
      state = await createBaseAudienceSyncState(trigger);
    }

    while (Date.now() - startedAtMs < executionBudget.value) {
      let page;
      try {
        page = await fetchBaseNotificationUsers({
          cursor: state.cursor,
          limit: BASE_AUDIENCE_PAGE_SIZE,
          notificationEnabled: true,
        });
      } catch (error) {
        const status =
          typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined;
        if (status !== 429) {
          throw error;
        }

        state = {
          ...state,
          rateLimitedCount: state.rateLimitedCount + 1,
          error: 'Rate limited while syncing Base audience. Retrying.',
        };
        await setBaseAudienceSyncState(state);
        await sleep(BASE_REQUEST_INTERVAL_MS * 2);
        continue;
      }

      const addresses = uniqueWalletAddresses(page.users.map((user) => user.address));
      const uniqueAddresses = await addBaseAudienceAddresses(state.id, addresses);

      state = {
        ...state,
        trigger,
        status: 'running',
        pagesFetched: state.pagesFetched + 1,
        usersFetched: state.usersFetched + page.users.length,
        uniqueAddresses,
        cursor: page.nextCursor,
        lastPageAt: new Date().toISOString(),
        error: null,
      };

      await setBaseAudienceSyncState(state);

      if (!page.nextCursor) {
        const snapshot = await finalizeBaseAudienceSnapshot(state);
        const completedState = {
          ...state,
          status: 'completed' as const,
          finishedAt: snapshot.completedAt,
          cursor: null,
          uniqueAddresses: snapshot.uniqueAddresses,
        };
        await setBaseAudienceSyncState(completedState);

        return NextResponse.json({
          success: true,
          completed: true,
          state: completedState,
          snapshot,
          history: await listBaseAudienceHistory(10),
          executionBudgetMs: executionBudget.value,
          executionBudgetSource: executionBudget.source,
          requestedMaxDurationSeconds: SERVER_ENV.BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS || null,
        });
      }

      if (Date.now() - startedAtMs >= executionBudget.value) {
        break;
      }

      await sleep(BASE_REQUEST_INTERVAL_MS);
    }

    return NextResponse.json({
      success: true,
      completed: false,
      state,
      snapshot: await getCurrentBaseAudienceSnapshotMeta(),
      history: await listBaseAudienceHistory(10),
      executionBudgetMs: executionBudget.value,
      executionBudgetSource: executionBudget.source,
      requestedMaxDurationSeconds: SERVER_ENV.BASE_AUDIENCE_SYNC_MAX_DURATION_SECONDS || null,
    });
  } catch (error) {
    const state = await getBaseAudienceSyncState();
    if (state) {
      await setBaseAudienceSyncState({
        ...state,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'sync_failed',
      });
    }

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'sync_failed',
      state: await getBaseAudienceSyncState(),
      snapshot: await getCurrentBaseAudienceSnapshotMeta(),
      executionBudgetMs: executionBudget.value,
      executionBudgetSource: executionBudget.source,
    }, { status: 500 });
  } finally {
    await releaseBaseApiLock(lockOwner);
  }
}

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handleRequest(req);
}
