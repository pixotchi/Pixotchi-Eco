import type { AIConversation, AIUsageStats } from '@/lib/types';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function count(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }
function timestamp(value: unknown): value is number { return count(value) && value <= 8.64e15; }

/** Keep version-mismatched API data out of formatters and administrative controls. */
export function parseAdminAiSnapshot(value: unknown): { conversations: AIConversation[]; stats: AIUsageStats | null } | null {
  const data = record(value);
  if (!data || !Array.isArray(data.conversations)) return null;
  const conversations: AIConversation[] = [];
  for (const raw of data.conversations) {
    const item = record(raw);
    if (!item || typeof item.id !== 'string' || typeof item.address !== 'string' || typeof item.title !== 'string'
      || typeof item.model !== 'string' || !timestamp(item.createdAt) || !timestamp(item.lastMessageAt) || !count(item.messageCount) || !count(item.totalTokens)) return null;
    conversations.push({ id: item.id, address: item.address, title: item.title, model: item.model, createdAt: item.createdAt, lastMessageAt: item.lastMessageAt, messageCount: item.messageCount, totalTokens: item.totalTokens });
  }
  let stats: AIUsageStats | null = null;
  if (data.stats != null) {
    const item = record(data.stats);
    if (!item || !count(item.totalConversations) || !count(item.totalMessages) || !count(item.totalTokens) || !count(item.dailyUsage) || !count(item.costEstimate)) return null;
    stats = { totalConversations: item.totalConversations, totalMessages: item.totalMessages, totalTokens: item.totalTokens, dailyUsage: item.dailyUsage, costEstimate: item.costEstimate };
  }
  return { conversations, stats };
}
