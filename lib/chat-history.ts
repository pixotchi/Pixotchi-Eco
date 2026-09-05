import { readBoolean, readRecord, readSafeUint } from './contract-value';
import type { AIChatMessage, AIToolCallTrace, ChatMessage } from './types';

function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid message text');
  return value;
}
function optionalString(value: unknown): string | undefined { return value === undefined ? undefined : string(value); }
function optionalCount(value: unknown): number | undefined { return value === undefined ? undefined : readSafeUint(value); }

export function parseChatMessage(value: unknown): ChatMessage {
  const message = readRecord(value);
  const id = string(message.id);
  const address = string(message.address);
  if (!id || !address) throw new Error('Missing message identity');
  return { id, address, message: string(message.message), displayName: string(message.displayName), timestamp: readSafeUint(message.timestamp, 8_640_000_000_000_000) };
}
function toolTrace(value: unknown): AIToolCallTrace {
  const trace = readRecord(value);
  if (trace.status !== 'ok' && trace.status !== 'error' && trace.status !== 'unknown') throw new Error('Invalid tool status');
  const freshness = trace.freshness === undefined ? undefined : readRecord(trace.freshness);
  return { toolName: string(trace.toolName), status: trace.status, source: optionalString(trace.source), error: optionalString(trace.error), input: trace.input,
    freshness: freshness ? { blockNumber: optionalString(freshness.blockNumber), cache: optionalString(freshness.cache), fetchedAt: optionalString(freshness.fetchedAt) } : undefined };
}
function parseAIMessage(value: unknown): AIChatMessage {
  const message = readRecord(value);
  if (message.type !== 'user' && message.type !== 'assistant') throw new Error('Invalid message role');
  if (message.toolCalls !== undefined && !Array.isArray(message.toolCalls)) throw new Error('Invalid tool history');
  return { ...parseChatMessage(value), type: message.type, conversationId: string(message.conversationId), model: string(message.model),
    continuations: optionalCount(message.continuations), outputTokens: optionalCount(message.outputTokens), tokensUsed: optionalCount(message.tokensUsed),
    provider: optionalString(message.provider), finishReason: optionalString(message.finishReason),
    recoveredFromLength: message.recoveredFromLength === undefined ? undefined : readBoolean(message.recoveredFromLength),
    toolCalls: message.toolCalls?.map(toolTrace) };
}
function messageList(value: unknown): unknown[] {
  const response = readRecord(value);
  if (!Array.isArray(response.messages)) throw new Error('Invalid message history');
  return response.messages;
}
export function parsePublicChatHistory(value: unknown): ChatMessage[] { return messageList(value).map(parseChatMessage); }
export function parseAIChatHistory(value: unknown): { messages: AIChatMessage[]; conversationId: string } {
  const conversationId = string(readRecord(value).conversationId);
  if (!conversationId) throw new Error('Missing conversation identity');
  const messages = messageList(value).map(parseAIMessage);
  if (messages.some(message => message.conversationId !== conversationId)) throw new Error('History belongs to another conversation');
  return { messages, conversationId };
}
/** Polling cannot erase a locally pending send before the server echoes it. */
export function mergePublicHistory<T extends { id: string }>(server: T[], cached: readonly T[]): T[] {
  const serverIds = new Set(server.map(message => message.id));
  return [...server, ...cached.filter(message => message.id.startsWith('optimistic-') && !serverIds.has(message.id))];
}
