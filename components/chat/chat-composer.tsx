"use client";
import React, { useId } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Bot, Loader2, Square } from 'lucide-react';
import type { ChatMode } from '@/lib/types';

export interface ChatComposerProps {
  activeMode: ChatMode;
  message: string;
  onMessageChange: (value: string) => void;
  activeSending: boolean;
  publicChatAuthenticated: boolean;
  publicChatLoading: boolean;
  onSend: (text: string) => Promise<boolean>;
  cancelActiveSend: () => void;
}
export function ChatComposer({ activeMode, message, onMessageChange: setMessage, activeSending, publicChatAuthenticated, publicChatLoading, onSend, cancelActiveSend }: ChatComposerProps) {
  const characterCountId = useId();

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
    if (inputDisabled) return;
    const sent = await onSend(trimmed);
    // Keep the draft on failure — clearing unconditionally used to discard the
    // user's typed text along with the rolled-back optimistic bubble.
    if (sent) {
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          disabled={inputDisabled}
          rows={1}
          className="min-h-11 max-h-32 flex-1 resize-y [field-sizing:content]"
          maxLength={maxLength}
          aria-label={isAIMode ? "Ask Neural Seed a question" : "Type a chat message"}
          aria-describedby={characterCountId}
        />
        <Button
          onClick={showStopButton ? cancelActiveSend : handleSend}
          disabled={!showStopButton && (inputDisabled || !message.trim())}
          size="icon"
          aria-label={showStopButton ? "Stop Neural Seed response" : (activeSending ? "Sending message..." : (isAIMode ? "Send question to Neural Seed" : "Send chat message"))}
          aria-describedby={characterCountId}
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
          id={characterCountId}
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
