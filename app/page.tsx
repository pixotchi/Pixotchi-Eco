"use client";

import { useMiniKit, useAddFrame } from "@coinbase/onchainkit/minikit";
import { sdk } from "@farcaster/miniapp-sdk";
import { useFrameContext } from "@/lib/frame-context";
import { Wallet } from "@coinbase/onchainkit/wallet";
import { useAccount, useConnect } from "wagmi";
import { useEffect, useState, useCallback, useRef, Suspense } from "react";
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

// Import custom hooks
import { useInviteValidation } from "@/hooks/useInviteValidation";
import { useFarcaster } from "@/hooks/useFarcaster";
import { useAutoConnect } from "@/hooks/useAutoConnect";
import { useBroadcastMessages } from "@/hooks/useBroadcastMessages";
import { sessionStorageManager } from "@/lib/session-storage-manager";

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

// Tab prefetching logic - Interaction based
const useTabPrefetch = () => {
  const loadedTabs = useRef(new Set<string>());
  const prefetchingTabs = useRef(new Set<string>());

  const prefetchTab = useCallback((tab: Tab) => {
    const key = String(tab);
    if (loadedTabs.current.has(key) || prefetchingTabs.current.has(key)) return;
    
    prefetchingTabs.current.add(key);
    
    import(`@/components/tabs/${tab}-tab`)
      .then(() => {
        loadedTabs.current.add(key);
      })
      .catch((err) => {
        console.warn(`Failed to prefetch tab ${tab}:`, err);
      })
      .finally(() => {
        prefetchingTabs.current.delete(key);
      });
  }, []);

  return prefetchTab;
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

  // Enable intelligent tab prefetching (interaction based)
  const prefetchTab = useTabPrefetch();
  
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

  // Privy state for debug + button readiness
  const { ready: privyReady, authenticated } = usePrivy();
  const { login } = useLogin();
  const { wallets } = useWallets();
  const { connect, connectors } = useConnect();
  
  // Read selected surface synchronously on initialization to avoid race conditions
  const [surface, setSurface] = useState<'privy' | 'base' | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const stored = sessionStorageManager.getAuthSurface();
      // Map 'coinbase' to 'base' for backward compatibility
      return stored === 'coinbase' ? 'base' : stored;
    } catch (error) {
      console.warn('Failed to read surface on mount:', error);
      return null;
    }
  });
  
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
    
    let mounted = true;
    let timeoutId: NodeJS.Timeout | null = null;
    
    const handleAutologin = async () => {
      try {
        const storedAuto = sessionStorageManager.getAutologin();
        if (!storedAuto) return;
        
        // Map 'coinbase' to 'base'
        const auto = storedAuto === 'coinbase' ? 'base' : storedAuto;
        
        if (auto === 'privy' && surface === 'privy' && privyReady) {
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
                  <BaseAccountButton />
                ) : (
                  <div className="text-muted-foreground text-sm">Connecting…</div>
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
                  key={activeTab}
                  resetKeys={[activeTab, ...(address ? [address] : [])]}
                  variant="card"
                  onError={(error, errorInfo) => {
                    console.error(`Error in ${activeTab} tab:`, { error, errorInfo });
                  }}
                >
                  <Suspense fallback={<BasePageLoader />}>
                    {(() => {
                      const ActiveTabComponent = tabComponents[activeTab];
                      return ActiveTabComponent ? <ActiveTabComponent /> : null;
                    })()}
                  </Suspense>
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
                      onMouseEnter={() => prefetchTab(tab.id)}
                      onTouchStart={() => prefetchTab(tab.id)}
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