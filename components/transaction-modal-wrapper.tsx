"use client";

import { useEffect } from 'react';
import { TransactionModal, useTransactions } from 'ethereum-identity-kit';

/**
 * Wrapper component for TransactionModal that ensures the X button works correctly
 * by intercepting clicks and manually closing the modal if needed
 */
export function TransactionModalWrapper({ className }: { className?: string }) {
  const { txModalOpen, setTxModalOpen } = useTransactions();

  // Intercept clicks on the X button/close button in TransactionModal
  useEffect(() => {
    if (!txModalOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Look for close button indicators (X button, close icon, etc.)
      // Check various patterns that might indicate a close button
      const closeButton = target.closest(
        'button[aria-label*="close" i], ' +
        'button[aria-label*="Close" i], ' +
        '[role="button"][aria-label*="close" i], ' +
        '[role="button"][aria-label*="Close" i], ' +
        '.close-button, ' +
        '[class*="close-button"], ' +
        '[class*="CloseButton"], ' +
        '[class*="transaction-modal"] button:last-child, ' +
        '[class*="TransactionModal"] button:last-child'
      );

      // Also check for SVG close icons or X symbols
      const isCloseIcon = 
        target.closest('svg') &&
        (target.closest('button') || target.closest('[role="button"]')) &&
        (target.closest('[class*="transaction-modal" i], [class*="TransactionModal" i]'));

      if (closeButton || isCloseIcon) {
        // Check if the close button is within TransactionModal
        const transactionModal = target.closest('[class*="transaction-modal" i], [class*="TransactionModal" i]');
        if (transactionModal) {
          // Small delay to ensure the click is processed
          setTimeout(() => {
            setTxModalOpen(false);
          }, 0);
        }
      }
    };

    // Use capture phase to catch the event early
    document.addEventListener('click', handleClick, true);
    // Also listen for mousedown in case click doesn't fire
    document.addEventListener('mousedown', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      document.removeEventListener('mousedown', handleClick, true);
    };
  }, [txModalOpen, setTxModalOpen]);

  return <TransactionModal className={className} />;
}

