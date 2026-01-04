"use client";

import { type ReactNode, useEffect, useState, useMemo } from "react";
import { base } from "wagmi/chains";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "next-themes";
import { PaymasterProvider } from "@/lib/paymaster-context";
import { EthModeProvider } from "@/lib/eth-mode-context";
import { SmartWalletProvider } from "@/lib/smart-wallet-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
// Privy wagmi will be scoped locally where needed (login UI) to avoid intercepting OnchainKit
import { WagmiProvider as CoreWagmiProvider } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { wagmiWebOnchainkitConfig } from "@/lib/wagmi-web-onchainkit-config";
import { wagmiMiniAppConfig } from "@/lib/wagmi-miniapp-config";
import { wagmiPrivyConfig } from "@/lib/wagmi-privy-config";
import { FrameProvider } from "@/lib/frame-context";
import { sdk } from "@farcaster/miniapp-sdk";
import { clearAppCaches, markCacheVersion, needsCacheMigration } from "@/lib/cache-utils";
import dynamic from "next/dynamic";
import { BalanceProvider } from "@/lib/balance-context";
import { LoadingProvider } from "@/lib/loading-context";
import { applyTheme } from "@/lib/theme-utils";
import { ThemeInitializer } from "@/components/theme-initializer";
import { ServerThemeProvider } from "@/components/server-theme-provider";
import ErrorBoundary from "@/components/ui/error-boundary";
import { SecretGardenListener } from "@/components/secret-garden-listener";
import { SnowEffect } from "@/components/ui/snow-effect";
import { SnowProvider } from "@/lib/snow-context";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import { TransactionProvider, TransactionModal, useTransactions } from 'ethereum-identity-kit';
import { TransactionModalWrapper } from '@/components/transaction-modal-wrapper';
import { SafeArea } from "@coinbase/onchainkit/minikit";
import { SolanaWalletProvider, isSolanaEnabled } from '@/components/solana';
import { ChatProvider } from "@/components/chat/chat-context";

// Surface types for auth provider selection
type AuthSurface = 'privy' | 'base' | 'privysolana';

// Solana RPC config for Privy - mainnet only
const getSolanaRpcConfig = () => {
  if (typeof window === 'undefined' || !isSolanaEnabled()) return undefined;

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  // Return simple RPC config for Privy (not @solana/kit format)
  return {
    mainnet: rpcUrl,
  };
};

// Get Solana connectors for Privy
// Using dynamic import to avoid build issues when Solana is not enabled
const getSolanaConnectors = () => {
  if (!isSolanaEnabled()) return undefined;

  try {
    // Import Solana wallet connectors from Privy
    const privySolana = require('@privy-io/react-auth/solana');
    if (privySolana?.toSolanaWalletConnectors) {
      return privySolana.toSolanaWalletConnectors({
        shouldAutoConnect: true
      });
    }
    return undefined;
  } catch (error) {
    console.warn('[Providers] Failed to load Solana connectors:', error);
    return undefined;
  }
};

const TutorialBundle = dynamic(() => import("@/components/tutorial/TutorialBundle"), { ssr: false });
const SlideshowModal = dynamic(() => import("@/components/tutorial/SlideshowModal"), { ssr: false });
const TasksInfoDialog = dynamic(() => import("@/components/tasks/TasksInfoDialog"), { ssr: false });

// TanStack Query client - created outside component to prevent recreation on every render
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 2,
    },
    mutations: {
      retry: 1,
    },
  },
});

export function Providers(props: { children: ReactNode }) {
  // Use CDP Client API key for Coinbase SDK
  const apiKey = process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY;

  // MiniKit API key validation handled internally

  // Environment variable validation (fail fast in production, warn in dev)
  const privyAppId: string = (() => {
    const envAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    if (!envAppId || envAppId.trim() === '') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('NEXT_PUBLIC_PRIVY_APP_ID is required in production');
      } else {
        console.warn('NEXT_PUBLIC_PRIVY_APP_ID not configured (dev)');
        return 'dev-placeholder-app-id';
      }
    }
    return envAppId;
  })();

  // ===== EARLY SURFACE DETECTION =====
  // Determine surface BEFORE rendering PrivyProvider so we can configure it correctly
  const [authSurface, setAuthSurface] = useState<AuthSurface>('privy');
  const [surfaceInitialized, setSurfaceInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSurfaceInitialized(true);
      return;
    }

    // Check URL param first
    const params = new URLSearchParams(window.location.search);
    const urlSurface = params.get('surface');

    if (urlSurface === 'privy' || urlSurface === 'base' || urlSurface === 'privysolana') {
      sessionStorageManager.setAuthSurface(urlSurface);
      setAuthSurface(urlSurface);
    } else {
      // Get from storage
      const stored = sessionStorageManager.getAuthSurface();
      // Map 'coinbase' to 'base' for backward compatibility
      const effective = stored === 'coinbase' ? 'base' : (stored || 'privy');
      setAuthSurface(effective as AuthSurface);
    }

    setSurfaceInitialized(true);
  }, []);

  // Lightweight client-side cache migration: bump this when wallet/provider plumbing changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const CACHE_VERSION = '2025-08-privy-v3-solana';
    try {
      if (needsCacheMigration(CACHE_VERSION)) {
        // Soft clear without unregistering SW, no reload
        clearAppCaches({
          unregisterServiceWorkers: false,
          reloadAfter: false,
          preserveLocalStorageKeys: ["pixotchi:tutorial", "pixotchi:cache_version"],
          // Only clear our own keys to avoid racing Privy/OnchainKit first-load state
          onlyPrefixes: ["pixotchi", "pixotchi:"]
        });
        markCacheVersion(CACHE_VERSION);
      }
    } catch (error) {
      console.error('Cache migration failed:', error);
      // Non-critical - cache migration failure shouldn't break the app
    }
  }, []);

  // Respect user preference for reduced motion (don't arbitrarily disable on touch devices)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const root = document.documentElement;
      if (mql.matches) root.classList.add('motion-off');
      else root.classList.remove('motion-off');
    };
    apply();
    try {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    } catch {
      // Safari fallback
      mql.addListener?.(apply as any);
      return () => mql.removeListener?.(apply as any);
    }
  }, []);

  // Determine PrivyProvider wallet config based on surface
  const privyWalletConfig = useMemo(() => {
    const isSolanaMode = authSurface === 'privysolana';
    const solanaEnabled = isSolanaEnabled();

    // Solana-only mode: only show Solana wallets
    if (isSolanaMode && solanaEnabled) {
      const solanaConnectors = getSolanaConnectors();
      const solanaRpcs = getSolanaRpcConfig();

      // Safety check: connectors must be present for Solana mode
      if (solanaConnectors) {
        return {
          walletChainType: 'solana-only' as const,
          // Show popular Solana wallets
          walletList: ['phantom', 'solflare', 'backpack', 'detected_solana_wallets'] as any,
          externalWallets: {
            solana: {
              connectors: solanaConnectors,
            },
          },
          // Privy Solana RPC config (mainnet only)
          solana: solanaRpcs ? {
            rpcUrl: solanaRpcs.mainnet,
          } : undefined,
        };
      }

      console.warn('[Providers] Solana enabled but connectors failed to load. Falling back to EVM-only mode.');
    }

    // EVM-only mode (default): only show Ethereum wallets
    // This runs if not Solana mode OR if Solana mode failed to load connectors
    return {
      walletChainType: 'ethereum-only' as const,
      walletList: ['detected_ethereum_wallets'],
      externalWallets: undefined,
      solana: undefined,
    };
  }, [authSurface]);

  function WagmiRouter({ children }: { children: ReactNode }) {
    const [isMiniApp, setIsMiniApp] = useState<boolean>(false);
    const [surface, setSurface] = useState<AuthSurface>('privy');
    const [isInitialized, setIsInitialized] = useState(false);

    useEffect(() => {
      let mounted = true;
      let cancelToken = false;

      const initializeRouter = async () => {
        try {
          // Step 1: Check if we're in a MiniApp
          const flag = await sdk.isInMiniApp();

          if (cancelToken || !mounted) return;

          setIsMiniApp(Boolean(flag));

          if (Boolean(flag)) {
            if (cancelToken || !mounted) return;
            setIsInitialized(true);
            return;
          }

          // Step 2: Use the already-determined auth surface
          if (cancelToken || !mounted) return;
          setSurface(authSurface);

          // Final initialization
          if (cancelToken || !mounted) return;
          setIsInitialized(true);

        } catch (error) {
          console.error('Failed to initialize router:', error);
          if (cancelToken || !mounted) return;
          setSurface('privy');
          setIsInitialized(true);
        }
      };

      initializeRouter();

      return () => {
        cancelToken = true;
        mounted = false;
      };
    }, [authSurface]);

    useEffect(() => {
      if (typeof document === 'undefined') return;
      const miniTitle = "Pixotchi Mini - Grow your farm, Earn rewards!";
      const webTitle = "Pixotchi - Grow your farm, Earn rewards!";
      document.title = isMiniApp ? miniTitle : webTitle;
    }, [isMiniApp]);

    // Show loading state until initialization is complete
    if (!isInitialized) {
      return <div>Loading...</div>;
    }

    // Mini App: use Farcaster connector.
    if (isMiniApp) {
      return (
        <CoreWagmiProvider config={wagmiMiniAppConfig}>
          <TransactionProvider
            defaultChainId={8453}
            paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
          >
            {children}
            <TransactionModalWrapper className="!z-[1300]" />
          </TransactionProvider>
        </CoreWagmiProvider>
      );
    }

    // Web: choose provider based on surface
    if (surface === 'base') {
      return (
        <CoreWagmiProvider config={wagmiWebOnchainkitConfig}>
          <TransactionProvider
            defaultChainId={8453}
            paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
          >
            {children}
            <TransactionModalWrapper className="!z-[1300]" />
          </TransactionProvider>
        </CoreWagmiProvider>
      );
    }

    // 'privy' and 'privysolana' both use PrivyWagmiProvider
    // (Solana doesn't use wagmi, so same provider works)
    return (
      <PrivyWagmiProvider config={wagmiPrivyConfig}>
        <TransactionProvider
          defaultChainId={8453}
          paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
        >
          {children}
          <TransactionModalWrapper className="!z-[1300]" />
        </TransactionProvider>
      </PrivyWagmiProvider>
    );
  }

  // Don't render until surface is determined (to configure PrivyProvider correctly)
  if (!surfaceInitialized) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-pulse">Loading...</div>
      </div>
    );
  }

  return (
    <ErrorBoundary variant="card" onError={(error) => {
      console.error('[Providers] Critical error in provider initialization:', error);
    }}>
      <ServerThemeProvider
        defaultTheme="light"
        storageKey="pixotchi-theme"
        themes={["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"]}
      >
        <ThemeInitializer />
        <SnowProvider>
          <PaymasterProvider>
            <PrivyProvider
              appId={privyAppId}
              config={{
                // Dynamic config based on selected surface (privy vs privysolana)
                appearance: {
                  theme: 'light',
                  walletChainType: privyWalletConfig.walletChainType,
                  // Specify walletList based on mode
                  ...(privyWalletConfig.walletList && {
                    walletList: privyWalletConfig.walletList,
                  }),
                },
                defaultChain: base,
                supportedChains: [base],
                loginMethods: ['wallet', 'email'],
                // Avoid session race conditions by not auto-connecting until hooks report ready
                embeddedWallets: {
                  // Privy v3: configure per-chain behavior (top-level createOnLogin removed)
                  ethereum: { createOnLogin: 'off' },
                },
                // Solana RPC config (only when in Solana mode)
                ...(privyWalletConfig.solana && {
                  solanaClusters: [
                    {
                      name: 'mainnet-beta',
                      rpcUrl: privyWalletConfig.solana.rpcUrl || 'https://api.mainnet-beta.solana.com',
                    },
                  ],
                }),
                // External Solana wallet connectors (only when in Solana mode)
                ...(privyWalletConfig.externalWallets && {
                  externalWallets: privyWalletConfig.externalWallets,
                }),
              }}
            >
              <QueryClientProvider client={queryClient}>
                <WagmiRouter>
                  <OnchainKitProvider
                    apiKey={apiKey}
                    chain={base}
                    config={{
                      appearance: {
                        mode: "auto",
                        name: "Pixotchi Mini",
                        logo: process.env.NEXT_PUBLIC_ICON_URL,
                      },
                      paymaster: process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL,
                      analytics: true,
                    }}
                    miniKit={{
                      enabled: true,
                      autoConnect: true,
                      notificationProxyUrl: "/api/notify",
                    }}
                  >
                    <SafeArea>
                      <FrameProvider>
                        <SmartWalletProvider>
                          <EthModeProvider>
                            <SolanaWalletProvider>
                              <BalanceProvider>
                                <LoadingProvider>
                                  <ChatProvider>
                                    <TutorialBundle>
                                      {/* Tutorial slideshow provider at root so it can render a modal on top of everything */}
                                      {/* It internally reads NEXT_PUBLIC_TUTORIAL_SLIDESHOW */}
                                      {/** added provider wrapper **/}
                                      {/* eslint-disable-next-line react/no-children-prop */}
                                      <Toaster
                                        position="top-center"
                                        toastOptions={{
                                          duration: 4000,
                                          style: {
                                            backgroundColor: "hsl(var(--background))",
                                            color: "hsl(var(--foreground))",
                                            border: "1px solid hsl(var(--border))",
                                            zIndex: 9999,
                                          },
                                          success: {
                                            iconTheme: {
                                              primary: "hsl(var(--primary))",
                                              secondary: "hsl(var(--primary-foreground))",
                                            },
                                          },
                                          error: {
                                            iconTheme: {
                                              primary: "hsl(var(--destructive))",
                                              secondary: "hsl(var(--destructive-foreground))",
                                            },
                                          },
                                        }}
                                        containerStyle={{
                                          zIndex: 9999,
                                        }}
                                      />
                                      {props.children}
                                      <SlideshowModal />
                                    </TutorialBundle>
                                    <TasksInfoDialog />
                                    <SecretGardenListener />
                                    <SnowEffect />
                                  </ChatProvider>
                                </LoadingProvider>
                              </BalanceProvider>
                            </SolanaWalletProvider>
                          </EthModeProvider>
                        </SmartWalletProvider>
                      </FrameProvider>
                    </SafeArea>
                  </OnchainKitProvider>
                </WagmiRouter>
              </QueryClientProvider>
            </PrivyProvider>
          </PaymasterProvider>
        </SnowProvider>
      </ServerThemeProvider>
    </ErrorBoundary>
  );
}
