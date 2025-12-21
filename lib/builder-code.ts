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

// Builder code from base.dev - set via environment variable
const BUILDER_CODE = CLIENT_ENV.BUILDER_CODE;

// Enable debug logging for Privy serialization issues
const DEBUG_SERIALIZATION = process.env.NODE_ENV === 'development' ||
  (typeof window !== 'undefined' && (window as any).__PRIVY_DEBUG__);

/**
 * Debug utility to find non-serializable properties in an object.
 * Helps diagnose postMessage cloning errors with Privy embedded wallets.
 */
function findNonSerializableProperties(obj: any, path: string = 'root'): string[] {
  const issues: string[] = [];

  if (obj === null || obj === undefined) return issues;

  const type = typeof obj;

  // Check for non-serializable types
  if (type === 'function') {
    issues.push(`${path}: function (${obj.toString().slice(0, 50)}...)`);
    return issues;
  }

  if (type === 'symbol') {
    issues.push(`${path}: symbol`);
    return issues;
  }

  if (obj instanceof Error) {
    issues.push(`${path}: Error object`);
    return issues;
  }

  if (obj instanceof Map || obj instanceof Set || obj instanceof WeakMap || obj instanceof WeakSet) {
    issues.push(`${path}: ${obj.constructor.name}`);
    return issues;
  }

  if (type === 'object') {
    // Check for DOM nodes
    if (typeof Node !== 'undefined' && obj instanceof Node) {
      issues.push(`${path}: DOM Node`);
      return issues;
    }

    // Check for circular references (simple check)
    try {
      JSON.stringify(obj);
    } catch (e) {
      if (e instanceof TypeError && String(e).includes('circular')) {
        issues.push(`${path}: circular reference`);
        return issues;
      }
    }

    // Recursively check object properties
    for (const key of Object.keys(obj)) {
      try {
        const value = obj[key];
        const childIssues = findNonSerializableProperties(value, `${path}.${key}`);
        issues.push(...childIssues);
      } catch (e) {
        issues.push(`${path}.${key}: error accessing property`);
      }
    }

    // Also check prototype chain for getters that might return functions
    const proto = Object.getPrototypeOf(obj);
    if (proto && proto !== Object.prototype && proto !== Array.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(proto);
      for (const [key, desc] of Object.entries(descriptors)) {
        if (desc.get && key !== 'constructor') {
          try {
            const value = obj[key];
            if (typeof value === 'function') {
              issues.push(`${path}.${key} (getter): returns function`);
            }
          } catch (e) {
            // Getter threw, skip
          }
        }
      }
    }
  }

  return issues;
}

/**
 * Debug log transaction data to console for Privy serialization debugging.
 */
export function debugLogTransactionData(label: string, data: {
  calls?: any[];
  capabilities?: any;
  transformedCalls?: any[];
}) {
  if (!DEBUG_SERIALIZATION) return;

  console.group(`[Privy Debug] ${label}`);

  if (data.calls) {
    console.log('Original calls:', data.calls);
    const callIssues = data.calls.flatMap((call, i) =>
      findNonSerializableProperties(call, `calls[${i}]`)
    );
    if (callIssues.length > 0) {
      console.warn('⚠️ Non-serializable in original calls:', callIssues);
    }
  }

  if (data.transformedCalls) {
    console.log('Transformed calls:', data.transformedCalls);
    const transformedIssues = data.transformedCalls.flatMap((call, i) =>
      findNonSerializableProperties(call, `transformedCalls[${i}]`)
    );
    if (transformedIssues.length > 0) {
      console.warn('⚠️ Non-serializable in transformed calls:', transformedIssues);
    } else {
      console.log('✅ Transformed calls appear serializable');
    }
  }

  if (data.capabilities) {
    console.log('Capabilities:', data.capabilities);
    const capIssues = findNonSerializableProperties(data.capabilities, 'capabilities');
    if (capIssues.length > 0) {
      console.warn('⚠️ Non-serializable in capabilities:', capIssues);
    } else {
      console.log('✅ Capabilities appear serializable');
    }
  }

  console.groupEnd();
}

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
 * Ensure capabilities object is fully serializable for postMessage.
 * 
 * Privy embedded wallets communicate via iframe postMessage which requires
 * all data to be serializable by the Structured Clone Algorithm.
 * This function strips any functions, getters, or other non-serializable
 * properties that may be attached by the ox/erc8021 library or viem.
 * 
 * @param capabilities - The capabilities object from getBuilderCapabilities
 * @returns A clean, serializable copy of capabilities
 */
export function serializeCapabilities(
  capabilities: { dataSuffix: string } | undefined
): { dataSuffix: string } | undefined {
  if (!capabilities) return undefined;

  // Create a clean copy with only primitive values
  // JSON.parse(JSON.stringify()) strips functions, getters, and non-serializable properties
  try {
    return JSON.parse(JSON.stringify(capabilities));
  } catch (error) {
    console.warn('[BuilderCode] Failed to serialize capabilities, returning undefined:', error);
    return undefined;
  }
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
 * Transform OnchainKit calls to include builder code suffix in the calldata.
 * 
 * This is necessary because OnchainKit only passes capabilities (including dataSuffix)
 * to wallets that support wallet_sendCalls (ERC-5792). For EOA wallets like Rabby,
 * MetaMask, etc., the capabilities are ignored.
 * 
 * By pre-encoding the calldata with the suffix, we ensure builder attribution
 * works across ALL wallet types.
 * 
 * IMPORTANT: This function also ensures calls are converted to raw format
 * (to, data, value) which is critical for Privy embedded wallets. ABIs contain
 * function objects that cannot be structured-cloned for postMessage communication.
 * 
 * @param calls - Array of transaction calls (OnchainKit format)
 * @returns Transformed calls with builder suffix baked into calldata (raw format)
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
  const suffix = getDataSuffix();

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

      // Return as raw call with pre-encoded data (and suffix if configured)
      // Create a completely new object without any reference to the original ABI
      return {
        to: call.address || call.to,
        data: suffix ? appendBuilderSuffix(encodedData) : encodedData,
        value: call.value,
      } as T;
    }

    // If call already has data, optionally append suffix
    if (call.data) {
      // Create a new object to ensure no non-serializable properties are retained
      return {
        to: call.to,
        data: suffix ? appendBuilderSuffix(call.data) : call.data,
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

