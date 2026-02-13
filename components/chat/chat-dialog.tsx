"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useChat } from './chat-context';
import ChatMessages from './chat-messages';
import ChatInput from './chat-input';
import AITypingIndicator from './ai-typing-indicator';
import { ToggleGroup } from '@/components/ui/toggle-group';
import Image from 'next/image';
import AgentPermissionsPanel from './AgentPermissionsPanel';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useFrameContext } from '@/lib/frame-context';
import { useTransactions } from 'ethereum-identity-kit';
import { CLIENT_ENV } from '@/lib/env-config';
import { createPortal } from 'react-dom';

interface ChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ChatDialogContent({ txModalOpen }: { txModalOpen: boolean }) {
  const { mode, setMode, isAITyping } = useChat();
  const { isSmartWallet } = useSmartWallet();
  const fc = useFrameContext();
  const isInMiniApp = Boolean(fc?.isInMiniApp);

  // Agent tab is only shown if:
  // 1. AGENT_ENABLED env is not false (defaults to true)
  // 2. User has a smart wallet
  // 3. User is not in a MiniApp
  const isAgentAvailable = CLIENT_ENV.AGENT_ENABLED && isSmartWallet && !isInMiniApp;

  return (
    <DialogContent
      className={`max-w-md w-full h-[80vh] flex flex-col ${txModalOpen ? 'pointer-events-none select-none' : ''}`}
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
              <Image src="/icons/neuralseed.png" alt="Neural Seed" width={20} height={20} />
            ) : (
              <Image src="/icons/chat.svg" alt="Chat" width={20} height={20} />
            )}
            {mode === 'ai' ? 'Assistant' : mode === 'agent' ? 'Agent' : 'Chat'}
          </div>
          <ToggleGroup
            value={mode}
            onValueChange={(v) => setMode(v as any)}
            options={[
              { value: 'public', label: 'Public' },
              { value: 'ai', label: 'AI' },
              ...(isAgentAvailable ? [{ value: 'agent', label: 'Agent' }] : []),
            ]}
          />
        </DialogTitle>
        <DialogDescription>
          {mode === 'agent'
            ? (isInMiniApp
              ? 'Agent is not available in Mini App.'
              : (!isSmartWallet
                ? 'Agent requires a smart wallet.'
                : 'Neural Seed Agent can mint plants using your spend permission.'))
            : 'Chat with the community or get help from Neural Seed AI assistant.'}
        </DialogDescription>
        {mode === 'agent' && isSmartWallet && !isInMiniApp && (
          <div className="mt-2">
            <AgentPermissionsPanel />
          </div>
        )}
      </DialogHeader>

      <div className="flex-grow overflow-hidden">
        <ChatMessages />
      </div>

      <DialogFooter className="border-t border-border pt-3">
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
            className="fixed inset-0 z-[2500] bg-black/60 backdrop-blur-sm pointer-events-none"
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
