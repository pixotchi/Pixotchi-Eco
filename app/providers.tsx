"use client";

import { type ComponentType, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { base } from "wagmi/chains";
import { PaymasterProvider } from "@/lib/paymaster-context";
import { EthModeProvider } from "@/lib/eth-mode-context";
import { SmartWalletProvider } from "@/lib/smart-wallet-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider as CoreWagmiProvider, type Config } from "wagmi";
import { WagmiProvider as PrivyWagmiProvider } from "@privy-io/wagmi";
import { FrameProvider } from "@/lib/frame-context";
import {
  HostEnvironmentProvider,
  type HostEnvironmentState,
  useHostEnvironment,
} from "@/lib/host-environment";
import dynamic from "next/dynamic";
import { BalanceProvider } from "@/lib/balance-context";
import { ThemeInitializer } from "@/components/theme-initializer";
import { ServerThemeProvider } from "@/components/server-theme-provider";
import ErrorBoundary from "@/components/ui/error-boundary";
import { SecretGardenListener } from "@/components/secret-garden-listener";
import { SnowProvider, useSnow } from "@/lib/snow-context";
import { AmbientAudioProvider } from "@/lib/ambient-audio-context";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import { SolanaWalletProvider } from '@/components/solana/SolanaWalletProvider';
import { isSolanaEnabled } from '@/lib/solana-constants';
import { ChatProvider } from "@/components/chat/chat-context";
import { AppToaster } from "@/components/ui/app-toaster";
import { PerformanceModeController } from "@/components/ui/performance-mode";
import { ScrollFadeController } from "@/components/ui/scroll-fade-controller";
import { SlideshowProvider, useSlideshow } from "@/components/tutorial/SlideshowProvider";
import { onTasksDialogOpen, openTasksDialog } from "@/lib/app-events";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AuthSurface,
  DEFAULT_AUTH_SURFACE,
  resolvePreferredAuthSurface,
} from "@/lib/auth-surface";
import {
  clearConfirmedMiniAppSession,
} from "@/lib/confirmed-miniapp-session";

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
// Privy's server-side app configuration can enable Solana authentication even
// while this browser session intentionally renders the EVM-only surface. A
// valid empty connector store keeps that surface honest (no Solana wallets are
// offered) without eagerly loading the Solana wallet-standard bundle merely to
// satisfy Privy's connector contract.
const EMPTY_SOLANA_CONNECTORS = Object.freeze({
  get: () => [],
  onMount: () => undefined,
  onUnmount: () => undefined,
});
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

type PrivySolanaBootstrap = {
  connectors?: UntypedValue;
  hasUsableConnectors: boolean;
  rpcConfig?: UntypedValue;
};

async function loadPrivySolanaBootstrap(): Promise<PrivySolanaBootstrap> {
  const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || DEFAULT_SOLANA_RPC_URL;
  const rpcSubscriptionsUrl = toSolanaRpcSubscriptionsUrl(rpcUrl);

  try {
    const [solanaKit, solanaAuth] = await Promise.all([
      import('@solana/kit'),
      import('@/lib/solana-auth-availability'),
    ]);
    const connectors = solanaAuth.getPrivySolanaConnectors();

    return {
      connectors,
      hasUsableConnectors: solanaAuth.hasUsableSolanaConnectors(connectors),
      rpcConfig: {
        rpcs: {
          'solana:mainnet': {
            blockExplorerUrl: 'https://explorer.solana.com',
            rpc: solanaKit.createSolanaRpc(rpcUrl),
            rpcSubscriptions: solanaKit.createSolanaRpcSubscriptions(rpcSubscriptionsUrl),
          },
        },
      },
    };
  } catch (error) {
    console.warn('[Providers] Failed to load Privy Solana support:', error);
    return { hasUsableConnectors: false };
  }
}

type WagmiConfigKey = 'base' | 'miniapp' | 'privy' | 'test';

const wagmiConfigLoaders: Record<WagmiConfigKey, () => Promise<Config>> = {
  base: () => import('@/lib/wagmi-web-base-config').then((module) => module.wagmiWebBaseConfig as Config),
  miniapp: () => import('@/lib/wagmi-miniapp-config').then((module) => module.wagmiMiniAppConfig as Config),
  privy: () => import('@/lib/wagmi-privy-config').then((module) => module.wagmiPrivyConfig as Config),
  test: () => import('@/lib/wagmi-local-test-config').then((module) => module.wagmiLocalTestConfig as Config),
};

const wagmiConfigPromises = new Map<WagmiConfigKey, Promise<Config>>();

function loadWagmiConfig(key: WagmiConfigKey) {
  const cached = wagmiConfigPromises.get(key);
  if (cached) return cached;

  const promise = wagmiConfigLoaders[key]().catch((error) => {
    wagmiConfigPromises.delete(key);
    throw error;
  });
  wagmiConfigPromises.set(key, promise);
  return promise;
}

function resolveWagmiConfigKey(
  authSurface: AuthSurface,
  hostEnvironmentState: HostEnvironmentState,
): WagmiConfigKey {
  if (hostEnvironmentState.isMiniApp) return 'miniapp';
  if (authSurface === 'base') return 'base';
  if (authSurface === 'test') return 'test';
  return 'privy';
}

const SnowEffect = dynamic(() => import("@/components/ui/snow-effect"), { ssr: false });

let slideshowDialogModulePromise: Promise<{ default: ComponentType }> | null = null;
let tasksDialogModulePromise: Promise<{ default: ComponentType }> | null = null;

function loadSlideshowDialog() {
  if (!slideshowDialogModulePromise) {
    slideshowDialogModulePromise = (import("@/components/tutorial/SlideshowModal") as Promise<{
      default: ComponentType;
    }>).catch((error) => {
      slideshowDialogModulePromise = null;
      throw error;
    });
  }
  return slideshowDialogModulePromise;
}

function loadTasksDialog() {
  if (!tasksDialogModulePromise) {
    tasksDialogModulePromise = (import("@/components/tasks/TasksInfoDialog") as Promise<{
      default: ComponentType;
    }>).catch((error) => {
      tasksDialogModulePromise = null;
      throw error;
    });
  }
  return tasksDialogModulePromise;
}

function DeferredSlideshowModal() {
  const { open, close } = useSlideshow();
  const [DialogComponent, setDialogComponent] = useState<ComponentType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);

  const beginLoad = useCallback(() => {
    if (loadingRef.current || DialogComponent) return;
    loadingRef.current = true;
    setIsLoading(true);
    setLoadError(null);
    void loadSlideshowDialog()
      .then((module) => {
        setDialogComponent(() => module.default);
        setIsLoading(false);
      })
      .catch((error) => {
        loadingRef.current = false;
        setIsLoading(false);
        setLoadError('The tutorial could not be loaded. Check your connection and retry.');
        console.error('[Providers] Failed to load tutorial dialog:', error);
      });
  }, [DialogComponent]);

  useEffect(() => {
    if (open && !DialogComponent && !loadError) beginLoad();
  }, [DialogComponent, beginLoad, loadError, open]);

  // Once loaded, keep the modal mounted so Radix can play its exit transition.
  if (DialogComponent) return <DialogComponent />;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogContent surface="soft" className="w-[min(92vw,26rem)]">
        <DialogHeader>
          <DialogTitle>Pixotchi tutorial</DialogTitle>
          <DialogDescription>
            {loadError ?? 'Preparing the step-by-step guide.'}
          </DialogDescription>
        </DialogHeader>
        {loadError ? (
          <Button onClick={beginLoad} className="w-full" size="touchCompact">
            Retry loading tutorial
          </Button>
        ) : (
          <div role="status" className="flex min-h-20 items-center justify-center gap-3 text-sm text-muted-foreground">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
            {isLoading ? 'Loading tutorial…' : 'Preparing tutorial…'}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeferredTasksInfoDialog() {
  const [DialogComponent, setDialogComponent] = useState<ComponentType | null>(null);
  const [requestedOpen, setRequestedOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadingRef = useRef(false);
  const replayOpenRef = useRef(false);

  const beginLoad = useCallback(() => {
    // Every open intent must be replayed after the cold chunk mounts. This has
    // to happen before the in-flight guard: a user can close the loading shell
    // and reopen it while the same import promise is still pending.
    replayOpenRef.current = true;
    if (loadingRef.current) return;
    loadingRef.current = true;
    setIsLoading(true);
    setLoadError(null);
    void loadTasksDialog()
      .then((module) => {
        setDialogComponent(() => module.default);
        setIsLoading(false);
      })
      .catch((error) => {
        loadingRef.current = false;
        replayOpenRef.current = false;
        setIsLoading(false);
        setLoadError('Tasks could not be loaded. Check your connection and retry.');
        console.error('[Providers] Failed to load Tasks dialog:', error);
      });
  }, []);

  useEffect(() => onTasksDialogOpen(() => {
    setRequestedOpen(true);
    if (!DialogComponent) beginLoad();
  }), [DialogComponent, beginLoad]);

  useEffect(() => {
    if (!DialogComponent || !replayOpenRef.current) return;
    replayOpenRef.current = false;
    setRequestedOpen(false);

    // Replay only after the dynamically loaded dialog has committed and
    // installed its own event listener.
    let innerFrame = 0;
    const outerFrame = window.requestAnimationFrame(() => {
      innerFrame = window.requestAnimationFrame(() => openTasksDialog());
    });

    return () => {
      window.cancelAnimationFrame(outerFrame);
      if (innerFrame) window.cancelAnimationFrame(innerFrame);
    };
  }, [DialogComponent]);

  if (DialogComponent) return <DialogComponent />;

  return (
    <Dialog
      open={requestedOpen}
      onOpenChange={(nextOpen) => {
        setRequestedOpen(nextOpen);
        if (!nextOpen) replayOpenRef.current = false;
      }}
    >
      <DialogContent surface="soft" className="w-[min(92vw,26rem)]">
        <DialogHeader>
          <DialogTitle>Farmer&apos;s Tasks</DialogTitle>
          <DialogDescription>
            {loadError ?? 'Loading your current tasks and rewards.'}
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div role="status" className="flex min-h-20 items-center justify-center gap-3 text-sm text-muted-foreground">
            <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
            Loading tasks…
          </div>
        ) : loadError ? (
          <Button onClick={beginLoad} className="w-full" size="touchCompact">
            Retry loading tasks
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DeferredSnowEffect() {
  const { isEnabled } = useSnow();
  return isEnabled ? <SnowEffect /> : null;
}

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
  fallback,
  hostEnvironmentState,
}: {
  authSurface: AuthSurface;
  children: ReactNode;
  fallback?: ReactNode;
  hostEnvironmentState: HostEnvironmentState;
}) {
  // HostEnvironment's web -> miniapp upgrade is a confirmed, monotonic state
  // transition. Context/client metadata updates do not change this key, while a
  // late Mini App context changes it exactly once.
  const desiredConfigKey = resolveWagmiConfigKey(authSurface, hostEnvironmentState);
  const isMiniApp = desiredConfigKey === 'miniapp';
  const [loadedConfig, setLoadedConfig] = useState<{
    config: Config;
    key: WagmiConfigKey;
  } | null>(null);
  const [loadError, setLoadError] = useState<{
    error: Error;
    key: WagmiConfigKey;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void loadWagmiConfig(desiredConfigKey)
      .then((config) => {
        if (active) {
          setLoadError(null);
          setLoadedConfig({ config, key: desiredConfigKey });
        }
      })
      .catch((error) => {
        if (active) {
          setLoadError({
            error: error instanceof Error ? error : new Error(String(error)),
            key: desiredConfigKey,
          });
        }
      });
    return () => {
      active = false;
    };
  }, [desiredConfigKey]);

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

  if (loadError?.key === desiredConfigKey) throw loadError.error;
  // On a confirmed late upgrade, immediately remove the old provider subtree.
  // It returns only when the matching Mini App config is ready, so descendants
  // can never observe Mini App host context under a web wallet provider.
  if (loadedConfig?.key !== desiredConfigKey) return <>{fallback ?? null}</>;

  if (loadedConfig.key === 'privy') {
    return (
      <PrivyWagmiProvider key={`wagmi-${loadedConfig.key}`} config={loadedConfig.config}>
        {children}
      </PrivyWagmiProvider>
    );
  }

  return (
    <CoreWagmiProvider key={`wagmi-${loadedConfig.key}`} config={loadedConfig.config}>
      {isMiniApp ? <MiniAppReadySignal hostEnvironment={hostEnvironmentState} /> : null}
      {children}
    </CoreWagmiProvider>
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
  // Lazy initialisers, not effects. Both inputs are synchronous and available on the
  // first client render, and resolving them here means PrivyProvider mounts once with
  // its final config instead of mounting with defaults and being reconfigured a render
  // later. `surfaceInitialized` deliberately stays an effect — see the gate comment in
  // ProvidersContent for why that one cannot move.
  const [authSurface] = useState<AuthSurface>(() =>
    typeof window === 'undefined'
      ? 'privy'
      : resolvePreferredAuthSurface({
          fallback: DEFAULT_AUTH_SURFACE,
          search: window.location.search,
          storedSurface: sessionStorageManager.getAuthSurface(),
        }),
  );
  const [isMobilePrivyBrowser] = useState(() => isMobileWalletBrowser());
  const [solanaEnabled] = useState(isSolanaEnabled);
  const [solanaBootstrap, setSolanaBootstrap] = useState<PrivySolanaBootstrap | null>(null);
  const [surfaceInitialized, setSurfaceInitialized] = useState(false);
  const [queryClient] = useState(createQueryClient);
  const requiresSolanaBootstrap = authSurface === 'privysolana' && solanaEnabled;
  const solanaBootstrapPending = requiresSolanaBootstrap && solanaBootstrap === null;

  useEffect(() => {
    if (!requiresSolanaBootstrap) return;
    let active = true;

    void loadPrivySolanaBootstrap().then((bootstrap) => {
      if (active) setSolanaBootstrap(bootstrap);
    });

    return () => {
      active = false;
    };
  }, [requiresSolanaBootstrap]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSurfaceInitialized(true);
      return;
    }

    // The surface itself is resolved in the useState initialiser above; this effect
    // only persists it. Fire-and-forget: storage can be blocked, and an unhandled
    // rejection here would log an error on every boot in private-browsing contexts.
    void sessionStorageManager.setAuthSurface(authSurface).catch((error) => {
      console.warn('[Providers] Failed to persist auth surface:', error);
    });

    setSurfaceInitialized(true);
  }, [authSurface]);

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
    const solanaConnectors = solanaBootstrap?.connectors;

    // Solana-only mode: only show Solana wallets
    if (isSolanaMode && solanaEnabled) {
      // Safety check: connectors must be present for Solana mode
      if (solanaBootstrap?.hasUsableConnectors) {
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
          solana: solanaBootstrap.rpcConfig,
        };
      }

      if (solanaBootstrap) {
        console.warn('[Providers] Solana enabled but connectors failed to load. Falling back to EVM-only mode.');
      }
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
      externalWallets: {
        solana: {
          connectors: EMPTY_SOLANA_CONNECTORS,
        },
      },
      solana: undefined,
    };
  }, [authSurface, isMobilePrivyBrowser, solanaBootstrap, solanaEnabled]);
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
              {solanaBootstrapPending ? (
                <>{props.fallback ?? null}</>
              ) : (
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
              )}
            </PaymasterProvider>
          </AmbientAudioProvider>
        </SnowProvider>
      </ServerThemeProvider>
    </ErrorBoundary>
  );
}

function useMiniAppReadySignal(hostEnvironment: HostEnvironmentState) {
  const readySignalledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || readySignalledRef.current) {
      return;
    }

    if (!hostEnvironment.initialized || !hostEnvironment.isMiniApp) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { sdk } = await import('@farcaster/miniapp-sdk');
        await sdk.actions.ready();
        if (!cancelled) {
          readySignalledRef.current = true;
        }
      } catch (error) {
        console.warn('[Providers] Failed to signal sdk.actions.ready():', error);
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

function MiniAppReadySignal({ hostEnvironment }: { hostEnvironment: HostEnvironmentState }) {
  useMiniAppReadySignal(hostEnvironment);
  return null;
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
    <WagmiRouter
      authSurface={authSurface}
      fallback={fallback}
      hostEnvironmentState={hostEnvironment}
    >
      <FrameProvider>
        <SmartWalletProvider>
          <EthModeProvider>
            <SolanaWalletProvider>
              <BalanceProvider>
                  <ChatProvider>
                    <SlideshowProvider>
                      <AppToaster />
                      <PerformanceModeController />
                      <ScrollFadeController />
                      {children}
                      <DeferredSlideshowModal />
                    </SlideshowProvider>
                    <DeferredTasksInfoDialog />
                    <SecretGardenListener />
                    <DeferredSnowEffect />
                  </ChatProvider>
              </BalanceProvider>
            </SolanaWalletProvider>
          </EthModeProvider>
        </SmartWalletProvider>
      </FrameProvider>
    </WagmiRouter>
  );
}
