"use client";

/**
 * Builder Codes (ERC-8021) Integration
 * 
 * This module provides utilities for appending Base Builder Code attribution
 * to all onchain transactions from Pixotchi.
 * 
 * Builder Codes enable:
 * - Analytics tracking on Base.dev
 * - Potential future rewards for builders
 * - Attribution of all onchain activity to your app
 * 
 * @see https://docs.base.org/builder-codes
 */

import { Attribution } from "ox/erc8021";
import { encodeFunctionData } from "viem";
import { CLIENT_ENV } from "./env-config";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";

// Builder code from base.dev - set via environment variable
const BUILDER_CODE = CLIENT_ENV.BUILDER_CODE;

// Cache the computed suffix to avoid recomputation
let cachedDataSuffix: string | null = null;
let cacheInitialized = false;

/**
 * Generate the ERC-8021 dataSuffix for transaction attribution
 * Uses the builder code from environment variables
 */
function computeDataSuffix(): string | null {
  if (!BUILDER_CODE || BUILDER_CODE.trim() === "") {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[BuilderCode] NEXT_PUBLIC_BUILDER_CODE not configured. " +
        "Transactions will not include builder attribution. " +
        "Register at https://base.dev to get your code."
      );
    }
    return null;
  }

  try {
    const suffix = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });
    if (process.env.NODE_ENV === "development") {
      console.log("[BuilderCode] Attribution suffix generated for code:", BUILDER_CODE);
    }
    return suffix;
  } catch (error) {
    console.error("[BuilderCode] Failed to generate dataSuffix:", error);
    return null;
  }
}

/**
 * Get the dataSuffix for ERC-8021 builder code attribution.
 * Returns cached value after first computation.
 * 
 * @returns The hex-encoded dataSuffix string, or undefined if not configured
 */
export function getDataSuffix(): string | undefined {
  if (!cacheInitialized) {
    cachedDataSuffix = computeDataSuffix();
    cacheInitialized = true;
  }
  return cachedDataSuffix ?? undefined;
}

/**
 * Get the capabilities object for OnchainKit Transaction component.
 * Includes the dataSuffix for builder code attribution.
 * 
 * @returns WalletCapabilities object with dataSuffix, or undefined if not configured
 */
export function getBuilderCapabilities(): { dataSuffix: string } | undefined {
  const suffix = getDataSuffix();
  if (!suffix) return undefined;
  return { dataSuffix: suffix };
}

/**
 * Check if builder code attribution is configured
 */
export function isBuilderCodeConfigured(): boolean {
  return Boolean(BUILDER_CODE && BUILDER_CODE.trim() !== "");
}

/**
 * Get the configured builder code (for debugging purposes)
 */
export function getBuilderCode(): string | undefined {
  return BUILDER_CODE || undefined;
}

/**
 * Check if the current wallet is a Privy embedded wallet
 * This is used to determine if we should pre-encode builder suffixes
 */
export function isPrivyEmbeddedWallet(): boolean {
  try {
    // This function needs to be called from within a React component
    // We'll return false here and handle the logic in the hook version
    return false;
  } catch {
    return false;
  }
}

/**
 * Hook version of isPrivyEmbeddedWallet that can access Privy context
 */
export function useIsPrivyEmbeddedWallet(): boolean {
  const { user } = usePrivy();
  const { address } = useAccount();

  if (!address || !user?.linkedAccounts) return false;

  // Find the linked account that matches the current address
  const linkedWallet = user.linkedAccounts.find((account) => {
    if (account?.type !== "wallet") return false;
    const walletAccount = account as any; // WalletWithMetadata
    return (
      walletAccount.address?.toLowerCase() === address.toLowerCase() &&
      walletAccount.walletClientType === "privy" &&
      walletAccount.chainType === "ethereum"
    );
  });

  return Boolean(linkedWallet);
}

/**
 * Append builder code suffix to encoded calldata for legacy transactions.
 * Use this for direct `sendTransaction` calls when `wallet_sendCalls` is not available.
 * 
 * @param encodedData - The ABI-encoded function call data (0x prefixed)
 * @returns The data with builder suffix appended, or original data if no suffix configured
 */
export function appendBuilderSuffix(encodedData: `0x${string}`): `0x${string}` {
  const suffix = getDataSuffix();
  if (!suffix) return encodedData;
  
  // Append suffix bytes (remove 0x prefix from suffix since encodedData has it)
  return (encodedData + suffix.slice(2)) as `0x${string}`;
}

/**
 * Transform OnchainKit calls to include builder code suffix in the calldata.
 *
 * This is necessary because OnchainKit only passes capabilities (including dataSuffix)
 * to wallets that support wallet_sendCalls (ERC-5792). For EOA wallets like Rabby,
 * MetaMask, etc., the capabilities are ignored.
 *
 * By pre-encoding the calldata with the suffix, we ensure builder attribution
 * works across ALL wallet types.
 *
 * IMPORTANT: For Privy embedded wallets, this function preserves the original ABI format
 * since they support capabilities and don't need pre-encoded suffixes. For external EOA wallets,
 * calls are converted to raw format (to, data, value) with pre-encoded builder suffixes.
 *
 * @param calls - Array of transaction calls (OnchainKit format)
 * @param skipPreEncodingForPrivyEmbedded - If true, preserve original ABI format for Privy embedded wallets
 * @returns Transformed calls with builder suffix baked into calldata (raw format for EOA, ABI format for Privy embedded)
 */
export function transformCallsWithBuilderCode<T extends {
  address?: `0x${string}`;
  to?: `0x${string}`;
  abi?: any;
  functionName?: string;
  args?: any[];
  data?: `0x${string}`;
  value?: bigint;
}>(calls: T[], skipPreEncodingForPrivyEmbedded: boolean = false): T[] {
  const suffix = getDataSuffix();

  return calls.map((call) => {
    // For Privy embedded wallets, don't transform at all - let them use capabilities
    // This preserves the original ABI format which works better with Privy embedded wallets
    if (skipPreEncodingForPrivyEmbedded) {
      return call;
    }

    // If call has abi/functionName, it's a contract call that needs encoding
    // Encode to raw format for EOA wallets that don't support ERC-5792 capabilities
    // (ABIs contain function objects that cannot be structured-cloned for some wallets)
    if (call.abi && call.functionName) {
      const encodedData = encodeFunctionData({
        abi: call.abi,
        functionName: call.functionName,
        args: call.args || [],
      });

      // Return as raw call with pre-encoded data and builder suffix
      // Create a completely new object without any reference to the original ABI
      return {
        to: call.address || call.to,
        data: suffix ? appendBuilderSuffix(encodedData) : encodedData,
        value: call.value,
      } as T;
    }

    // If call already has data, append suffix if available
    if (call.data) {
      // Create a new object to ensure no non-serializable properties are retained
      return {
        to: call.to,
        data: suffix ? appendBuilderSuffix(call.data) : call.data,
        value: call.value,
      } as T;
    }

    // Fallback: return a clean copy
    return {
      to: call.address || call.to,
      data: call.data,
      value: call.value,
    } as T;
  });
}

