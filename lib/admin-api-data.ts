import { z } from 'zod';

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const amount = z.number().nonnegative();
const timestamp = z.number().nonnegative().max(8.64e15);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/).refine(value => Number.isFinite(Number(value)));

/** Parse service JSON before it reaches date/amount formatters or action IDs. */
function parser<T>(schema: z.ZodType<T>) {
  return (value: unknown): T | null => {
    const result = schema.safeParse(value);
    return result.success ? result.data : null;
  };
}

const broadcast = z.object({
  id: z.string().min(1), content: z.string(), title: z.string().optional(),
  createdAt: timestamp, expiresAt: timestamp.optional(), createdBy: z.string(),
  priority: z.enum(['low', 'normal', 'high']), type: z.enum(['info', 'warning', 'success', 'announcement']),
  dismissible: z.boolean(), action: z.object({ label: z.string(), url: z.string() }).optional(),
  stats: z.object({ impressions: count, dismissals: count }),
});
const broadcastSnapshot = z.object({
  messages: z.array(broadcast),
  stats: z.object({ totalMessages: count, totalImpressions: count, totalDismissals: count }),
});
export type AdminBroadcastSnapshot = z.infer<typeof broadcastSnapshot>;
export const parseAdminBroadcast = parser(broadcastSnapshot);

const requirements = z.object({ total: amount, remaining: amount });
const airdropSnapshot = z.object({
  meta: z.object({
    uploadedAt: timestamp.optional(), totalRecipients: count, claimedCount: count,
    serverWallet: address,
    balances: z.object({ seed: decimal, leaf: decimal, pixotchi: decimal }),
    requirements: z.object({ seed: requirements, leaf: requirements, pixotchi: requirements }),
  }),
  recipients: z.array(z.object({ address, seed: decimal, leaf: decimal, pixotchi: decimal, claimed: z.boolean() })),
});
export type AdminAirdropSnapshot = z.infer<typeof airdropSnapshot>;
export const parseAdminAirdrop = parser(airdropSnapshot);

const claimsSnapshot = z.object({
  stats: z.object({ total: count, complete: count, partial: count, failed: count, leafBonusSent: count, seedBonusSent: count }),
  claims: z.array(z.object({
    address, tokenId: z.union([count, z.string().regex(/^\d+$/)]).nullish(), strainId: count.nullish(), status: z.string().min(1),
    leafBonusSent: z.boolean().optional(), seedBonusSent: z.boolean().optional(),
  })),
});
export type AdminClaimsSnapshot = z.infer<typeof claimsSnapshot>;
export const parseAdminClaims = parser(claimsSnapshot);

const operationResponse = z.object({
  success: z.boolean().optional(), error: z.string().optional(), message: z.string().optional(),
  cleaned: count.optional(), deletedKeys: count.optional(), deletedCount: count.optional(),
  deleted: z.union([count, z.object({ walletClaims: count, verifiedClaims: count })]).optional(),
  totalRecipients: count.optional(), validCount: count.optional(), invalidCount: count.optional(),
  added: count.optional(), updated: count.optional(),
  updatedCount: count.optional(), createdCount: count.optional(), protectedCount: count.optional(), conflictCount: count.optional(),
  errors: z.array(z.string()).optional(), validationErrors: z.array(z.string()).optional(),
});
export const parseAdminOperation = parser(operationResponse);
export function adminApiError(value: unknown, fallback: string): string {
  return parseAdminOperation(value)?.error || fallback;
}

const chatMessage = z.object({
  id: z.string().min(1), address: z.string(), message: z.string(), timestamp,
  displayName: z.string(), isSpam: z.boolean().optional(), similarCount: count.optional(),
});
export const parseAdminChat = parser(z.object({
  messages: z.array(chatMessage), stats: z.object({ totalMessages: count, activeUsers: count, messagesLast24h: count }),
}));
export const parseAdminAiMessages = parser(z.object({
  messages: z.array(chatMessage.omit({ isSpam: true, similarCount: true }).extend({
    conversationId: z.string().min(1), type: z.enum(['user', 'assistant']), model: z.string(),
    tokensUsed: count.optional(), outputTokens: count.optional(), continuations: count.optional(),
    provider: z.string().optional(), finishReason: z.string().optional(), recoveredFromLength: z.boolean().optional(),
    toolCalls: z.array(z.object({
      toolName: z.string(), status: z.enum(['ok', 'error', 'unknown']), source: z.string().optional(), error: z.string().optional(),
      input: z.unknown().optional(), freshness: z.object({ blockNumber: z.string().optional(), cache: z.string().optional(), fetchedAt: z.string().optional() }).optional(),
    })).optional(),
  }))
}));
const feedbackSnapshot = z.object({
  feedback: z.array(z.object({
    id: z.string().min(1), address: z.string(), username: z.string().optional(), message: z.string(), createdAt: timestamp,
    walletType: z.string().optional(), isSmartWallet: z.boolean().optional(), isMiniApp: z.boolean().optional(),
  // Optional user-supplied profile hints must not hide otherwise valid moderation records.
  farcasterDetails: z.object({
    fid: count.optional().catch(undefined), username: z.string().optional().catch(undefined), displayName: z.string().optional().catch(undefined),
  }).nullish().catch(null).transform(details => details && (details.fid !== undefined || details.username || details.displayName) ? details : null),
  }))
});
export const parseAdminFeedback = parser(feedbackSnapshot);
export type AdminFeedbackSnapshot = z.infer<typeof feedbackSnapshot>;

const rpcEndpoint = z.object({
  url: z.string(), vendor: z.string().optional(), rank: count.optional(), ok: z.boolean(), ms: amount,
  error: z.string().optional(), successCount: count, failureCount: count, ewmaLatencyMs: amount.nullable(),
  coolingDown: z.boolean().optional(), readCoolingDown: z.boolean().optional(), receiptCoolingDown: z.boolean().optional(),
  logCoolingDown: z.boolean().optional(), probeCoolingDown: z.boolean().optional(),
  readConsecutiveFailures: count.optional(), readOpenUntilAt: timestamp.nullish(),
  readHealthy: z.boolean().optional(), receiptHealthy: z.boolean().optional(), logHealthy: z.boolean().optional(), probeHealthy: z.boolean().optional(),
});
export const parseAdminRpc = parser(z.object({
  endpoints: z.array(rpcEndpoint), summary: z.object({
    total: count, healthy: count, degraded: count, coolingDown: count, avgLatencyMs: amount.nullable(),
    liveSuccessCount: count, liveFailureCount: count,
  }),
}));
export const parseAdminLeaderboards = parser(z.object({
  streakTop: z.array(z.object({ address, value: count })), missionTop: z.array(z.object({ address, value: count })),
}));
export const parseAdminShare = parser(z.object({
  shortUrl: z.string().refine(value => {
    try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
  })
}));
