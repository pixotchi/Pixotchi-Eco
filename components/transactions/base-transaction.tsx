"use client";

import React, { useCallback, useRef, useEffect, useState } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusAction,
  TransactionStatusLabel,
} from '@coinbase/onchainkit/transaction';
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { usePaymaster } from '@/lib/paymaster-context';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Clock, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sdk } from '@farcaster/miniapp-sdk';
import { useAccount } from 'wagmi';
import type { TransactionCall } from '@/lib/types';

interface BaseTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  showStatus?: boolean;
  forceUnsponsored?: boolean; // Force transaction to be unsponsored (e.g., for swaps)
  sponsorshipMode?: 'auto' | 'force-sponsored' | 'force-unsponsored'; // More explicit control
  // Enhanced UX options
  variant?: 'default' | 'compact' | 'minimal'; // Different visual styles
  showInlineStatus?: boolean; // Show status inline with button
  successMessage?: string; // Custom success message
  errorMessage?: string; // Custom error message
  ariaLabel?: string; // Accessibility label
}

export default function BaseTransaction({
  calls,
  onSuccess,
  onError,
  onStatusUpdate,
  buttonText,
  buttonClassName = "",
  disabled = false,
  showToast = true,
  showStatus = true,
  forceUnsponsored = false,
  sponsorshipMode = 'auto',
  variant = 'default',
  showInlineStatus = false,
  successMessage,
  errorMessage,
  ariaLabel
}: BaseTransactionProps) {
  const { isSponsored: paymasterEnabled } = usePaymaster();
  const { address } = useAccount();

  // Enhanced state management for better UX
  const [transactionStatus, setTransactionStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Determine sponsorship based on mode
  const isSponsored = (() => {
    switch (sponsorshipMode) {
      case 'force-sponsored':
        return true;
      case 'force-unsponsored':
        return false;
      case 'auto':
      default:
        return forceUnsponsored ? false : paymasterEnabled;
    }
  })();

  // Track success handling to prevent duplicates
  const successHandledRef = useRef(false);
  const currentTransactionRef = useRef<string | null>(null);
  
  // Reset success tracking when calls change (new transaction)
  useEffect(() => {
    successHandledRef.current = false;
    currentTransactionRef.current = null;
  }, [calls]);

  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Transaction successful:', {
      hash: tx?.transactionHash,
      sponsorship: isSponsored ? 'sponsored' : 'unsponsored',
      timestamp: new Date().toISOString()
    });
    
    onSuccess?.(tx);
    // Haptics: success feedback when supported
    (async () => {
      try {
        const caps = await sdk.getCapabilities();
        if (Array.isArray(caps) && caps.includes('haptics.notificationOccurred')) {
          await sdk.haptics.notificationOccurred('success');
        }
      } catch {}
    })();
    
    // Notify status bar to refresh balances with slight delay for blockchain state propagation
    try { 
      setTimeout(() => {
        window.dispatchEvent(new Event('balances:refresh'));
      }, 100);
    } catch (error) {
      console.warn('Failed to dispatch balance refresh event:', error);
    }

    // Gamification: track daily activity (non-blocking)
    (async () => {
      if (!address) return;
      fetch('/api/gamification/streak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      }).catch(err => console.warn('Streak tracking failed (non-critical):', err));
    })();
  }, [onSuccess, isSponsored]);

  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    // Update enhanced status state for better UX
    switch (status.statusName) {
      case 'init':
      case 'pending':
        setTransactionStatus('pending');
        setStatusMessage('Transaction pending...');
        successHandledRef.current = false;
        break;
      case 'success':
        setTransactionStatus('success');
        setStatusMessage(successMessage || 'Transaction successful!');
        break;
      case 'error':
      case 'reverted':
        setTransactionStatus('error');
        setStatusMessage(errorMessage || 'Transaction failed');
        break;
      default:
        setTransactionStatus('idle');
        setStatusMessage('');
    }

    // Always call onStatusUpdate if provided
    try {
      onStatusUpdate?.(status);
    } catch (error) {
      console.warn('onStatusUpdate callback failed:', error);
    }

    // Handle success only once per transaction
    if (status.statusName === 'success' && !successHandledRef.current) {
      // Validate we have transaction data
      if (status.statusData?.transactionReceipts?.[0]) {
        const transactionHash = status.statusData.transactionReceipts[0].transactionHash;

        // Prevent duplicate handling for the same transaction
        if (currentTransactionRef.current !== transactionHash) {
          successHandledRef.current = true;
          currentTransactionRef.current = transactionHash;
          handleOnSuccess(status.statusData.transactionReceipts[0]);
        }
      }
    }
  }, [onStatusUpdate, successMessage, errorMessage]);

  const handleOnError = useCallback((error: any) => {
    console.error('Transaction failed:', {
      error: error?.message || error,
      sponsorship: isSponsored ? 'sponsored' : 'unsponsored',
      timestamp: new Date().toISOString()
    });

    // Update enhanced status state
    setTransactionStatus('error');
    setStatusMessage(errorMessage || 'Transaction failed');
    // Haptics: error feedback when supported
    (async () => {
      try {
        const caps = await sdk.getCapabilities();
        if (Array.isArray(caps) && caps.includes('haptics.notificationOccurred')) {
          await sdk.haptics.notificationOccurred('error');
        }
      } catch {}
    })();

    // Reset success tracking on error for retry scenarios
    successHandledRef.current = false;
    currentTransactionRef.current = null;

    onError?.(error);
  }, [onError, isSponsored, errorMessage]);

  // Get status icon and color based on transaction status
  const getStatusIcon = () => {
    switch (transactionStatus) {
      case 'pending':
        return <Loader2 className="w-4 h-4 animate-spin" />;
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-600" />;
      default:
        return null;
    }
  };

  const getStatusColor = () => {
    switch (transactionStatus) {
      case 'success':
        return 'text-green-600';
      case 'error':
        return 'text-red-600';
      case 'pending':
        return 'text-blue-600';
      default:
        return 'text-foreground';
    }
  };

  // Enhanced button text based on status
  const enhancedButtonText = () => {
    if (transactionStatus === 'pending') return 'Processing...';
    if (transactionStatus === 'success') return 'Success!';
    if (transactionStatus === 'error') return 'Failed - Retry';
    return buttonText;
  };

  const renderInlineStatus = () => {
    if (!showInlineStatus || transactionStatus === 'idle') return null;

    return (
      <div
        className={cn("flex items-center gap-2 mt-2 text-sm", getStatusColor())}
        role="status"
        aria-live="polite"
        aria-label={`Transaction status: ${statusMessage}`}
      >
        {getStatusIcon()}
        <span>{statusMessage}</span>
      </div>
    );
  };

  const renderAlertStatus = () => {
    if (!showInlineStatus || transactionStatus === 'idle') return null;

    const variant = transactionStatus === 'success' ? 'default' :
                   transactionStatus === 'error' ? 'destructive' : 'default';

    return (
      <Alert className="mt-2" variant={variant}>
        <div className="flex items-center gap-2">
          {getStatusIcon()}
          <AlertDescription>{statusMessage}</AlertDescription>
        </div>
      </Alert>
    );
  };

  return (
    <div className="transaction-container">
      <Transaction
        onStatus={handleOnStatus}
        calls={calls}
        onError={handleOnError}
        isSponsored={isSponsored}
      >
        <TransactionButton
          text={enhancedButtonText()}
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap leading-none",
            buttonClassName,
            transactionStatus === 'pending' && "cursor-not-allowed opacity-75",
            transactionStatus === 'success' && "bg-green-600 hover:bg-green-700",
            transactionStatus === 'error' && "bg-red-600 hover:bg-red-700"
          )}
          disabled={disabled || transactionStatus === 'pending'}
          aria-label={ariaLabel || buttonText}
          aria-describedby={statusMessage ? "transaction-status" : undefined}
        />

        {showStatus && (
          <TransactionStatus>
            <TransactionStatusAction />
            <TransactionStatusLabel />
          </TransactionStatus>
        )}

        {showToast && <GlobalTransactionToast />}
      </Transaction>

      {/* Enhanced inline status indicators */}
      {variant === 'minimal' ? renderInlineStatus() : renderAlertStatus()}

      {/* Screen reader status announcement */}
      <div
        id="transaction-status"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusMessage}
      </div>
    </div>
  );
}

// Export legacy component names for backward compatibility
export { BaseTransaction as UniversalTransaction };
export { BaseTransaction as SponsoredTransaction };
export { BaseTransaction as SmartWalletTransaction };
