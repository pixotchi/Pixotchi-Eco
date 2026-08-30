"use client";

import { createContext, useContext, ReactNode } from "react";

interface PaymasterContextType {
  isPaymasterEnabled: boolean;
  isSponsored: boolean;
}

const PaymasterContext = createContext<PaymasterContextType | undefined>(undefined);

// Env-derived constants: this value can never change at runtime, yet it used
// to be a fresh object literal per render of a provider ABOVE PrivyProvider —
// every consumer (the heaviest tabs and the whole transactions family)
// re-rendered whenever the tower did.
const IS_PAYMASTER_ENABLED = process.env.NEXT_PUBLIC_PAYMASTER_ENABLED === 'true';
const PAYMASTER_CONTEXT_VALUE = Object.freeze({
  isPaymasterEnabled: IS_PAYMASTER_ENABLED,
  // For CDP integration, we primarily need the CDP API key
  isSponsored: IS_PAYMASTER_ENABLED && Boolean(process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY),
});

export function PaymasterProvider({ children }: { children: ReactNode }) {
  // Environment-controlled paymaster setting
  return (
    <PaymasterContext.Provider value={PAYMASTER_CONTEXT_VALUE}>
      {children}
    </PaymasterContext.Provider>
  );
}

export function usePaymaster() {
  const context = useContext(PaymasterContext);
  if (context === undefined) {
    throw new Error('usePaymaster must be used within a PaymasterProvider');
  }
  return context;
} 