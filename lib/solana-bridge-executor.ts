'use client';

/**
 * Solana Bridge Executor
 * Executes bridge transactions using our own bridge implementation
 * Compatible with Privy Solana wallet signing
 */

import { PublicKey,Transaction } from '@solana/web3.js';
import { formatUnits } from 'viem';
import { solanaBridgeImplementation,type BaseContractCall } from './solana-bridge-implementation';
import type { BridgeTransactionParams } from './solana-bridge-service';
import {
  waitForBaseBridgeExecution,
  type BaseBridgeExecutionStatus,
  type BridgeTransactionMetadata,
  type SolanaBridgeLifecyclePhase,
} from './solana-bridge-lifecycle';
import {
SOLANA_BRIDGE_CONFIG,
getSolanaExplorerTxUrl,
} from './solana-constants';

export interface BridgeExecuteOptions {
  /** Solana wallet public key (base58 string) */
  solanaPublicKey: string;
  /** Bridge transaction parameters */
  params: BridgeTransactionParams;
  /** Function to sign the Solana transaction (from Privy) */
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  /** Lifecycle updates for honest submitted/confirmed/relay UI. */
  onPhase?: (phase: SolanaBridgeLifecyclePhase) => void;
}

export interface BridgeExecuteResult {
  /** Solana transaction signature */
  signature: string;
  /** Whether the transaction was successful */
  success: boolean;
  /** Cross-chain terminal/pending state. */
  status: BaseBridgeExecutionStatus;
  /** Metadata required to resume a pending relay check. */
  metadata?: BridgeTransactionMetadata;
  /** Error message if failed */
  error?: string;
}

export interface PreparedSolanaBridgeTransaction {
  transaction: Transaction;
  metadata: BridgeTransactionMetadata;
}

/**
 * Convert app bridge parameters into a Solana transaction in one place. This
 * prevents callers from accidentally dropping the action-specific Base gas cap.
 */
export async function createSolanaBridgeTransaction(
  solanaPublicKey: string,
  params: BridgeTransactionParams,
): Promise<PreparedSolanaBridgeTransaction> {
  const walletPubkey = new PublicKey(solanaPublicKey);
  const asset = {
    symbol: 'sol',
    label: 'SOL',
    type: 'sol' as const,
    decimals: 9,
    remoteAddress: SOLANA_BRIDGE_CONFIG.base.wrappedSOL.toLowerCase(),
    mint: undefined,
    tokenProgram: undefined,
  };
  const call: BaseContractCall | undefined = params.call
    ? {
        type: 'call',
        target: params.call.target,
        data: params.call.data,
        value: params.call.value?.toString() ?? '0',
      }
    : undefined;

  const transaction = await solanaBridgeImplementation.createBridgeTransaction({
    walletAddress: walletPubkey,
    amount: params.solAmount,
    destinationAddress: params.twinAddress,
    asset,
    tokenAccount: undefined,
    call,
    gasLimit: params.gasLimit,
  });

  return {
    transaction,
    metadata: solanaBridgeImplementation.getBridgeTransactionMetadata(transaction),
  };
}

/**
 * Execute a Solana bridge transaction
 * This bridges SOL to Base and optionally calls a contract
 */
export async function executeBridgeTransaction(
  options: BridgeExecuteOptions
): Promise<BridgeExecuteResult> {
  const { solanaPublicKey, params, signTransaction, onPhase } = options;
  
  try {
    console.log('[SolanaBridge] Starting bridge transaction...');
    console.log('[SolanaBridge] Destination (Twin):', params.twinAddress);
    console.log('[SolanaBridge] Amount (lamports):', params.solAmount.toString());
    
    // Create the bridge transaction
    console.log('[SolanaBridge] Building transaction...');
    const { transaction, metadata } = await createSolanaBridgeTransaction(
      solanaPublicKey,
      params,
    );
    const walletPubkey = new PublicKey(solanaPublicKey);
    
    // Submit the transaction (signs and sends)
    console.log('[SolanaBridge] Signing and submitting...');
    const signature = await solanaBridgeImplementation.submitBridgeTransaction(
      transaction,
      walletPubkey,
      signTransaction,
      { onPhase },
    );
    
    console.log(`[SolanaBridge] Transaction submitted: ${signature}`);
    
    const baseResult = await waitForBaseBridgeExecution(
      solanaBridgeImplementation.getConnection(),
      metadata,
      { onPhase },
    );

    return {
      signature,
      success: baseResult.status === 'base-confirmed',
      status: baseResult.status,
      metadata,
      error:
        baseResult.status === 'relay-failed'
          ? 'The relay attempted the Base action but it failed. Do not resubmit; the message may be retried.'
          : undefined,
    };
    
  } catch (error) {
    console.error('[SolanaBridge] Transaction failed:', error);
    return {
      signature: '',
      success: false,
      status: 'unknown',
      error: error instanceof Error ? error.message : 'Bridge transaction failed',
    };
  }
}

/**
 * Check if the user has enough SOL for a bridge transaction
 */
export async function checkSolBalance(
  solanaPublicKey: string,
  requiredLamports: bigint
): Promise<{ hasEnough: boolean; balance: bigint; required: bigint; formatted: { balance: string; required: string } }> {
  try {
    const connection = solanaBridgeImplementation.getConnection();
    const walletPubkey = new PublicKey(solanaPublicKey);
    const balance = await connection.getBalance(walletPubkey);
    
    // Add buffer for transaction fees (~0.01 SOL = 10,000,000 lamports)
    const requiredWithFees = requiredLamports + BigInt(10_000_000);
    
    return {
      hasEnough: BigInt(balance) >= requiredWithFees,
      balance: BigInt(balance),
      required: requiredWithFees,
      formatted: {
        balance: formatUnits(BigInt(balance), 9),
        required: formatUnits(requiredWithFees, 9),
      },
    };
  } catch (error) {
    console.error('[SolanaBridge] Balance check failed:', error);
    return {
      hasEnough: false,
      balance: BigInt(0),
      required: requiredLamports,
      formatted: {
        balance: '0',
        required: formatUnits(requiredLamports, 9),
      },
    };
  }
}

/**
 * Format lamports to SOL string
 */
export function formatSolAmount(lamports: bigint): string {
  return formatUnits(lamports, 9);
}

// Re-export the explorer URL function
export { getSolanaExplorerTxUrl };
