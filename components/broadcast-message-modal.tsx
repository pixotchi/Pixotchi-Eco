"use client";

import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, AlertTriangle, CheckCircle, Megaphone, ExternalLink } from 'lucide-react';
import type { BroadcastMessage } from '@/lib/broadcast-service';
import { openExternalUrl } from '@/lib/open-external';

interface BroadcastMessageModalProps {
  message: BroadcastMessage | null;
  onDismiss: () => void;
  onImpression?: (messageId: string) => void;
}

const typeConfig = {
  info: {
    icon: Info,
    color: 'text-[hsl(var(--info))]',
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
  useEffect(() => {
    if (!message || message.dismissible) {
      setUnlockElapsed(false);
      return;
    }
    const timer = window.setTimeout(() => setUnlockElapsed(true), NON_DISMISSIBLE_UNLOCK_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!renderedMessage) return null;
  const activeMessage = renderedMessage;
  const canDismiss = activeMessage.dismissible || unlockElapsed;

  const config = typeConfig[activeMessage.type] || typeConfig.info;
  const Icon = config.icon;
  const priorityLabel = priorityLabels[activeMessage.priority];

  const handleAction = async () => {
    if (activeMessage.action?.url) {
      // Open in new tab for external links (handles both mini app and web)
      if (activeMessage.action.url.startsWith('http')) {
        await openExternalUrl(activeMessage.action.url);
      } else {
        // Internal navigation
        window.location.href = activeMessage.action.url;
      }
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && canDismiss && onDismiss()}>
      <DialogContent 
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

        <div className="space-y-4 pt-2">
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
              className="w-full"
              onClick={handleAction}
            >
              {activeMessage.action.label}
              {activeMessage.action.url.startsWith('http') && (
                <ExternalLink className="w-4 h-4 ml-2" />
              )}
            </Button>
          )}

          {/* Dismiss / delayed-unlock button */}
          {canDismiss && (
            <Button
              onClick={onDismiss}
              className="w-full"
              variant={activeMessage.type === 'warning' ? 'default' : 'secondary'}
            >
              {activeMessage.dismissible ? 'Got it' : 'Continue'}
            </Button>
          )}

          {/* Non-dismissible message, before the unlock elapses */}
          {!canDismiss && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                Please review this message before continuing
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
