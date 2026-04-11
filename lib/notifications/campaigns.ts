import { SERVER_ENV } from '@/lib/env-config';
import {
  acquireBaseApiLock,
  createCampaignMeta,
  getCurrentBaseAudienceAddresses,
  getCurrentBaseAudienceSnapshotMeta,
  releaseBaseApiLock,
  setCampaignProgress,
  setCampaignResults,
  updateCampaignMeta,
  type NotificationCampaignAudienceMode,
  type NotificationCampaignMeta,
} from '@/lib/notifications/storage';
import { BASE_REQUEST_LOCK_TTL_SECONDS } from '@/lib/notifications/constants';
import {
  sendBaseNotificationsInChunks,
  type BaseNotificationChunkedSendError,
} from '@/lib/notifications/base-api';
import {
  normalizeWalletAddress,
  uniqueWalletAddresses,
} from '@/lib/notifications/utils';

export type BaseCampaignInput = {
  title: string;
  message: string;
  targetPath?: string;
  audienceMode: NotificationCampaignAudienceMode;
  walletAddresses?: string[];
  walletAddressInput?: string;
  dryRun?: boolean;
};

export type BaseCampaignResolution = {
  recipients: string[];
  requestedCount: number;
  resolvedCount: number;
  invalidCount: number;
  duplicateCount: number;
  snapshotCount: number | null;
  snapshotMatchedCount: number | null;
  notes: string[];
};

export function normalizeCampaignInput(input: BaseCampaignInput): BaseCampaignInput {
  return {
    ...input,
    title: input.title.trim(),
    message: input.message.trim(),
    targetPath: input.targetPath?.trim() || undefined,
    audienceMode: input.audienceMode,
    walletAddresses: uniqueWalletAddresses(input.walletAddresses || []),
    walletAddressInput: input.walletAddressInput || '',
    dryRun: Boolean(input.dryRun),
  };
}

export async function resolveBaseCampaignRecipients(
  input: BaseCampaignInput,
): Promise<BaseCampaignResolution> {
  const normalized = normalizeCampaignInput(input);
  const snapshotMeta = await getCurrentBaseAudienceSnapshotMeta();
  const snapshotCount = snapshotMeta?.uniqueAddresses ?? null;
  const notes: string[] = [];

  if (normalized.audienceMode === 'all') {
    if (!snapshotMeta) {
      throw new Error('Base audience snapshot missing. Run the audience sync first.');
    }

    const recipients = await getCurrentBaseAudienceAddresses();
    return {
      recipients,
      requestedCount: recipients.length,
      resolvedCount: recipients.length,
      invalidCount: 0,
      duplicateCount: 0,
      snapshotCount,
      snapshotMatchedCount: recipients.length,
      notes,
    };
  }

  const rawValues = [
    ...(input.walletAddresses || []),
    ...String(input.walletAddressInput || '')
      .split(/[\s,;]+/g)
      .filter(Boolean),
  ];
  const rawCount = rawValues.length;
  const normalizedValues = rawValues.map((value) => normalizeWalletAddress(value));
  const validValues = normalizedValues.filter((value): value is string => value !== null);
  const merged = uniqueWalletAddresses(validValues);
  const invalidCount = normalizedValues.filter((value) => value === null).length;
  const duplicateCount = Math.max(validValues.length - merged.length, 0);

  let snapshotMatchedCount: number | null = null;
  if (snapshotMeta) {
    const snapshotSet = new Set(await getCurrentBaseAudienceAddresses());
    snapshotMatchedCount = merged.filter((address) => snapshotSet.has(address)).length;
    if (snapshotMatchedCount !== merged.length) {
      notes.push('Some selected wallets are not currently in the Base enabled-audience snapshot.');
    }
  } else {
    notes.push('No Base audience snapshot is available yet. Selected sends will rely on live Base delivery results.');
  }

  return {
    recipients: merged,
    requestedCount: rawCount,
    resolvedCount: merged.length,
    invalidCount,
    duplicateCount,
    snapshotCount,
    snapshotMatchedCount,
    notes,
  };
}

export async function previewBaseCampaign(input: BaseCampaignInput) {
  const resolution = await resolveBaseCampaignRecipients(input);
  return {
    provider: 'base' as const,
    audienceMode: input.audienceMode,
    title: input.title.trim(),
    message: input.message.trim(),
    targetPath: input.targetPath?.trim() || '/',
    ...resolution,
  };
}

export async function sendBaseCampaign(input: BaseCampaignInput): Promise<{
  campaign: NotificationCampaignMeta;
  preview: BaseCampaignResolution;
  result: Record<string, unknown>;
}> {
  if (SERVER_ENV.NOTIFICATION_PROVIDER !== 'base') {
    throw new Error('Base campaigns are only available when the Base provider is active.');
  }

  const normalized = normalizeCampaignInput(input);
  const preview = await resolveBaseCampaignRecipients(normalized);

  if (preview.recipients.length === 0) {
    throw new Error('No valid recipient wallets were provided.');
  }

  const campaign = await createCampaignMeta({
    provider: 'base',
    status: normalized.dryRun ? 'dry_run' : 'running',
    audienceMode: normalized.audienceMode,
    title: normalized.title,
    message: normalized.message,
    targetPath: normalized.targetPath,
    requestedCount: preview.requestedCount,
    resolvedCount: preview.resolvedCount,
    dryRun: Boolean(normalized.dryRun),
    notes: preview.notes,
  });

  if (normalized.dryRun) {
    const result = {
      preview,
      sentCount: 0,
      failedCount: 0,
      batches: [],
      failures: [],
    };

    await setCampaignResults(campaign.id, result);
    const finalized = await updateCampaignMeta(campaign.id, {
      status: 'dry_run',
      finishedAt: new Date().toISOString(),
    });

    return {
      campaign: finalized || campaign,
      preview,
      result,
    };
  }

  const lockOwner = `base-campaign:${campaign.id}`;
  const lockAcquired = await acquireBaseApiLock(lockOwner, BASE_REQUEST_LOCK_TTL_SECONDS);
  if (!lockAcquired) {
    await updateCampaignMeta(campaign.id, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      notes: [...(campaign.notes || []), 'Base notifications API was busy with another sync or send job.'],
    });
    throw new Error('Base notifications API is busy with another sync or send job.');
  }

  try {
    await setCampaignProgress(campaign.id, {
      processedBatches: 0,
      totalBatches: Math.max(1, Math.ceil(preview.recipients.length / 1000)),
      lastBatchAt: null,
    });

    const response = await sendBaseNotificationsInChunks({
      addresses: preview.recipients,
      title: normalized.title,
      message: normalized.message,
      targetPath: normalized.targetPath,
      onBatchComplete: async (batch) => {
        await setCampaignProgress(campaign.id, {
          processedBatches: batch.batchIndex + 1,
          totalBatches: Math.max(1, Math.ceil(preview.recipients.length / 1000)),
          lastBatchAt: new Date().toISOString(),
        });
      },
    });

    const result = {
      preview,
      ...response,
    };

    await setCampaignResults(campaign.id, result);
    const finalized = await updateCampaignMeta(campaign.id, {
      status: response.failedCount > 0 ? 'completed_with_failures' : 'completed',
      sentCount: response.sentCount,
      failedCount: response.failedCount,
      finishedAt: new Date().toISOString(),
      notes:
        response.prunedSnapshotCount > 0
          ? [
              ...(campaign.notes || []),
              `Pruned ${response.prunedSnapshotCount} stale wallet(s) from the current Base audience snapshot after delivery failures.`,
            ]
          : campaign.notes,
    });

    return {
      campaign: finalized || campaign,
      preview,
      result,
    };
  } catch (error) {
    const partialResponse =
      typeof error === 'object' && error && 'partialResponse' in error
        ? (error as BaseNotificationChunkedSendError).partialResponse
        : undefined;

    if (partialResponse) {
      await setCampaignResults(campaign.id, {
        preview,
        ...partialResponse,
        fatalError: error instanceof Error ? error.message : 'send_failed',
      });
    }

    await updateCampaignMeta(campaign.id, {
      status: 'failed',
      sentCount: partialResponse?.sentCount ?? 0,
      failedCount: partialResponse?.failedCount ?? 0,
      finishedAt: new Date().toISOString(),
      notes: [
        ...(campaign.notes || []),
        error instanceof Error ? error.message : 'send_failed',
        ...(partialResponse?.prunedSnapshotCount
          ? [`Pruned ${partialResponse.prunedSnapshotCount} stale wallet(s) from the current Base audience snapshot after delivery failures.`]
          : []),
      ],
    });
    throw error;
  } finally {
    await releaseBaseApiLock(lockOwner);
  }
}
