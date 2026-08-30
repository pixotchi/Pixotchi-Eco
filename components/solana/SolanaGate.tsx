'use client';

/**
 * Solana Gate Component
 * Conditionally renders content based on wallet type (Solana vs EVM)
 */

import React from 'react';
import { useIsSolanaWallet } from '@/hooks/useSolanaWallet';
import { isSolanaEnabled } from '@/lib/solana-constants';
import { Badge } from '@/components/ui/badge';

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
  
  // Solana-only content can never apply when the feature is disabled — check it
  // BEFORE the enabled bail-out (which used to render Solana-only children to
  // EVM users whenever the flag was off).
  if (solanaOnly && (!isEnabled || !isSolana)) {
    return <>{fallback}</>;
  }

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
    <div className={`rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.12)] p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <svg 
          className="w-5 h-5 text-[hsl(var(--warning))] flex-shrink-0 mt-0.5" 
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
          <h4 className="text-[hsl(var(--warning))] font-medium">Not Available for Solana Wallets</h4>
          <p className="text-sm mt-1 text-[hsl(var(--warning)/0.78)]">
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
    <Badge variant="special" className={className}>
      Bridge Mode
    </Badge>
  );
}

export default SolanaGate;
