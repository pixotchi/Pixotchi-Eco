'use client';

/**
 * Solana Bridge Transaction Component
 * UI component for executing bridge transactions
 */

import React, { useState, useCallback } from 'react';
import { useSolanaBridge, type BridgeStatus } from '@/hooks/useSolanaBridge';
import { useSolanaWallet } from '@/hooks/useSolanaWallet';
import { formatWsol } from '@/lib/solana-quote';
import { getSolanaExplorerUrl, getBaseExplorerUrl } from '@/lib/solana-twin';
import { BRIDGE_CONFIG } from '@/lib/solana-constants';

// ============ Types ============

export interface SolanaBridgeTransactionProps {
  /** Action type */
  actionType: 'mint' | 'shopItem' | 'gardenItem' | 'boxGame' | 'spinGame' | 'attack' | 'claimRewards' | 'setName';
  /** Action parameters */
  params: {
    strain?: number;
    plantId?: number;
    itemId?: number;
    targetId?: number;
    name?: string;
  };
  /** Button text (default based on action) */
  buttonText?: string;
  /** Disabled state */
  disabled?: boolean;
  /** Called when transaction succeeds */
  onSuccess?: (signature: string) => void;
  /** Called when transaction fails */
  onError?: (error: string) => void;
  /** Custom className */
  className?: string;
  /** Show cost estimate */
  showCost?: boolean;
}

// ============ Status Display Component ============

function BridgeStatusDisplay({ status }: { status: BridgeStatus }) {
  const statusConfig: Record<BridgeStatus, { text: string; color: string; spinning?: boolean }> = {
    idle: { text: '', color: '' },
    building: { text: 'Preparing...', color: 'text-yellow-500', spinning: true },
    quoting: { text: 'Getting quote...', color: 'text-yellow-500', spinning: true },
    ready: { text: 'Ready to sign', color: 'text-green-500' },
    signing: { text: 'Sign in wallet...', color: 'text-blue-500', spinning: true },
    bridging: { text: 'Bridging...', color: 'text-purple-500', spinning: true },
    confirming: { text: 'Confirming...', color: 'text-purple-500', spinning: true },
    success: { text: 'Success!', color: 'text-green-500' },
    error: { text: 'Failed', color: 'text-red-500' },
  };
  
  const config = statusConfig[status];
  if (!config.text) return null;
  
  return (
    <div className={`flex items-center gap-2 text-sm ${config.color}`}>
      {config.spinning && (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      )}
      <span>{config.text}</span>
    </div>
  );
}

// ============ Main Component ============

export function SolanaBridgeTransaction({
  actionType,
  params,
  buttonText,
  disabled = false,
  onSuccess,
  onError,
  className = '',
  showCost = true,
}: SolanaBridgeTransactionProps) {
  const { isConnected, isTwinSetup, twinAddress } = useSolanaWallet();
  const bridge = useSolanaBridge();
  const [isPreparing, setIsPreparing] = useState(false);
  
  // Determine if this action requires setup
  const needsSetupFirst = !isTwinSetup && ['mint', 'shopItem', 'gardenItem', 'setName'].includes(actionType);
  
  // Get default button text
  const getDefaultButtonText = () => {
    if (needsSetupFirst) return 'Setup Bridge Access';
    
    const texts: Record<typeof actionType, string> = {
      mint: 'Mint Plant',
      shopItem: 'Buy Item',
      gardenItem: 'Give Item',
      boxGame: 'Play Box Game',
      spinGame: 'Play Spin',
      attack: 'Attack',
      claimRewards: 'Claim Rewards',
      setName: 'Set Name',
    };
    
    return texts[actionType] || 'Execute';
  };
  
  // Prepare transaction based on action type
  const prepareTransaction = useCallback(async () => {
    if (needsSetupFirst) {
      return await bridge.prepareSetup();
    }
    
    switch (actionType) {
      case 'mint':
        return await bridge.prepareMint(params.strain ?? 0);
      case 'shopItem':
        return await bridge.prepareShopItem(params.plantId ?? 0, params.itemId ?? 0);
      case 'gardenItem':
        return await bridge.prepareGardenItem(params.plantId ?? 0, params.itemId ?? 0);
      case 'boxGame':
        return await bridge.prepareBoxGame(params.plantId ?? 0);
      case 'spinGame':
        return await bridge.prepareSpinGame(params.plantId ?? 0);
      case 'attack':
        return await bridge.prepareAttack(params.plantId ?? 0, params.targetId ?? 0);
      case 'claimRewards':
        return await bridge.prepareClaimRewards(params.plantId ?? 0);
      case 'setName':
        return await bridge.prepareSetName(params.plantId ?? 0, params.name ?? '');
      default:
        return null;
    }
  }, [actionType, params, needsSetupFirst, bridge]);
  
  // Handle button click
  const handleClick = useCallback(async () => {
    if (!isConnected) {
      onError?.('Please connect a Solana wallet');
      return;
    }
    
    setIsPreparing(true);
    
    try {
      const tx = await prepareTransaction();
      
      if (!tx) {
        onError?.('Failed to prepare transaction');
        return;
      }
      
      // In a real implementation, we'd use Privy's signTransaction here
      // For now, we show the prepared state
      // const signature = await bridge.execute(signTransaction);
      
      // Placeholder success
      // if (signature) {
      //   onSuccess?.(signature);
      // }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      onError?.(message);
    } finally {
      setIsPreparing(false);
    }
  }, [isConnected, prepareTransaction, onError]);
  
  // Determine button state
  const isDisabled = disabled || !isConnected || isPreparing || bridge.state.status === 'signing' || bridge.state.status === 'bridging';
  const isLoading = isPreparing || ['building', 'quoting', 'signing', 'bridging', 'confirming'].includes(bridge.state.status);
  
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Cost estimate */}
      {showCost && bridge.state.quote && bridge.state.quote.wsolAmount > BigInt(0) && (
        <div className="text-sm text-gray-400">
          Est. cost: {formatWsol(bridge.state.quote.wsolAmount)} SOL
          <span className="ml-1 text-xs">({bridge.state.quote.route})</span>
        </div>
      )}
      
      {/* Status */}
      <BridgeStatusDisplay status={bridge.state.status} />
      
      {/* Error */}
      {bridge.state.error && (
        <div className="text-sm text-red-500">
          {bridge.state.error}
        </div>
      )}
      
      {/* Success with explorer link */}
      {bridge.state.status === 'success' && bridge.state.signature && (
        <a 
          href={getSolanaExplorerUrl(bridge.state.signature)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-blue-400 hover:text-blue-300 underline"
        >
          View on Solana Explorer →
        </a>
      )}
      
      {/* Twin address info */}
      {twinAddress && (
        <div className="text-xs text-gray-500">
          Twin: <a 
            href={getBaseExplorerUrl(twinAddress)}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-400"
          >
            {twinAddress.slice(0, 6)}...{twinAddress.slice(-4)}
          </a>
        </div>
      )}
      
      {/* Action button */}
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={`
          px-4 py-2 rounded-lg font-medium transition-all
          ${isDisabled 
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed' 
            : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white'
          }
          ${isLoading ? 'animate-pulse' : ''}
        `}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Processing...
          </span>
        ) : (
          buttonText || getDefaultButtonText()
        )}
      </button>
      
      {/* Bridge time estimate */}
      {isLoading && (
        <div className="text-xs text-gray-500 text-center">
          Bridge takes ~{Math.round(BRIDGE_CONFIG.estimatedBridgeTime / 1000)}s
        </div>
      )}
    </div>
  );
}

export default SolanaBridgeTransaction;
