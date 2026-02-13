"use client";

/**
 * Builder Codes (ERC-8021) Integration
 * 
 * This module provides utilities for Base Builder Code attribution and
 * transaction-call normalization for wallet compatibility.
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
 * Get a wallet_sendCalls capability payload for data suffix attribution.
 * Note: Prefer client-level `dataSuffix` in Wagmi config for primary integration.
 * 
 * @returns Capability payload with `dataSuffix.value`, or undefined if not configured
 */
export function getBuilderCapabilities():
  | { dataSuffix: { value: string; optional: true } }
  | undefined {
  const suffix = getDataSuffix();
  if (!suffix) return undefined;
  return { dataSuffix: { value: suffix, optional: true } };
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
 * Transform OnchainKit calls into raw serializable calls (`to`, `data`, `value`).
 * 
 * Attribution should be handled by client-level `dataSuffix` in Wagmi config.
 * This helper is focused on compatibility with embedded wallets that cannot
 * structured-clone ABI function objects.
 * 
 * IMPORTANT: This function also ensures calls are converted to raw format
 * (to, data, value) which is critical for Privy embedded wallets. ABIs contain
 * function objects that cannot be structured-cloned for postMessage communication.
 * 
 * @param calls - Array of transaction calls (OnchainKit format)
 * @returns Transformed raw calls without mutating calldata suffix
 */
export function transformCallsWithBuilderCode<T extends {
  address?: `0x${string}`;
  to?: `0x${string}`;
  abi?: any;
  functionName?: string;
  args?: any[];
  data?: `0x${string}`;
  value?: bigint;
}>(calls: T[]): T[] {
  return calls.map((call) => {
    // If call has abi/functionName, it's a contract call that needs encoding
    // ALWAYS encode to raw format to ensure compatibility with Privy embedded wallets
    // (ABIs contain function objects that cannot be structured-cloned)
    if (call.abi && call.functionName) {
      const encodedData = encodeFunctionData({
        abi: call.abi,
        functionName: call.functionName,
        args: call.args || [],
      });

      // Return as raw call with pre-encoded data
      // Create a completely new object without any reference to the original ABI
      return {
        to: call.address || call.to,
        data: encodedData,
        value: call.value,
      } as T;
    }

    // If call already has data, pass through as raw call
    if (call.data) {
      // Create a new object to ensure no non-serializable properties are retained
      return {
        to: call.to,
        data: call.data,
        value: call.value,
      } as T;
    }

    // Fallback: return a clean copy without abi/functionName/args
    // This ensures Privy embedded wallets can serialize the call
    return {
      to: call.address || call.to,
      data: call.data,
      value: call.value,
    } as T;
  });
}
