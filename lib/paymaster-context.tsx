"use client";

import { createContext, useContext, ReactNode } from "react";

interface PaymasterContextType {
  isPaymasterEnabled: boolean;
  isSponsored: boolean;
}

const PaymasterContext = createContext<PaymasterContextType | undefined>(undefined);

export function PaymasterProvider({ children }: { children: ReactNode }) {
  // Environment-controlled paymaster setting
  const isPaymasterEnabled = process.env.NEXT_PUBLIC_PAYMASTER_ENABLED === 'true';

  // Check if current environment supports sponsored transactions
  // For CDP integration, we primarily need the CDP API key
  const isSponsored = isPaymasterEnabled && Boolean(process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY);

  return (
    <PaymasterContext.Provider value={{
      isPaymasterEnabled,
      isSponsored
    }}>
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