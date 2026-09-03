"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import { TransactionToast } from './transaction-kit';

interface GlobalTransactionToastProps {
  className?: string;
  position?: 'bottom-center' | 'bottom-right' | 'top-center' | 'top-right';
}

export default function GlobalTransactionToast({
  className = 'safe-area-bottom-margin',
  position = 'bottom-center',
}: GlobalTransactionToastProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TransactionToast className={className} position={position} />,
    document.body
  );
}
