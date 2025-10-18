"use client";

import { useMiniKit, useAddFrame } from "@coinbase/onchainkit/minikit";
import { sdk } from "@farcaster/miniapp-sdk";
import { useFrameContext } from "@/lib/frame-context";
import { Wallet } from "@coinbase/onchainkit/wallet";
import { useAccount, useConnect } from "wagmi";
import { useEffect, useState, useCallback, useRef } from "react";
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
import { clearAppCaches } from "@/lib/cache-utils";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Activity } from 'react';

// Import custom hooks
import { useInviteValidation } from "@/hooks/useInviteValidation";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";

// Import broadcast component
import { BroadcastMessageModal } from "@/components/broadcast-message-modal";

// Tab content components with optimized code splitting
const tabComponents = {
  dashboard: dynamic(() => import(/* webpackChunkName: "dashboard-tab" */ "@/components/tabs/dashboard-tab"), {
    loading: () => <BasePageLoader />
  }),
  mint: dynamic(() => import(/* webpackChunkName: "mint-tab" */ "@/components/tabs/mint-tab"), {
    loading: () => <BasePageLoader />
  }),
  about: dynamic(() => import(/* webpackChunkName: "about-tab" */ "@/components/tabs/about-tab"), {
    loading: () => <BasePageLoader />
  }),
  swap: dynamic(() => import(/* webpackChunkName: "swap-tab" */ "@/components/tabs/swap-tab"), {
    loading: () => <BasePageLoader />
  }),
  activity: dynamic(() => import(/* webpackChunkName: "activity-tab" */ "@/components/tabs/activity-tab"), {
    loading: () => <BasePageLoader />
  }),
  leaderboard: dynamic(() => import(/* webpackChunkName: "leaderboard-tab" */ "@/components/tabs/leaderboard-tab"), {
    loading: () => <BasePageLoader />
  }),
};

// Tab prefetching logic with de-duplication
const useTabPrefetching = (activeTab: Tab, isConnected: boolean) => {
  const loadedTabs = useRef(new Set<string>());
  const prefetchingTabs = useRef(new Set<string>());

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
      tabsToPrefetch.forEach((tab) => {
        const key = String(tab);
        if (key === activeTab) return;
        if (loadedTabs.current.has(key) || prefetchingTabs.current.has(key)) return;
        prefetchingTabs.current.add(key);
        (window as any).requestIdleCallback?.(() => {
          // Trigger prefetch by accessing the component (causes Next to fetch the chunk)
          import(`@/components/tabs/${tab}-tab`).finally(() => {
            prefetchingTabs.current.delete(key);
            loadedTabs.current.add(key);
          });
        });
      });
    }

    // Cleanup function to clear pending prefetches on unmount
    return () => {
      prefetchingTabs.current.clear();
    };
  }, [activeTab, isConnected]);
};

import { useSlideshow } from "@/components/tutorial";
import ErrorBoundary from "@/components/ui/error-boundary";
import { useKeyboardAware, useViewportHeight, useKeyboardNavigation } from "@/hooks/useKeyboardAware";


export default function App() {
  const { context } = useMiniKit();
  const fc = useFrameContext();
  const { address, isConnected } = useAccount();
  const { theme } = useTheme();
  const { startIfFirstVisit } = useSlideshow();
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [frameAdded, setFrameAdded] = useState(false);
  const [showWalletProfile, setShowWalletProfile] = useState(false);
  const lastDismissedRef = useRef<string | null>(null);

  // Enable intelligent tab prefetching
  useTabPrefetching(activeTab, isConnected);
  
  // Custom hooks for logic separation
  const { userValidated, checkingValidation, handleInviteValidated, setUserValidated } = useInviteValidation();
  useFarcaster();
  useAutoConnect();

  // Broadcast messages system
  const { messages: broadcastMessages, dismissMessage, trackImpression } = useBroadcastMessages();
  const [currentBroadcast, setCurrentBroadcast] = useState<any>(null);

  // Keyboard and viewport awareness
  const keyboardState = useKeyboardAware();
  const viewportHeight = useViewportHeight();
  const isKeyboardNavigation = useKeyboardNavigation();

  // Privy state for debug + button readiness
  const { ready: privyReady, authenticated } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const { connect, connectors } = useConnect();
  
  // Read selected surface synchronously on initialization to avoid race conditions
  const [surface, setSurface] = useState<'privy' | 'coinbase' | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const key = 'pixotchi:authSurface';
      const stored = sessionStorage.getItem(key) as any;
      if (stored === 'privy' || stored === 'coinbase') return stored;
    } catch {}
    return null;
  });
  
  // Farcaster splash-screen: call ready() once UI is stable
  const readyCalledRef = useRef(false);
  useEffect(() => {
    (async () => {
      if (readyCalledRef.current) return;
      try {
        // Only call inside Mini App environments
        const inMini = await sdk.isInMiniApp();
        if (!inMini) return;

        // Avoid calling during invite validation blocking state when system enabled
        const uiBlockedByInvite = isConnected && INVITE_CONFIG.SYSTEM_ENABLED && (checkingValidation || !userValidated);
        if (uiBlockedByInvite) return;

        await sdk.actions.ready();
        readyCalledRef.current = true;
      } catch (error) {
        console.warn('Failed to call sdk.actions.ready():', error);
      }
    })();
  }, [isConnected, checkingValidation, userValidated]);

  // Back navigation control: enable web navigation integration inside Mini App
  useEffect(() => {
    (async () => {
      try {
        const inMini = await sdk.isInMiniApp();
        if (inMini) {
          await sdk.back.enableWebNavigation();
        }
      } catch {}
    })();
  }, []);
  
  // One-shot autologin after surface switch
  useEffect(() => {
    if (isConnected) return;
    try {
      const auto = (typeof window !== 'undefined') ? sessionStorage.getItem('pixotchi:autologin') : null;
      if (!auto) return;
      if (auto === 'privy' && surface === 'privy' && privyReady) {
        sessionStorage.removeItem('pixotchi:autologin');
        login();
      } else if (auto === 'coinbase' && surface === 'coinbase') {
        const cb = (connectors || []).find((c: any) => `${c.name}`.toLowerCase().includes('coinbase')) || (connectors || [])[0];
        if (cb) {
          sessionStorage.removeItem('pixotchi:autologin');
          connect({ connector: cb as any });
        }
      }
    } catch {}
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

  // Map fid -> address for backend notifications (optional, best-effort)
  useEffect(() => {
    (async () => {
      try {
        const fid = (window as any)?.__pixotchi_frame_context__?.context?.user?.fid;
        if (!fid || !address) return;
        await fetch('/api/notifications/map-fid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid, address }),
        });
      } catch {}
    })();
  }, [address]);

  // Nudge UI forward immediately after a successful connection
  useEffect(() => {
    if (isConnected) {
      try {
        (window as any).__pixotchi_refresh_balances__?.();
      } catch {}
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

  // Render a web-only Coinbase Connect using the app-level wagmi provider
  function CoinbaseConnectOnlyButton() {
    const { connect, connectors, isPending } = useConnect();
    const cbConnector = useMemo(() =>
      connectors.find((c: any) => `${c.name}`.toLowerCase().includes('coinbase')) || connectors[0],
      [connectors]
    );

    const label = isPending ? 'Connecting…' : 'Coinbase Wallet';
    // Keep the option available unless no connector exists; some environments may mark
    // a generic connect as pending due to other providers. We still allow user action.
    const disabled = !cbConnector;

    // Button state is managed by the component logic above

    const handleClick = async () => {
      try {
        // Set preferences first
        sessionStorage.setItem('pixotchi:authSurface', 'coinbase');
        sessionStorage.setItem('pixotchi:autologin', 'coinbase');
        
        // Wait a tick to ensure storage operations complete
        await new Promise(resolve => setTimeout(resolve, 0));
        
        // Update URL and reload
        const url = new URL(window.location.href);
        url.searchParams.set('surface', 'coinbase');
        window.location.replace(url.toString());
      } catch (error) {
        console.error('Failed to switch to Coinbase surface:', error);
        // Fallback: try direct connection without reload
        if (cbConnector) {
          connect({ connector: cbConnector as any });
        }
      }
    };

    return (
      <Button
        className="w-full rounded-md mt-1 h-11 text-base font-semibold text-white bg-[#0000FF] hover:bg-[#335CFF] active:bg-[#0016B3] transition-colors focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0000FF] disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ backgroundColor: '#0000FF' }}
        variant="default"
        aria-busy={isPending}
        aria-live="polite"
        disabled={false}
        onClick={handleClick}
      >
        <span className="flex items-center justify-center gap-2">
          {isPending && (
            <span className="inline-block h-4 w-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
          )}
          <Image src="/icons/Base_square_white.png" alt="Base" width={16} height={16} className="w-4 h-4" />
          <span>{label}</span>
        </span>
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
      // Fallback to Coinbase MiniKit if Farcaster add flow is not available
      const result = await addFrame();
      setFrameAdded(Boolean(result));
    }
  }, [addFrame]);

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
      className={`flex justify-center w-full min-h-dvh bg-background overscroll-none ${
        keyboardState.isVisible ? 'keyboard-visible' : 'keyboard-hidden'
      } ${
        isKeyboardNavigation ? 'keyboard-navigation' : ''
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
              {context && !context.client.added && (
                <Button variant="outline" size="sm" onClick={handleAddFrame}>
                  <PlusCircle className="w-4 h-4" />
                </Button>
              )}

              <ChatButton />
              
              {isConnected && address ? (
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
                        // Set preferences first
                        sessionStorage.setItem('pixotchi:authSurface', 'privy');
                        sessionStorage.setItem('pixotchi:autologin', 'privy');
                        
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
                  <CoinbaseConnectOnlyButton />
                ) : (
                  <div className="text-muted-foreground text-sm">Connecting…</div>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Tab Content */}
              <div className="flex-1">
                {tabs.map((tab) => {
                  const TabComponent = tabComponents[tab.id];
                  if (!TabComponent) return null;
                  const isActive = activeTab === tab.id;
                  return (
                    <Activity key={tab.id} mode={isActive ? 'visible' : 'hidden'}>
                      <div
                        role="tabpanel"
                        id={`tabpanel-${tab.id}`}
                        aria-labelledby={`tab-${tab.id}`}
                        aria-hidden={!isActive}
                        hidden={!isActive}
                        className={`flex-1 overflow-y-auto overscroll-contain p-4 pb-16 safe-area-inset ${isActive ? '' : 'hidden'}`}
                      >
                        <ErrorBoundary
                          key={tab.id}
                          resetKeys={[activeTab, ...(address ? [address] : [])]}
                          variant="card"
                          onError={(error, errorInfo) => {
                            console.error(`Error in ${tab.id} tab:`, { error, errorInfo });
                          }}
                        >
                          <TabComponent />
                        </ErrorBoundary>
                      </div>
                    </Activity>
                  );
                })}
              </div>

              {/* Bottom Navigation with safe area */}
              <nav className="bg-card border-t border-border px-4 py-1 overscroll-none touch-pan-x select-none safe-area-bottom" role="navigation" aria-label="Main navigation">
                <div className="flex justify-around items-center" role="tablist" aria-label="Application tabs">
                  {tabs.map((tab) => (
                    <Button
                      key={tab.id}
                      variant="ghost"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex flex-col items-center space-y-0.5 h-auto w-16 rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                        activeTab === tab.id
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
                        className={`w-5 h-5 ${
                          activeTab === tab.id ? "text-primary" : ""
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