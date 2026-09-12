"use client";

import { useSelectionIndicator } from "@/components/hooks/use-selection-indicator";
import { getRovingIndex } from "@/lib/roving-index";
import { ChatButton } from "@/components/chat";
import { AppUpdateBanner } from "@/components/app-update-banner";
import StatusBar from "@/components/status-bar";
import { useIsSolanaWallet } from "@/components/solana";
import { GameSettingsMenu } from "@/components/game-settings-menu";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { ToggleGroup, type ToggleValue } from "@/components/ui/toggle-group";
import { LoginPanel } from "@/components/login-hero";

import { FarmViewProvider, useFarmView } from "@/lib/farm-view-context";
import { TabVisibilityProvider } from "@/lib/tab-visibility-context";
import { Tab } from "@/lib/types";
import { History,Info,LandPlot,Leaf,PlusCircle,Repeat,Sparkles,Trophy,type LucideIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { useTabSwipe } from '@/hooks/useTabSwipe';
import { haptic } from '@/lib/sensory-feedback';
import dynamic from "next/dynamic";
import Image from "next/image";
import { Activity,memo,useCallback,useEffect,useMemo,useRef,useState,type ComponentType,type KeyboardEvent } from "react";

let farcasterSdkPromise: Promise<typeof import('@farcaster/miniapp-sdk')> | null = null;

function loadFarcasterSdk() {
  farcasterSdkPromise ??= import('@farcaster/miniapp-sdk');
  return farcasterSdkPromise;
}

// Import custom hooks
import { useAppAuthController } from "@/hooks/useAppAuthController";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";
import { useFarcaster } from "@/hooks/useFarcaster";
import { DESKTOP_MEDIA_QUERY, TABLET_MEDIA_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { useGameNavigation } from "@/hooks/useGameNavigation";
import { createRetryableTab } from "@/components/retryable-tab";
import { createRetryableResource } from "@/lib/retryable-resource";
import { requestBalanceRefresh } from "@/lib/app-events";
import { readMiniAppPresentation } from "@/lib/auth-presentation-data";
import { LoginAuthActions } from "@/components/auth/login-auth-actions";
import { CLIENT_ENV } from "@/lib/env-config";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import { isLocalTestAuthAllowed } from "@/lib/local-test-mode";
import { cn } from "@/lib/utils";

// Broadcast + wallet-profile dialogs load on first use, not at boot.
const BroadcastMessageModal = dynamic(
  () => import("@/components/broadcast-message-modal").then((mod) => mod.BroadcastMessageModal),
  { ssr: false },
);
// Dialog-only module (1,000+ lines incl. transfer/airdrop flows). Keep one
// retryable promise so hover/focus can preload it and a cold click can display
// an immediate, accessible loading dialog instead of appearing dead.
type WalletProfileProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};
const loadWalletProfileModule = createRetryableResource(() =>
  import("@/components/wallet-profile").then((module) => module.WalletProfile),
);
// Developer-only viewport instrumentation. Loaded on demand and only rendered when
// ?viewportDebug=1 is present, so it stays out of the app-shell chunk. (Not gated on
// NODE_ENV: the whole point is reading visualViewport / safe-area insets inside the
// production Mini App webview.)
const ViewportDebugOverlay = dynamic(
  () => import("@/components/viewport-debug-overlay").then((mod) => mod.ViewportDebugOverlay),
  { ssr: false }
);

// Tab content components with optimized code splitting and error handling
const tabComponents = {
  dashboard: createRetryableTab(
    () => import(/* webpackChunkName: "dashboard-tab" */ "@/components/tabs/dashboard-tab"),
    "Farm"
  ),
  mint: createRetryableTab(
    () => import(/* webpackChunkName: "mint-tab" */ "@/components/tabs/mint-tab"),
    "Mint"
  ),
  about: createRetryableTab(
    () => import(/* webpackChunkName: "about-tab" */ "@/components/tabs/about-tab"),
    "About"
  ),
  swap: createRetryableTab(
    () => import(/* webpackChunkName: "swap-tab" */ "@/components/tabs/swap-tab"),
    "Swap"
  ),
  activity: createRetryableTab(
    () => import(/* webpackChunkName: "activity-tab" */ "@/components/tabs/activity-tab"),
    "Activity"
  ),
  leaderboard: createRetryableTab(
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

    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
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

    const requestIdleCallback = window.requestIdleCallback;
    if (typeof requestIdleCallback === "function") {
      const id = requestIdleCallback(runPrefetch, { timeout: 2500 }) as number;
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(runPrefetch, 750);
    return () => window.clearTimeout(id);
  }, [activeTab, isConnected]);
};

import { useSlideshow } from "@/components/tutorial";
import ErrorBoundary from "@/components/ui/error-boundary";
import { useViewportInsets } from "@/hooks/useKeyboardAware";

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
        "flex justify-center pb-3 tablet:hidden",
        !showToggle && "hidden",
      )}
      data-shared-farm-mint-toggle
    >
      <ToggleGroup
        ariaLabel={activeTab === 'mint' ? 'Mint type' : 'Farm view'}
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

type TabChangeSource = "keyboard" | "pointer";

// Static — hoisted so the two SlidingNavTabs (memoized below) don't reconcile
// the primary navigation buttons on every App render.
const APP_TABS: AppTabDefinition[] = [
  { id: "dashboard", label: "Farm", icon: Leaf },
  { id: "mint", label: "Mint", icon: Sparkles },
  { id: "activity", label: "Activity", icon: History },
  { id: "leaderboard", label: "Ranking", icon: Trophy },
  { id: "swap", label: "Swap", icon: Repeat },
  { id: "about", label: "About", icon: Info },
];

const PRIMARY_APP_TABS = APP_TABS.filter(tab => tab.id !== "about");

const SlidingNavTabs = memo(function SlidingNavTabs({
  activeTab,
  animateIndicator,
  mode,
  onTabChange,
  tabs,
}: {
  activeTab: Tab;
  animateIndicator: boolean;
  mode: "desktop" | "mobile";
  onTabChange: (tab: Tab, source: TabChangeSource) => void;
  tabs: AppTabDefinition[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = tabs.findIndex((tab) => tab.id === activeTab);
  const indicatorRef = useRef<HTMLSpanElement | null>(null);
  useSelectionIndicator({
    containerRef, indicatorRef, itemRefs: tabRefs, selectedIndex,
    itemCount: tabs.length, layoutKey: mode, animate: animateIndicator,
  });

  const focusTab = (index: number) => {
    tabRefs.current[index]?.focus();
  };

  const selectTab = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;

    onTabChange(tab.id, "keyboard");
    focusTab(index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const nextIndex = getRovingIndex(event.key, index, tabs.length, mode === "desktop" ? "vertical" : "horizontal");
    if (nextIndex === null) return;
    event.preventDefault();

    selectTab(nextIndex);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative isolate",
        mode === "desktop"
          ? "flex shrink-0 flex-col gap-2"
          : "grid w-full grid-cols-5 items-stretch gap-0.5",
      )}
      role="tablist"
      aria-label="Application tabs"
      aria-orientation={mode === "desktop" ? "vertical" : "horizontal"}
    >
      <span
        aria-hidden="true"
        ref={indicatorRef}
        data-main-nav-indicator={mode}
        className={cn(
          "surface-control-selected pointer-events-none absolute left-0 top-0 z-0 rounded-[var(--radius-nav)] border",

        )}
      />
      {tabs.map((tab, index) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;

        return (
          <Button
            key={tab.id}
            variant="navSliding"
            onClick={(event) => onTabChange(tab.id, event.detail === 0 ? "keyboard" : "pointer")}
            data-active={isActive}
            onKeyDown={(event) => handleKeyDown(event, index)}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            className={cn(
              "relative z-10",
              !animateIndicator && "transition-none",
              mode === "desktop"
                ? "flex h-[68px] w-full shrink-0 flex-col items-center justify-center gap-1 !rounded-[var(--radius-nav)] px-2 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                : "flex h-auto w-full min-w-0 flex-col items-center justify-start gap-1 !rounded-[var(--radius-nav)] px-0 py-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
            tabIndex={isActive || (selectedIndex < 0 && index === 0) ? 0 : -1}
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
                mode === "mobile" && "max-w-full whitespace-normal break-words text-xs",
              )}
            >
              {tab.label}
            </span>
          </Button>
        );
      })}
    </div>
  );
});

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
    isWalletConnecting,
    isWalletReconnecting,
    privyReady,
    state,
    switchAuthSurface,
  } = useAppAuthController();
  const { activeTab, setActiveTab, contentScrollRef, onContentScroll } = useGameNavigation(isMiniApp);
  const [keyboardSelectedTab, setKeyboardSelectedTab] = useState<Tab | null>(null);
  const handleTabChange = useCallback((tab: Tab, source: TabChangeSource) => {
    setKeyboardSelectedTab(source === "keyboard" ? tab : null);
    if (source !== 'keyboard' && tab !== activeTab) haptic('light');
    setActiveTab(tab);
  }, [activeTab, setActiveTab]);
  const shouldAnimateTabChange = keyboardSelectedTab !== activeTab;
  useTabSwipe({ container: contentScrollRef, tabs: PRIMARY_APP_TABS.map(tab => tab.id), selected: activeTab, onSelect: tab => handleTabChange(tab, 'pointer'), animateSelection: shouldAnimateTabChange });
  const [frameAdded, setFrameAdded] = useState(false);
  const [showWalletProfile, setShowWalletProfile] = useState(false);
  const [WalletProfileComponent, setWalletProfileComponent] = useState<ComponentType<WalletProfileProps> | null>(null);
  const [walletProfileLoading, setWalletProfileLoading] = useState(false);
  const [walletProfileLoadError, setWalletProfileLoadError] = useState<string | null>(null);
  const [localTestAuthAvailable, setLocalTestAuthAvailable] = useState(false);
  const [showViewportDebug, setShowViewportDebug] = useState(false);
  // Lazy-initialised media queries (useMediaQuery), not useState(false)+effect:
  // the old pattern rendered the WRONG StatusBar placement on the first desktop
  // frame and then swapped it into the header, shifting everything below.
  const isDesktopShell = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const isCompactLandscape = useMediaQuery("(min-width: 54rem) and (max-height: 700px)");
  const isTabletViewport = useMediaQuery(TABLET_MEDIA_QUERY);
  const isHeaderStatusPlacement = isDesktopShell || isCompactLandscape;
  const showStandaloneEthBalance = isTabletViewport && !isDesktopShell && !isCompactLandscape;
  const lastDismissedRef = useRef<string | null>(null);
  const broadcastEverShownRef = useRef(false);

  const ensureWalletProfileLoaded = useCallback(async () => {
    if (WalletProfileComponent || walletProfileLoading) return;
    setWalletProfileLoading(true);
    setWalletProfileLoadError(null);
    try {
      const component = await loadWalletProfileModule();
      setWalletProfileComponent(() => component);
    } catch (error) {
      console.error('Failed to load wallet profile:', error);
      setWalletProfileLoadError('Wallet profile could not be loaded. Check your connection and retry.');
    } finally {
      setWalletProfileLoading(false);
    }
  }, [WalletProfileComponent, walletProfileLoading]);

  // Only render tabs the user has actually opened. React 19's <Activity mode="hidden">
  // still RENDERS its children (it defers effects, not rendering), so every
  // next/dynamic tab chunk was being fetched and evaluated on first connect even if
  // the user never left Farm. Derived from activeTab rather than the setter because
  // activeTab is URL-derived and also changes via popstate and the query-state event.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<Tab>>(() => new Set([activeTab]));
  if (!visitedTabs.has(activeTab)) {
    setVisitedTabs(new Set(visitedTabs).add(activeTab));
  }

  useEffect(() => {
    if (keyboardSelectedTab !== null && keyboardSelectedTab !== activeTab) {
      setKeyboardSelectedTab(null);
    }
  }, [activeTab, keyboardSelectedTab]);

  useTabPrefetching(activeTab, isConnected);

  useFarcaster();
  useAutoConnect();

  useEffect(() => {
    setLocalTestAuthAvailable(isLocalTestAuthAllowed());
    setShowViewportDebug(
      new URLSearchParams(window.location.search).get("viewportDebug") === "1",
    );
  }, []);


  // Broadcast messages system
  const { messages: broadcastMessages, dismissMessage, trackImpression } = useBroadcastMessages();
  const [currentBroadcast, setCurrentBroadcast] = useState<(typeof broadcastMessages)[number] | null>(null);

  // Keep CSS safe-area and keyboard-inclusive viewport variables in sync.
  useViewportInsets();
  const isNeynarNotifications = CLIENT_ENV.NOTIFICATION_PROVIDER === 'neynar';
  const miniAppContext = useMemo(() => readMiniAppPresentation(fc?.context), [fc?.context]);
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
        const { sdk } = await loadFarcasterSdk();
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
    let controller: AbortController | null = null;

    (async () => {
      try {
        const fid = readMiniAppPresentation(fc?.context)?.user.fid;
        if (!fid || !address || !mounted) return;

        const requestController = new AbortController();
        controller = requestController;
        timeoutId = setTimeout(() => requestController.abort(), 5000);
        const authHeaders = await getMiniAppQuickAuthHeaders({ expectedAddress: address });
        if (!authHeaders.Authorization || !mounted) return;

        await fetch('/api/notifications/map-fid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ fid, address }),
          signal: requestController.signal,
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
      controller?.abort();
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

  const handleAddFrame = useCallback(async () => {
    if (!fc?.isInMiniApp) {
      return;
    }

    try {
      const { sdk } = await loadFarcasterSdk();
      await sdk.actions.addMiniApp();
      setFrameAdded(true);
    } catch (e) {
      console.warn('Add mini app prompt failed:', e);
    }
  }, [fc?.isInMiniApp]);

  // Show broadcast messages (one at a time, highest priority first)
  useEffect(() => {
    if (currentBroadcast && !broadcastMessages.some((msg) => msg.id === currentBroadcast.id)) {
      setCurrentBroadcast(null);
    }

    if (!currentBroadcast) {
      const next = broadcastMessages.find((msg) => msg.id !== lastDismissedRef.current);
      if (next) {
        lastDismissedRef.current = null;
        broadcastEverShownRef.current = true;
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
        !isConnected && "login-scene",
      )}
    >
      <div
        data-viewport-shell="inner"
        data-connected={isConnected ? "true" : "false"}
        className={cn(
          "app-shell-inner w-full flex flex-col h-dvh overflow-hidden overscroll-none",
          !isConnected && "login-shell-safe-top relative z-10",
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
                <div className="flex min-w-0 items-center space-x-1.5">
                  <Image
                    src="/PixotchiKit/Logonotext.svg"
                    alt="Pixotchi Mini Logo"
                    width={24}
                    height={24}
                    className="shrink-0"
                    preload
                  />
                  {/* min-w-0 + truncate: at 320px with four 44px header actions the
                      old shrink-0 group pushed the settings control past the chrome's
                      overflow-hidden edge; the title is the element that gives way. */}
                  <h1 className="min-w-0 truncate text-sm font-pixel text-foreground">
                    {fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'}
                  </h1>
                </div>

                <div className={cn("flex items-center gap-[8px]", isHeaderStatusPlacement ? "min-w-0 shrink" : "shrink-0")}>
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
                      size="headerIcon"
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
                    size="headerIcon"
                    onClick={() => {
                      setShowWalletProfile(true);
                      void ensureWalletProfileLoaded();
                    }}
                    onPointerEnter={() => void ensureWalletProfileLoaded()}
                    onFocus={() => void ensureWalletProfileLoaded()}
                    className="[&>img]:h-[24px] [&>img]:w-[24px]"
                    aria-label="Open wallet profile"
                    title="Open wallet profile"
                  >
                    <Image
                      src={theme === "pink" ? "/icons/avatar1-icon.webp" : "/icons/avatar2-icon.webp"}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6"
                      aria-hidden="true"
                      preload
                    />
                  </Button>
                  <GameSettingsMenu onAbout={() => handleTabChange("about", "pointer")} />
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

        <div className="relative z-[var(--z-banner)] shrink-0">
          <AppUpdateBanner disabled={isMiniApp} />
        </div>

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
            <LoginPanel title={fc?.isInMiniApp ? 'PIXOTCHI MINI' : 'PIXOTCHI'}>
              <LoginAuthActions
                className="login-auth-actions"
                handleMiniAppReconnect={handleMiniAppReconnect}
                isInMiniApp={Boolean(fc?.isInMiniApp)}
                state={state}
                isWalletPending={isWalletConnecting || isWalletReconnecting}
                isRestoringBaseSession={isRestoringBaseSession}
                localTestAuthAvailable={localTestAuthAvailable}
                privyReady={privyReady}
                switchAuthSurface={switchAuthSurface}
              />
            </LoginPanel>
          ) : (
            <>
              <nav data-viewport-shell="desktop-nav" className="hidden xl:flex min-h-0 w-24 shrink-0 flex-col gap-2 overflow-x-hidden overflow-y-auto overscroll-contain scroll-py-3 border-r border-[hsl(var(--divider)/0.62)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] p-3 shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75 [scrollbar-width:thin]" role="navigation" aria-label="Main navigation">
                <SlidingNavTabs
                  activeTab={activeTab}
                  animateIndicator={shouldAnimateTabChange}
                  mode="desktop"
                  onTabChange={handleTabChange}
                  tabs={PRIMARY_APP_TABS}
                />
              </nav>

              {/* Tab Content */}
              <div
                ref={contentScrollRef}
                onScroll={onContentScroll}
                data-viewport-shell="content"
                className="flex-1 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y"
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
                    {APP_TABS.map((tab) => {
                      const TabComponent = tabComponents[tab.id];
                      const usesContainedTabLayout =
                        tab.id === 'activity' || tab.id === 'leaderboard';
                      // Activity mode: 'visible' means mounted/active effects, 'hidden' means kept in memory but effects unmounted.
                      // This preserves component state (inputs, selections); scroll position is
                      // saved/restored per tab by the effect above, since all panels share one scroller.
                      const activityMode = activeTab === tab.id ? 'visible' : 'hidden';
                      const isVisited = visitedTabs.has(tab.id);

                      return (
                        <Activity key={tab.id} mode={activityMode}>
                          {/*
                            Keep each destination's panel mounted for navigation
                            references and retained state. About is opened from
                            Settings and has its own accessible label.
                            Mounting <TabComponent /> is the expensive part, because
                            <Activity mode="hidden"> still renders its children and would
                            pull every next/dynamic tab chunk on first connect. So the
                            element is always here and only the contents wait for a visit.
                          */}
                          <div
                            role="tabpanel"
                            id={`tabpanel-${tab.id}`}
                            aria-labelledby={tab.id === "about" ? undefined : `tab-desktop-${tab.id}`}
                            aria-label={tab.id === "about" ? tab.label : undefined}
                            className={
                              activeTab === tab.id
                                ? cn(
                                    'block min-h-0',
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
              <nav data-viewport-shell="nav" className="surface-footer-divider rounded-t-[var(--radius-panel)] border-x border-t border-x-[hsl(var(--border-strong)/0.28)] border-t-[hsl(var(--divider)/0.66)] bg-secondary/90 bg-[image:var(--gradient-app-chrome)] px-4 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md supports-[backdrop-filter]:bg-secondary/75 overscroll-none touch-pan-x select-none safe-area-bottom max-[380px]:px-[8px] max-[340px]:px-[6px] xl:hidden" role="navigation" aria-label="Main navigation">
                <SlidingNavTabs
                  activeTab={activeTab}
                  animateIndicator={shouldAnimateTabChange}
                  mode="mobile"
                  onTabChange={handleTabChange}
                  tabs={PRIMARY_APP_TABS}
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
          {WalletProfileComponent ? (
            <WalletProfileComponent
              open={showWalletProfile}
              onOpenChange={setShowWalletProfile}
            />
          ) : (
            <Dialog open={showWalletProfile} onOpenChange={setShowWalletProfile}>
              <DialogContent surface="soft" className="w-[min(92vw,26rem)]">
                <DialogHeader>
                  <DialogTitle>Wallet profile</DialogTitle>
                  <DialogDescription>
                    {walletProfileLoadError ?? 'Loading your wallet, balances, and settings.'}
                  </DialogDescription>
                </DialogHeader>
                {walletProfileLoading ? (
                  <div role="status" className="flex min-h-20 items-center justify-center gap-3 text-sm text-muted-foreground">
                    <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
                    Loading wallet profile…
                  </div>
                ) : walletProfileLoadError ? (
                  <Button className="w-full" size="touchCompact" onClick={() => void ensureWalletProfileLoaded()}>
                    Retry loading wallet profile
                  </Button>
                ) : null}
              </DialogContent>
            </Dialog>
          )}
        </ErrorBoundary>

        {/* Broadcast Message Modal (mounted once a broadcast exists) */}
        {(currentBroadcast || broadcastEverShownRef.current) && (
          <BroadcastMessageModal
            message={currentBroadcast}
            onDismiss={handleDismissBroadcast}
            onImpression={trackImpression}
          />
        )}
        {showViewportDebug && <ViewportDebugOverlay />}
      </div>
    </div>
  );
}
