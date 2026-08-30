"use client";

import React, { useEffect,useMemo,useState } from 'react';
import { PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import type { TransactionCall } from '@/lib/types';
import SmartWalletTransaction from './smart-wallet-transaction';
import SponsoredTransaction from './sponsored-transaction';
import type { TransactionFeedbackMode } from './transaction-kit';

const MAX_UINT256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

const ERC20_APPROVE_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

type ApprovalActionTransactionProps = {
  intentKey: string;
  actionCalls: TransactionCall[];
  approvalSpender: `0x${string}`;
  approvalTokenAddress?: `0x${string}`;
  approvalAmount?: bigint;
  needsApproval: boolean;
  onApprovalSuccess?: (tx: UntypedValue) => void;
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  batchButtonText: string;
  approvalButtonText?: string;
  actionButtonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  resetKey?: string | number;
};

export default function ApprovalActionTransaction({
  intentKey,
  actionCalls,
  approvalSpender,
  approvalTokenAddress = PIXOTCHI_TOKEN_ADDRESS,
  approvalAmount = MAX_UINT256,
  needsApproval,
  onApprovalSuccess,
  onSuccess,
  onError,
  batchButtonText,
  approvalButtonText,
  actionButtonText,
  buttonClassName = 'w-full',
  disabled = false,
  feedbackMode = 'toast',
  showToast = true,
  resetKey,
}: ApprovalActionTransactionProps) {
  const { isSmartWallet } = useSmartWallet();
  const [approvalConfirmed, setApprovalConfirmed] = useState(false);

  useEffect(() => {
    setApprovalConfirmed(false);
  }, [resetKey]);

  useEffect(() => {
    if (!needsApproval) {
      setApprovalConfirmed(false);
    }
  }, [needsApproval]);

  const approvalCall = useMemo<TransactionCall>(() => ({
    address: approvalTokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [approvalSpender, approvalAmount],
  }), [approvalAmount, approvalSpender, approvalTokenAddress]);

  const pendingApproval = needsApproval && !approvalConfirmed;
  const hasActionCalls = actionCalls.length > 0;

  if (pendingApproval && isSmartWallet) {
    return (
      <SmartWalletTransaction
        intentKey={intentKey}
        calls={[approvalCall, ...actionCalls]}
        onSuccess={onSuccess}
        onError={onError}
        buttonText={batchButtonText}
        buttonClassName={buttonClassName}
        disabled={disabled || !hasActionCalls}
        feedbackMode={feedbackMode}
        showToast={showToast}
      />
    );
  }

  if (pendingApproval) {
    return (
      <SponsoredTransaction
        intentKey={`${intentKey}:approval:${approvalTokenAddress.toLowerCase()}:${approvalSpender.toLowerCase()}:${approvalAmount}`}
        calls={[approvalCall]}
        onSuccess={(tx) => {
          setApprovalConfirmed(true);
          onApprovalSuccess?.(tx);
        }}
        onError={onError}
        buttonText={approvalButtonText ?? batchButtonText}
        buttonClassName={buttonClassName}
        disabled={disabled}
        feedbackMode={feedbackMode}
        showToast={showToast}
      />
    );
  }

  return (
    <SponsoredTransaction
      intentKey={intentKey}
      calls={actionCalls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={actionButtonText}
      buttonClassName={buttonClassName}
      disabled={disabled || !hasActionCalls}
      feedbackMode={feedbackMode}
      showToast={showToast}
    />
  );
}
