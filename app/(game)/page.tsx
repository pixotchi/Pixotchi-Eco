"use client";

import { ChatButton } from "@/components/chat";
import StatusBar from "@/components/status-bar";
import { useIsSolanaWallet } from "@/components/solana";
import { ThemeSelector } from "@/components/theme-selector";
import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BasePageLoader } from "@/components/ui/loading";
import { ToggleGroup, type ToggleValue } from "@/components/ui/toggle-group";
import { LoginHero, LoginIntro } from "@/components/login-hero";
import { WalletProfile } from "@/components/wallet-profile";
import { FarmViewProvider, useFarmView } from "@/lib/farm-view-context";
import { TabVisibilityProvider } from "@/lib/tab-visibility-context";
import { Tab } from "@/lib/types";
import { sdk } from "@farcaster/miniapp-sdk";
import { History,Info,KeyRound,LandPlot,Leaf,PlusCircle,Repeat,Sparkles,Trophy,type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Activity,memo,useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties,type KeyboardEvent } from "react";
import toast from "react-hot-toast";

// Import custom hooks
import {
BaseAccountSurfaceButton,
SolanaSurfaceButton,
} from "@/components/auth/surface-switch-buttons";
import { useAppAuthController } from "@/hooks/useAppAuthController";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useWebQueryState, WEB_QUERY_STATE_EVENT } from "@/hooks/useWebQueryState";
import { requestBalanceRefresh } from "@/lib/app-events";
import type { AuthSurface } from "@/lib/auth-surface";
import { CLIENT_ENV } from "@/lib/env-config";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import { isLocalTestAuthAllowed } from "@/lib/local-test-mode";
import { isSolanaAuthAvailable } from "@/lib/solana-auth-availability";
import { cn } from "@/lib/utils";

// Import broadcast component
import { BroadcastMessageModal } from "@/components/broadcast-message-modal";
// Developer-only viewport instrumentation. Loaded on demand and only rendered when
// ?viewportDebug=1 is present, so it stays out of the app-shell chunk. (Not gated on
// NODE_ENV: the whole point is reading visualViewport / safe-area insets inside the
// production Mini App webview.)
const ViewportDebugOverlay = dynamic(
  () => import("@/components/viewport-debug-overlay").then((mod) => mod.ViewportDebugOverlay),
  { ssr: false }
);

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
  importFn: () => Promise<UntypedValue>,
  tabName: string
) => {
  const LazyTab = dynamic(
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

  LazyTab.displayName = `DynamicTab(${tabName})`;
  // Memoized once here rather than in each of the six tab modules: these take no
  // props, so without memo every App render reconciles all six subtrees.
  return memo(LazyTab);
};

// Tab content components with optimized code splitting and error handling
const tabComponents = {
  dashboard: createDynamicTab(
    () => import(/* webpackChunkName: "dashboard-tab" */ "@/components/tabs/dashboard-tab"),
    "Farm"
  ),
  mint: createDynamicTab(
    () => import(/* webpackChunkName: "mint-tab" */ "@/components/tabs/mint-tab"),
    "Mint"
  ),
  about: createDynamicTab(
    () => import(/* webpackChunkName: "about-tab" */ "@/components/tabs/about-tab"),
    "About"
  ),
  swap: createDynamicTab(
    () => import(/* webpackChunkName: "swap-tab" */ "@/components/tabs/swap-tab"),
    "Swap"
  ),
  activity: createDynamicTab(
    () => import(/* webpackChunkName: "activity-tab" */ "@/components/tabs/activity-tab"),
    "Activity"
  ),
  leaderboard: createDynamicTab(
    () => import(/* webpackChunkName: "leaderboard-tab" */ "@/components/tabs/leaderboard-tab"),
    "Ranking"
  ),
};
// Same dynamic imports as tabComponents above. Calling these only warms the module
// cache — it does not render anything — which is why prefetching composes with the
// visitedTabs gate further down: the tab still mounts lazily, but by the time the
// user clicks, the chunk is already in memory and there is no loading fallback.
const tabPrefetchers: Record<Tab, () => Promise<unknown>> = {
  dashboard: () => import("@/components/tabs/dashboard-tab"),
  mint: () => import("@/components/tabs/mint-tab"),
  about: () => import("@/components/tabs/about-tab"),
  swap: () => import("@/components/tabs/swap-tab"),
  activity: () => import("@/components/tabs/activity-tab"),
  leaderboard: () => import("@/components/tabs/leaderboard-tab"),
};

const TAB_VALUES: Tab[] = ["dashboard", "mint", "activity", "leaderboard", "swap", "about"];
const LOGIN_THEME_SEQUENCE = ["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"] as const;
const LOGIN_THEME_INTERVAL_MS = 4000;
const LOGIN_THEME_LAYER_STYLE: CSSProperties = {
  backgroundImage: "linear-gradient(180deg, hsl(var(--background)) 0%, hsl(var(--secondary)) 52%, hsl(var(--card)) 100%)",
  backgroundPosition: "center top",
  backgroundSize: "100% 100%",
};
const MANAGED_GAME_QUERY_KEYS = new Set([
  "tab",
  "dashboardView",
  "mintType",
  "activityView",
  "activityPage",
  "activityFilter",
  "activityDirection",
  "leaderboardPage",
  "leaderboardFilter",
  "leaderboardMine",
  "leaderboardBoard",
]);
const TAB_QUERY_KEY_ALLOWLIST: Record<Tab, ReadonlySet<string>> = {
  dashboard: new Set(["tab", "dashboardView"]),
  mint: new Set(["tab", "mintType"]),
  activity: new Set(["tab", "activityView", "activityPage", "activityFilter", "activityDirection"]),
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

/**
 * Warm the chunks for tabs the user is likely to open next.
 *
 * Pairs with the visitedTabs gate in App: that gate stops every tab from MOUNTING on
 * first connect, but without prefetching it also means each tab's first open pays a
 * cold dynamic import and shows a loading fallback. Prefetching only fetches the
 * module, so the two together give lazy mount plus an instant first switch.
 *
 * Skipped entirely on Save-Data and 2g connections, and deferred to idle time so it
 * never competes with the active tab's own data fetching.
 */
const useTabPrefetching = (activeTab: Tab, isConnected: boolean) => {
  const prefetched = useRef(new Set<Tab>());

  useEffect(() => {
    if (!isConnected) return;

    const connection = (navigator as UntypedValue).connection;
    if (
      connection?.saveData ||
      connection?.effectiveType === "slow-2g" ||
      connection?.effectiveType === "2g"
    ) {
      return;
    }

    const currentIndex = TAB_VALUES.indexOf(activeTab);
    const adjacent = [currentIndex - 1, currentIndex + 1]
      .filter((index) => index >= 0 && index < TAB_VALUES.length)
      .map((index) => TAB_VALUES[index]);
    const frequentlyAccessed: Tab[] = ["dashboard", "mint", "swap"];

    const targets = [...new Set<Tab>([...adjacent, ...frequentlyAccessed])].filter(
      (tab) => tab !== activeTab && !prefetched.current.has(tab),
    );

    if (targets.length === 0) return;

    const runPrefetch = () => {
      targets.forEach((tab) => {
        // Mark before awaiting so a re-render mid-flight cannot queue a duplicate;
        // on failure the mark is released so a later pass can retry.
        prefetched.current.add(tab);
        void tabPrefetchers[tab]().catch(() => {
          prefetched.current.delete(tab);
        });
      });
    };

    const requestIdleCallback = (window as UntypedValue).requestIdleCallback;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(runPrefetch, { timeout: 2500 }) as number;
      return () => (window as UntypedValue).cancelIdleCallback?.(id);
    }

    const id = window.setTimeout(runPrefetch, 750);
    return () => window.clearTimeout(id);
  }, [activeTab, isConnected]);
};

import { useSlideshow } from "@/components/tutorial";
import ErrorBoundary from "@/components/ui/error-boundary";
import { useKeyboardAware,useKeyboardNavigation,useViewportInsets } from "@/hooks/useKeyboardAware";

type LoginAuthActionsProps = {
  className: string;
  handleMiniAppReconnect: () => void;
  isInMiniApp: boolean;
  isMiniConnectRetrying: boolean;
  isRestoringBaseSession: boolean;
  localTestAuthAvailable: boolean;
  privyReady: boolean;
  switchAuthSurface: (surface: AuthSurface) => Promise<void>;
};

function LoginAuthActions({
  className,
  handleMiniAppReconnect,
  isInMiniApp,
  isMiniConnectRetrying,
  isRestoringBaseSession,
  localTestAuthAvailable,
  privyReady,
  switchAuthSurface,
}: LoginAuthActionsProps) {
  if (isRestoringBaseSession) {
    return (
      <div className={className}>
        <BasePageLoader text="Restoring your Base session..." />
      </div>
    );
  }

  if (isInMiniApp) {
    return (
      <div className={className}>
        <div className="space-y-2">
          <div className="text-muted-foreground text-sm text-center md:text-left">Connecting...</div>
          <Button
            variant="outline"
            className="w-full"
            onClick={handleMiniAppReconnect}
            disabled={isMiniConnectRetrying}
          >
            {isMiniConnectRetrying ? "Retrying..." : "Retry Connection"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <Alert className="login-web-app-alert !bg-[hsl(var(--card)/0.86)] !bg-none">
        <Info className="h-4 w-4" />
        <AlertTitle>Web App</AlertTitle>
        <AlertDescription>
          You are in web app mode. For the best experience, sign in with Base or open the game from Farcaster.
        </AlertDescription>
      </Alert>
      <Button
        className="w-full text-base"
        variant="special"
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
        {privyReady ? 'Continue with Privy' : 'Loading Privy...'}
      </Button>
      <BaseAccountSurfaceButton onSwitchSurface={switchAuthSurface} />
      {isSolanaAuthAvailable() && (
        <>
          <div className="flex items-center gap-2 my-2">
            <div className="h-px flex-1 bg-[hsl(var(--divider)/0.72)]" />
            <span className="text-xs text-muted-foreground">or bridge from Solana</span>
            <div className="h-px flex-1 bg-[hsl(var(--divider)/0.72)]" />
          </div>
          <SolanaSurfaceButton onSwitchSurface={switchAuthSurface} />
        </>
      )}
      {localTestAuthAvailable && (
        <>
          <div className="flex items-center gap-2 my-2">
            <div className="h-px flex-1 bg-[hsl(var(--divider)/0.72)]" />
            <span className="text-xs text-muted-foreground">or local testing</span>
            <div className="h-px flex-1 bg-[hsl(var(--divider)/0.72)]" />
          </div>
          <Button
            className="h-11 w-full rounded-[var(--radius-control)] text-base font-semibold"
            variant="outline"
            onClick={async () => {
              try {
                await switchAuthSurface('test');
              } catch (error) {
                console.error('Failed to switch to local test auth:', error);
                toast.error('Local test auth is only available on localhost.');
              }
            }}
          >
            <KeyRound className="mr-2 h-4 w-4" aria-hidden="true" />
            Local Test Wallet
          </Button>
        </>
      )}
    </div>
  );
}

function SharedFarmMintMobileToggle({
  activeTab,
}: {
  activeTab: Tab;
}) {
  const isSolana = useIsSolanaWallet();
  const { dashboardView, setDashboardView, mintType, setMintType } = useFarmView();

  const isFarmOrMint = activeTab === 'dashboard' || activeTab === 'mint';
  const showToggle = isFarmOrMint && !(activeTab === 'mint' && isSolana);
  const value =
    activeTab === 'mint'
      ? (mintType === 'land' ? 'lands' : 'plants')
      : dashboardView;

  const handleValueChange = (nextValue: ToggleValue) => {
    if (nextValue !== 'plants' && nextValue !== 'lands') {
      return;
    }

    if (activeTab === 'mint') {
      setMintType(nextValue === 'lands' ? 'land' : 'plant');
      return;
    }

    setDashboardView(nextValue);
  };

  return (
    <div
      className={cn(
        "flex justify-center pb-3 min-[54rem]:hidden",
        !showToggle && "hidden",
      )}
      data-shared-farm-mint-toggle
    >
      <ToggleGroup
        ariaLabel="Farm view"
        value={value}
        onValueChange={handleValueChange}
        options={[
          {
            value: 'plants',
            ariaLabel: 'Plants',
            label: <span className="flex items-center gap-1"><Leaf className="h-4 w-4" /> Plants</span>,
          },
          {
            value: 'lands',
            ariaLabel: 'Lands',
            label: <span className="flex items-center gap-1"><LandPlot className="h-4 w-4" /> Lands</span>,
          },
        ]}
      />
    </div>
  );
}

type AppTabDefinition = {
  id: Tab;
  label: string;
  icon: LucideIcon;
};

function SlidingNavTabs({
  activeTab,
  mode,
  onTabChange,
  tabs,
}: {
  activeTab: Tab;
  mode: "desktop" | "mobile";
  onTabChange: (tab: Tab) => void;
  tabs: AppTabDefinition[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTab));
  const [indicatorStyle, setIndicatorStyle] = useState<CSSProperties>({
    opacity: 0,
  });

  useLayoutEffect(() => {
    const container = containerRef.current;
    const selectedTab = tabRefs.current[selectedIndex];
    if (!container || !selectedTab) return;

    const updateIndicator = () => {
      setIndicatorStyle({
        height: selectedTab.offsetHeight,
        opacity: 1,
        transform: `translate3d(${selectedTab.offsetLeft}px, ${selectedTab.offsetTop}px, 0)`,
        width: selectedTab.offsetWidth,
      });
    };

    updateIndicator();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(updateIndicator);
    resizeObserver.observe(container);
    tabRefs.current.forEach((tab) => {
      if (tab) resizeObserver.observe(tab);
    });

    return () => resizeObserver.disconnect();
  }, [mode, selectedIndex, tabs.length]);

  const focusTab = (index: number) => {
    tabRefs.current[index]?.focus();
  };

  const selectTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;

    onTabChange(tab.id);
    focusTab(index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (tabs.length === 0) return;

    const isVertical = mode === "desktop";
    const previousKey = isVertical ? "ArrowUp" : "ArrowLeft";
    const nextKey = isVertical ? "ArrowDown" : "ArrowRight";
    let nextIndex = index;

    if (event.key === previousKey) {
      event.preventDefault();
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === nextKey) {
      event.preventDefault();
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "Home") {
      event.preventDefault();
      nextIndex = 0;
    } else if (event.key === "End") {
      event.preventDefault();
      nextIndex = tabs.length - 1;
    } else {
      return;
    }

    selectTab(nextIndex);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative isolate",
        mode === "desktop"
          ? "flex flex-col gap-2"
          : "grid w-full grid-cols-6 items-center gap-0.5",
      )}
      role="tablist"
      aria-label="Application tabs"
      aria-orientation={mode === "desktop" ? "vertical" : "horizontal"}
    >
      <span
        aria-hidden="true"
        data-main-nav-indicator={mode}
        className="surface-control-selected pointer-events-none absolute left-0 top-0 z-0 rounded-[var(--radius-nav)] border transition-[transform,width,height,opacity] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none"
        style={indicatorStyle}
      />
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <Button
            key={tab.id}
            variant="navSliding"
            onClick={() => onTabChange(tab.id)}
            data-active={isActive}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            className={cn(
              "relative z-10",
              mode === "desktop"
                ? "flex h-[68px] w-full flex-col items-center justify-center gap-1 !rounded-[var(--radius-nav)] px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                : "flex h-auto w-full min-w-0 flex-col items-center space-y-0.5 !rounded-[var(--radius-nav)] px-1 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-[340px]:px-0.5",
            )}
            role="tab"
            id={`tab-${mode}-${tab.id}`}
            aria-selected={isActive}
            aria-controls={`tabpanel-${tab.id}`}
            /* No aria-label: the visible span below is the accessible name.
               Overriding it with "Switch to X tab" made the programmatic name
               diverge from the visible one (WCAG 2.5.3) and, because
               aria-labelledby resolves before aria-label, leaked that string
               into the tabpanel's name too. */
            tabIndex={isActive ? 0 : -1}
          >
            <Icon
              className={cn(
                mode === "desktop"
                  ? "h-5 w-5"
                  : "h-5 w-5 shrink-0 max-[360px]:h-4 max-[360px]:w-4",
                // Same ink token as the label beside it (see --selected-control-foreground).
                isActive && "text-[hsl(var(--selected-control-foreground))]",
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "font-medium leading-tight",
                mode === "mobile" && "max-w-full truncate text-[11px] max-[340px]:text-[10px]",
              )}
            >
              {tab.label}
            </span>
          </Button>
        );
      })}
    </div>
  );
}

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
    // The only push-history call site: Back should step between tabs rather than
    // leaving the app. All other query state stays on replace.
    history: "push",
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
  const [localTestAuthAvailable, setLocalTestAuthAvailable] = useState(false);
  const [showViewportDebug, setShowViewportDebug] = useState(false);
  const [isHeaderStatusPlacement, setIsHeaderStatusPlacement] = useState(false);
  const [showStandaloneEthBalance, setShowStandaloneEthBalance] = useState(false);
  const [loginThemeState, setLoginThemeState] = useState({
    current: 0,
    previous: 0,
    activeLayer: 0,
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const previousActiveTabRef = useRef<Tab>(activeTab);
  const lastDismissedRef = useRef<string | null>(null);
  const loginTheme = LOGIN_THEME_SEQUENCE[loginThemeState.current];
  const previousLoginTheme = LOGIN_THEME_SEQUENCE[loginThemeState.previous];
  const loginThemeLayers = [
    loginThemeState.activeLayer === 0 ? loginTheme : previousLoginTheme,
    loginThemeState.activeLayer === 1 ? loginTheme : previousLoginTheme,
  ] as const;

  // Only render tabs the user has actually opened. React 19's <Activity mode="hidden">
  // still RENDERS its children (it defers effects, not rendering), so every
  // next/dynamic tab chunk was being fetched and evaluated on first connect even if
  // the user never left Farm. Derived from activeTab rather than the setter because
  // activeTab is URL-derived and also changes via popstate and the query-state event.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<Tab>>(() => new Set([activeTab]));
  if (!visitedTabs.has(activeTab)) {
    setVisitedTabs(new Set(visitedTabs).add(activeTab));
  }

  useTabPrefetching(activeTab, isConnected);

  useFarcaster();
  useAutoConnect();

  useEffect(() => {
    setLocalTestAuthAvailable(isLocalTestAuthAllowed());
    setShowViewportDebug(
      new URLSearchParams(window.location.search).get("viewportDebug") === "1",
    );
  }, []);

  useEffect(() => {
    if (isConnected) {
      return;
    }

    // Stop the cycle entirely for reduced-motion users. The CSS escape hatch only
    // removes the cross-fade — leaving the timer running would swap the palette in a
    // hard cut every 4s, which is worse than the fade it was meant to soften.
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (motionQuery?.matches) {
      return;
    }

    const advanceLoginTheme = () => {
      setLoginThemeState(({ activeLayer, current }) => ({
        activeLayer: activeLayer === 0 ? 1 : 0,
        current: (current + 1) % LOGIN_THEME_SEQUENCE.length,
        previous: current,
      }));
    };

    const intervalId = window.setInterval(() => {
      advanceLoginTheme();
    }, LOGIN_THEME_INTERVAL_MS);

    const handleMotionPreferenceChange = () => {
      if (motionQuery?.matches) {
        window.clearInterval(intervalId);
      }
    };
    motionQuery?.addEventListener?.("change", handleMotionPreferenceChange);

    return () => {
      window.clearInterval(intervalId);
      motionQuery?.removeEventListener?.("change", handleMotionPreferenceChange);
    };
  }, [isConnected]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;

    const desktopQuery = window.matchMedia("(min-width: 80rem)");
    const compactLandscapeQuery = window.matchMedia("(min-width: 54rem) and (max-height: 700px)");
    const roomyPortraitQuery = window.matchMedia("(min-width: 54rem)");
    const syncShellMode = () => {
      setIsHeaderStatusPlacement(desktopQuery.matches || compactLandscapeQuery.matches);
      setShowStandaloneEthBalance(roomyPortraitQuery.matches && !desktopQuery.matches && !compactLandscapeQuery.matches);
    };

    syncShellMode();
    desktopQuery.addEventListener("change", syncShellMode);
    compactLandscapeQuery.addEventListener("change", syncShellMode);
    roomyPortraitQuery.addEventListener("change", syncShellMode);

    return () => {
      desktopQuery.removeEventListener("change", syncShellMode);
      compactLandscapeQuery.removeEventListener("change", syncShellMode);
      roomyPortraitQuery.removeEventListener("change", syncShellMode);
    };
  }, []);

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
      // Announce the rewrite like every other URL writer does. Without this, any
      // mounted useWebQueryState keeps its old value while the URL no longer
      // carries it, and the divergence only surfaces on an unrelated later write.
      window.dispatchEvent(new Event(WEB_QUERY_STATE_EVENT));
    }
  }, [activeTab, isMiniApp]);

  // Broadcast messages system
  const { messages: broadcastMessages, dismissMessage, trackImpression } = useBroadcastMessages();
  const [currentBroadcast, setCurrentBroadcast] = useState<UntypedValue>(null);

  // Keyboard and viewport awareness
  const keyboardState = useKeyboardAware();
  useViewportInsets();
  const isKeyboardNavigation = useKeyboardNavigation();
  const isNeynarNotifications = CLIENT_ENV.NOTIFICATION_PROVIDER === 'neynar';
  const miniAppContext = (fc?.context as UntypedValue) ?? null;
  const miniAppAdded = Boolean(miniAppContext?.client?.added);

  // Start tutorial only after wallet connect
  useEffect(() => {
    if (isConnected) {
      startIfFirstVisit();
    }
  }, [isConnected, startIfFirstVisit]);

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
        const fid = typeof fc?.context === 'object' ? (fc?.context as UntypedValue)?.user?.fid : undefined;
        if (!fid || !address || !mounted) return;

        const controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 5000);
        const authHeaders = await getMiniAppQuickAuthHeaders({ expectedAddress: address });
        if (!authHeaders.Authorization || !mounted) return;

        await fetch('/api/notifications/map-fid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
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

  useEffect(() => {
    if (previousActiveTabRef.current === activeTab) {
      return;
    }

    previousActiveTabRef.current = activeTab;
    contentScrollRef.current?.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [activeTab]);

  // Balance refreshes after transactions are handled via events in balance-context.tsx
  // No need to refresh on every tab change - balances are already in context

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

  return (
    <div
      data-viewport-shell="outer"
      className={cn(
        "flex justify-center w-full min-h-dvh bg-background bg-[image:var(--gradient-content-well)] overscroll-none",
        keyboardState.isVisible ? "keyboard-visible" : "keyboard-hidden",
        isKeyboardNavigation && "keyboard-navigation",
        !isConnected && "login-theme-cycle",
        !isConnected && loginTheme,
      )}
    >
      {!isConnected && (
        <div className="login-theme-background" aria-hidden="true">
          <div
            className={cn(
              "login-theme-layer",
              loginThemeLayers[0],
              loginThemeState.activeLayer === 0 && "is-active",
            )}
            style={LOGIN_THEME_LAYER_STYLE}
          />
          <div
            className={cn(
              "login-theme-layer",
              loginThemeLayers[1],
              loginThemeState.activeLayer === 1 && "is-active",
            )}
            style={LOGIN_THEME_LAYER_STYLE}
          />
        </div>
      )}
      <div
        data-viewport-shell="inner"
        data-connected={isConnected ? "true" : "false"}
        className={cn(
          "app-shell-inner w-full flex flex-col h-dvh overflow-hidden overscroll-none",
          !isConnected && "relative z-10",
          isConnected ? "bg-background bg-[image:var(--gradient-content-well)]" : "bg-transparent"
        )}
        style={!isConnected ? { maxWidth: "100%" } : undefined}
      >
        {isConnected && (
          <div className="relative z-[var(--z-sticky)] overflow-hidden rounded-b-[var(--radius-panel)] border-x border-b border-x-[hsl(var(--border-strong)/0.28)] border-b-[hsl(var(--divider)/0.66)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75 overscroll-none">
            <header
              data-viewport-shell="header"
              className={cn(
                "bg-transparent px-4 py-2 overscroll-none safe-area-top",
                isHeaderStatusPlacement && "surface-header-divider"
              )}
              role="banner"
              aria-label="Application header"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex shrink-0 items-center space-x-1.5">
                  <Image
                    src="/PixotchiKit/Logonotext.svg"
                    alt="Pixotchi Mini Logo"
                    width={24}
                    height={24}
                    preload
                  />
                  <h1 className="text-sm font-pixel text-foreground">
                    {fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'}
                  </h1>
                </div>

                <div className="flex min-w-0 items-center space-x-2">
                  {isHeaderStatusPlacement && (
                    <ErrorBoundary
                      variant="inline"
                      resetKeys={address ? [address] : []}
                      onError={(error, errorInfo) => {
                        console.error('Error in StatusBar:', { error, errorInfo });
                      }}
                    >
                      <StatusBar placement="header" />
                    </ErrorBoundary>
                  )}

                  {isNeynarNotifications && fc?.isInMiniApp && miniAppContext && !miniAppAdded && !frameAdded && (
                    <Button
                      type="button"
                      variant="headerIcon"
                      size="sm"
                      onClick={handleAddFrame}
                      aria-label="Add Pixotchi Mini to your app"
                      title="Add Pixotchi Mini to your app"
                    >
                      <PlusCircle className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  )}

                  <ChatButton />

                  <Button
                    type="button"
                    variant="headerIcon"
                    size="icon"
                    onClick={() => setShowWalletProfile(true)}
                    aria-label="Open wallet profile"
                    title="Open wallet profile"
                  >
                    <Image
                      src={theme === "pink" ? "/icons/avatar1-icon.webp" : "/icons/avatar2-icon.webp"}
                      alt=""
                      width={24}
                      height={24}
                      className="w-6 h-6"
                      aria-hidden="true"
                      preload
                    />
                  </Button>
                  <ThemeSelector />
                </div>
              </div>
            </header>
            {!isHeaderStatusPlacement && (
              <ErrorBoundary
                variant="inline"
                resetKeys={address ? [address] : []}
                onError={(error, errorInfo) => {
                  console.error('Error in StatusBar:', { error, errorInfo });
                }}
              >
                <StatusBar showEthInStandalone={showStandaloneEthBalance} />
              </ErrorBoundary>
            )}
          </div>
        )}

        {/* Main Content */}
        <main
          data-viewport-shell="main"
          className={cn(
            "flex flex-1 flex-col overflow-hidden xl:flex-row",
            isConnected ? "bg-muted/40 bg-[image:var(--gradient-content-well)]" : "bg-transparent",
          )}
          role="main"
          aria-label="Main content area"
        >
          {(!isConnected) ? (
            <div className="relative z-10 flex h-full flex-col items-center justify-center p-4 safe-area-bottom md:w-full md:overflow-y-auto md:overscroll-contain md:p-4 xl:p-5">
              <div className="flex-grow flex flex-col items-center justify-center text-center md:flex-grow-0 md:w-full md:max-w-[24rem] md:rounded-t-[var(--radius-panel)] md:border md:border-b-0 md:border-[hsl(var(--border-strong)/0.34)] md:bg-card/80 md:px-5 md:pt-5">
                {/* Same components the server-rendered fallback uses (see
                    app/(game)/layout.tsx), so the hand-off is seamless. */}
                <LoginHero title={fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'} />
                <LoginIntro />
              </div>
              <LoginAuthActions
                className="w-full max-w-xs space-y-3 md:max-w-[24rem] md:rounded-b-[var(--radius-panel)] md:border md:border-t-0 md:border-[hsl(var(--border-strong)/0.34)] md:bg-card/80 md:px-5 md:pb-5 md:shadow-[var(--shadow-hairline)]"
                handleMiniAppReconnect={handleMiniAppReconnect}
                isInMiniApp={Boolean(fc?.isInMiniApp)}
                isMiniConnectRetrying={state.isMiniConnectRetrying}
                isRestoringBaseSession={isRestoringBaseSession}
                localTestAuthAvailable={localTestAuthAvailable}
                privyReady={privyReady}
                switchAuthSurface={switchAuthSurface}
              />
            </div>
          ) : (
            <>
              <nav data-viewport-shell="desktop-nav" className="hidden xl:flex w-24 shrink-0 flex-col gap-2 border-r border-[hsl(var(--divider)/0.62)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] p-3 shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75" role="navigation" aria-label="Main navigation">
                <SlidingNavTabs
                  activeTab={activeTab}
                  mode="desktop"
                  onTabChange={setActiveTab}
                  tabs={tabs}
                />
              </nav>

              {/* Tab Content */}
              <div
                ref={contentScrollRef}
                data-viewport-shell="content"
                className="flex-1 overflow-y-auto overscroll-contain touch-pan-y"
                style={{
                  paddingTop: "var(--app-content-gutter)",
                  paddingRight: "var(--app-content-gutter)",
                  // Includes the bottom inset directly: `xl:safe-area-bottom` compiled to
                  // nothing, because .safe-area-bottom is a plain class in @layer utilities
                  // rather than an @utility, so Tailwind never generated the xl: variant.
                  paddingBottom:
                    "calc(var(--app-content-gutter) + var(--app-content-safe-bottom, 0px))",
                  paddingLeft: "var(--app-content-gutter)",
                }}
              >
                <FarmViewProvider isMiniApp={isMiniApp}>
                <SharedFarmMintMobileToggle activeTab={activeTab} />
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
                      const usesContainedTabLayout =
                        tab.id === 'activity' || tab.id === 'leaderboard';
                      // Activity mode: 'visible' means mounted/active effects, 'hidden' means kept in memory but effects unmounted.
                      // This preserves scroll position and state (e.g. inputs) when switching tabs.
                      const activityMode = activeTab === tab.id ? 'visible' : 'hidden';
                      const isVisited = visitedTabs.has(tab.id);

                      return (
                        <Activity key={tab.id} mode={activityMode}>
                          {/*
                            One tabpanel per tab, not one shared panel, and one for
                            EVERY tab rather than only visited ones: each of the 12 nav
                            buttons (6 desktop + 6 mobile) sets
                            aria-controls="tabpanel-<id>", so all six ids must exist or
                            those references dangle. Rendering the panel element is not
                            what costs anything — mounting <TabComponent /> is, because
                            <Activity mode="hidden"> still renders its children and would
                            pull every next/dynamic tab chunk on first connect. So the
                            element is always here and only the contents wait for a visit.
                          */}
                          <div
                            role="tabpanel"
                            id={`tabpanel-${tab.id}`}
                            aria-labelledby={`tab-desktop-${tab.id}`}
                            className={
                              activeTab === tab.id
                                ? cn(
                                    'block min-h-0 animate-tab-content-in',
                                    usesContainedTabLayout && 'h-full'
                                  )
                                : 'hidden'
                            }
                          >
                            {isVisited ? (
                              <ErrorBoundary
                                resetKeys={[tab.id, ...(address ? [address] : [])]}
                                variant="card"
                                onError={(error, errorInfo) => {
                                  console.error(`Error in ${tab.id} tab:`, { error, errorInfo });
                                }}
                              >
                                {TabComponent ? <TabComponent /> : null}
                              </ErrorBoundary>
                            ) : null}
                          </div>
                        </Activity>
                      );
                    })}
                  </TabVisibilityProvider>
                </ErrorBoundary>
                </FarmViewProvider>
              </div>

              {/* Bottom Navigation with safe area */}
              <nav data-viewport-shell="nav" className="surface-footer-divider rounded-t-[var(--radius-panel)] border-x border-t border-x-[hsl(var(--border-strong)/0.28)] border-t-[hsl(var(--divider)/0.66)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] px-4 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75 overscroll-none touch-pan-x select-none safe-area-bottom max-[380px]:px-2 max-[340px]:px-1.5 xl:hidden" role="navigation" aria-label="Main navigation">
                <SlidingNavTabs
                  activeTab={activeTab}
                  mode="mobile"
                  onTabChange={setActiveTab}
                  tabs={tabs}
                />
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
        {showViewportDebug && <ViewportDebugOverlay />}
      </div>
    </div>
  );
}
