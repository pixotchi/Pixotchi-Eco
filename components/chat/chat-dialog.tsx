"use client";

import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChat } from './chat-context';
import ChatMessages from './chat-messages';
import ChatInput from './chat-input';
import AITypingIndicator from './ai-typing-indicator';
import { ToggleGroup } from '@/components/ui/toggle-group';
import Image from 'next/image';
import { useTransactions } from 'ethereum-identity-kit';
import { createPortal } from 'react-dom';
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
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-background/40">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Image src={icon} alt="" width={18} height={18} className="h-[18px] w-[18px]" aria-hidden="true" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <ChatMessages modeOverride={mode} />
      </div>
      <div className="border-t border-border p-3">
        <div className="space-y-2">
          {isAITypingForMode(mode) && <AITypingIndicator />}
          <ChatInput modeOverride={mode} />
        </div>
      </div>
    </section>
  );
}

function ChatDialogContent({ txModalOpen }: { txModalOpen: boolean }) {
  const { mode, setMode, isAITyping } = useChat();

  return (
    <DialogContent
      size="full"
      surface="soft"
      className={`h-[82dvh] w-[calc(100vw-2rem)] max-w-md xl:max-w-5xl flex flex-col ${txModalOpen ? 'pointer-events-none select-none' : ''}`}
      aria-hidden={txModalOpen || undefined}
      onInteractOutside={(event) => {
        if (txModalOpen) event.preventDefault();
      }}
      onPointerDownOutside={(event) => {
        if (txModalOpen) event.preventDefault();
      }}
    >
      <DialogHeader className="border-b border-border">
        <DialogTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'ai' ? (
              <Image src="/icons/neuralseed.png" alt="Neural Seed" width={20} height={20} className="xl:hidden" />
            ) : (
              <Image src="/icons/chat.svg" alt="Chat" width={20} height={20} className="xl:hidden" />
            )}
            <Image src="/icons/chat.svg" alt="Chat" width={20} height={20} className="hidden xl:block" />
            <span className="xl:hidden">{mode === 'ai' ? 'Neural Seed' : 'Chat'}</span>
            <span className="hidden xl:inline">Chat</span>
          </div>
          <div className="xl:hidden">
            <ToggleGroup
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
        <DesktopChatPane mode="public" title="Public" icon="/icons/chat.svg" />
        <DesktopChatPane mode="ai" title="Neural Seed" icon="/icons/neuralseed.png" />
      </div>

      <DialogFooter className="border-t border-border pt-3 xl:hidden">
        <div className="w-full space-y-2">
          {isAITyping && <AITypingIndicator />}
          <ChatInput />
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

export default function ChatDialog({ open, onOpenChange }: ChatDialogProps) {
  const { txModalOpen } = useTransactions();

  return (
    <>
      {open && txModalOpen && typeof document !== 'undefined'
        ? createPortal(
          <div
            className="fixed inset-0 z-[calc(var(--z-transaction)-1)] bg-black/60 backdrop-blur-sm pointer-events-none"
            aria-hidden="true"
          />,
          document.body
        )
        : null}

      <Dialog open={open} onOpenChange={onOpenChange} modal={!txModalOpen}>
        <ChatDialogContent txModalOpen={txModalOpen} />
      </Dialog>
    </>
  );
}
