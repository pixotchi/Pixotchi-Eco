import { z } from 'zod';

export type AdminNotificationProvider = 'neynar' | 'base';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fid = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const fidText = z.string().regex(/^[1-9]\d*$/).refine(value => Number.isSafeInteger(Number(value)));
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const dateText = z.string().refine(value => Number.isFinite(Date.parse(value)));
const nonempty = z.string().refine(value => value.trim().length > 0);
const success = z.object({ success: z.literal(true) });

const plantStats = z.object({
  sentCount: count,
  thresholdHours: z.number().positive(),
  totalRuns: count,
  // These are rendered only as JSON, including older stored log formats.
  recent: z.array(z.unknown()),
  lastRun: z.unknown(),
});
const globalStats = z.object({ sentCount: count, recent: z.array(z.unknown()) });
const snapshot = z.object({
  id: nonempty,
  uniqueAddresses: count,
  pagesFetched: count,
  completedAt: dateText,
});
const audience = z.object({
  enabledCount: count,
  currentSnapshot: snapshot.nullable(),
  history: z.array(snapshot),
  syncState: z.unknown(),
});
const campaign = z.object({
  id: nonempty,
  title: z.string(),
  message: z.string(),
  status: z.enum(['draft', 'dry_run', 'running', 'completed', 'completed_with_failures', 'failed']),
  audienceMode: z.enum(['all', 'selected']),
  requestedCount: count,
  resolvedCount: count,
  sentCount: count,
  failedCount: count,
  updatedAt: dateText,
});
const notificationStats = success.extend({
  provider: z.enum(['neynar', 'base']).optional(),
  stats: z.object({
    plantTOD: plantStats,
    global: globalStats.optional(),
    eligibleFids: z.array(fidText).optional(),
    audience: audience.optional(),
    campaigns: z.object({ recent: z.array(campaign) }).optional(),
  }),
});

const plant = z.object({
  id: count,
  hoursLeft: z.number().nonnegative(),
  // Missing throttle information must never make a recipient sendable.
  throttled: z.boolean().default(true),
});
const recipient = z.object({
  userThrottled: z.boolean(),
  plants: z.array(plant),
});
const eligibleSummary = z.object({
  totalEligiblePlants: count,
  throttledUsers: count,
  wouldNotify: count,
});
const neynarEligible = success.extend({
  provider: z.literal('neynar').default('neynar'),
  summary: eligibleSummary.extend({ fidsWithEligiblePlants: count }),
  eligible: z.array(recipient.extend({ fid, address: address.optional() })),
});
const baseEligible = success.extend({
  provider: z.literal('base').default('base'),
  summary: eligibleSummary.extend({ addressesWithEligiblePlants: count }),
  eligible: z.array(recipient.extend({ address })),
});

const notificationKey = z.object({ key: nonempty, type: nonempty, ttl: z.number().int().min(-2).nullable(), value: z.unknown() });
const notificationKeys = success.extend({
  totalKeys: count,
  returnedKeys: count,
  grouped: z.record(z.string(), z.array(notificationKey)),
});
const keyDeletion = success.extend({ deletedCount: count });
const resolution = z.object({
  recipients: z.array(address),
  requestedCount: count,
  resolvedCount: count,
  snapshotCount: count.nullable(),
  snapshotMatchedCount: count.nullable(),
  notes: z.array(z.string()),
}).refine(value => value.recipients.length === value.resolvedCount, 'Recipient count does not match preview');
const campaignPreview = success.extend({ preview: resolution });
const campaignResult = success.extend({
  campaign,
  preview: resolution,
  result: z.object({ sentCount: count, failedCount: count }),
});
const outcome = success.extend({ completed: z.boolean().optional(), skipped: z.boolean().optional() });
const syncOutcome = outcome.refine(value => typeof value.completed === 'boolean' || value.skipped === true);
const triggerOutcome = success.extend({ fid, sent: z.boolean().optional(), dryRun: z.boolean().optional() })
  .refine(value => value.sent === true || value.dryRun === true);

export type PlantNotificationStats = z.infer<typeof plantStats>;
export type GlobalNotificationStats = z.infer<typeof globalStats>;
export type BaseNotificationAudience = z.infer<typeof audience>;
export type BaseNotificationCampaign = z.infer<typeof campaign>;
export type EligibleNotificationPlants = z.infer<typeof neynarEligible> | z.infer<typeof baseEligible>;
export type NotificationKeys = z.infer<typeof notificationKeys>;
export type BaseNotificationPreview = z.infer<typeof resolution>;

function parse<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid ${label} response. Please retry.`);
  return parsed.data;
}

export function parseNotificationStats(value: unknown, provider: AdminNotificationProvider) {
  const result = parse(notificationStats, value, 'notification stats');
  if (result.provider !== undefined && result.provider !== provider) throw new Error('Notification provider changed. Refresh the page and retry.');
  if (provider === 'base' ? !result.stats.audience || !result.stats.campaigns : !result.stats.global || !result.stats.eligibleFids) {
    throw new Error('Invalid notification stats response. Please retry.');
  }
  return result;
}

export function parseEligiblePlants(value: unknown, provider: AdminNotificationProvider): EligibleNotificationPlants {
  return provider === 'base' ? parse(baseEligible, value, 'eligible plants') : parse(neynarEligible, value, 'eligible plants');
}
export const parseNotificationKeys = (value: unknown) => parse(notificationKeys, value, 'notification keys');
export const parseNotificationKeyDeletion = (value: unknown) => parse(keyDeletion, value, 'notification deletion');
export const parseBaseCampaignPreview = (value: unknown) => parse(campaignPreview, value, 'campaign preview').preview;
export const parseBaseCampaignResult = (value: unknown) => ({ ...parse(campaignResult, value, 'campaign result'), raw: value });
export function parseNotificationOutcome(value: unknown, kind: 'debug' | 'sync' | 'trigger' | 'reset' = 'debug') {
  const metadata = parse(kind === 'sync' ? syncOutcome : outcome, value, `${kind} outcome`);
  if (kind === 'trigger') parse(triggerOutcome, value, 'trigger outcome');
  if (kind === 'reset') parse(keyDeletion, value, 'reset outcome');
  return { ...metadata, raw: value };
}

export function getNotificationResponseError(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string' && value.error.trim()) return value.error;
  return fallback;
}

export async function readNotificationResponse<T>(response: Response, parser: (value: unknown) => T, fallback: string): Promise<T> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new Error(response.ok ? `Invalid JSON response. ${fallback}` : `${fallback} (HTTP ${response.status})`);
  }
  if (!response.ok || (typeof value === 'object' && value !== null && 'success' in value && value.success === false)) {
    throw new Error(getNotificationResponseError(value, `${fallback} (HTTP ${response.status})`));
  }
  return parser(value);
}
