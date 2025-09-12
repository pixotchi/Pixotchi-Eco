"use client";

import React from 'react';
import { createPortal } from 'react-dom';
import {
  TransactionToast,
  TransactionToastIcon,
  TransactionToastLabel,
  TransactionToastAction,
} from '@coinbase/onchainkit/transaction';

interface GlobalTransactionToastProps {
  className?: string;
  position?: 'bottom-center' | 'bottom-right' | 'top-center' | 'top-right';
}

export default function GlobalTransactionToast({
  className = '!z-[10000]',
  position = 'bottom-center',
}: GlobalTransactionToastProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TransactionToast className={className} position={position}>
      <TransactionToastIcon />
      <TransactionToastLabel />
      <TransactionToastAction />
    </TransactionToast>,
    document.body
  );
}


