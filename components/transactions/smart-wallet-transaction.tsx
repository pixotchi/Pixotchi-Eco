"use client";

import type { TransactionFeedbackMode } from './transaction-kit';
import type { TransactionCall } from '@/lib/types';
import UniversalTransaction from './universal-transaction';

interface SmartWalletTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  intentKey?: string;
}

/**
 * Compatibility name retained for callers. Smart-wallet and universal
 * transactions now share one lifecycle, receipt verification, toast, and
 * post-transaction refresh implementation.
 */
export default function SmartWalletTransaction(props: SmartWalletTransactionProps) {
  return <UniversalTransaction {...props} />;
}
