"use client";

import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo } from 'react';

import {
  getAIUIMessageText,
  type AiChatHandle,
  type AiChatStatus,
  type AIUIMessage,
} from './ai-message-utils';

/*
 * The Neural Seed streaming runtime, isolated behind next/dynamic.
 *
 * ChatProvider used to instantiate useChat() from @ai-sdk/react directly, which
 * put the whole AI SDK in the app-shell chunk and constructed the streaming
 * transport on page load for every user, chat opened or not. This component is
 * mounted (lazily) the first time the chat dialog opens; it renders nothing and
 * reports through the callbacks below.
 */
type AiChatEngineProps = {
  onError: (error: Error) => void;
  onMessagesChange: (messages: AIUIMessage[]) => void;
  onReady: (handle: AiChatHandle) => void;
  onStatusChange: (status: AiChatStatus) => void;
};

export default function AiChatEngine({
  onError,
  onMessagesChange,
  onReady,
  onStatusChange,
}: AiChatEngineProps) {
  const aiTransport = useMemo(
    () => new DefaultChatTransport<AIUIMessage>({
      api: '/api/chat/ai/send',
      credentials: 'same-origin',
      prepareSendMessagesRequest: ({ body, id, messageId, messages, trigger }) => {
        const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
        return {
          body: {
            ...body,
            id,
            message: latestUserMessage ? getAIUIMessageText(latestUserMessage) : '',
            messageId,
            messages: latestUserMessage ? [latestUserMessage] : [],
            trigger,
          },
        };
      },
    }),
    [],
  );

  const aiChat = useAIChat<AIUIMessage>({
    experimental_throttle: 60,
    transport: aiTransport,
  });

  const { sendMessage, setMessages, stop } = aiChat;
  useEffect(() => {
    onReady({ sendMessage, setMessages, stop });
  }, [onReady, sendMessage, setMessages, stop]);

  useEffect(() => {
    onStatusChange(aiChat.status);
  }, [aiChat.status, onStatusChange]);

  useEffect(() => {
    onMessagesChange(aiChat.messages);
  }, [aiChat.messages, onMessagesChange]);

  useEffect(() => {
    if (aiChat.error) {
      onError(aiChat.error);
    }
  }, [aiChat.error, onError]);

  return null;
}
