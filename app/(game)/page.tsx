"use client";

import { sdk } from "@farcaster/miniapp-sdk";
import { Activity, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BasePageLoader } from "@/components/ui/loading";
import { Tab } from "@/lib/types";
import { WalletProfile } from "@/components/wallet-profile";
import { PlusCircle, Leaf, Sparkles, Info, Repeat, History, Trophy } from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ThemeSelector } from "@/components/theme-selector";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { INVITE_CONFIG, getLocalStorageKeys } from "@/lib/invite-utils";
import InviteGate from "@/components/invite-gate";
import { ChatButton } from "@/components/chat";
import StatusBar from "@/components/status-bar";
import dynamic from "next/dynamic";
import { TabVisibilityProvider } from "@/lib/tab-visibility-context";
import toast from "react-hot-toast";

// Import custom hooks
import { useAppAuthController } from "@/hooks/useAppAuthController";
import { useInviteValidation } from "@/hooks/useInviteValidation";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useWebQueryState } from "@/hooks/useWebQueryState";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";
import {
  BaseAccountSurfaceButton,
  SolanaSurfaceButton,
} from "@/components/auth/surface-switch-buttons";
import { requestBalanceRefresh } from "@/lib/app-events";
import { CLIENT_ENV } from "@/lib/env-config";

// Import broadcast component
import { BroadcastMessageModal } from "@/components/broadcast-message-modal";
import { ViewportDebugOverlay } from "@/components/viewport-debug-overlay";

// Tab load error fallback component
function TabLoadError({ tabName, onRetry }: { tabName: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <Info className="w-6 h-6 text-destructive" />
      </div>
      <div>
        <p className="text-sm font-medium text-destructive">Failed to load {tabName}</p>
        <p className="text-xs text-muted-foreground mt-1">
          Please check your connection and try again
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry || (() => window.location.reload())}
      >
        <Repeat className="w-4 h-4 mr-2" />
        Retry
      </Button>
    </div>
  );
}

// Factory function to create dynamic imports with error handling
const createDynamicTab = (
  importFn: () => Promise<any>,
  tabName: string,
  chunkName: string
) => {
  return dynamic(
    () => importFn().catch((error) => {
      console.error(`Failed to load ${tabName} tab:`, error);
      // Return a module with default export as the error component
      return {
        default: () => <TabLoadError tabName={tabName} />
      };
    }),
    {
      loading: () => <BasePageLoader />,
      ssr: false // Disable SSR for tab components to avoid hydration issues
    }
  );
};

// Tab content components with optimized code splitting and error handling
const tabComponents = {
  dashboard: createDynamicTab(
    () => import(/* webpackChunkName: "dashboard-tab" */ "@/components/tabs/dashboard-tab"),
    "Farm",
    "dashboard-tab"
  ),
  mint: createDynamicTab(
    () => import(/* webpackChunkName: "mint-tab" */ "@/components/tabs/mint-tab"),
    "Mint",
    "mint-tab"
  ),
  about: createDynamicTab(
    () => import(/* webpackChunkName: "about-tab" */ "@/components/tabs/about-tab"),
    "About",
    "about-tab"
  ),
  swap: createDynamicTab(
    () => import(/* webpackChunkName: "swap-tab" */ "@/components/tabs/swap-tab"),
    "Swap",
    "swap-tab"
  ),
  activity: createDynamicTab(
    () => import(/* webpackChunkName: "activity-tab" */ "@/components/tabs/activity-tab"),
    "Activity",
    "activity-tab"
  ),
  leaderboard: createDynamicTab(
    () => import(/* webpackChunkName: "leaderboard-tab" */ "@/components/tabs/leaderboard-tab"),
    "Ranking",
    "leaderboard-tab"
  ),
};

const TAB_VALUES: Tab[] = ["dashboard", "mint", "activity", "leaderboard", "swap", "about"];
const MANAGED_GAME_QUERY_KEYS = new Set([
  "tab",
  "dashboardView",
  "mintType",
  "activityView",
  "activityPage",
  "leaderboardPage",
  "leaderboardFilter",
  "leaderboardMine",
  "leaderboardBoard",
]);
const TAB_QUERY_KEY_ALLOWLIST: Record<Tab, ReadonlySet<string>> = {
  dashboard: new Set(["tab", "dashboardView"]),
  mint: new Set(["tab", "mintType"]),
  activity: new Set(["tab", "activityView", "activityPage"]),
  leaderboard: new Set([
    "tab",
    "leaderboardPage",
    "leaderboardFilter",
    "leaderboardMine",
    "leaderboardBoard",
  ]),
  swap: new Set(["tab"]),
  about: new Set(["tab"]),
};

// Tab prefetching logic with de-duplication
const useTabPrefetching = (activeTab: Tab, isConnected: boolean) => {
  const loadedTabs = useRef(new Set<string>());
  const prefetchingTabs = useRef(new Set<string>());
  const prefetchPromises = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    if (!isConnected) return;

    // Define tab navigation patterns for prefetching
    const currentIndex = TAB_VALUES.indexOf(activeTab);

    // Prefetch adjacent tabs (next and previous)
    const prefetchTabs = [currentIndex - 1, currentIndex + 1]
      .filter(index => index >= 0 && index < TAB_VALUES.length)
      .map(index => TAB_VALUES[index]);

    // Prefetch frequently accessed tabs
    const frequentlyAccessedTabs: Tab[] = ["dashboard", "mint", "swap"];

    const tabsToPrefetch = [...new Set([...prefetchTabs, ...frequentlyAccessedTabs])]
      .filter((tab): tab is Tab => tab !== activeTab);

    // Use requestIdleCallback for non-blocking prefetching, avoid duplicates
    if ('requestIdleCallback' in window) {
      const idleCallbackId = (window as any).requestIdleCallback?.(() => {
        tabsToPrefetch.forEach((tab) => {
          const key = String(tab);
          if (key === activeTab) return;
          if (loadedTabs.current.has(key) || prefetchingTabs.current.has(key)) return;
          prefetchingTabs.current.add(key);

          const prefetchPromise = import(`@/components/tabs/${tab}-tab`)
            .finally(() => {
              prefetchingTabs.current.delete(key);
              loadedTabs.current.add(key);
              prefetchPromises.current.delete(key);
            });

          prefetchPromises.current.set(key, prefetchPromise);
        });
      });

      // Cleanup function to clear pending prefetches on unmount
      return () => {
        if (idleCallbackId && typeof idleCallbackId === 'number') {
          (window as any).cancelIdleCallback?.(idleCallbackId);
        }
        prefetchingTabs.current.clear();
        prefetchPromises.current.clear();
      };
    }

    return () => {
      prefetchingTabs.current.clear();
      prefetchPromises.current.clear();
    };
  }, [activeTab, isConnected]);
};

import { useSlideshow } from "@/components/tutorial";
import ErrorBoundary from "@/components/ui/error-boundary";
import { useKeyboardAware, useViewportInsets, useKeyboardNavigation } from "@/hooks/useKeyboardAware";


export default function App() {
  const { theme } = useTheme();
  const { startIfFirstVisit } = useSlideshow();
  const {
    address,
    fc,
    handleMiniAppReconnect,
    isConnected,
    isMiniApp,
    isRestoringBaseSession,
    privyReady,
    state,
    switchAuthSurface,
  } = useAppAuthController();
  const [activeTab, setActiveTab] = useWebQueryState<Tab>({
    key: "tab",
    defaultValue: "dashboard",
    enabled: !isMiniApp,
    parse: (rawValue) => {
      if (!rawValue) {
        return null;
      }

      return TAB_VALUES.includes(rawValue as Tab) ? (rawValue as Tab) : null;
    },
    serialize: (value) => (value === "dashboard" ? null : value),
  });
  const [frameAdded, setFrameAdded] = useState(false);
  const [showWalletProfile, setShowWalletProfile] = useState(false);
  const lastDismissedRef = useRef<string | null>(null);
  const { userValidated, checkingValidation, handleInviteValidated, setUserValidated } = useInviteValidation();
  const readyBlocker =
    isConnected &&
    INVITE_CONFIG.SYSTEM_ENABLED &&
    (checkingValidation || !userValidated);

  useTabPrefetching(activeTab, isConnected);

  useFarcaster({ readyBlocker });
  useAutoConnect();

  useEffect(() => {
    if (isMiniApp || typeof window === "undefined") {
      return;
    }

    const allowedKeys = TAB_QUERY_KEY_ALLOWLIST[activeTab];
    const currentUrl = new URL(window.location.href);
    let didChange = false;

    for (const key of MANAGED_GAME_QUERY_KEYS) {
      if (!currentUrl.searchParams.has(key) || allowedKeys.has(key)) {
        continue;
      }

      currentUrl.searchParams.delete(key);
      didChange = true;
    }

    if (!didChange) {
      return;
    }

    const nextSearch = currentUrl.searchParams.toString();
    const nextUrl = `${currentUrl.pathname}${nextSearch ? `?${nextSearch}` : ""}${currentUrl.hash}`;
    const currentPathWithSearch =
      `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentPathWithSearch) {
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activeTab, isMiniApp]);

  // Broadcast messages system
  const { messages: broadcastMessages, dismissMessage, trackImpression } = useBroadcastMessages();
  const [currentBroadcast, setCurrentBroadcast] = useState<any>(null);

  // Keyboard and viewport awareness
  const keyboardState = useKeyboardAware();
  useViewportInsets();
  const isKeyboardNavigation = useKeyboardNavigation();
  const isNeynarNotifications = CLIENT_ENV.NOTIFICATION_PROVIDER === 'neynar';
  const miniAppContext = (fc?.context as any) ?? null;
  const miniAppAdded = Boolean(miniAppContext?.client?.added);

  // Start tutorial only after wallet connect (and invite gate passed)
  useEffect(() => {
    if (isConnected && userValidated) {
      startIfFirstVisit();
    }
  }, [isConnected, userValidated, startIfFirstVisit]);

  // Auto-prompt to add mini app when user opens in miniapp mode and hasn't added yet
  useEffect(() => {
    if (!isNeynarNotifications) return;

    // Only run once context is available, user is in miniapp, and hasn't added yet
    if (!miniAppContext || miniAppAdded || frameAdded) return;
    if (!fc?.isInMiniApp) return;

    // Small delay to let the app settle before showing the prompt
    const timeoutId = setTimeout(async () => {
      try {
        await sdk.actions.addMiniApp();
        setFrameAdded(true);
      } catch (e) {
        // User may have dismissed or it failed - that's okay, they can try the button
        console.log('Auto add mini app prompt dismissed or failed:', e);
      }
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [miniAppAdded, miniAppContext, fc?.isInMiniApp, frameAdded, isNeynarNotifications]);

  // Map fid -> address for backend notifications (optional, best-effort)
  useEffect(() => {
    if (!isNeynarNotifications) return;

    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;

    (async () => {
      try {
        const fid = typeof fc?.context === 'object' ? (fc?.context as any)?.user?.fid : undefined;
        if (!fid || !address || !mounted) return;

        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 5000);

        await fetch('/api/notifications/map-fid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid, address }),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof Error && error.name !== 'AbortError') {
          console.warn('Failed to map FID to address:', error);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    })();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [address, fc?.context, isNeynarNotifications]);

  // Nudge UI forward immediately after a successful connection
  useEffect(() => {
    if (isConnected) {
      void requestBalanceRefresh();
    }
  }, [isConnected]);

  // Balance refreshes after transactions are handled via events in balance-context.tsx
  // No need to refresh on every tab change - balances are already in context

  const handleSkipInvite = () => {
    // For development - allow skipping invite system
    setUserValidated(true);
    const keys = getLocalStorageKeys();
    localStorage.setItem(keys.INVITE_VALIDATED, 'true');
    if (address) {
      localStorage.setItem(keys.USER_ADDRESS, address.toLowerCase());
    }
  };

  const handleAddFrame = useCallback(async () => {
    if (!fc?.isInMiniApp) {
      return;
    }

    try {
      await sdk.actions.addMiniApp();
      setFrameAdded(true);
    } catch (e) {
      console.warn('Add mini app prompt failed:', e);
    }
  }, [fc?.isInMiniApp]);

  const tabs = [
    { id: "dashboard" as Tab, label: "Farm", icon: Leaf },
    { id: "mint" as Tab, label: "Mint", icon: Sparkles },
    { id: "activity" as Tab, label: "Activity", icon: History },
    { id: "leaderboard" as Tab, label: "Ranking", icon: Trophy },
    { id: "swap" as Tab, label: "Swap", icon: Repeat },
    { id: "about" as Tab, label: "About", icon: Info },
  ];

  // Show broadcast messages (one at a time, highest priority first)
  useEffect(() => {
    if (currentBroadcast && !broadcastMessages.some((msg) => msg.id === currentBroadcast.id)) {
      setCurrentBroadcast(null);
    }

    if (!currentBroadcast) {
      const next = broadcastMessages.find((msg) => msg.id !== lastDismissedRef.current);
      if (next) {
        lastDismissedRef.current = null;
        setCurrentBroadcast(next);
      }
    }
  }, [broadcastMessages, currentBroadcast]);

  const handleDismissBroadcast = () => {
    if (!currentBroadcast) {
      return;
    }

    lastDismissedRef.current = currentBroadcast.id;
    dismissMessage(currentBroadcast.id);
    setCurrentBroadcast(null);
  };

  // Show loading while checking validation (only if wallet is connected and invite system enabled)
  if (checkingValidation && isConnected && INVITE_CONFIG.SYSTEM_ENABLED) {
    return (
      <div className="flex flex-col h-dvh bg-background items-center justify-center p-4">
        <div className="flex flex-col items-center justify-center gap-4">
          <Image src="/PixotchiKit/Logonotext.svg" alt="Pixotchi Logo" width={64} height={64} className="opacity-50" />
          <BasePageLoader text="Checking wallet validation…" />
        </div>
      </div>
    );
  }

  // Show invite gate if wallet is connected but not validated (and system is enabled)
  if (isConnected && INVITE_CONFIG.SYSTEM_ENABLED && !userValidated) {
    return (
      <InviteGate
        onValidated={handleInviteValidated}
        onSkip={handleSkipInvite}
        showSkip={process.env.NODE_ENV === 'development'}
      />
    );
  }

  return (
    <div
      data-viewport-shell="outer"
      className={`flex justify-center w-full min-h-dvh bg-background overscroll-none ${keyboardState.isVisible ? 'keyboard-visible' : 'keyboard-hidden'
        } ${isKeyboardNavigation ? 'keyboard-navigation' : ''
        }`}
      aria-label="Pixotchi Mini Game"
    >
      <div
        data-viewport-shell="inner"
        className="w-full max-w-md flex flex-col h-dvh bg-background overflow-hidden overscroll-none"
      >
        {/* Header wrapper with matching background and safe area */}
        <div className="bg-card/90 backdrop-blur-sm overscroll-none">
          <header data-viewport-shell="header" className="bg-card/90 backdrop-blur-sm border-b border-border px-4 py-2 overscroll-none safe-area-top" role="banner" aria-label="Application header">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Image
                  src="/PixotchiKit/Logonotext.svg"
                  alt="Pixotchi Mini Logo"
                  width={24}
                  height={24}
                />
                <h1 className="text-sm font-pixel text-foreground">
                  {fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'}
                </h1>
              </div>

              <div className="flex items-center space-x-2">
                {isNeynarNotifications && fc?.isInMiniApp && miniAppContext && !miniAppAdded && !frameAdded && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddFrame}
                    aria-label="Add Pixotchi Mini to your app"
                    title="Add Pixotchi Mini to your app"
                  >
                    <PlusCircle className="w-4 h-4" aria-hidden="true" />
                  </Button>
                )}

                {isConnected ? <ChatButton /> : null}

                {isConnected ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowWalletProfile(true)}
                    aria-label="Open wallet profile"
                    title="Open wallet profile"
                  >
                    <Image
                      src={theme === "pink" ? "/icons/Avatar1.svg" : "/icons/Avatar2.svg"}
                      alt=""
                      width={24}
                      height={24}
                      className="w-6 h-6"
                      aria-hidden="true"
                    />
                  </Button>
                ) : null}
                <ThemeSelector />
              </div>
            </div>
          </header>
          {isConnected && (
            <ErrorBoundary
              variant="inline"
              resetKeys={address ? [address] : []}
              onError={(error, errorInfo) => {
                console.error('Error in StatusBar:', { error, errorInfo });
              }}
            >
              <StatusBar />
            </ErrorBoundary>
          )}
        </div>

        {/* Main Content */}
        <main data-viewport-shell="main" className="flex-1 bg-muted/40 flex flex-col overflow-hidden" role="main" aria-label="Main content area">
          {(!isConnected) ? (
            <div className="flex h-full flex-col items-center justify-center p-4 safe-area-bottom">
              <div className="flex-grow flex flex-col items-center justify-center text-center">
                <div className="flex flex-col items-center space-y-3 mb-8">
                  <Image
                    src="/PixotchiKit/Logonotext.svg"
                    alt="Pixotchi Mini Logo"
                    width={80}
                    height={80}
                    priority
                    fetchPriority="high"
                    sizes="80px"
                    quality={90}
                  />
                  <h1 className="text-2xl font-pixel text-foreground">
                    {fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'}
                  </h1>
                </div>
                <h2 className="text-xl font-semibold text-foreground mb-2">
                  Welcome!
                </h2>
                <p className="text-muted-foreground mb-6 max-w-xs">
                  Connect your wallet, mint a plant and begin your farming journey on Base.
                </p>
              </div>
              {isRestoringBaseSession ? (
                <div className="w-full max-w-xs space-y-3">
                  <BasePageLoader text="Restoring your Base session…" />
                </div>
              ) : (
              <div className="w-full max-w-xs space-y-3">
                {!fc?.isInMiniApp && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Web App</AlertTitle>
                    <AlertDescription>
                      You are in the web app mode. For the best experience; sign in with base or use Farcaster to access the game in the mini app mode.
                    </AlertDescription>
                  </Alert>
                )}
                {/* Web-only login buttons; MiniApp autoconnects above */}
                {!fc?.isInMiniApp ? (
                  <Button
                    className="w-full rounded-md text-base font-semibold text-white h-11 bg-[#ff8170] hover:bg-[#ff6b56] active:bg-[#ff8170] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#ff8170] disabled:opacity-60 disabled:cursor-not-allowed"
                    variant="default"
                    onClick={async () => {
                      try {
                        await switchAuthSurface('privy');
                      } catch (error) {
                        console.error('Failed to switch to Privy surface:', error);
                        toast.error('Failed to switch to Privy sign-in. Please try again.');
                      }
                    }}
                    disabled={!privyReady}
                  >
                    {privyReady ? 'Continue with Privy' : 'Loading Privy…'}
                  </Button>
                ) : null}
                {!fc?.isInMiniApp ? (
                  <>
                    <BaseAccountSurfaceButton onSwitchSurface={switchAuthSurface} />
                    {/* Solana Bridge option - connects via Base-Solana bridge */}
                    {process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true' && (
                      <>
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-xs text-muted-foreground">or bridge from Solana</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                        <SolanaSurfaceButton onSwitchSurface={switchAuthSurface} />
                      </>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="text-muted-foreground text-sm text-center">Connecting…</div>
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={handleMiniAppReconnect}
                      disabled={state.isMiniConnectRetrying}
                    >
                      {state.isMiniConnectRetrying ? "Retrying…" : "Retry Connection"}
                    </Button>
                  </div>
                )}
              </div>
              )}
            </div>
          ) : (
            <>
              {/* Tab Content */}
              <div
                data-viewport-shell="content"
                className="flex-1 overflow-y-auto overscroll-contain touch-pan-y p-4 pb-16 safe-area-inset"
                role="tabpanel"
                id={`tabpanel-${activeTab}`}
                aria-labelledby={`tab-${activeTab}`}
                aria-label={`${tabs.find(t => t.id === activeTab)?.label || activeTab} content`}
              >
                <ErrorBoundary
                  key="tab-boundary"
                  resetKeys={address ? [address] : []}
                  variant="card"
                  onError={(error, errorInfo) => {
                    console.error(`Error in tabs:`, { error, errorInfo });
                  }}
                >
                  <TabVisibilityProvider activeTab={activeTab}>
                    {tabs.map((tab) => {
                      const TabComponent = tabComponents[tab.id];
                      // Activity mode: 'visible' means mounted/active effects, 'hidden' means kept in memory but effects unmounted.
                      // This preserves scroll position and state (e.g. inputs) when switching tabs.
                      const activityMode = activeTab === tab.id ? 'visible' : 'hidden';

                      return (
                        <Activity key={tab.id} mode={activityMode}>
                          <div className={activeTab === tab.id ? 'block h-full' : 'hidden'}>
                            {TabComponent ? <TabComponent /> : null}
                          </div>
                        </Activity>
                      );
                    })}
                  </TabVisibilityProvider>
                </ErrorBoundary>
              </div>

              {/* Bottom Navigation with safe area */}
              <nav data-viewport-shell="nav" className="bg-card border-t border-border px-4 py-1 overscroll-none touch-pan-x select-none safe-area-bottom rounded-t-2xl" role="navigation" aria-label="Main navigation">
                <div className="flex justify-around items-center" role="tablist" aria-label="Application tabs">
                  {tabs.map((tab) => (
                    <Button
                      key={tab.id}
                      variant="ghost"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex flex-col items-center space-y-0.5 h-auto w-16 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${activeTab === tab.id
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground border border-transparent"
                        }`}
                      role="tab"
                      id={`tab-${tab.id}`}
                      aria-selected={activeTab === tab.id}
                      aria-controls={`tabpanel-${tab.id}`}
                      aria-label={`Switch to ${tab.label} tab`}
                      tabIndex={activeTab === tab.id ? 0 : -1}
                    >
                      <tab.icon
                        className={`w-5 h-5 ${activeTab === tab.id ? "text-primary" : ""
                          }`}
                      />
                      <span className="text-xs font-medium">{tab.label}</span>
                    </Button>
                  ))}
                </div>
              </nav>
            </>
          )}
        </main>

        {/* Wallet Profile */}
        <ErrorBoundary
          variant="inline"
          resetKeys={[showWalletProfile.toString(), ...(address ? [address] : [])]}
          onError={(error, errorInfo) => {
            console.error('Error in WalletProfile:', { error, errorInfo });
          }}
        >
          <WalletProfile
            open={showWalletProfile}
            onOpenChange={setShowWalletProfile}
          />
        </ErrorBoundary>

        {/* Broadcast Message Modal */}
        <BroadcastMessageModal
          message={currentBroadcast}
          onDismiss={handleDismissBroadcast}
          onImpression={trackImpression}
        />
        <ViewportDebugOverlay />
      </div>
    </div>
  );
}
