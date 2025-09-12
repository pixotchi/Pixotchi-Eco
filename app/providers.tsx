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

  // Debug log to ensure API key is available (remove in production)
  if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
    console.log('🔑 MiniKit API Key configured:', !!apiKey);
  }

  // Privy App ID may be undefined at build time; provide a safe default to satisfy types.
  const privyAppId: string = (process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '') as string;

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
    useEffect(() => {
      let mounted = true;
      (async () => {
        try {
          const flag = await sdk.isInMiniApp();
          if (mounted) setIsMiniApp(Boolean(flag));
        } catch {
          if (mounted) setIsMiniApp(false);
        }
      })();
      return () => { mounted = false; };
    }, []);

    // Mini App: use Farcaster connector. Web: use Privy wagmi as the single app-level wagmi (includes CB + injected + embedded wallet support)
    if (isMiniApp) {
      return <CoreWagmiProvider config={wagmiMiniAppConfig}>{children}</CoreWagmiProvider>;
    }
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
              walletList: ['detected_ethereum_wallets', 'base_account', 'universal_profile'],
            },
            defaultChain: base,
            supportedChains: [base],
            loginMethods: ['wallet', 'email'],
            // Avoid session race conditions by not auto-connecting until hooks report ready
            embeddedWallets: { createOnLogin: 'users-without-wallets' },
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
