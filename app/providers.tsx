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

  // Environment variable validation with fallback
  const privyAppId: string = (() => {
    const envAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    const fallbackAppId = 'clsjenoh000mhigrekjgcpjpd';
    
    if (!envAppId) {
      console.warn('NEXT_PUBLIC_PRIVY_APP_ID not configured, using fallback');
      return fallbackAppId;
    }
    
    if (envAppId.trim() === '') {
      console.warn('NEXT_PUBLIC_PRIVY_APP_ID is empty, using fallback');
      return fallbackAppId;
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


    } catch {}
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
    const [surface, setSurface] = useState<'privy' | 'coinbase'>('privy'); // Default to privy instead of null
    const [isInitialized, setIsInitialized] = useState(false);
    
    useEffect(() => {
      let mounted = true;
      
      const initializeRouter = async () => {
        try {
          // Check if we're in a MiniApp
          const flag = await sdk.isInMiniApp();
          if (mounted) setIsMiniApp(Boolean(flag));
        } catch {
          if (mounted) setIsMiniApp(false);
        }
        
        // Determine selected auth surface (persisted or via URL)
        try {
          if (!mounted) return;
          if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const urlSurface = params.get('surface');
            const key = 'pixotchi:authSurface';
            
            if (urlSurface === 'privy' || urlSurface === 'coinbase') {
              // Store the surface preference
              try {
                sessionStorage.setItem(key, urlSurface);
              } catch (e) {
                console.warn('Failed to store surface preference:', e);
              }
              setSurface(urlSurface as 'privy' | 'coinbase');
            } else {
              // Try to get stored preference, fallback to 'privy'
              try {
                const stored = sessionStorage.getItem(key) as 'privy' | 'coinbase' | null;
                setSurface(stored || 'privy');
              } catch (e) {
                console.warn('Failed to read surface preference:', e);
                setSurface('privy');
              }
            }
          }
        } catch (error) {
          console.warn('Failed to initialize surface:', error);
          setSurface('privy'); // Fallback to privy on any error
        }
        
        if (mounted) {
          setIsInitialized(true);
        }
      };
      
      initializeRouter();
      return () => { mounted = false; };
    }, []);

    // Show loading state until initialization is complete
    if (!isInitialized) {
      return <div>Loading...</div>;
    }

    // Mini App: use Farcaster connector.
    if (isMiniApp) {
      return <CoreWagmiProvider config={wagmiMiniAppConfig}>{children}</CoreWagmiProvider>;
    }
    
    // Web: choose a single provider per session based on selected surface
    if (surface === 'coinbase') {
      return <CoreWagmiProvider config={wagmiWebOnchainkitConfig}>{children}</CoreWagmiProvider>;
    }
    
    // default & 'privy'
    return <PrivyWagmiProvider config={wagmiPrivyConfig}>{children}</PrivyWagmiProvider>;
  }

  return (
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
              createOnLogin: 'off' // Prevent automatic embedded wallet creation
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
                        background: "hsl(var(--background))",
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
                      </LoadingProvider>
                    </BalanceProvider>
                  </SmartWalletProvider>
                </FrameProvider>
              </OnchainKitProvider>
            </WagmiRouter>
          </QueryClientProvider>
        </PrivyProvider>
      </PaymasterProvider>
    </ServerThemeProvider>
  );
}
