"use client";

import { ChatComposer } from './chat-composer';
import { useChat } from './chat-context';
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
    isSendingForMode,
    mode,
    publicChatAuthenticated,
    publicChatLoading,
    sendMessage,
    sendMessageForMode,
  } = useChat();
  const activeMode = modeOverride ?? mode;
  const activeSending = modeOverride ? isSendingForMode(modeOverride) : isSending;
  return <ChatComposer activeMode={activeMode} message={message} onMessageChange={setMessage} activeSending={activeSending}
    publicChatAuthenticated={publicChatAuthenticated} publicChatLoading={publicChatLoading} cancelActiveSend={cancelActiveSend}
    onSend={text => modeOverride ? sendMessageForMode(modeOverride, text) : sendMessage(text)} />;
}
