"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { useActiveDialogFeedbackHost } from '@/components/ui/dialog-feedback-host';
import { TransactionToast } from './transaction-kit';
import type { TransactionFeedbackPosition } from './transaction-feedback-card';

interface GlobalTransactionToastProps {
  className?: string;
  successMessage?: string;
  suppressSuccess?: boolean;
  position?: TransactionFeedbackPosition;
}

export default function GlobalTransactionToast({
  className,
  successMessage,
  suppressSuccess,
  position = 'auto',
}: GlobalTransactionToastProps) {
  const activeDialogHost = useActiveDialogFeedbackHost();

  if (typeof document === 'undefined') return null;
  return createPortal(
    <TransactionToast successMessage={successMessage} suppressSuccess={suppressSuccess} className={className} position={position} />,
    activeDialogHost ?? document.body
  );
}
