"use client";

import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChat } from './chat-context';
import ChatMessages from './chat-messages';
import ChatInput from './chat-input';
import AITypingIndicator from './ai-typing-indicator';
import { ToggleGroup } from '@/components/ui/toggle-group';
import Image from 'next/image';
import type { ChatMode } from '@/lib/types';

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DesktopChatPane({
  icon,
  mode,
  title,
}: {
  icon: string;
  mode: Extract<ChatMode, 'public' | 'ai'>;
  title: string;
}) {
  const { fetchHistoryForMode, isAITypingForMode, publicChatAuthenticated } = useChat();

  useEffect(() => {
    if (!publicChatAuthenticated) {
      return;
    }

    void fetchHistoryForMode(mode, true);
  }, [fetchHistoryForMode, mode, publicChatAuthenticated]);

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border border-border/60 bg-card/85 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]">
      <div className="surface-header-divider dialog-header-surface flex items-center gap-2 px-3 py-2">
            <Image src={icon} alt="" width={18} height={18} className="h-[18px] w-[18px]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatMessages modeOverride={mode} />
      </div>
      <div className="surface-footer-divider dialog-footer-surface p-3">
        <div className="space-y-2">
          {isAITypingForMode(mode) && <AITypingIndicator />}
          <ChatInput modeOverride={mode} />
        </div>
      </div>
    </section>
  );
}

function ChatDialogContent() {
  const { mode, setMode, isAITyping } = useChat();

  return (
    <DialogContent
      size="full"
      surface="soft"
      className="flex h-[min(86dvh,42rem)] w-[min(94vw,28rem)] max-w-md flex-col rounded-[var(--radius-dialog)] border sm:h-[82dvh] sm:w-[calc(100vw-2rem)] xl:w-[min(92vw,56rem)] xl:max-w-[56rem]"
    >
      <DialogHeader>
        <DialogTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'ai' ? (
              <Image src="/icons/neuralseed.png" alt="Neural Seed" width={20} height={20} className="xl:hidden" />
            ) : (
              <Image src="/icons/chat-icon.webp" alt="Chat" width={20} height={20} className="xl:hidden" />
            )}
            <Image src="/icons/chat-icon.webp" alt="Chat" width={20} height={20} className="hidden xl:block" />
            <span className="xl:hidden">{mode === 'ai' ? 'Neural Seed' : 'Chat'}</span>
            <span className="hidden xl:inline">Chat</span>
          </div>
          <div className="xl:hidden">
            <ToggleGroup
              ariaLabel="Chat mode"
              value={mode}
              onValueChange={(v) => setMode(v as ChatMode)}
              options={[
                { value: 'public', label: 'Public' },
                { value: 'ai', label: 'AI' },
              ]}
            />
          </div>
        </DialogTitle>
        <DialogDescription>
          <span className="xl:hidden">
            Chat with the community or get help from Neural Seed agent.
          </span>
          <span className="hidden xl:inline">
            Chat with the community or get help from Neural Seed agent.
          </span>
        </DialogDescription>
      </DialogHeader>

      <div className="flex-grow overflow-hidden xl:hidden">
        <ChatMessages />
      </div>

      <div className="hidden min-h-0 flex-1 grid-cols-2 gap-4 overflow-hidden pt-3 xl:grid">
        <DesktopChatPane mode="public" title="Public" icon="/icons/chat-icon.webp" />
        <DesktopChatPane mode="ai" title="Neural Seed" icon="/icons/neuralseed.png" />
      </div>

      <DialogFooter sticky className="pt-3 xl:hidden">
        <div className="w-full space-y-2">
          {isAITyping && <AITypingIndicator />}
          <ChatInput />
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

export default function ChatDialog({ open, onOpenChange }: ChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ChatDialogContent />
    </Dialog>
  );
}
