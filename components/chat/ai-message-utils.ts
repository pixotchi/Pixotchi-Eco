import type { UIMessage } from 'ai';

import { AIChatMessage } from '@/lib/types';

/*
 * Shared AI-message shapes and pure converters.
 *
 * This module exists so ChatProvider (mounted at the root for every user) can
 * type and convert AI messages WITHOUT a runtime dependency on the AI SDK: the
 * only 'ai' import here is type-only, which the compiler erases. The runtime
 * SDK (useChat + DefaultChatTransport, ~200KB of initial JS when it lived in
 * chat-context) is confined to ai-chat-engine.tsx, which is dynamically
 * imported the first time the chat dialog opens.
 */
export type AIMessageMetadata = {
  address?: string;
  continuations?: number;
  conversationId?: string;
  displayName?: string;
  finishReason?: string;
  model?: string;
  persistedMessageId?: string;
  provider?: string;
  recoveredFromLength?: boolean;
  timestamp?: number;
  tokensUsed?: number;
  toolCalls?: AIChatMessage['toolCalls'];
};
export type AIUIMessage = UIMessage<AIMessageMetadata>;

export function getAIUIMessageText(message: AIUIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function storedAIMessageToUIMessage(message: AIChatMessage): AIUIMessage {
  return {
    id: message.id,
    metadata: {
      address: message.address,
      continuations: message.continuations,
      conversationId: message.conversationId,
      displayName: message.displayName,
      finishReason: message.finishReason,
      model: message.model,
      persistedMessageId: message.id,
      provider: message.provider,
      recoveredFromLength: message.recoveredFromLength,
      timestamp: message.timestamp,
      tokensUsed: message.tokensUsed,
      toolCalls: message.toolCalls,
    },
    parts: [
      {
        text: message.message,
        type: 'text',
      },
    ],
    role: message.type === 'user' ? 'user' : 'assistant',
  };
}

export function uiMessageToAIChatMessage(
  message: AIUIMessage,
  fallbackAddress: string | null,
  fallbackConversationId: string | null,
): AIChatMessage | null {
  const text = getAIUIMessageText(message);
  if (!text.trim()) {
    return null;
  }

  const metadata = message.metadata || {};
  const type = message.role === 'assistant' ? 'assistant' : 'user';

  return {
    address: metadata.address || fallbackAddress || '0x0000000000000000000000000000000000000000',
    continuations: metadata.continuations,
    conversationId: metadata.conversationId || fallbackConversationId || '',
    displayName: metadata.displayName || (type === 'assistant' ? 'Neural Seed' : 'You'),
    finishReason: metadata.finishReason,
    id: metadata.persistedMessageId || message.id,
    message: text,
    model: metadata.model || '',
    provider: metadata.provider,
    recoveredFromLength: metadata.recoveredFromLength,
    timestamp: metadata.timestamp || Date.now(),
    tokensUsed: metadata.tokensUsed,
    toolCalls: metadata.toolCalls,
    type,
  };
}

/** Imperative surface the engine hands back to ChatProvider once mounted. */
export type AiChatHandle = {
  sendMessage: (
    message: { text: string },
    options: { body: Record<string, unknown>; headers: Record<string, string> },
  ) => Promise<void>;
  setMessages: (messages: AIUIMessage[]) => void;
  stop: () => Promise<void> | void;
};

export type AiChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';
