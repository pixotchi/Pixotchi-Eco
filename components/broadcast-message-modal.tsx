"use client";

import React, { useEffect } from 'react';
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

  if (!message) return null;

  const config = typeConfig[message.type] || typeConfig.info;
  const Icon = config.icon;
  const priorityLabel = priorityLabels[message.priority];

  const handleAction = async () => {
    if (message.action?.url) {
      // Open in new tab for external links (handles both mini app and web)
      if (message.action.url.startsWith('http')) {
        await openExternalUrl(message.action.url);
      } else {
        // Internal navigation
        window.location.href = message.action.url;
      }
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={(open) => !open && message.dismissible && onDismiss()}>
      <DialogContent 
        className="max-w-md"
        onEscapeKeyDown={(e) => !message.dismissible && e.preventDefault()}
        onPointerDownOutside={(e) => !message.dismissible && e.preventDefault()}
        hideCloseButton={!message.dismissible}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className={`w-5 h-5 ${config.color} flex-shrink-0`} />
            <div className="flex-1">
              <DialogTitle className="text-left">
                {message.title || 'Announcement'}
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
              {message.content}
            </AlertDescription>
          </Alert>

          {/* Action Button */}
          {message.action && (
            <Button
              variant="outline"
              className="w-full"
              onClick={handleAction}
            >
              {message.action.label}
              {message.action.url.startsWith('http') && (
                <ExternalLink className="w-4 h-4 ml-2" />
              )}
            </Button>
          )}

          {/* Dismiss Button */}
          {message.dismissible && (
            <Button
              onClick={onDismiss}
              className="w-full"
              variant={message.type === 'warning' ? 'default' : 'secondary'}
            >
              Got it
            </Button>
          )}

          {/* Non-dismissible message */}
          {!message.dismissible && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                This message cannot be dismissed
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
