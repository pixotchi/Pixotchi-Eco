"use client";

/**
 * Solana Bridge Button Component
 * Reusable button for executing Solana bridge transactions
 * Follows the same UX pattern as EVM SponsoredTransaction
 * 
 * Quote fetching strategy:
 * - Fetch once on mount/item change (with 3 retries built into quote service)
 * - Cache quote for 20 seconds before allowing refresh
 * - Only refetch when item changes (tracked by stable key)
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { useSolanaBridge } from '@/hooks/useSolanaBridge';
import { useSolanaWallet } from '@/hooks/useSolanaWallet';
import { useWallets as useSolanaWallets, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { toast } from 'react-hot-toast';
import { solanaBridgeImplementation } from '@/lib/solana-bridge-implementation';
import { SOLANA_BRIDGE_CONFIG } from '@/lib/solana-constants';

// ============ Types ============

export type SolanaBridgeActionType = 'setup' | 'shopItem' | 'gardenItem' | 'setName' | 'claimRewards' | 'attack';

export interface SolanaBridgeButtonProps {
  /** Action type */
  actionType: SolanaBridgeActionType;
  /** Plant ID (required for most actions) */
  plantId?: number;
  /** Item ID (for shop/garden items) */
  itemId?: number | string;
  /** Target plant ID (for attack) */
  targetId?: number;
  /** New name (for setName) */
  name?: string;
  /** Button text override */
  buttonText?: string;
  /** Button className */
  buttonClassName?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Called when transaction succeeds */
  onSuccess?: (signature: string) => void;
  /** Called when transaction fails */
  onError?: (error: any) => void;
  /** Called whenever a fresh quote is fetched (wSOL amount/error). Only fires for actions that require quotes. */
  onQuote?: (quote: { wsolAmount: bigint; error?: string } | null) => void;
}

// Quote cache duration in milliseconds (20 seconds)
const QUOTE_CACHE_DURATION = 20_000;

// ============ Component ============

export default function SolanaBridgeButton({
  actionType,
  plantId,
  itemId,
  targetId,
  name,
  buttonText,
  buttonClassName = '',
  disabled = false,
  onSuccess,
  onError,
  onQuote,
}: SolanaBridgeButtonProps) {
  const bridge = useSolanaBridge();
  const { solanaAddress, isTwinSetup, isConnected } = useSolanaWallet();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signAndSendTransaction } = useSignAndSendTransaction();
  
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [isQuoteLoading, setIsQuoteLoading] = useState(false);
  const [localQuote, setLocalQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  
  // Track when we last fetched a quote and for what item
  const lastFetchRef = useRef<{ key: string; timestamp: number } | null>(null);
  
  // Store bridge.getQuote in a ref to avoid dependency issues
  const getQuoteRef = useRef(bridge.getQuote);
  getQuoteRef.current = bridge.getQuote;
  
  // Pick the first available Privy-provided Solana wallet (they are already usable)
  const solanaWallet = useMemo(() => solanaWallets?.[0] ?? null, [solanaWallets]);
  
  // Check if setup is required for this action
  const needsSetup = !isTwinSetup && ['shopItem', 'gardenItem', 'setName'].includes(actionType);
  
  // Create a stable key for the current item/action combination
  const quoteKey = useMemo(() => {
    if (actionType === 'shopItem' || actionType === 'gardenItem') {
      return `${actionType}-${itemId}`;
    }
    if (actionType === 'setName') {
      return `setName-${plantId}`;
    }
    return null; // No quote needed for free actions
  }, [actionType, itemId, plantId]);
  
  // Check if this action requires a quote
  const requiresQuote = ['shopItem', 'gardenItem', 'setName'].includes(actionType);
  
  // Fetch quote with caching - only when quoteKey changes (item selection changes)
  useEffect(() => {
    // Skip if not connected or doesn't require quote
    // Note: We still fetch quote even if needsSetup=true, so users can see the price
    if (!isConnected || !requiresQuote || !quoteKey) {
      setLocalQuote(null);
      onQuote?.(null);
      return;
    }
    
    // For shop/garden items, itemId is required
    if ((actionType === 'shopItem' || actionType === 'gardenItem') && !itemId) {
      setLocalQuote(null);
      return;
    }
    
    // Check if we already have a recent quote for this item
    const now = Date.now();
    if (
      lastFetchRef.current &&
      lastFetchRef.current.key === quoteKey &&
      now - lastFetchRef.current.timestamp < QUOTE_CACHE_DURATION &&
      localQuote !== null
    ) {
      // Quote is still fresh, don't refetch
      return;
    }
    
    let cancelled = false;
    
    const fetchQuote = async () => {
      setIsQuoteLoading(true);
      
      try {
        let result;
        const getQuote = getQuoteRef.current;
        
        if (actionType === 'shopItem' && itemId) {
          result = await getQuote('shopItem', { itemId: Number(itemId) });
        } else if (actionType === 'gardenItem' && itemId) {
          result = await getQuote('gardenItem', { itemId: Number(itemId) });
        } else if (actionType === 'setName') {
          result = await getQuote('setName', {});
        }
        
        if (!cancelled) {
          if (result) {
            lastFetchRef.current = { key: quoteKey, timestamp: Date.now() };
            setLocalQuote({
              wsolAmount: result.wsolAmount || BigInt(0),
              error: result.error,
            });
            onQuote?.({ wsolAmount: result.wsolAmount || BigInt(0), error: result.error });
          } else {
            // No result returned
            const fallback = { wsolAmount: BigInt(0), error: 'No quote available' };
            setLocalQuote(fallback);
            onQuote?.(fallback);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[SolanaBridgeButton] Quote fetch error:', err);
          const fallback = { wsolAmount: BigInt(0), error: 'Failed to get quote' };
          setLocalQuote(fallback);
          onQuote?.(fallback);
        }
      } finally {
        if (!cancelled) {
          setIsQuoteLoading(false);
        }
      }
    };
    
    fetchQuote();
    
    // Set up auto-refresh after cache duration (20 seconds)
    const refreshInterval = setInterval(() => {
      if (!cancelled) {
        // Reset the last fetch timestamp to allow refetch
        lastFetchRef.current = null;
        fetchQuote();
      }
    }, QUOTE_CACHE_DURATION);
    
    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
    // Only depend on stable values - quoteKey changes when item selection changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, requiresQuote, quoteKey, actionType, itemId]);
  
  // Get default button text
  const getDefaultButtonText = () => {
    if (needsSetup) return 'Setup Bridge Access';
    
    switch (actionType) {
      case 'setup': return 'Setup Bridge';
      case 'shopItem': return 'Buy Item';
      case 'gardenItem': return 'Buy Item';
      case 'setName': return 'Set Name';
      case 'claimRewards': return 'Claim Rewards';
      case 'attack': return 'Attack';
      default: return 'Execute';
    }
  };
  
  // Execute the bridge transaction
  const handleClick = useCallback(async () => {
    if (!solanaWallet || !solanaAddress || !signAndSendTransaction) {
      toast.error('Solana wallet not connected');
      onError?.('Wallet not connected');
      return;
    }
    
    setIsLoading(true);
    setStatusText('Preparing transaction...');
    
    try {
      // Prepare transaction based on action type
      let tx;
      
      if (needsSetup || actionType === 'setup') {
        tx = await bridge.prepareSetup();
      } else {
        switch (actionType) {
          case 'shopItem':
            if (!plantId || !itemId) throw new Error('Plant ID and Item ID required');
            tx = await bridge.prepareShopItem(plantId, Number(itemId));
            break;
          case 'gardenItem':
            if (!plantId || !itemId) throw new Error('Plant ID and Item ID required');
            tx = await bridge.prepareGardenItem(plantId, Number(itemId));
            break;
          case 'setName':
            if (!plantId || !name) throw new Error('Plant ID and Name required');
            tx = await bridge.prepareSetName(plantId, name);
            break;
          case 'claimRewards':
            if (!plantId) throw new Error('Plant ID required');
            tx = await bridge.prepareClaimRewards(plantId);
            break;
          case 'attack':
            if (!plantId || !targetId) throw new Error('Plant ID and Target ID required');
            tx = await bridge.prepareAttack(plantId, targetId);
            break;
          default:
            throw new Error('Unknown action type');
        }
      }
      
      if (!tx) {
        throw new Error(bridge.state.error || 'Failed to prepare transaction');
      }
      
      setStatusText('Building Solana transaction...');
      
      // Build the Solana transaction
      const walletPubkey = new PublicKey(solanaAddress);
      const asset = {
        symbol: 'sol',
        label: 'SOL',
        type: 'sol' as const,
        decimals: 9,
        remoteAddress: SOLANA_BRIDGE_CONFIG.base.wrappedSOL.toLowerCase(),
      };
      
      const callOptions = tx.params.call ? {
        type: 'call' as const,
        target: tx.params.call.target,
        data: tx.params.call.data,
        value: '0',
      } : undefined;
      
      const solanaTransaction = await solanaBridgeImplementation.createBridgeTransaction({
        walletAddress: walletPubkey,
        amount: tx.params.solAmount,
        destinationAddress: tx.params.twinAddress,
        asset,
        call: callOptions,
        gasLimit: tx.params.gasLimit,
      });
      
      setStatusText('Waiting for signature...');
      
      // Sign and send the transaction
      // Privy expects a serialized transaction (Uint8Array)
      const serializedTx = solanaTransaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      const { signature } = await signAndSendTransaction({
        transaction: serializedTx,
        wallet: solanaWallet,
        options: { skipPreflight: false },
      });
      
      const connection = solanaBridgeImplementation.getConnection();
      const signatureStr = typeof signature === 'string' ? signature : bs58.encode(signature);
      
      // Fire-and-forget confirmation; if websocket subscriptions are blocked, fallback to HTTP polling
      const confirmBackground = async () => {
        try {
          await connection.confirmTransaction(signatureStr, 'confirmed');
        } catch (err) {
          console.warn('[SolanaBridgeButton] confirmTransaction websocket error, falling back to HTTP polling:', err);
          try {
            const start = Date.now();
            const timeoutMs = 30_000;
            while (Date.now() - start < timeoutMs) {
              const statuses = await connection.getSignatureStatuses([signatureStr]);
              const status = statuses?.value?.[0];
              if (status?.err) throw new Error('Transaction failed on Solana');
              if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
                return;
              }
              await new Promise(res => setTimeout(res, 1500));
            }
            throw new Error('Timeout waiting for Solana confirmation');
          } catch (pollErr) {
            console.warn('[SolanaBridgeButton] HTTP polling confirmation warning:', pollErr);
          }
        }
      };
      confirmBackground().catch(() => {});
      
      setStatusText(null);
      toast.success('Transaction submitted! Bridge processing...');
      onSuccess?.(signatureStr);
      
    } catch (error) {
      console.error('[SolanaBridgeButton] Error:', error);
      setStatusText(null);
      const message = error instanceof Error ? error.message : 'Transaction failed';
      toast.error(message);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  }, [
    actionType, plantId, itemId, targetId, name, needsSetup,
    solanaWallet, solanaAddress, signAndSendTransaction, bridge,
    onSuccess, onError
  ]);
  
  // Determine if quote is ready (successful with amount)
  const hasValidQuote = localQuote && localQuote.wsolAmount > BigInt(0) && !localQuote.error;
  const quoteError = localQuote?.error;
  
  // For paid actions: disable only while loading quote for the first time (not on error)
  // If quote fails, user can still click - the prepare function will retry getting a fresh quote
  // Note: We use isConnected (from useSolanaWallet) as the primary check, not solanaWallet
  // solanaWallet is only needed when actually executing the transaction
  const isDisabled = disabled || !isConnected || isLoading || (requiresQuote && isQuoteLoading && localQuote === null);
  
  // Debug logging - remove after fixing
  if (process.env.NODE_ENV === 'development') {
    console.log('[SolanaBridgeButton] State:', {
      actionType,
      itemId,
      plantId,
      isConnected,
      isLoading,
      isQuoteLoading,
      requiresQuote,
      hasLocalQuote: localQuote !== null,
      localQuoteError: localQuote?.error,
      localQuoteAmount: localQuote?.wsolAmount?.toString(),
      disabled: disabled,
      isDisabled,
      disabledReason: disabled ? 'prop' : !isConnected ? 'not connected' : isLoading ? 'loading' : (requiresQuote && isQuoteLoading && localQuote === null) ? 'quote loading' : 'none',
    });
  }
  
  // Determine display text
  const getDisplayText = () => {
    if (isQuoteLoading && localQuote === null) return 'Loading price...';
    if (!isConnected) return 'Connect Solana Wallet';
    return buttonText || getDefaultButtonText();
  };
  
  const displayText = getDisplayText();
  
  return (
    <Button
      onClick={handleClick}
      disabled={isDisabled}
      className={`w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white disabled:opacity-50 ${buttonClassName}`}
    >
      {isLoading ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          {statusText || 'Processing...'}
        </span>
      ) : isQuoteLoading && localQuote === null ? (
        <span className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading price...
        </span>
      ) : (
        displayText
      )}
    </Button>
  );
}

