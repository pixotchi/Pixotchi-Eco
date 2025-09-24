"use client";

import React, { useState } from 'react';
import { useChat } from './chat-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Send, Bot, Loader2 } from 'lucide-react';
import { useBalances } from '@/lib/balance-context';
import { parseUnits } from 'viem';

export default function ChatInput() {
  const { sendMessage, isSending, mode } = useChat();
  const [message, setMessage] = useState('');
  const { seedBalance, loading: balanceLoading } = useBalances();
  
  const isAIMode = mode === 'ai';
  const MIN_REQUIRED_SEED = parseUnits('10', 18);
  const insufficientForAgent = mode === 'agent' && !balanceLoading && seedBalance < MIN_REQUIRED_SEED;

  const handleSend = async () => {
    if (!message.trim()) return;
    await sendMessage(message.trim());
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
      <div className="flex items-center gap-2">
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyPress={handleKeyPress}
        placeholder={mode === 'agent' ? (insufficientForAgent ? "SEED balance insufficient (min 10). Visit Swap." : "Ask the agent to mint plants...") : (isAIMode ? "Ask about Pixotchi..." : "Type a message...")}
        disabled={isSending || insufficientForAgent}
        className="flex-1"
        maxLength={mode === 'agent' ? 200 : (isAIMode ? 300 : 200)}
        aria-label={mode === 'agent' ? "Ask onchain agent" : (isAIMode ? "Ask AI assistant a question" : "Type a chat message")}
        aria-describedby="chat-character-count"
        aria-invalid={message.length > (mode === 'agent' ? 200 : (isAIMode ? 300 : 200))}
      />
      <Button
        onClick={handleSend}
        disabled={isSending || !message.trim() || insufficientForAgent}
        size="icon"
        aria-label={isSending ? "Sending message..." : (mode === 'agent' ? "Send prompt to agent" : (isAIMode ? "Send question to AI" : "Send chat message"))}
        aria-describedby="chat-character-count"
      >
        {isSending ? (
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
        {message.length}/{mode === 'agent' ? 200 : (isAIMode ? 300 : 200)} characters
        {message.length > (mode === 'agent' ? 200 : (isAIMode ? 300 : 200)) && " - Message too long"}
      </div>
      </div>
    </div>
  );
}
