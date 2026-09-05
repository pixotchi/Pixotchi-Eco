"use client";

import React from 'react';
import { Check, CircleAlert, Info, Wallet, X } from 'lucide-react';
import type { TransactionFeedback } from '@/lib/transaction-feedback';
import { cn } from '@/lib/utils';

export type TransactionFeedbackPosition = 'auto' | 'bottom-center' | 'bottom-right' | 'top-center' | 'top-right';

export function TransactionFeedbackIcon({ feedback, className }: { feedback: TransactionFeedback; className?: string }) {
  const Icon = { wallet: Wallet, check: Check, info: Info, error: CircleAlert, loading: Info }[feedback.icon];
  return (
    <span aria-hidden="true" className={cn('transaction-feedback-icon', className)} data-tone={feedback.tone}>
      {feedback.icon === 'loading'
        ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" />
        : <Icon className="h-[18px] w-[18px]" strokeWidth={2} />}
    </span>
  );
}

/** The notification surface is independent of its transaction and modal controllers. */
export function TransactionFeedbackCard({
  feedback,
  actions,
  children,
  className,
  position = 'auto',
  exiting = false,
  onDismiss,
  onPointerEnter,
  onPointerLeave,
  onFocusCapture,
  onBlurCapture,
}: {
  feedback: TransactionFeedback;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  position?: TransactionFeedbackPosition;
  exiting?: boolean;
  onDismiss: () => void;
  onPointerEnter?: React.PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLDivElement>;
  onFocusCapture?: React.FocusEventHandler<HTMLDivElement>;
  onBlurCapture?: React.FocusEventHandler<HTMLDivElement>;
}) {
  return (
    <div
      className={cn('transaction-feedback-viewport', className)}
      data-position={position}
      data-state={exiting ? 'closed' : 'open'}
      data-testid="ockToast"
      aria-hidden={exiting || undefined}
      inert={exiting || undefined}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocusCapture={onFocusCapture}
      onBlurCapture={onBlurCapture}
    >
      <div className="transaction-feedback-card">
        {children ?? (
          <>
            <TransactionFeedbackIcon feedback={feedback} />
            <div className="min-w-0">
              <div role={feedback.tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
                <p className="text-sm font-semibold leading-5 text-foreground">{feedback.title}</p>
                {feedback.description && <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">{feedback.description}</p>}
              </div>
            </div>
            <div className="col-span-2 -mt-2 min-[360px]:pl-10 [&:empty]:hidden">
              {actions}
            </div>
          </>
        )}
        <button
          className="transaction-feedback-close"
          onClick={onDismiss}
          type="button"
          data-testid="ockCloseButton"
          aria-label="Dismiss transaction status"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
