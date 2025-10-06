"use client";

import React, { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Info, AlertTriangle, CheckCircle, Megaphone, ExternalLink, X } from 'lucide-react';
import type { BroadcastMessage } from '@/lib/broadcast-service';

interface BroadcastMessageModalProps {
  message: BroadcastMessage | null;
  onDismiss: () => void;
  onImpression?: (messageId: string) => void;
}

const typeConfig = {
  info: {
    icon: Info,
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/20',
  },
  warning: {
    icon: AlertTriangle,
    color: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/10',
    border: 'border-orange-500/20',
  },
  success: {
    icon: CheckCircle,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
    border: 'border-green-500/20',
  },
  announcement: {
    icon: Megaphone,
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/20',
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

  const handleAction = () => {
    if (message.action?.url) {
      // Open in new tab for external links
      if (message.action.url.startsWith('http')) {
        window.open(message.action.url, '_blank', 'noopener,noreferrer');
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
      >
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2 flex-1">
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
              </div>
            </div>
            {message.dismissible && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onDismiss}
                className="h-6 w-6 -mt-1 -mr-2"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
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

          {/* Metadata */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
            <span>{new Date(message.createdAt).toLocaleString()}</span>
            {message.expiresAt && (
              <span className="text-orange-600 dark:text-orange-400">
                Expires: {new Date(message.expiresAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

