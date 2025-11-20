"use client";

import { type ReactNode, useEffect, useState } from "react";
import { base } from "wagmi/chains";
import { OnchainKitProvider } from "@coinbase/onchainkit";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "next-themes";
import { PaymasterProvider } from "@/lib/paymaster-context";
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
import { sessionStorageManager } from "@/lib/session-storage-manager";
import { TransactionProvider, TransactionModal, useTransactions } from 'ethereum-identity-kit';
// ... removed TransactionModalWrapper import ...
import { SafeArea } from "@coinbase/onchainkit/minikit";
const TutorialBundle = dynamic(() => import("@/components/tutorial/TutorialBundle"), { ssr: false });
const SlideshowModal = dynamic(() => import("@/components/tutorial/SlideshowModal"), { ssr: false });
const TasksInfoDialog = dynamic(() => import("@/components/tasks/TasksInfoDialog"), { ssr: false });

export function Providers(props: { children: ReactNode }) {
  // Use CDP Client API key for Coinbase SDK
  const apiKey = process.env.NEXT_PUBLIC_CDP_CLIENT_API_KEY;
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

  // Lightweight client-side cache migration: bump this when wallet/provider plumbing changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const CACHE_VERSION = '2025-08-privy-v2';
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

  function WagmiRouter({ children }: { children: ReactNode }) {
    const [isMiniApp, setIsMiniApp] = useState<boolean>(false);
    const [surface, setSurface] = useState<'privy' | 'base' | null>(null); // Initialize as null to avoid hydration mismatch
    const [isInitialized, setIsInitialized] = useState(false);
    
    useEffect(() => {
      let mounted = true;
      let cancelToken = false;
      
      const initializeRouter = async () => {
        try {
          // Sequential initialization with cancellation checks
          // Step 1: Check if we're in a MiniApp
          const flag = await sdk.isInMiniApp();
          
          // Check if component unmounted or cancelled before proceeding
          if (cancelToken || !mounted) return;
          
          setIsMiniApp(Boolean(flag));
          
          // If we're in a MiniApp, we can initialize immediately
          if (Boolean(flag)) {
            if (cancelToken || !mounted) return;
            setIsInitialized(true);
            return;
          }
          
          // Step 2: Determine selected auth surface (only if not MiniApp)
          if (cancelToken || !mounted) return;
          
          if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const urlSurface = params.get('surface');
            
            if (urlSurface === 'privy' || urlSurface === 'base') {
              // Store the surface preference using centralized manager
              try {
                await sessionStorageManager.setAuthSurface(urlSurface as any);
              } catch (e) {
                console.error('Failed to store surface preference:', e);
              }
              
              // Check again before state update
              if (cancelToken || !mounted) return;
              setSurface(urlSurface as 'privy' | 'base');
            } else {
              // Try to get stored preference using centralized manager, fallback to 'privy'
              try {
                const stored = sessionStorageManager.getAuthSurface();
                
                // Check again before state update
                if (cancelToken || !mounted) return;

                // Map 'coinbase' to 'base' for backward compatibility
                const effectiveSurface = stored === 'coinbase' ? 'base' : stored;
                setSurface(effectiveSurface || 'privy');
              } catch (e) {
                console.error('Failed to read surface preference:', e);
                if (cancelToken || !mounted) return;
                setSurface('privy');
              }
            }
          }
          
          // Final initialization check
          if (cancelToken || !mounted) return;
          setIsInitialized(true);
          
        } catch (error) {
          console.error('Failed to initialize router:', error);
          
          // Safe fallback on error
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
    }, []);

    useEffect(() => {
      if (typeof document === 'undefined') return;
      const miniTitle = "Pixotchi Mini - Your pocket farm on Base!";
      const webTitle = "Pixotchi - Your pocket farm on Base!";
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
          </TransactionProvider>
        </CoreWagmiProvider>
      );
    }
    
    // Web: choose a single provider per session based on selected surface
    if (surface === 'base') {
      return (
        <CoreWagmiProvider config={wagmiWebOnchainkitConfig}>
          <TransactionProvider 
            defaultChainId={8453}
            paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
          >
            {children}
          </TransactionProvider>
        </CoreWagmiProvider>
      );
    }
    
    // default & 'privy'
    return (
      <PrivyWagmiProvider config={wagmiPrivyConfig}>
        <TransactionProvider 
          defaultChainId={8453}
          paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
        >
          {children}
        </TransactionProvider>
      </PrivyWagmiProvider>
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
        <PaymasterProvider>
        <PrivyProvider
          appId={privyAppId}
          config={{
            // Keep config minimal and safe; can be extended via env flags later
            appearance: {
              theme: 'light',
              walletList: ['detected_ethereum_wallets', 'base_account'],
            },
            defaultChain: base,
            supportedChains: [base],
            loginMethods: ['wallet', 'email'],
            // Avoid session race conditions by not auto-connecting until hooks report ready
        embeddedWallets: {
          // Privy v3: configure per-chain behavior (top-level createOnLogin removed)
          ethereum: { createOnLogin: 'off' },
        },
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
                      <BalanceProvider>
                        <LoadingProvider>
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
                        </LoadingProvider>
                      </BalanceProvider>
                    </SmartWalletProvider>
                  </FrameProvider>
                </SafeArea>
              </OnchainKitProvider>
            </WagmiRouter>
          </QueryClientProvider>
        </PrivyProvider>
      </PaymasterProvider>
    </ServerThemeProvider>
    </ErrorBoundary>
  );
}
