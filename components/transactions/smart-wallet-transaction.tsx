"use client";

import GameTransaction, { type GameTransactionEffects } from './game-transaction';
import type { LifecycleStatus, TransactionFeedbackMode, TransactionPreflight } from './transaction-kit';
import type { TransactionCall } from '@/lib/types';

interface SmartWalletTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  onButtonClick?: TransactionPreflight;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  buttonText: string;
  pendingText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  successFeedback?: 'shared' | 'feature';
  successMessage?: string;
  intentKey: string;
  effects: GameTransactionEffects;
}

/**
 * Compatibility name retained for callers. Smart-wallet and universal
 * transactions now share one lifecycle, receipt verification, toast, and
 * post-transaction refresh implementation.
 */
export default function SmartWalletTransaction(props: SmartWalletTransactionProps) {
  return <GameTransaction {...props} atomicity={props.calls.length > 1 ? "required" : "single"} />;
}
