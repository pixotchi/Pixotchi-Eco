"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { base } from "wagmi/chains";
import { PaymasterProvider } from "@/lib/paymaster-context";
import { EthModeProvider } from "@/lib/eth-mode-context";
import { SmartWalletProvider } from "@/lib/smart-wallet-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { sdk } from "@farcaster/miniapp-sdk";
import { WagmiProvider as CoreWagmiProvider } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { wagmiWebBaseConfig } from "@/lib/wagmi-web-base-config";
import { wagmiMiniAppConfig } from "@/lib/wagmi-miniapp-config";
import { wagmiPrivyConfig } from "@/lib/wagmi-privy-config";
import { wagmiLocalTestConfig } from "@/lib/wagmi-local-test-config";
import { FrameProvider } from "@/lib/frame-context";
import {
  HostEnvironmentProvider,
  type HostEnvironmentState,
  useHostEnvironment,
} from "@/lib/host-environment";
import dynamic from "next/dynamic";
import { BalanceProvider } from "@/lib/balance-context";
import { LoadingProvider } from "@/lib/loading-context";
import { ThemeInitializer } from "@/components/theme-initializer";
import { ServerThemeProvider } from "@/components/server-theme-provider";
import ErrorBoundary from "@/components/ui/error-boundary";
import { SecretGardenListener } from "@/components/secret-garden-listener";
import { SnowEffect } from "@/components/ui/snow-effect";
import { SnowProvider } from "@/lib/snow-context";
import { AmbientAudioProvider } from "@/lib/ambient-audio-context";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import { SolanaWalletProvider, isSolanaEnabled } from '@/components/solana';
import { ChatProvider } from "@/components/chat/chat-context";
import { AppUpdateBanner } from "@/components/app-update-banner";
import { AppToaster } from "@/components/ui/app-toaster";
import { PerformanceModeController } from "@/components/ui/performance-mode";
import { ScrollFadeController } from "@/components/ui/scroll-fade-controller";
import { usePathname } from "next/navigation";
import {
  AuthSurface,
  DEFAULT_AUTH_SURFACE,
  resolvePreferredAuthSurface,
} from "@/lib/auth-surface";
import {
  clearConfirmedMiniAppSession,
} from "@/lib/confirmed-miniapp-session";
import { getPrivySolanaConnectors, hasUsableSolanaConnectors } from "@/lib/solana-auth-availability";

const DEFAULT_SOLANA_RPC_URL = 'https://api.mainnet-beta.solana.com';
const DESKTOP_EVM_WALLET_LIST = [
  'metamask',
  'coinbase_wallet',
  'rainbow',
  'detected_ethereum_wallets',
  'wallet_connect_qr',
] as const;
const MOBILE_EVM_WALLET_LIST = [
  'metamask',
  'coinbase_wallet',
  'rainbow',
] as const;
const DESKTOP_SOLANA_WALLET_LIST = [
  'phantom',
  'solflare',
  'backpack',
  'detected_solana_wallets',
  'wallet_connect_qr_solana',
] as const;
const MOBILE_SOLANA_WALLET_LIST = [
  'phantom',
  'solflare',
  'backpack',
] as const;
const PRIVY_LOGIN_METHODS: Array<'wallet' | 'email'> = ['wallet', 'email'];

function isMobileWalletBrowser() {
  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function toSolanaRpcSubscriptionsUrl(rpcUrl: string) {
  try {
    const url = new URL(rpcUrl);
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }
    return url.toString();
  } catch {
    if (rpcUrl.startsWith('https://')) {
      return `wss://${rpcUrl.slice('https://'.length)}`;
    }
    if (rpcUrl.startsWith('http://')) {
      return `ws://${rpcUrl.slice('http://'.length)}`;
    }
    return rpcUrl;
  }
}

// Solana RPC config for Privy - mainnet only
const getSolanaRpcConfig = () => {
  if (typeof window === 'undefined' || !isSolanaEnabled()) return undefined;

  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL;
  const rpcSubscriptionsUrl = toSolanaRpcSubscriptionsUrl(rpcUrl);

  try {
    const { createSolanaRpc, createSolanaRpcSubscriptions } = require('@solana/kit');

    return {
      rpcs: {
        'solana:mainnet': {
          blockExplorerUrl: 'https://explorer.solana.com',
          rpc: createSolanaRpc(rpcUrl),
          rpcSubscriptions: createSolanaRpcSubscriptions(rpcSubscriptionsUrl),
        },
      },
    };
  } catch (error) {
    console.warn('[Providers] Failed to load Solana RPC clients for Privy:', error);
    return undefined;
  }
};

const TutorialBundle = dynamic(() => import("@/components/tutorial/TutorialBundle"), { ssr: false });
const SlideshowModal = dynamic(() => import("@/components/tutorial/SlideshowModal"), { ssr: false });
const TasksInfoDialog = dynamic(() => import("@/components/tasks/TasksInfoDialog"), { ssr: false });

function createQueryClient() {
  return new QueryClient({
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
}

function WagmiRouter({
  authSurface,
  children,
  hostEnvironmentState,
}: {
  authSurface: AuthSurface;
  children: ReactNode;
  hostEnvironmentState: HostEnvironmentState;
}) {
  const isMiniApp = hostEnvironmentState.isMiniApp;
  const surface = authSurface;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.surface = isMiniApp ? 'miniapp' : 'web';
    return () => {
      delete document.documentElement.dataset.surface;
    };
  }, [isMiniApp]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const miniTitle = "Pixotchi Mini - Grow your farm, Earn rewards!";
    const webTitle = "Pixotchi - Grow your farm, Earn rewards!";
    document.title = isMiniApp ? miniTitle : webTitle;
  }, [isMiniApp]);

  if (isMiniApp) {
    return (
      <CoreWagmiProvider config={wagmiMiniAppConfig}>
        {children}
      </CoreWagmiProvider>
    );
  }

  if (surface === 'base') {
    return (
      <CoreWagmiProvider config={wagmiWebBaseConfig}>
        {children}
      </CoreWagmiProvider>
    );
  }

  if (surface === 'test') {
    return (
      <CoreWagmiProvider config={wagmiLocalTestConfig}>
        {children}
      </CoreWagmiProvider>
    );
  }

  return (
    <PrivyWagmiProvider config={wagmiPrivyConfig}>
      {children}
    </PrivyWagmiProvider>
  );
}

export function Providers(props: { children: ReactNode; fallback?: ReactNode }) {
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
  const [isMobilePrivyBrowser, setIsMobilePrivyBrowser] = useState(false);
  const [surfaceInitialized, setSurfaceInitialized] = useState(false);
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSurfaceInitialized(true);
      return;
    }

    const resolvedSurface = resolvePreferredAuthSurface({
      fallback: DEFAULT_AUTH_SURFACE,
      search: window.location.search,
      storedSurface: sessionStorageManager.getAuthSurface(),
    });
    // Fire-and-forget: persisting the surface is best-effort (storage can be
    // blocked), and an unhandled rejection here would surface as a console error
    // on every boot in private-browsing contexts.
    void sessionStorageManager.setAuthSurface(resolvedSurface).catch((error) => {
      console.warn('[Providers] Failed to persist auth surface:', error);
    });
    setAuthSurface(resolvedSurface);

    setSurfaceInitialized(true);
  }, []);

  useEffect(() => {
    setIsMobilePrivyBrowser(isMobileWalletBrowser());
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
      mql.addListener?.(apply as UntypedValue);
      return () => mql.removeListener?.(apply as UntypedValue);
    }
  }, []);

  // Determine PrivyProvider wallet config based on surface
  const privyWalletConfig = useMemo(() => {
    const isSolanaMode = authSurface === 'privysolana';
    const solanaEnabled = isSolanaEnabled();
    const evmWalletList = (
      isMobilePrivyBrowser
        ? MOBILE_EVM_WALLET_LIST
        : DESKTOP_EVM_WALLET_LIST
    ) as UntypedValue;
    const solanaWalletList = (
      isMobilePrivyBrowser
        ? MOBILE_SOLANA_WALLET_LIST
        : DESKTOP_SOLANA_WALLET_LIST
    ) as UntypedValue;
    const solanaConnectors = solanaEnabled ? getPrivySolanaConnectors() : undefined;

    // Solana-only mode: only show Solana wallets
    if (isSolanaMode && solanaEnabled) {
      const solanaRpcs = getSolanaRpcConfig();

      // Safety check: connectors must be present for Solana mode
      if (hasUsableSolanaConnectors(solanaConnectors)) {
        return {
          embeddedWallets: {
            ethereum: { createOnLogin: 'off' as const },
            solana: { createOnLogin: 'users-without-wallets' as const },
          },
          loginMethods: PRIVY_LOGIN_METHODS,
          walletChainType: 'solana-only' as const,
          // Prefer explicit Solana wallets on mobile; add detection/WalletConnect QR on desktop.
          walletList: solanaWalletList,
          externalWallets: {
            solana: {
              connectors: solanaConnectors,
            },
          },
          // Privy Solana RPC config for embedded wallet UIs.
          solana: solanaRpcs,
        };
      }

      console.warn('[Providers] Solana enabled but connectors failed to load. Falling back to EVM-only mode.');
    }

    // EVM-only mode (default): only show Ethereum wallets
    // This runs if not Solana mode OR if Solana mode failed to load connectors
    return {
      embeddedWallets: {
        ethereum: { createOnLogin: 'users-without-wallets' as const },
      },
      loginMethods: PRIVY_LOGIN_METHODS,
      walletChainType: 'ethereum-only' as const,
      // Explicit wallets keep Privy usable on mobile, while detected wallets + QR cover desktop.
      walletList: evmWalletList,
      externalWallets: solanaConnectors
        ? {
          solana: {
            connectors: solanaConnectors,
          },
        }
        : undefined,
      solana: undefined,
    };
  }, [authSurface, isMobilePrivyBrowser]);
  const privyConfig = useMemo(() => ({
    appearance: {
      theme: 'light' as const,
      walletChainType: privyWalletConfig.walletChainType,
      ...(privyWalletConfig.walletList && {
        walletList: privyWalletConfig.walletList,
      }),
    },
    defaultChain: base,
    supportedChains: [base],
    loginMethods: privyWalletConfig.loginMethods,
    embeddedWallets: privyWalletConfig.embeddedWallets,
    ...(privyWalletConfig.solana && {
      solana: privyWalletConfig.solana,
    }),
    ...(privyWalletConfig.externalWallets && {
      externalWallets: privyWalletConfig.externalWallets,
    }),
  }), [privyWalletConfig]);

  // "page" (not "card"): this boundary wraps the entire provider tower, where a
  // max-w-md card floating in an unstyled viewport is the wrong treatment.
  return (
    <ErrorBoundary variant="page" onError={(error) => {
      console.error('[Providers] Critical error in provider initialization:', error);
    }}>
      <ServerThemeProvider
        defaultTheme="light"
        storageKey="pixotchi-theme"
        themes={["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"]}
      >
        <ThemeInitializer />
        <SnowProvider>
          <AmbientAudioProvider>
            <PaymasterProvider>
              <PrivyProvider
                appId={privyAppId}
                config={privyConfig}
              >
                <QueryClientProvider client={queryClient}>
                  <HostEnvironmentProvider>
                    <ProvidersContent
                      authSurface={authSurface}
                      fallback={props.fallback}
                      surfaceInitialized={surfaceInitialized}
                    >
                      {props.children}
                    </ProvidersContent>
                  </HostEnvironmentProvider>
                </QueryClientProvider>
              </PrivyProvider>
            </PaymasterProvider>
          </AmbientAudioProvider>
        </SnowProvider>
      </ServerThemeProvider>
    </ErrorBoundary>
  );
}

function RouteAwareChatProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isStatusRoute = pathname === '/status' || pathname.startsWith('/status/');

  if (isStatusRoute) {
    return <>{children}</>;
  }

  return <ChatProvider>{children}</ChatProvider>;
}

function useMiniAppReadySignal(hostEnvironment: HostEnvironmentState) {
  const readySignalledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || readySignalledRef.current) {
      return;
    }

    if (!hostEnvironment.initialized) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await sdk.actions.ready();
        if (!cancelled) {
          readySignalledRef.current = true;
        }
      } catch (error) {
        if (hostEnvironment.isMiniApp) {
          console.warn('[Providers] Failed to signal sdk.actions.ready():', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    hostEnvironment.initialized,
    hostEnvironment.isMiniApp,
  ]);
}

function ProvidersContent({
  authSurface,
  children,
  fallback,
  surfaceInitialized,
}: {
  authSurface: AuthSurface;
  children: ReactNode;
  fallback?: ReactNode;
  surfaceInitialized: boolean;
}) {
  const hostEnvironment = useHostEnvironment();
  const [hostEnvironmentReady, setHostEnvironmentReady] = useState(
    typeof window === 'undefined',
  );
  const didBootstrapSanitizeRef = useRef(typeof window === 'undefined');

  useMiniAppReadySignal(hostEnvironment);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const previousScrollLock = root.dataset.appShellScroll;

    root.dataset.appShellScroll = 'locked';

    return () => {
      if (previousScrollLock) {
        root.dataset.appShellScroll = previousScrollLock;
        return;
      }

      delete root.dataset.appShellScroll;
    };
  }, []);

  useEffect(() => {
    if (!hostEnvironment.initialized) {
      return;
    }

    if (!didBootstrapSanitizeRef.current) {
      clearConfirmedMiniAppSession('host-bootstrap');
      didBootstrapSanitizeRef.current = true;
      setHostEnvironmentReady(true);
      return;
    }

    if (!hostEnvironment.isMiniApp) {
      clearConfirmedMiniAppSession('host-downgrade');
    }
  }, [
    hostEnvironment.initialized,
    hostEnvironment.isMiniApp,
  ]);

  if (!surfaceInitialized || !hostEnvironment.initialized || !hostEnvironmentReady) {
    // `fallback` is server-rendered markup (the login hero), so `/` ships a real
    // LCP element instead of the placeholder string this used to return.
    // The gate itself is unavoidable on the server: surfaceInitialized starts false,
    // and page.tsx's first hooks require the tower we are still assembling.
    return <>{fallback ?? null}</>;
  }

  return (
    <WagmiRouter authSurface={authSurface} hostEnvironmentState={hostEnvironment}>
      <FrameProvider>
        <SmartWalletProvider>
          <EthModeProvider>
            <SolanaWalletProvider>
              <BalanceProvider>
                <LoadingProvider>
                  <RouteAwareChatProvider>
                    <TutorialBundle>
                      <AppUpdateBanner disabled={hostEnvironment.isMiniApp} />
                      {/* Tutorial slideshow provider at root so it can render a modal on top of everything */}
                      {/* It internally reads NEXT_PUBLIC_TUTORIAL_SLIDESHOW */}
                      {/** added provider wrapper **/}
                      <AppToaster />
                      <PerformanceModeController />
                      <ScrollFadeController />
                      {children}
                      <SlideshowModal />
                    </TutorialBundle>
                    <TasksInfoDialog />
                    <SecretGardenListener />
                    <SnowEffect />
                  </RouteAwareChatProvider>
                </LoadingProvider>
              </BalanceProvider>
            </SolanaWalletProvider>
          </EthModeProvider>
        </SmartWalletProvider>
      </FrameProvider>
    </WagmiRouter>
  );
}
