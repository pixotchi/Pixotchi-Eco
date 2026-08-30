'use client';

import { useIsSolanaWallet } from '@/hooks/useSolanaWallet';
import { Badge } from '@/components/ui/badge';

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
    <div role="status" className={`rounded-[var(--radius-panel)] border border-[hsl(var(--warning)/0.3)] bg-[hsl(var(--warning)/0.12)] p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 text-[hsl(var(--warning-strong))] flex-shrink-0 mt-0.5"
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
          <h4 className="text-[hsl(var(--warning-strong))] font-medium">Not Available for Solana Wallets</h4>
          <p className="text-sm mt-1 text-foreground">
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
