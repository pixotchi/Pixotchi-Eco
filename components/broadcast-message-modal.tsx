"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, AlertTriangle, CheckCircle, Megaphone, ExternalLink } from 'lucide-react';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { openBroadcastUrl } from '@/lib/broadcast-navigation';
import { useOwnerOperationScope } from '@/hooks/useOwnerOperationScope';

interface BroadcastMessageModalProps {
  message: BroadcastMessage | null;
  onDismiss: () => void;
  onImpression?: (messageId: string) => void;
}

const typeConfig = {
  info: {
    icon: Info,
    color: 'text-info-strong',
    bg: 'bg-[hsl(var(--info)/0.12)]',
    border: 'border-[hsl(var(--info)/0.24)]',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-[hsl(var(--warning))]',
    bg: 'bg-[hsl(var(--warning)/0.14)]',
    border: 'border-[hsl(var(--warning)/0.28)]',
  },
  success: {
    icon: CheckCircle,
    color: 'text-[hsl(var(--success-strong))]',
    bg: 'bg-[hsl(var(--success)/0.12)]',
    border: 'border-[hsl(var(--success)/0.24)]',
  },
  announcement: {
    icon: Megaphone,
    color: 'text-violet-700 dark:text-violet-200',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/20',
  },
};

const priorityLabels = {
  high: '🔴 Important',
  normal: '',
  low: '',
};

// A server flag used to be able to hard-lock the app: dismissible:false meant no
// close button, Escape and backdrop blocked, and a modal focus trap with no
// client-side exit. After this delay a "Continue" affordance appears so the
// message still demands attention but can never strand the user.
const NON_DISMISSIBLE_UNLOCK_MS = 15_000;

export function BroadcastMessageModal({ 
  message, 
  onDismiss,
  onImpression 
}: BroadcastMessageModalProps) {
  // Track impression when message is shown
  useEffect(() => {
    if (message && onImpression) {
      onImpression(message.id);
    }
  }, [message, onImpression]);

  // Keep the last message through the close so Radix can run its exit
  // animation — the old `if (!message) return null` unmounted the dialog in the
  // same commit the message cleared and it snapped shut.
  const lastMessageRef = useRef<BroadcastMessage | null>(null);
  if (message) {
    lastMessageRef.current = message;
  }
  const renderedMessage = message ?? lastMessageRef.current;

  const [unlockElapsed, setUnlockElapsed] = useState(false);
  const [unlockMessageId, setUnlockMessageId] = useState<string | undefined>(undefined);
  const [remainingSeconds, setRemainingSeconds] = useState(15);
  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const presentationScope = useOwnerOperationScope(message?.id ?? null);
  const currentMessageId = message?.id;
  const currentMessageDismissible = message?.dismissible;
  useEffect(() => {
    setUnlockElapsed(false);
    setUnlockMessageId(currentMessageId);
    setRemainingSeconds(15);
    setActionPending(false);
    setActionError(null);
    if (!currentMessageId || currentMessageDismissible) {
      setUnlockElapsed(false);
      return;
    }
    const deadline = Date.now() + NON_DISMISSIBLE_UNLOCK_MS;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining === 0) { setUnlockElapsed(true); window.clearInterval(timer); }
    }, 250);
    return () => window.clearInterval(timer);
  }, [currentMessageId, currentMessageDismissible]);

  if (!renderedMessage) return null;
  const activeMessage = renderedMessage;
  const canDismiss = activeMessage.dismissible || (unlockElapsed && unlockMessageId === activeMessage.id);

  const config = typeConfig[activeMessage.type] || typeConfig.info;
  const Icon = config.icon;
  const priorityLabel = priorityLabels[activeMessage.priority];

  const handleAction = async () => {
    const operation = presentationScope.capture();
    setActionPending(true);
    setActionError(null);
    try {
    if (activeMessage.action?.url) {
      await openBroadcastUrl(activeMessage.action.url);
      if (operation.isCurrent()) onDismiss();
    }
    } catch {
      if (operation.isCurrent()) setActionError('Could not open this link. Please try again.');
    } finally {
      if (operation.isCurrent()) setActionPending(false);
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && canDismiss && onDismiss()}>
      <DialogContent 
        layout="form"
        adaptiveScroll
        className="max-w-md"
        onEscapeKeyDown={(e) => !canDismiss && e.preventDefault()}
        onPointerDownOutside={(e) => !canDismiss && e.preventDefault()}
        onInteractOutside={(e) => !canDismiss && e.preventDefault()}
        hideCloseButton={!canDismiss}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${config.color} flex-shrink-0`} />
            <div className="flex-1">
              <DialogTitle className="text-left">
                {activeMessage.title || 'Announcement'}
              </DialogTitle>
              {priorityLabel && (
                <span className="text-xs text-muted-foreground mt-1 block">
                  {priorityLabel}
                </span>
              )}
              <DialogDescription className="sr-only">
                Important Pixotchi message. Review the content and choose the available action.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* Message Content */}
          <Alert className={`${config.bg} ${config.border}`}>
            <AlertDescription className="text-sm whitespace-pre-wrap leading-relaxed">
              {activeMessage.content}
            </AlertDescription>
          </Alert>

          {/* Action Button */}
          {activeMessage.action && (
            <Button
              variant="outline"
              className="h-auto min-h-11 w-full whitespace-normal px-[min(1rem,4vw)] leading-snug"
              onClick={handleAction}
              disabled={actionPending}
              aria-busy={actionPending}
            >
              <span className="min-w-0 [overflow-wrap:anywhere]">{activeMessage.action.label}</span>
              {activeMessage.action.url.startsWith('http') && (
                <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
            </Button>
          )}
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
        </DialogBody>

        <DialogFooter>
          {/* Dismiss / delayed-unlock button */}
          {canDismiss && (
            <Button
              onClick={onDismiss}
              className="h-auto min-h-11 w-full whitespace-normal leading-snug [overflow-wrap:anywhere]"
              variant={activeMessage.type === 'warning' ? 'default' : 'secondary'}
            >
              {activeMessage.dismissible ? 'Got it' : 'Continue'}
            </Button>
          )}

          {/* Non-dismissible message, before the unlock elapses */}
          {!canDismiss && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                Continue will be available in {unlockMessageId === activeMessage.id ? remainingSeconds : 15} seconds.{activeMessage.action && ' You can open the announcement link now.'}
              </p>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
