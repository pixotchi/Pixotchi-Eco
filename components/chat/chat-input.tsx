"use client";

import { ChatComposer } from './chat-composer';
import { useChatComposer } from './chat-view-context';
import type { ChatMode } from '@/lib/types';

type ChatInputProps = {
  modeOverride?: ChatMode;
  message: string;
  onMessageChange: (value: string) => void;
};

export default function ChatInput({ modeOverride, message, onMessageChange: setMessage }: ChatInputProps) {
  const {
    cancelActiveSend,
    isSending,
    activeMode,
    publicChatAuthenticated,
    publicChatLoading,
    sendMessageForMode,
  } = useChatComposer(modeOverride);
  return <ChatComposer activeMode={activeMode} message={message} onMessageChange={setMessage} activeSending={isSending}
    publicChatAuthenticated={publicChatAuthenticated} publicChatLoading={publicChatLoading} cancelActiveSend={() => cancelActiveSend(activeMode)}
    onSend={text => sendMessageForMode(activeMode, text)} />;
}
