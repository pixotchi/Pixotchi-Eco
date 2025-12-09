'use client';

/**
 * Solana Gate Component
 * Conditionally renders content based on wallet type (Solana vs EVM)
 */

import React from 'react';
import { useIsSolanaWallet } from '@/hooks/useSolanaWallet';
import { isSolanaEnabled } from '@/lib/solana-constants';

// ============ Types ============

interface SolanaGateProps {
  children: React.ReactNode;
  /** Content to show for Solana wallets */
  solanaContent?: React.ReactNode;
  /** Content to show for EVM wallets */
  evmContent?: React.ReactNode;
  /** If true, hide content for Solana wallets (gate out) */
  hideForSolana?: boolean;
  /** If true, only show content for Solana wallets */
  solanaOnly?: boolean;
  /** Fallback content when gated out */
  fallback?: React.ReactNode;
}

// ============ Components ============

/**
 * Gate content based on wallet type
 * 
 * @example
 * ```tsx
 * // Show different content based on wallet type
 * <SolanaGate
 *   solanaContent={<SolanaMintButton />}
 *   evmContent={<EVMMintButton />}
 * />
 * 
 * // Hide content for Solana wallets (e.g., Land features)
 * <SolanaGate hideForSolana fallback={<SolanaNotSupported />}>
 *   <LandManagement />
 * </SolanaGate>
 * 
 * // Only show for Solana wallets
 * <SolanaGate solanaOnly>
 *   <SolanaBridgeInfo />
 * </SolanaGate>
 * ```
 */
export function SolanaGate({
  children,
  solanaContent,
  evmContent,
  hideForSolana = false,
  solanaOnly = false,
  fallback = null,
}: SolanaGateProps) {
  const isSolana = useIsSolanaWallet();
  const isEnabled = isSolanaEnabled();
  
  // If Solana is not enabled, always show children
  if (!isEnabled) {
    return <>{children}</>;
  }
  
  // If specific content provided for each wallet type
  if (solanaContent !== undefined || evmContent !== undefined) {
    return <>{isSolana ? solanaContent : evmContent}</>;
  }
  
  // If hiding for Solana wallets
  if (hideForSolana && isSolana) {
    return <>{fallback}</>;
  }
  
  // If only showing for Solana wallets
  if (solanaOnly && !isSolana) {
    return <>{fallback}</>;
  }
  
  // Default: show children
  return <>{children}</>;
}

/**
 * Show content only for Solana wallets
 */
export function SolanaOnly({ 
  children, 
  fallback = null 
}: { 
  children: React.ReactNode; 
  fallback?: React.ReactNode;
}) {
  return (
    <SolanaGate solanaOnly fallback={fallback}>
      {children}
    </SolanaGate>
  );
}

/**
 * Hide content from Solana wallets
 */
export function HideFromSolana({ 
  children, 
  fallback = null 
}: { 
  children: React.ReactNode; 
  fallback?: React.ReactNode;
}) {
  return (
    <SolanaGate hideForSolana fallback={fallback}>
      {children}
    </SolanaGate>
  );
}

/**
 * Display message when feature is not available for Solana wallets
 */
export function SolanaNotSupported({ 
  feature = 'This feature',
  className = '',
}: { 
  feature?: string;
  className?: string;
}) {
  return (
    <div className={`bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <svg 
          className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" 
          fill="none" 
          viewBox="0 0 24 24" 
          stroke="currentColor"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" 
          />
        </svg>
        <div>
          <h4 className="text-yellow-500 font-medium">Not Available for Solana Wallets</h4>
          <p className="text-yellow-500/70 text-sm mt-1">
            {feature} is currently not available when connected with a Solana wallet. 
            Please connect with an EVM wallet (MetaMask, Coinbase, etc.) to access this feature.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Badge indicating Solana bridge mode
 */
export function SolanaBridgeBadge({ className = '' }: { className?: string }) {
  const isSolana = useIsSolanaWallet();
  
  if (!isSolana) return null;
  
  return (
    <span className={`
      inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
      bg-gradient-to-r from-purple-500/20 to-pink-500/20 
      border border-purple-500/30
      text-purple-300
      ${className}
    `}>
      Bridge Mode
    </span>
  );
}

export default SolanaGate;
