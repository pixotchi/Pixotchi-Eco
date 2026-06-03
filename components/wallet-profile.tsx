"use client";

import { AirdropClaimCard } from "@/components/airdrop-claim-card";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { SolanaBridgeBadge,useIsSolanaWallet,useSolanaWallet } from "@/components/solana";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
Dialog,
DialogBody,
DialogContent,
DialogDescription,
DialogFooter,
DialogHeader,
DialogTitle,
} from "@/components/ui/dialog";
import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { useAuthSurface } from "@/hooks/useAuthSurface";
import { clearAppCaches } from "@/lib/cache-utils";
import { clearPublicChatSession } from "@/lib/chat-auth-client";
import { useEthMode } from "@/lib/eth-mode-context";
import { useFrameContext } from "@/lib/frame-context";
import { openExternalUrl } from "@/lib/open-external";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { isSolanaEnabled } from "@/lib/solana-constants";
import { formatAddress } from "@/lib/utils";
import { sdk } from "@farcaster/miniapp-sdk";
import type { WalletWithMetadata } from "@privy-io/react-auth";
import { useLogin,useLogout,usePrivy } from "@privy-io/react-auth";
import { useWallets as useSolanaPrivyWallets } from "@privy-io/react-auth/solana";
import {
CheckCircle,
ChevronRight,
Copy,
Info,
Key,
Lightbulb,
LogOut,
RefreshCw,
ShieldAlert,
Wallet,
X,
XCircle
} from "lucide-react";
import React,{ useEffect,useMemo,useState } from "react";
import toast from "react-hot-toast";
import { useAccount,useChainId,useDisconnect } from "wagmi";
import BalanceCard from "./balance-card";
import TransferAssetsDialog from "./transactions/transfer-assets-dialog";
import { StandardContainer } from "./ui/pixel-container";
import { Skeleton } from "./ui/skeleton";

const AUTH_CACHE_PREFIXES = [
  "wagmi",
  "_wagmi",
  "walletconnect",
  "wc@",
  "privy",
  "@privy",
  "ock",
  "coinbase",
];

// Compact ETH Mode toggle row for Connection card
const EthModeToggleRow = () => {
  const { isEthMode, toggleEthMode, isFeatureEnabled } = useEthMode();

  // Don't render if feature is disabled via env var
  if (!isFeatureEnabled) return null;

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium">ETH Mode (Beta)</span>
      <button
        type="button"
        onClick={toggleEthMode}
        className="relative inline-flex min-h-11 min-w-14 items-center justify-center rounded-[var(--radius-control)] p-0 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        role="switch"
        aria-checked={isEthMode}
        aria-label="ETH Mode"
      >
        <span
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${isEthMode ? 'bg-[hsl(var(--success))]' : 'bg-muted'
            }`}
          aria-hidden="true"
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform ${isEthMode ? 'translate-x-[22px]' : 'translate-x-[4px]'
              }`}
          />
        </span>
      </button>
    </div>
  );
};

interface WalletProfileProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletProfile({ open, onOpenChange }: WalletProfileProps) {
  const { address, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const {
    ready: privyReady,
    authenticated: privyAuthenticated,
    user: privyUser,
    exportWallet,
  } = usePrivy();
  const { login } = useLogin();

  // Use useLogout hook with callbacks as recommended by Privy guidelines
  const { logout } = useLogout({
    onSuccess: () => {
      console.log('User successfully logged out from Privy');
      // Post-logout cleanup handled in handleDisconnect
    },
  });
  const chainId = useChainId();
  const fc = useFrameContext();     // Farcaster context provider
  const { resolved: authSurfaceResolved, surface: authSurface } = useAuthSurface();
  const {
    isSmartWallet,
    walletType,
    isLoading: smartWalletLoading,
  } = useSmartWallet();



  const { name, loading: isNameLoading } = usePrimaryName(address ?? undefined);

  // Solana wallet state
  const isSolana = useIsSolanaWallet();
  const { solanaAddress, twinAddress, isTwinSetup, isLoading: solanaLoading } = useSolanaWallet();
  const { wallets: solanaPrivyWallets } = useSolanaPrivyWallets();

  const [referrerDomain, setReferrerDomain] = useState<string | null>(null);
  const [showFcDetails, setShowFcDetails] = useState<boolean>(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedEmbeddedAddress, setSelectedEmbeddedAddress] = useState<string | null>(null);

  // Hidden debug mode - tap wallet icon 5 times to reveal
  const [debugTapCount, setDebugTapCount] = useState(0);
  const [debugMode, setDebugMode] = useState(false);
  const debugTapTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // Farcaster / Mini App state (evaluate before export gating)
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const isFrameContextResolved = fc !== null;
  const fcContext = (fc?.context as UntypedValue) ?? null;
  const isInFrame = isMiniApp; // alias for clarity
  const isPrivySurface = authSurface === "privy" || authSurface === "privysolana";

  useEffect(() => {
    if (isMiniApp) {
      return;
    }

    setDebugTapCount(0);
    setDebugMode(false);
    setShowFcDetails(false);

    if (debugTapTimeoutRef.current) {
      clearTimeout(debugTapTimeoutRef.current);
      debugTapTimeoutRef.current = null;
    }
  }, [isMiniApp]);

  useEffect(() => {
    return () => {
      if (debugTapTimeoutRef.current) {
        clearTimeout(debugTapTimeoutRef.current);
      }
    };
  }, []);

  const embeddedWallets = useMemo(() => {
    if (!privyUser?.linkedAccounts) return [] as Array<{ address: string }>;

    const wallets = privyUser.linkedAccounts.filter((account): account is WalletWithMetadata => {
      if (account?.type !== "wallet") return false;
      const walletAccount = account as WalletWithMetadata;
      return (
        walletAccount.walletClientType === "privy" &&
        walletAccount.chainType === "ethereum" &&
        typeof walletAccount.address === "string"
      );
    });

    return wallets.map((wallet) => ({ address: wallet.address }));
  }, [privyUser?.linkedAccounts]);

  useEffect(() => {
    if (embeddedWallets.length > 0) {
      setSelectedEmbeddedAddress((prev) => prev ?? embeddedWallets[0].address);
    } else {
      setSelectedEmbeddedAddress(null);
    }
  }, [embeddedWallets]);

  // Check if the currently connected wallet is an embedded Privy wallet
  const isCurrentlyEmbeddedWallet = useMemo(() => {
    if (!address || !privyUser?.linkedAccounts) return false;

    // Find the linked account that matches the current address
    const linkedWallet = privyUser.linkedAccounts.find((account) => {
      if (account?.type !== "wallet") return false;
      const walletAccount = account as WalletWithMetadata;
      return (
        walletAccount.address?.toLowerCase() === address.toLowerCase() &&
        walletAccount.walletClientType === "privy" &&
        walletAccount.chainType === "ethereum"
      );
    });

    return Boolean(linkedWallet);
  }, [address, privyUser?.linkedAccounts]);

  const canExportEmbeddedWallet =
    authSurfaceResolved &&
    isPrivySurface &&
    privyReady &&
    privyAuthenticated &&
    embeddedWallets.length > 0 &&
    isCurrentlyEmbeddedWallet &&
    Boolean(exportWallet) &&
    !isMiniApp;

  const exportWalletLabel = "Export Embedded Wallet";

  const handleOpenExportDialog = () => {
    if (!canExportEmbeddedWallet) {
      toast.error("Export is only available for embedded Privy wallets.");
      return;
    }
    setExportDialogOpen(true);
  };

  const handleConfirmExport = async () => {
    if (!exportWallet || !canExportEmbeddedWallet) {
      toast.error("Export is currently unavailable.");
      return;
    }

    // According to Privy docs (exp.md line 51): exportWallet requires user to be authenticated
    // Check that user is both ready AND authenticated (not just connected via Wagmi)
    if (!privyReady || !privyAuthenticated) {
      toast.error("Please log in with Privy to export your wallet. Wallet export requires Privy authentication.");
      if (login) {
        try {
          setIsExporting(true);
          await login();
          setIsExporting(false);
          // After login, user needs to manually retry export
          toast("Please try exporting again after logging in.", { icon: "ℹ️" });
          return;
        } catch (loginError) {
          console.error("Authentication failed:", loginError);
          setIsExporting(false);
          toast.error("Authentication failed. Please try logging in again.");
          return;
        }
      } else {
        return;
      }
    }

    const performExport = async () => {
      if (embeddedWallets.length > 1 && selectedEmbeddedAddress) {
        await exportWallet({ address: selectedEmbeddedAddress });
      } else {
        await exportWallet();
      }
    };

    setIsExporting(true);
    try {
      await performExport();
      toast.success("Export window opened. Follow the instructions to copy your key.");
      setExportDialogOpen(false);
    } catch (error: UntypedValue) {
      console.error("Embedded wallet export failed", error);
      const rawMessage = (error?.message || "").toString();
      const needsReauth = /access token/i.test(rawMessage) || /mfa/i.test(rawMessage);
      const isMfaError = /mfa/i.test(rawMessage) && /enroll/i.test(rawMessage);

      // MFA/access token errors indicate missing or invalid Privy authentication
      // According to Privy docs, exportWallet requires authenticated user with valid access token
      if (isMfaError || needsReauth) {
        toast.error("Wallet export requires Privy authentication with a valid access token. Please log out and log back in via Privy.");
        // Don't automatically retry - user needs to properly authenticate first
        setIsExporting(false);
        return;
      }

      const fallbackMessage = rawMessage || "Failed to export embedded wallet";
      toast.error(fallbackMessage);
    } finally {
      setIsExporting(false);
    }
  };

  // Derive referrer from provider's context
  useEffect(() => {
    const loc = fcContext?.location;
    if (loc && typeof loc === 'object') {
      const ref = (loc as UntypedValue).referrerDomain || (loc as UntypedValue).referrer || null;
      setReferrerDomain(ref ?? null);
    } else {
      setReferrerDomain(null);
    }
  }, [fcContext, open]);

  // Network info
  const getNetworkName = (chainId: number) => {
    switch (chainId) {
      case 8453:
        return "Base";
      case 84532:
        return "Base Sepolia";
      case 1:
        return "Ethereum";
      default:
        return `Chain ${chainId}`;
    }
  };

  const getNetworkStatusIcon = (chainId: number) => {
    const isBase = chainId === 8453;
    const isTestnet = chainId === 84532;

    if (isBase) {
      // Blue rounded square for Base mainnet (Base logo style)
      return <div className="w-4 h-4 bg-[hsl(var(--info))] rounded-sm" />;
    }

    const color = isTestnet ? "text-[hsl(var(--warning))]" : "text-destructive";
    return <CheckCircle className={`w-4 h-4 ${color}`} />;
  };

  // Wallet provider info with MiniKit awareness and Solana support
  const getWalletProviderName = () => {
    if (isSolana) {
      const solWallet = solanaPrivyWallets?.[0];
      const solName =
        (solWallet as UntypedValue)?.name ||
        (solWallet as UntypedValue)?.standardWallet?.name ||
        (solWallet as UntypedValue)?.walletClientType;
      return solName || "Solana Wallet";
    }
    if (!connector) return "Unknown";

    // In frame context, it's likely Base Account via Farcaster
    if (isInFrame) {
      return "Base Account (Frame)";
    }

    switch (connector.name.toLowerCase()) {
      case "privy":
        return "Privy";
      case "sign in with base":
      case "baseaccount":
      case "base account":
        return "Base Account";
      case "metamask":
        return "MetaMask";
      case "walletconnect":
        return "WalletConnect";
      case "rainbow":
        return "Rainbow";
      case "safe":
        return "Safe";
      default:
        return connector.name;
    }
  };

  const getWalletTypeLabel = () => {
    if (isSolana) return "Solana Twin (Smart Wallet)";
    switch (walletType) {
      case "coinbase-smart":
      case "other-smart":
        return "Smart Wallet";
      case "eoa":
      case "eip7702-delegated":
        return "Regular Wallet";
      default:
        return "Unknown";
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  const handleDisconnect = async () => {
    try {
      // First, close the dialog to provide immediate feedback
      onOpenChange(false);
      await sessionStorageManager.markPrivyLogoutIntent();

      let privyLogoutSucceeded = true;

      // According to Privy guidelines: logout Privy first, then disconnect Wagmi
      // This ensures proper session cleanup before disconnecting the wallet connection
      if (privyReady && privyAuthenticated && logout) {
        try {
          // Privy logout will clear user state and delete persisted session
          await logout();
          privyLogoutSucceeded = true;
        } catch (logoutError) {
          console.error('Privy logout failed:', logoutError);
          toast.error('Failed to logout from Privy. Please try again.');
          privyLogoutSucceeded = false;
        }
      }

      // Disconnect wagmi connection after Privy logout
      // This ensures wallet disconnection happens after session cleanup
      disconnect();

      // Clear auth state to reset any surface and wallet-binding metadata
      try {
        await sessionStorageManager.clearAuthState();
      } catch (storageError) {
        console.warn('Failed to clear auth preferences:', storageError);
      }

      try {
        await clearPublicChatSession();
      } catch (chatSessionError) {
        console.warn('Failed to clear public chat session:', chatSessionError);
      }

      // Clear URL query parameters and redirect to root
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.delete('surface');
        // Use replace to avoid adding to browser history
        window.history.replaceState({}, '', url.pathname);
      }

      // Show success message only if Privy logout succeeded or wasn't needed
      // If Privy logout failed, onError callback already showed error toast
      if (privyLogoutSucceeded) {
        toast.success("Wallet disconnected");
      }

      // Clear caches asynchronously to avoid blocking UI
      setTimeout(() => {
        try {
          clearAppCaches({
            preserveLocalStorageKeys: ["pixotchi:tutorial", "pixotchi:cache_version"]
          });
        } catch (cacheError) {
          console.warn('Cache cleanup failed:', cacheError);
        }
      }, 100);

    } catch (error) {
      console.error('Disconnect failed:', error);
      toast.error("Failed to disconnect wallet completely");

      // Still close dialog even if there were errors
      onOpenChange(false);
    }
  };

  const handleCloseMiniApp = async () => {
    try {
      await sessionStorageManager.clearAuthState();
    } catch (storageError) {
      console.warn('Failed to clear auth state before closing mini app:', storageError);
    }

    try {
      await clearPublicChatSession();
    } catch (chatSessionError) {
      console.warn('Failed to clear public chat session before closing mini app:', chatSessionError);
    }

    await clearAppCaches({
      onlyPrefixes: AUTH_CACHE_PREFIXES,
      preserveLocalStorageKeys: ["pixotchi:tutorial", "pixotchi:cache_version"],
    });

    try {
      await sdk.actions.close();
    } catch {
      toast.error("Close action not supported in this context");
    }
  };

  const handleEmbeddedWalletAddressChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedEmbeddedAddress(event.target.value);
  };

  // For EVM wallets, check address. For Solana, check solanaAddress
  const hasWallet = address || solanaAddress;
  if (!hasWallet && !isSolana) return null;

  return (
    <React.Fragment>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="xl" surface="soft" className="w-[min(94vw,36rem)]">
          <DialogHeader>
            <div className="flex items-center space-x-2">
              {/* Profile Avatar or Wallet icon - with 5-tap debug mode trigger */}
              <div
                className={isMiniApp ? "cursor-pointer select-none" : "select-none"}
                onClick={() => {
                  if (!isMiniApp) {
                    return;
                  }

                  // Clear previous timeout
                  if (debugTapTimeoutRef.current) {
                    clearTimeout(debugTapTimeoutRef.current);
                  }

                  const newCount = debugTapCount + 1;
                  setDebugTapCount(newCount);

                  if (newCount >= 5) {
                    setDebugMode(true);
                    setDebugTapCount(0);
                    toast.success('Debug mode enabled!');
                  } else {
                    // Reset tap count after 2 seconds of no tapping
                    debugTapTimeoutRef.current = setTimeout(() => {
                      setDebugTapCount(0);
                    }, 2000);
                  }
                }}
              >
                {address ? (
                  <WalletAvatar address={address} className="w-6 h-6" />
                ) : (
                  <Wallet className="w-6 h-6 text-primary" />
                )}
              </div>
              <DialogTitle className="text-lg font-semibold">Wallet Profile</DialogTitle>
            </div>
            <DialogDescription>
              View your wallet details, balances, and connection information.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="pr-1">
            <div className="space-y-4 p-1.5">
              {/* MiniKit Context Info - only shown in debug mode */}
              {debugMode && isInFrame && (
                <div className="flex items-center space-x-2">
                  <Info className="w-5 h-5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Running in MiniKit Frame - wallet managed by Farcaster
                  </span>
                </div>
              )}

              {/* Wallet Connection Info */}

              {/* Airdrop Claim Card - shown when eligible */}
              <AirdropClaimCard />

              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">
                  Account
                </h3>
                <StandardContainer className="space-y-2 rounded-[var(--radius-panel)] border border-border/70 bg-background/45 p-3 shadow-[var(--shadow-hairline)]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Provider</span>
                    <span className="text-xs font-semibold">
                      {getWalletProviderName()}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Network</span>
                    <div className="flex items-center space-x-1">
                      {getNetworkStatusIcon(chainId)}
                      <span className="text-xs font-semibold">
                        {getNetworkName(chainId)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Basename</span>
                    <div className="flex items-center space-x-1">
                      {isNameLoading ? (
                        <Skeleton className="h-4 w-32" />
                      ) : name ? (
                        <span className="text-xs font-semibold">{name}</span>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => openExternalUrl("https://base.org/names")}
                          variant="primary"
                          size="compact"
                          className="px-3 text-xs"
                        >
                          Get a Basename!
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Wallet Address with copy icon */}
                  {address && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Address</span>
                      <div className="flex items-center space-x-1">
                        <span className="text-xs font-mono text-muted-foreground">
                          {formatAddress(address)}
                        </span>
                        <Button
                          onClick={() => copyToClipboard(address, "Wallet address")}
                          variant="ghost"
                          size="icon"
                          aria-label="Copy wallet address"
                        >
                          <Copy className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Mini App</span>
                    <div className="flex items-center space-x-1">
                      {isMiniApp ? (
                        <React.Fragment>
                          <CheckCircle className="w-3 h-3 text-value" />
                          <span className="text-xs font-semibold text-value">Yes</span>
                        </React.Fragment>
                      ) : (
                        <React.Fragment>
                          <XCircle className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">No</span>
                        </React.Fragment>
                      )}
                    </div>
                  </div>

                  {/* Smart Wallet Indicator */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Wallet Type</span>
                    <div className="flex items-center space-x-1">
                      {smartWalletLoading ? (
                        <Skeleton className="h-4 w-32" />
                      ) : isSolana ? (
                        <div className="flex items-center space-x-1">
                          <Wallet className="w-3 h-3 text-violet-700 dark:text-violet-200" />
                          <span className="text-xs font-semibold text-violet-700 dark:text-violet-200">
                            {getWalletTypeLabel()}
                          </span>
                        </div>
                      ) : isSmartWallet ? (
                        <div className="flex items-center space-x-1">
                          <CheckCircle className="w-3 h-3 text-value" />
                          <span className="text-xs font-semibold text-value">
                            {getWalletTypeLabel()}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          <Wallet className="w-3 h-3 text-[hsl(var(--info))]" />
                          <span className="text-xs font-semibold text-[hsl(var(--info))]">
                            {getWalletTypeLabel()}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Gas Fees Indicator */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">Gas Fees</span>
                    <div className="flex items-center space-x-1">
                      {smartWalletLoading ? (
                        <Skeleton className="h-4 w-16" />
                      ) : isSmartWallet || isSolana ? (
                        <div className="flex items-center space-x-1">
                          <CheckCircle className="w-3 h-3 text-value" />
                          <span className="text-xs font-semibold text-value">
                            Sponsored
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-1">
                          <XCircle className="w-3 h-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            No
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ETH Mode Toggle - only for smart wallet users */}
                  {(isSmartWallet || isSolana) && (
                    <EthModeToggleRow />
                  )}

                  {/* Farcaster Mini App Context (collapsible) - only shown in debug mode */}
                  {debugMode && isMiniApp && fcContext && (
                    <div className="pt-2 mt-2 border-t border-border">
                      <button
                        type="button"
                        onClick={() => setShowFcDetails((v) => !v)}
                        className="flex min-h-11 w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                        aria-expanded={showFcDetails}
                        aria-controls="fc-context-details"
                      >
                        <span className="text-xs font-medium">Farcaster Context</span>
                        <ChevronRight
                          className={`h-4 w-4 text-muted-foreground transition-transform ${showFcDetails ? 'rotate-90' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                      {showFcDetails && (
                        <div id="fc-context-details" className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Context Type</span>
                            <span className="text-xs font-semibold">{fcContext?.location?.type ?? '—'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Referrer</span>
                            <span className="text-xs font-semibold">{referrerDomain ?? '—'}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Client</span>
                            <span className="text-xs font-semibold">
                              {fcContext?.client?.name ? `${fcContext.client.name}${fcContext?.client?.version ? ` v${fcContext.client.version}` : ''}` : '—'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">Added</span>
                            <span className="text-xs font-semibold">{String(fcContext?.client?.added ?? '—')}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium">FID</span>
                            <span className="text-xs font-semibold">{fcContext?.user?.fid ?? '—'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Smart Wallet Recommendation for Regular Wallets */}
                  {!smartWalletLoading && !isSmartWallet && !isSolana && (
                    <div className="flex items-start space-x-2">
                      <Lightbulb className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <span className="text-xs text-muted-foreground">
                        For best experience, consider using a smart wallet
                      </span>
                    </div>
                  )}
                </StandardContainer>
              </div>

              {/* Solana Bridge Info (only shown for Solana wallets) */}
              {isSolana && isSolanaEnabled() && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Solana Bridge
                    </h3>
                    <SolanaBridgeBadge />
                  </div>
                  <StandardContainer className="space-y-2 rounded-[var(--radius-panel)] border border-border/70 bg-background/45 p-3 shadow-[var(--shadow-hairline)]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Solana Address</span>
                      <div className="flex items-center gap-1">
                        {solanaLoading ? (
                          <Skeleton className="h-4 w-24" />
                        ) : solanaAddress ? (
                          <>
                            <span className="text-xs font-mono">
                              {solanaAddress.slice(0, 6)}...{solanaAddress.slice(-4)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(solanaAddress, "Solana address")}
                              aria-label="Copy Solana address"
                              title="Copy Solana address"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Twin Address (Base)</span>
                      <div className="flex items-center gap-1">
                        {solanaLoading ? (
                          <Skeleton className="h-4 w-24" />
                        ) : twinAddress ? (
                          <>
                            <span className="text-xs font-mono">
                              {twinAddress.slice(0, 6)}...{twinAddress.slice(-4)}
                            </span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => copyToClipboard(twinAddress, "Twin address")}
                              aria-label="Copy twin address"
                              title="Copy twin address"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">Bridge Setup</span>
                      <div className="flex items-center space-x-1">
                        {solanaLoading ? (
                          <Skeleton className="h-4 w-16" />
                        ) : isTwinSetup ? (
                          <>
                            <CheckCircle className="w-3 h-3 text-value" />
                            <span className="text-xs font-semibold text-value">Ready</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3 text-[hsl(var(--warning))]" />
                            <span className="text-xs font-semibold text-[hsl(var(--warning))]">Setup Required</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="pt-2 mt-2 border-t border-border">
                      <div className="flex items-start space-x-2">
                        <Info className="w-3 h-3 text-violet-700 dark:text-violet-200 mt-0.5 flex-shrink-0" />
                        <span className="text-xs text-muted-foreground">
                          Your plants are owned by your Twin address on Base. Some features like Land NFTs are not available with Solana wallets.
                        </span>
                      </div>
                    </div>
                  </StandardContainer>
                </div>
              )}



              {/* Balances (consolidated) */}
              <BalanceCard variant="wallet-profile" />
            </div>
          </DialogBody>
          <DialogFooter sticky className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:space-x-0">
            {canExportEmbeddedWallet && (
              <Button
                variant="outline"
                size="default"
                onClick={handleOpenExportDialog}
                className="w-full sm:col-span-2"
              >
                <Key className="w-4 h-4 mr-2" />
                {exportWalletLabel}
              </Button>
            )}
            <Button
              variant="secondary"
              size="default"
              onClick={() => { setTransferOpen(true); onOpenChange(false); }}
              className="w-full"
            >
              Transfer Assets
            </Button>
            {!isFrameContextResolved ? (
              <Button
                variant="secondary"
                size="default"
                disabled
                className="w-full"
              >
                Loading session controls...
              </Button>
            ) : isMiniApp ? (
              <Button
                variant="secondary"
                size="default"
                onClick={handleCloseMiniApp}
                className="w-full"
              >
                <X className="w-4 h-4 mr-2" />
                Close Mini App
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="default"
                onClick={handleDisconnect}
                className="w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Wallet
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <TransferAssetsDialog open={transferOpen} onOpenChange={setTransferOpen} />
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-lg" hideCloseButton={isExporting}>
          <DialogHeader>
            <div className="flex items-center space-x-2">
              <Key className="w-5 h-5 text-primary" />
              <DialogTitle>Export Embedded Wallet</DialogTitle>
            </div>
            <DialogDescription>
              Exporting will open a secure Privy window where you can copy the private key for your embedded wallet. Keep it safe and never share it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert>
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldAlert className="w-4 h-4" />
                Security Notice
              </div>
              <p className="mt-1 text-sm leading-relaxed">
                Only export your key in a trusted environment. Anyone with this key can fully control your wallet. Pixotchi never sees or stores your private key.
              </p>
            </Alert>

            {embeddedWallets.length > 1 && (
              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Select embedded wallet</span>
                <div className="space-y-2">
                  {embeddedWallets.map((wallet) => (
                    <label
                      key={wallet.address}
                      className="flex min-h-11 items-center space-x-3 rounded-[var(--radius-control)] border border-border bg-muted/40 px-3 py-2 text-sm hover:border-primary/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
                    >
                      <input
                        type="radio"
                        name="embedded-wallet-address"
                        value={wallet.address}
                        checked={selectedEmbeddedAddress === wallet.address}
                        onChange={handleEmbeddedWalletAddressChange}
                        className="h-5 w-5 border-border text-primary focus:ring-primary"
                        disabled={isExporting}
                      />
                      <span className="font-mono text-xs break-all">
                        {wallet.address}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => setExportDialogOpen(false)}
              disabled={isExporting}
            >
              Cancel
            </Button>
              <Button
              onClick={handleConfirmExport}
              disabled={isExporting || (embeddedWallets.length > 1 && !selectedEmbeddedAddress)}
              className="min-w-[140px]"
            >
              {isExporting ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Opening…
                </>
              ) : (
                "Open Export"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
} 
