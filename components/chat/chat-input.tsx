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
  const maxLength = isAIMode ? 300 : 200;
  const sharedChatUnavailable = (activeMode === 'public' || isAIMode) && !publicChatAuthenticated;
  // Per-pane, not the global isSending: in the desktop two-pane layout, a
  // streaming Neural Seed reply used to disable the Public pane's input too.
  const inputDisabled = activeSending || sharedChatUnavailable;
  const showStopButton = isAIMode && activeSending;

  const handleSend = async () => {
    const trimmed = message.trim();
    if (!trimmed) return;
    const sent = modeOverride
      ? await sendMessageForMode(modeOverride, trimmed)
      : await sendMessage(trimmed);
    // Keep the draft on failure — clearing unconditionally used to discard the
    // user's typed text along with the rolled-back optimistic bubble.
    if (sent) {
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (sharedChatUnavailable) {
    return (
      <div className="rounded-[var(--radius-control)] border border-border/60 bg-muted/35 px-3 py-2 text-xs text-muted-foreground" role="note">
        {publicChatLoading
          ? 'Restoring chat session...'
          : 'Refresh the chat session above to continue.'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" role="region" aria-label="Chat input area">
      <div className="flex items-center gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={inputDisabled}
          className="flex-1"
          maxLength={maxLength}
          aria-label={isAIMode ? "Ask Neural Seed a question" : "Type a chat message"}
          aria-describedby="chat-character-count"
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

        {/* Character count for screen readers. (maxLength hard-caps input, so
            there is no "too long" state to announce — the old warning branch was
            unreachable.) */}
        <div
          id="chat-character-count"
          className="sr-only"
          aria-live="polite"
          aria-atomic="true"
        >
          {message.length}/{maxLength} characters
        </div>
      </div>
    </div>
  );
}
