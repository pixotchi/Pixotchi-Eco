"use client";

import { useMiniKit, useAddFrame } from "@coinbase/onchainkit/minikit";
import { sdk } from "@farcaster/miniapp-sdk";
import { useFrameContext } from "@/lib/frame-context";
import { useAccount, useConnect } from "wagmi";
import { useEffect, useState, useCallback, useRef, Activity } from "react";
import { Button } from "@/components/ui/button";
import { PageLoader, BasePageLoader } from "@/components/ui/loading";
import { Tab } from "@/lib/types";
import { WalletProfile } from "@/components/wallet-profile";
import { PlusCircle, User, Leaf, Sparkles, Info, Repeat, History, LandPlot, Trophy } from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { ThemeSelector } from "@/components/theme-selector";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { INVITE_CONFIG, getLocalStorageKeys } from "@/lib/invite-utils";
import InviteGate from "@/components/invite-gate";
import { ChatButton } from "@/components/chat";
import StatusBar from "@/components/status-bar";
import { usePrivy, useWallets, useLogin } from "@privy-io/react-auth";
import { SignInWithBaseButton } from "@base-org/account-ui/react";
import { clearAppCaches } from "@/lib/cache-utils";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { TabVisibilityProvider } from "@/lib/tab-visibility-context";

// Import custom hooks
import { useInviteValidation } from "@/hooks/useInviteValidation";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";
import { sessionStorageManager } from "@/lib/session-storage-manager";

// Import broadcast component
import { BroadcastMessageModal } from "@/components/broadcast-message-modal";

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

// Tab prefetching logic with de-duplication
const useTabPrefetching = (activeTab: Tab, isConnected: boolean) => {
  const loadedTabs = useRef(new Set<string>());
  const prefetchingTabs = useRef(new Set<string>());
  const prefetchPromises = useRef<Map<string, Promise<void>>>(new Map());

  useEffect(() => {
    if (!isConnected) return;

    // Define tab navigation patterns for prefetching
    const tabOrder: Tab[] = ["dashboard", "mint", "activity", "leaderboard", "swap", "about"];
    const currentIndex = tabOrder.indexOf(activeTab);

    // Prefetch adjacent tabs (next and previous)
    const prefetchTabs = [currentIndex - 1, currentIndex + 1]
      .filter(index => index >= 0 && index < tabOrder.length)
      .map(index => tabOrder[index]);

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
import { useKeyboardAware, useViewportHeight, useKeyboardNavigation } from "@/hooks/useKeyboardAware";


export default function App() {
  const { context } = useMiniKit();
  const fc = useFrameContext();
  const { address, isConnected: isEvmConnected } = useAccount();
  const { theme } = useTheme();
  const { startIfFirstVisit } = useSlideshow();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [frameAdded, setFrameAdded] = useState(false);
  const [showWalletProfile, setShowWalletProfile] = useState(false);
  const [isMiniConnectRetrying, setIsMiniConnectRetrying] = useState(false);
  const lastDismissedRef = useRef<string | null>(null);

  // Privy state for debug + button readiness + Solana wallet check
  const { ready: privyReady, authenticated, user } = usePrivy();

  // Check if user has a Solana wallet connected via Privy
  const hasSolanaWallet = useMemo(() => {
    if (!authenticated || !user) return false;
    // Check linked accounts for Solana wallets
    return user.linkedAccounts?.some(
      (account: any) => account.type === 'wallet' && account.chainType === 'solana'
    ) ?? false;
  }, [authenticated, user]);

  // Combined connection check: EVM wallet OR Solana wallet
  const isConnected = isEvmConnected || hasSolanaWallet;

  // For Solana users, use their Twin address as the "address" for the app
  // This will be populated by the SolanaWalletContext
  const effectiveAddress = address; // EVM address or undefined for Solana users

  // Enable intelligent tab prefetching
  useTabPrefetching(activeTab, isConnected);

  // Custom hooks for logic separation
  const { userValidated, checkingValidation, handleInviteValidated, setUserValidated } = useInviteValidation();
  const readyBlocker =
    isConnected &&
    INVITE_CONFIG.SYSTEM_ENABLED &&
    (checkingValidation || !userValidated);

  useFarcaster({ readyBlocker });
  useAutoConnect();

  // Broadcast messages system
  const { messages: broadcastMessages, dismissMessage, trackImpression } = useBroadcastMessages();
  const [currentBroadcast, setCurrentBroadcast] = useState<any>(null);

  // Keyboard and viewport awareness
  const keyboardState = useKeyboardAware();
  const viewportHeight = useViewportHeight();
  const isKeyboardNavigation = useKeyboardNavigation();

  // Additional Privy/Wagmi hooks
  const { login } = useLogin();
  const { wallets } = useWallets();
  const { connect, connectors } = useConnect();

  // Initialize surface as null on server to avoid SSR hydration mismatch
  // sessionStorage doesn't exist on server, so we populate this on client mount
  const [surface, setSurface] = useState<'privy' | 'base' | 'privysolana' | null>(null);
  const [surfaceInitialized, setSurfaceInitialized] = useState(false);

  // Populate surface from sessionStorage on client mount only
  useEffect(() => {
    if (surfaceInitialized) return;

    try {
      const stored = sessionStorageManager.getAuthSurface();
      // Map 'coinbase' to 'base' for backward compatibility
      const effectiveSurface = stored === 'coinbase' ? 'base' : (stored as 'privy' | 'base' | 'privysolana' | null);
      setSurface(effectiveSurface);
    } catch (error) {
      console.warn('Failed to read surface on mount:', error);
    }

    setSurfaceInitialized(true);
  }, [surfaceInitialized]);

  // Back navigation control: enable web navigation integration inside Mini App
  useEffect(() => {
    (async () => {
      try {
        const inMini = await sdk.isInMiniApp();
        if (inMini) {
          await sdk.back.enableWebNavigation();
        }
      } catch { }
    })();
  }, []);

  // One-shot autologin after surface switch
  useEffect(() => {
    if (isConnected) return;

    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;

    const handleAutologin = async () => {
      try {
        const storedAuto = sessionStorageManager.getAutologin();
        if (!storedAuto) return;

        // Map 'coinbase' to 'base'
        const auto = storedAuto === 'coinbase' ? 'base' : storedAuto;

        // Handle Privy surfaces (both EVM and Solana)
        if (auto === 'privy' && surface === 'privy' && privyReady) {
          await sessionStorageManager.removeAutologin();
          if (mounted) login();
        } else if (auto === 'privysolana' && surface === 'privysolana' && privyReady) {
          // Solana surface - trigger Privy login (will show Solana wallets only)
          await sessionStorageManager.removeAutologin();
          if (mounted) login();
        } else if (auto === 'base' && surface === 'base') {
          const base = (connectors || []).find((c: any) => c.id === 'baseAccount') || (connectors || [])[0];
          if (base) {
            await sessionStorageManager.removeAutologin();
            if (mounted) connect({ connector: base as any });
          }
        }
      } catch (error) {
        console.error('Failed to handle autologin:', error);
      }
    };

    handleAutologin();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isConnected, privyReady, surface, connectors, connect, login]);

  // Respect user's wallet choice - don't automatically switch to embedded wallets
  // This prevents the issue where external wallets get switched to Privy embedded wallets
  // after signing auth messages


  const addFrame = useAddFrame();

  // Start tutorial only after wallet connect (and invite gate passed)
  useEffect(() => {
    if (isConnected && userValidated) {
      startIfFirstVisit();
    }
  }, [isConnected, userValidated, startIfFirstVisit]);

  // Auto-prompt to add mini app when user opens in miniapp mode and hasn't added yet
  useEffect(() => {
    // Only run once context is available, user is in miniapp, and hasn't added yet
    if (!context || context.client.added || frameAdded) return;
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
  }, [context, fc?.isInMiniApp, frameAdded]);

  // Map fid -> address for backend notifications (optional, best-effort)
  useEffect(() => {
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
  }, [address, fc?.context]);

  // Nudge UI forward immediately after a successful connection
  useEffect(() => {
    if (isConnected) {
      try {
        (window as any).__pixotchi_refresh_balances__?.();
      } catch { }
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

  // Render a web-only Base Account connect using the official Base UI component
  function BaseAccountButton() {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleClick = () => {
      if (isProcessing) return;
      setIsProcessing(true);
      (async () => {
        try {
          await sessionStorageManager.setAuthSurfaceAndAutologin("base");
          const url = new URL(window.location.href);
          url.searchParams.set("surface", "base");
          window.location.replace(url.toString());
        } catch (error) {
          console.error("Failed to switch to Base surface:", error);
          setIsProcessing(false);
        }
      })();
    };

    return (
      <SignInWithBaseButton
        align="center"
        variant="solid"
        colorScheme="light"
        onClick={handleClick}
      />
    );
  }

  // Render Solana wallet login button (switches to solana-only Privy mode)
  function SolanaLoginButton() {
    const [isProcessing, setIsProcessing] = useState(false);
    const isSolanaEnabled = process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true';

    if (!isSolanaEnabled) return null;

    const handleClick = () => {
      if (isProcessing) return;
      setIsProcessing(true);
      (async () => {
        try {
          await sessionStorageManager.setAuthSurfaceAndAutologin("privysolana");
          const url = new URL(window.location.href);
          url.searchParams.set("surface", "privysolana");
          window.location.replace(url.toString());
        } catch (error) {
          console.error("Failed to switch to Solana surface:", error);
          setIsProcessing(false);
        }
      })();
    };

    return (
      <Button
        className="w-full rounded-md text-base font-semibold text-white h-11 bg-gradient-to-r from-[#9945FF] to-[#14F195] hover:from-[#8833EE] hover:to-[#0DE084] active:from-[#9945FF] active:to-[#14F195] focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
        variant="default"
        onClick={handleClick}
        disabled={isProcessing}
      >
        {isProcessing ? (
          'Loading...'
        ) : (
          <span className="flex items-center gap-2">
            <Image
              src="/icons/solana.svg"
              alt="Solana"
              width={20}
              height={20}
              className="w-5 h-5"
            />
            Continue with Solana
          </span>
        )}
      </Button>
    );
  }

  const handleAddFrame = useCallback(async () => {
    // Prefer Farcaster Mini App add flow when available, fallback to MiniKit's add frame
    try {
      await sdk.actions.addMiniApp();
      setFrameAdded(true);
      return;
    } catch (e) {
      // Fallback to Base MiniKit if Farcaster add flow is not available
      const result = await addFrame();
      setFrameAdded(Boolean(result));
    }
  }, [addFrame]);

  const handleMiniAppReconnect = useCallback(() => {
    if (isMiniConnectRetrying) return;

    setIsMiniConnectRetrying(true);
    try {
      const farcasterConnector = (connectors || []).find((c: any) => {
        const id = (c?.id ?? "").toString().toLowerCase();
        const name = (c?.name ?? "").toString().toLowerCase();
        return id.includes("farcaster") || name.includes("farcaster");
      }) || (connectors || [])[0];

      if (farcasterConnector) {
        connect({ connector: farcasterConnector as any });
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.warn("Mini app reconnect failed, reloading:", error);
      window.location.reload();
    } finally {
      setTimeout(() => setIsMiniConnectRetrying(false), 1200);
    }
  }, [connect, connectors, isMiniConnectRetrying]);

  const tabs = [
    { id: "dashboard" as Tab, label: "Farm", icon: Leaf },
    { id: "mint" as Tab, label: "Mint", icon: Sparkles },
    { id: "activity" as Tab, label: "Activity", icon: History },
    { id: "leaderboard" as Tab, label: "Ranking", icon: Trophy },
    { id: "swap" as Tab, label: "Swap", icon: Repeat },
    { id: "about" as Tab, label: "About", icon: Info },
  ];

  // Handle tutorial CTA tab navigation via a custom event fired externally if needed
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tab?: Tab } | undefined;
      if (detail?.tab) {
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener('pixotchi:navigate', handler as EventListener);
    return () => window.removeEventListener('pixotchi:navigate', handler as EventListener);
  }, []);

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
          <BasePageLoader text="Checking wallet validation..." />
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
      className={`flex justify-center w-full min-h-dvh bg-background overscroll-none ${keyboardState.isVisible ? 'keyboard-visible' : 'keyboard-hidden'
        } ${isKeyboardNavigation ? 'keyboard-navigation' : ''
        }`}
      aria-label="Pixotchi Mini Game"
      style={{
        // Dynamic viewport height for mobile
        minHeight: viewportHeight > 0 ? `${viewportHeight}px` : undefined
      }}
    >
      <div className="w-full max-w-md flex flex-col h-dvh bg-background overflow-hidden overscroll-none">
        {/* Header wrapper with matching background and safe area */}
        <div className="bg-card/90 backdrop-blur-sm overscroll-none">
          <header className="bg-card/90 backdrop-blur-sm border-b border-border px-4 py-2 overscroll-none safe-area-top" role="banner" aria-label="Application header">
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
                {context && !context.client.added && !frameAdded && (
                  <Button variant="outline" size="sm" onClick={handleAddFrame}>
                    <PlusCircle className="w-4 h-4" />
                  </Button>
                )}

                <ChatButton />

                {isConnected ? (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowWalletProfile(true)}
                  >
                    <Image
                      src={theme === "pink" ? "/icons/Avatar1.svg" : "/icons/Avatar2.svg"}
                      alt="Profile"
                      width={24}
                      height={24}
                      className="w-6 h-6"
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
        <main className="flex-1 bg-muted/40 flex flex-col overflow-hidden" role="main" aria-label="Main content area">
          {(!isConnected) ? (
            <div className="flex flex-col items-center justify-center h-full p-4">
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
              <div className="w-full max-w-xs space-y-3">
                {!fc?.isInMiniApp && (
                  <Alert>
                    <Info className="h-4 w-4" />
                    <AlertTitle>Not in Mini App</AlertTitle>
                    <AlertDescription>
                      Open in Farcaster/Base App for the native experience — search "Pixotchi Mini". You can also continue here.
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
                        // Set preferences first using centralized manager
                        await sessionStorageManager.setAuthSurfaceAndAutologin('privy');

                        // Wait a tick to ensure storage operations complete
                        await new Promise(resolve => setTimeout(resolve, 0));

                        // Update URL and reload
                        const url = new URL(window.location.href);
                        url.searchParams.set('surface', 'privy');
                        window.location.replace(url.toString());
                      } catch (error) {
                        console.error('Failed to switch to Privy surface:', error);
                        // Fallback: try direct login without reload if Privy is ready
                        if (privyReady && login) {
                          try {
                            login();
                          } catch (loginError) {
                            console.error('Fallback Privy login failed:', loginError);
                          }
                        }
                      }
                    }}
                    disabled={!privyReady}
                  >
                    {privyReady ? 'Continue with Privy' : 'Loading Privy…'}
                  </Button>
                ) : null}
                {!fc?.isInMiniApp ? (
                  <>
                    <BaseAccountButton />
                    {/* Solana Bridge option - connects via Base-Solana bridge */}
                    {process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true' && (
                      <>
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-xs text-muted-foreground">or bridge from Solana</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                        <SolanaLoginButton />
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
                      disabled={isMiniConnectRetrying}
                    >
                      {isMiniConnectRetrying ? "Retrying..." : "Retry Connection"}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tab Content */}
              <div
                className="flex-1 overflow-y-auto overscroll-contain p-4 pb-16 safe-area-inset"
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
              <nav className="bg-card border-t border-border px-4 py-1 overscroll-none touch-pan-x select-none safe-area-bottom rounded-t-2xl" role="navigation" aria-label="Main navigation">
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
      </div>
    </div>
  );
}
