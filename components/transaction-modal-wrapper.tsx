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
  // Only intercept actual close buttons, not confirm/action buttons
  useEffect(() => {
    if (!txModalOpen) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      
      // Only look for explicit close button indicators - be very specific
      // Don't match buttons that might be confirm/action buttons
      const closeButton = target.closest(
        'button[aria-label*="close" i]:not([aria-label*="confirm" i]):not([aria-label*="Confirm" i]), ' +
        '[role="button"][aria-label*="close" i]:not([aria-label*="confirm" i]):not([aria-label*="Confirm" i])'
      );

      // Check for close button classes (but exclude action buttons)
      const hasCloseClass = 
        target.closest('.close-button, [class*="close-button"], [class*="CloseButton"]') &&
        !target.closest('button[aria-label*="confirm" i], button[aria-label*="Confirm" i], button[aria-label*="submit" i], button[aria-label*="Submit" i]');

      // Check if it's an SVG close icon (X) inside a button
      const isCloseIcon = 
        target.closest('svg') &&
        (target.closest('button') || target.closest('[role="button"]')) &&
        target.closest('[class*="transaction-modal" i], [class*="TransactionModal" i]') &&
        !target.closest('button[aria-label*="confirm" i], button[aria-label*="Confirm" i], button[aria-label*="submit" i], button[aria-label*="Submit" i]');

      // Only proceed if it's definitely a close button, not a confirm/action button
      // Also exclude any button that looks like a submit/confirm button
      const isActionButton = target.closest('button[type="submit"], button[aria-label*="confirm" i], button[aria-label*="Confirm" i], button[aria-label*="submit" i], button[aria-label*="Submit" i]');
      
      if ((closeButton || hasCloseClass || isCloseIcon) && !isActionButton) {
        // Check if the close button is within TransactionModal
        const transactionModal = target.closest('[class*="transaction-modal" i], [class*="TransactionModal" i]');
        if (transactionModal) {
          // Close the modal after the button's own handler has a chance to run
          requestAnimationFrame(() => {
            setTimeout(() => {
              setTxModalOpen(false);
            }, 50);
          });
        }
      }
    };

    // Use bubble phase (not capture) so button handlers run first
    document.addEventListener('click', handleClick, false);

    return () => {
      document.removeEventListener('click', handleClick, false);
    };
  }, [txModalOpen, setTxModalOpen]);

  return <TransactionModal className={className} />;
}

