"use client";

import React, { useState } from 'react';
import { useChat } from './chat-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, Loader2 } from 'lucide-react';
import { useBalances } from '@/lib/balance-context';
import { parseUnits } from 'viem';
import type { ChatMode } from '@/lib/types';

type ChatInputProps = {
  modeOverride?: ChatMode;
};

export default function ChatInput({ modeOverride }: ChatInputProps = {}) {
  const {
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
  const { seedBalance, loading: balanceLoading } = useBalances();

  const isAIMode = activeMode === 'ai';
  const MIN_REQUIRED_SEED = parseUnits('10', 18);
  const insufficientForAgent = activeMode === 'agent' && !balanceLoading && seedBalance < MIN_REQUIRED_SEED;
  const sharedChatUnavailable = (activeMode === 'public' || isAIMode || activeMode === 'agent') && !publicChatAuthenticated;
  const inputDisabled = isSending || insufficientForAgent || sharedChatUnavailable;

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
      {insufficientForAgent && (
        <div className="text-xs text-red-600 dark:text-red-400" role="note">
          SEED balance insufficient for Agent tasks. (Minimum 10 needed, Visit Swap)
        </div>
      )}
      {sharedChatUnavailable && (
        <div className="text-xs text-muted-foreground" role="note">
          {publicChatLoading
            ? 'Connecting chat...'
            : (
              activeMode === 'agent'
                ? 'Agent chat is unavailable for this session.'
                : (isAIMode ? 'AI chat is unavailable, refresh the app.' : 'Public chat is unavailable, refresh the app.')
            )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={
            activeMode === 'agent'
              ? (
                insufficientForAgent
                  ? "SEED balance insufficient (min 10). Visit Swap."
                  : (sharedChatUnavailable ? "Agent chat unavailable" : "Ask the agent to mint plants...")
              )
              : (isAIMode
                ? (sharedChatUnavailable ? "AI chat unavailable" : "Ask about Pixotchi...")
                : (sharedChatUnavailable ? "Public chat unavailable" : "Type a message..."))
          }
          disabled={inputDisabled}
          className="flex-1"
          maxLength={activeMode === 'agent' ? 200 : (isAIMode ? 300 : 200)}
          aria-label={activeMode === 'agent' ? "Ask onchain agent" : (isAIMode ? "Ask AI assistant a question" : "Type a chat message")}
          aria-describedby="chat-character-count"
          aria-invalid={message.length > (activeMode === 'agent' ? 200 : (isAIMode ? 300 : 200))}
        />
        <Button
          onClick={handleSend}
          disabled={inputDisabled || !message.trim()}
          size="icon"
          aria-label={activeSending ? "Sending message..." : (activeMode === 'agent' ? "Send prompt to agent" : (isAIMode ? "Send question to AI" : "Send chat message"))}
          aria-describedby="chat-character-count"
        >
          {activeSending ? (
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
          {message.length}/{activeMode === 'agent' ? 200 : (isAIMode ? 300 : 200)} characters
          {message.length > (activeMode === 'agent' ? 200 : (isAIMode ? 300 : 200)) && " - Message too long"}
        </div>
      </div>
    </div>
  );
}
