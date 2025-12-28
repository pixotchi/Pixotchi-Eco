"use client";

import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from "react";
import { useSmartWallet } from "./smart-wallet-context";

const ETH_MODE_STORAGE_KEY = "pixotchi:eth_mode";

interface EthModeContextType {
  /** Whether ETH Mode is currently enabled */
  isEthModeEnabled: boolean;
  /** Toggle ETH Mode on/off */
  toggleEthMode: () => void;
  /** Set ETH Mode explicitly */
  setEthModeEnabled: (enabled: boolean) => void;
  /** Whether the user can use ETH Mode (requires smart wallet) */
  canUseEthMode: boolean;
  /** Whether ETH Mode context is still loading */
  isLoading: boolean;
}

const EthModeContext = createContext<EthModeContextType | undefined>(undefined);

export function EthModeProvider({ children }: { children: ReactNode }) {
  const { isSmartWallet, isLoading: isSmartWalletLoading } = useSmartWallet();
  const [isEnabled, setIsEnabled] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ETH_MODE_STORAGE_KEY);
      if (stored === "true") {
        setIsEnabled(true);
      }
    } catch (e) {
      // localStorage not available (SSR or privacy mode)
      console.warn("[EthMode] Failed to read localStorage:", e);
    }
    setIsInitialized(true);
  }, []);

  // Persist state changes
  const persistState = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(ETH_MODE_STORAGE_KEY, enabled ? "true" : "false");
    } catch (e) {
      console.warn("[EthMode] Failed to write localStorage:", e);
    }
  }, []);

  const toggleEthMode = useCallback(() => {
    setIsEnabled(prev => {
      const newValue = !prev;
      persistState(newValue);
      return newValue;
    });
  }, [persistState]);

  const setEthModeEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
    persistState(enabled);
  }, [persistState]);

  // ETH Mode can only be used by smart wallet users
  const canUseEthMode = isSmartWallet;
  
  // If user is not on smart wallet, force disable ETH mode
  const effectiveEnabled = canUseEthMode && isEnabled;

  return (
    <EthModeContext.Provider
      value={{
        isEthModeEnabled: effectiveEnabled,
        toggleEthMode,
        setEthModeEnabled,
        canUseEthMode,
        isLoading: !isInitialized || isSmartWalletLoading,
      }}
    >
      {children}
    </EthModeContext.Provider>
  );
}

export function useEthMode() {
  const context = useContext(EthModeContext);
  if (context === undefined) {
    throw new Error("useEthMode must be used within an EthModeProvider");
  }
  return context;
}
