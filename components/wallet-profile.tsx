"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useAccount, useBalance, useDisconnect, useChainId } from "wagmi";
import { useMiniKit } from "@coinbase/onchainkit/minikit";
import { sdk } from "@farcaster/miniapp-sdk";
import { useFrameContext } from "@/lib/frame-context";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatAddress } from "@/lib/utils";
import BalanceCard from "./balance-card";
import toast from "react-hot-toast";
import {
  Copy,
  LogOut,
  RefreshCw,
  Wallet,
  CheckCircle,
  XCircle,
  Info,
  ChevronRight,
  Eye,
  EyeOff,
  X,
  Lightbulb,
  Key,
  ShieldAlert,
} from "lucide-react";
import { Avatar } from "@coinbase/onchainkit/identity";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { openExternalUrl } from "@/lib/open-external";
import { base } from "viem/chains";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { StandardContainer } from "./ui/pixel-container";
import { usePrivy, useLogin, useLogout } from "@privy-io/react-auth";
import type { WalletWithMetadata } from "@privy-io/react-auth";
import { clearAppCaches } from "@/lib/cache-utils";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import TransferAssetsDialog from "./transactions/transfer-assets-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useIsSolanaWallet, useSolanaWallet, SolanaBridgeBadge } from "@/components/solana";
import { useWallets as useSolanaPrivyWallets } from "@privy-io/react-auth/solana";
import { isSolanaEnabled } from "@/lib/solana-constants";

interface WalletProfileProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletProfile({ open, onOpenChange }: WalletProfileProps) {
  const { address, isConnected, connector } = useAccount();
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
  const { context } = useMiniKit(); // Get MiniKit context (Coinbase)
  const fc = useFrameContext();     // Farcaster context provider
  const { 
    isSmartWallet, 
    walletType, 
    isLoading: smartWalletLoading, 
    detectionMethods,
    isContract,
    refetch: refetchSmartWallet 
  } = useSmartWallet();



  const { name, loading: isNameLoading } = usePrimaryName(address ?? undefined);
  
  // Solana wallet state
  const isSolana = useIsSolanaWallet();
  const { solanaAddress, twinAddress, isTwinSetup, isLoading: solanaLoading } = useSolanaWallet();
  const { wallets: solanaPrivyWallets } = useSolanaPrivyWallets();

  const { loading, refreshBalances } = useBalances();
  const [showFullAddress, setShowFullAddress] = useState(false);
  const [referrerDomain, setReferrerDomain] = useState<string | null>(null);
  const [showFcDetails, setShowFcDetails] = useState<boolean>(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedEmbeddedAddress, setSelectedEmbeddedAddress] = useState<string | null>(null);

  // Farcaster / Mini App state (evaluate before export gating)
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const fcContext = (fc?.context as any) ?? null;
  const isInFrame = isMiniApp; // alias for clarity

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
    } catch (error: any) {
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
      const ref = (loc as any).referrerDomain || (loc as any).referrer || null;
      setReferrerDomain(ref ?? null);
    } else {
      setReferrerDomain(null);
    }
  }, [fcContext, open]);

  // Use wagmi's balance hook for ETH
  const {
    data: ethBalance,
    isLoading: ethLoading,
    refetch: refetchEthBalance,
  } = useBalance({
    address: address,
  });

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
    const color = isBase
      ? "text-green-500"
      : isTestnet
      ? "text-yellow-500"
      : "text-red-500";
    return <CheckCircle className={`w-4 h-4 ${color}`} />;
  };

  // Wallet provider info with MiniKit awareness and Solana support
  const getWalletProviderName = () => {
    if (isSolana) {
      const solWallet = solanaPrivyWallets?.[0];
      const solName =
        (solWallet as any)?.name ||
        (solWallet as any)?.standardWallet?.name ||
        (solWallet as any)?.walletClientType;
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

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied!`);
  };

  const handleDisconnect = async () => {
    try {
      // First, close the dialog to provide immediate feedback
      onOpenChange(false);
      
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
      
      // Clear auth surface preference to reset state
      try {
        sessionStorage.removeItem('pixotchi:authSurface');
        sessionStorage.removeItem('pixotchi:autologin');
      } catch (storageError) {
        console.warn('Failed to clear auth preferences:', storageError);
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
      await sdk.actions.close();
    } catch {
      toast.error("Close action not supported in this context");
    }
    // Clear caches on exit as well, to avoid stale connector state lingering between sessions
    // Preserve tutorial progress key so onboarding doesn't reshow
    clearAppCaches({ preserveLocalStorageKeys: ["pixotchi:tutorial"] });
  };

  const handleRefreshBalances = () => {
    refetchEthBalance();
    refetchSmartWallet();
    refreshBalances().then(() => {
      toast.success("Balances refreshed");
    });
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
      <DialogContent className="max-w-2xl w-[min(92vw,32rem)]">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <Wallet className="w-6 h-6 text-primary" />
            <DialogTitle className="text-lg font-semibold">Wallet Profile</DialogTitle>
          </div>
          <DialogDescription>
            View your wallet details, balances, and connection information.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
        <div className="p-4 space-y-6">
                    {/* MiniKit Context Info */}
          {isInFrame && (
            <div className="flex items-center space-x-2">
              <Info className="w-5 h-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Running in MiniKit Frame - wallet managed by Farcaster
              </span>
            </div>
          )}

          {/* Wallet Connection Info */}
 <div className="space-y-3">
 <h3 className="text-sm font-medium text-muted-foreground">
              Connection
 </h3>
  <StandardContainer className="p-4 space-y-2 rounded-md border bg-card">
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
        <button
          type="button"
          onClick={() => openExternalUrl("https://base.org/names")}
          className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 btn-compact"
          style={{ backgroundColor: '#0000FF', color: '#FFFFFF' }}
        >
          Get a Basename!
        </button>
      )}
    </div>
  </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Mini App</span>
                <div className="flex items-center space-x-1">
                  {isMiniApp ? (
                    <React.Fragment>
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400">Yes</span>
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
                      <Wallet className="w-3 h-3 text-purple-500" />
                      <span className="text-xs font-semibold text-purple-600 dark:text-purple-300">
                        Solana Twin (Smart Wallet)
                      </span>
                    </div>
                  ) : isSmartWallet ? (
                    <div className="flex items-center space-x-1">
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                        Smart Wallet
                        {walletType === 'coinbase-smart' && ' (Coinbase)'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1">
                      <Wallet className="w-3 h-3 text-blue-500" />
                      <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        Regular Wallet
                      </span>
                    </div>
                  )}
                </div>
 </div>

              {/* Farcaster Mini App Context (collapsible) */}
              {isMiniApp && fcContext && (
                <div className="pt-2 mt-2 border-t border-border">
                  <button
                    type="button"
                    onClick={() => setShowFcDetails((v) => !v)}
                    className="w-full flex items-center justify-between text-left py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-md"
                    aria-expanded={showFcDetails}
                    aria-controls="fc-context-details"
                  >
                    <span className="text-xs font-medium">Farcaster Context</span>
                    <ChevronRight
                      className={`h-3 w-3 text-muted-foreground transition-transform ${showFcDetails ? 'rotate-90' : ''}`}
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
              <StandardContainer className="p-4 space-y-2 rounded-md border bg-card">
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
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(solanaAddress, "Solana address")}
                        >
                          <Copy className="w-3 h-3" />
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
                          className="h-6 w-6"
                          onClick={() => copyToClipboard(twinAddress, "Twin address")}
                        >
                          <Copy className="w-3 h-3" />
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
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        <span className="text-xs font-semibold text-green-600 dark:text-green-400">Ready</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-3 h-3 text-yellow-500" />
                        <span className="text-xs font-semibold text-yellow-600 dark:text-yellow-400">Setup Required</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="pt-2 mt-2 border-t border-border">
                  <div className="flex items-start space-x-2">
                    <Info className="w-3 h-3 text-purple-400 mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-muted-foreground">
                      Your plants are owned by your Twin address on Base. Some features like Land NFTs are not available with Solana wallets.
                    </span>
                  </div>
                </div>
              </StandardContainer>
            </div>
          )}

          {/* Wallet Address - Only shown for EVM wallets */}
          {address && (
	<div className="space-y-2">
	<h3 className="text-sm font-medium text-muted-foreground">
	            Identity
	</h3>
  <StandardContainer className="p-4 rounded-md border bg-card">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Avatar address={address} chain={base} />
 <span className="text-sm font-mono break-all">
                    {isNameLoading
                      ? <Skeleton className="h-5 w-40" />
                      : showFullAddress
                      ? address
                      : name || formatAddress(address)}
 </span>
 </div>

      <div className="flex items-center space-x-1">
 <Button
 variant="ghost"
 size="icon"
 onClick={() => copyToClipboard(address, "Wallet address")}
 className="h-8 w-8"
 >
 <Copy className="w-4 h-4" />
 </Button>
 <Button
 variant="ghost"
 size="icon"
 onClick={() => setShowFullAddress(!showFullAddress)}
 className="h-8 w-8"
 >
                    {showFullAddress ? (
 <EyeOff className="w-4 h-4" />
                    ) : (
 <Eye className="w-4 h-4" />
                    )}
 </Button>
 </div>
 </div>
  </StandardContainer>
 </div>
          )}

          {/* Balances (consolidated) */}
          <BalanceCard variant="wallet-profile" />

          {/* Actions */}
          <div className="pt-4 border-t border-border">
            <div className="grid gap-2 mb-3">
              {canExportEmbeddedWallet && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenExportDialog}
                  className="w-full"
                >
                  <Key className="w-4 h-4 mr-2" />
                  {exportWalletLabel}
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setTransferOpen(true); onOpenChange(false); }}
                className="w-full"
              >
                Transfer Assets
              </Button>
            </div>
            {isMiniApp ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleCloseMiniApp}
                className="w-full"
              >
                <X className="w-4 h-4 mr-2" />
                Close Mini App
              </Button>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnect}
                className="w-full"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Wallet
              </Button>
            )}
          </div>
        </div>
      </div>
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
                    className="flex items-center space-x-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm hover:border-primary/50 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
                  >
                    <input
                      type="radio"
                      name="embedded-wallet-address"
                      value={wallet.address}
                      checked={selectedEmbeddedAddress === wallet.address}
                      onChange={handleEmbeddedWalletAddressChange}
                      className="h-4 w-4 border-border text-primary focus:ring-primary"
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
                Opening...
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