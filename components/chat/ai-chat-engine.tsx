"use client";

import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport, generateId } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { AiChatAuthenticationError, AiSendAttempt } from '@/lib/ai-send-outcome';

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
  const activeAttemptRef = useRef<AiSendAttempt | null>(null);
  const retryMessageRef = useRef<{ id: string; text: string } | null>(null);
  const historyRevisionRef = useRef(0);
  const aiTransport = useMemo(
    () => new DefaultChatTransport<AIUIMessage>({
      api: '/api/chat/ai/send',
      credentials: 'same-origin',
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        // The SDK otherwise discards HTTP status and throws only response text.
        if (response.status === 401) throw new AiChatAuthenticationError();
        return response;
      },
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
    onError: (error) => {
      if (activeAttemptRef.current) activeAttemptRef.current.fail(error);
      else onError(error);
    },
    onFinish: (result) => activeAttemptRef.current?.finish(result),
  });

  const { sendMessage, setMessages, stop } = aiChat;
  const sendWithOutcome = useCallback<AiChatHandle['sendMessage']>(async (message, options) => {
    if (activeAttemptRef.current) return { status: 'failed', error: new Error('Wait for the current response before sending another question.') };
    const attempt = new AiSendAttempt();
    const historyRevision = historyRevisionRef.current;
    const retry = retryMessageRef.current?.text === message.text ? retryMessageRef.current : null;
    const id = retry?.id ?? generateId();
    activeAttemptRef.current = attempt;
    try {
      await sendMessage({ id, role: 'user', parts: [{ type: 'text', text: message.text }], ...(retry ? { messageId: retry.id } : {}) }, options);
    } catch (error) {
      attempt.fail(error instanceof Error ? error : new Error('Neural Seed could not send this question.'));
    }
    const result = attempt.outcome();
    if (activeAttemptRef.current === attempt) activeAttemptRef.current = null;
    retryMessageRef.current = result.status === 'accepted' || historyRevision !== historyRevisionRef.current ? null : { id, text: message.text };
    if (result.status !== 'accepted') {
      setMessages(current => current.map(entry => entry.id === id
        ? { ...entry, metadata: { ...entry.metadata, deliveryStatus: result.status } }
        : entry));
    }
    return result;
  }, [sendMessage, setMessages]);

  const stopWithOutcome = useCallback(() => {
    activeAttemptRef.current?.cancel();
    return stop();
  }, [stop]);
  useEffect(() => () => { void stopWithOutcome(); }, [stopWithOutcome]);

  const replaceHistory = useCallback<AiChatHandle['setMessages']>(messages => {
    // Refetched history may not contain a locally failed question. Its old id
    // must not be sent as a replacement target in the SDK's new message list.
    retryMessageRef.current = null;
    historyRevisionRef.current += 1;
    setMessages(messages);
  }, [setMessages]);

  useEffect(() => {
    onReady({ sendMessage: sendWithOutcome, setMessages: replaceHistory, stop: stopWithOutcome });
  }, [onReady, replaceHistory, sendWithOutcome, stopWithOutcome]);

  useEffect(() => {
    onStatusChange(aiChat.status);
  }, [aiChat.status, onStatusChange]);

  useEffect(() => {
    onMessagesChange(aiChat.messages);
  }, [aiChat.messages, onMessagesChange]);

  return null;
}
