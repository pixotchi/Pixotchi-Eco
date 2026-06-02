"use client";

import React, { useState } from 'react';
import { useChat } from './chat-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, Loader2, Square } from 'lucide-react';
import type { ChatMode } from '@/lib/types';

type ChatInputProps = {
  modeOverride?: ChatMode;
};

export default function ChatInput({ modeOverride }: ChatInputProps = {}) {
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
  const [message, setMessage] = useState('');

  const isAIMode = activeMode === 'ai';
  const sharedChatUnavailable = (activeMode === 'public' || isAIMode) && !publicChatAuthenticated;
  const inputDisabled = isSending || sharedChatUnavailable;
  const showStopButton = isAIMode && activeSending;

  const handleSend = async () => {
    if (!message.trim()) return;
    if (modeOverride) {
      await sendMessageForMode(modeOverride, message.trim());
    } else {
      await sendMessage(message.trim());
    }
    setMessage('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Chat input area">
      {sharedChatUnavailable && (
        <div className="text-xs text-muted-foreground" role="note">
          {publicChatLoading
            ? 'Connecting chat...'
            : (isAIMode ? 'AI chat is unavailable, refresh the app.' : 'Public chat is unavailable, refresh the app.')}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={
            isAIMode
              ? (sharedChatUnavailable ? "AI chat unavailable" : "Type a message...")
              : (sharedChatUnavailable ? "Public chat unavailable" : "Type a message...")
          }
          disabled={inputDisabled}
          className="flex-1"
          maxLength={isAIMode ? 300 : 200}
          aria-label={isAIMode ? "Ask Neural Seed a question" : "Type a chat message"}
          aria-describedby="chat-character-count"
          aria-invalid={message.length > (isAIMode ? 300 : 200)}
        />
        <Button
          onClick={showStopButton ? cancelActiveSend : handleSend}
          disabled={!showStopButton && (inputDisabled || !message.trim())}
          size="icon"
          aria-label={showStopButton ? "Stop Neural Seed response" : (activeSending ? "Sending message..." : (isAIMode ? "Send question to Neural Seed" : "Send chat message"))}
          aria-describedby="chat-character-count"
        >
          {showStopButton ? (
            <Square className="w-4 h-4 fill-current" aria-hidden="true" />
          ) : activeSending ? (
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          ) : isAIMode ? (
            <Bot className="w-4 h-4" aria-hidden="true" />
          ) : (
            <Send className="w-4 h-4" aria-hidden="true" />
          )}
        </Button>

        {/* Character count for screen readers */}
        <div
          id="chat-character-count"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {message.length}/{isAIMode ? 300 : 200} characters
          {message.length > (isAIMode ? 300 : 200) && " - Message too long"}
        </div>
      </div>
    </div>
  );
}
