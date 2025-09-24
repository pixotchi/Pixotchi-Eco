"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
import { Avatar, useName } from "@coinbase/onchainkit/identity";
import { openExternalUrl } from "@/lib/open-external";
import { base } from "viem/chains";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { StandardContainer } from "./ui/pixel-container";
import { usePrivy } from "@privy-io/react-auth";
import { clearAppCaches } from "@/lib/cache-utils";
import { Skeleton } from "./ui/skeleton";
import { useBalances } from "@/lib/balance-context";
import TransferAssetsDialog from "./transactions/transfer-assets-dialog";

interface WalletProfileProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WalletProfile({ open, onOpenChange }: WalletProfileProps) {
  const { address, isConnected, connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { logout } = usePrivy();
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



  const { data: name, isLoading: isNameLoading } = useName({
    address: address ?? "0x0000000000000000000000000000000000000000",
    chain: base,
  });

  const { loading, refreshBalances } = useBalances();
  const [showFullAddress, setShowFullAddress] = useState(false);
  const [referrerDomain, setReferrerDomain] = useState<string | null>(null);
  const [showFcDetails, setShowFcDetails] = useState<boolean>(false);
  const [transferOpen, setTransferOpen] = useState(false);

  // Use shared Farcaster provider state
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const fcContext = (fc?.context as any) ?? null;

  // MiniKit context can exist on web too; Farcaster flag decides frame UI
  const isInFrame = isMiniApp;

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

  // Wallet provider info with MiniKit awareness
  const getWalletProviderName = () => {
    if (!connector) return "Unknown";

    // In frame context, it's likely Coinbase Wallet via Farcaster
    if (isInFrame) {
      return "Coinbase Wallet (Frame)";
    }

    switch (connector.name.toLowerCase()) {
      case "privy":
        return "Privy";
      case "coinbase wallet":
        return "Coinbase Wallet";
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
      
      // Disconnect wagmi connection
      disconnect();
      
      // Then attempt to logout from Privy if available
      if (logout) {
        try {
          await logout();
        } catch (logoutError) {
          console.warn('Privy logout failed:', logoutError);
          // Don't show error to user as disconnect still worked
        }
      }
      
      // Clear auth surface preference to reset state
      try {
        sessionStorage.removeItem('pixotchi:authSurface');
        sessionStorage.removeItem('pixotchi:autologin');
      } catch (storageError) {
        console.warn('Failed to clear auth preferences:', storageError);
      }
      
      // Show success message
      toast.success("Wallet disconnected");
      
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

  if (!address || !isConnected) return null;

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm md:max-w-md">
        <DialogHeader>
          <div className="flex items-center space-x-2">
            <Wallet className="w-6 h-6 text-primary" />
            <DialogTitle>Wallet Profile</DialogTitle>
          </div>
          <DialogDescription>
            View your wallet details, balances, and connection information.
          </DialogDescription>
        </DialogHeader>

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
  <StandardContainer className="p-3 space-y-2 rounded-md border bg-card">
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
        <Skeleton className="h-4 w-20" />
      ) : name ? (
        <span className="text-xs font-semibold">{name}</span>
      ) : (
        <button
          type="button"
          onClick={() => openExternalUrl("https://base.org/names")}
          className="inline-flex items-center justify-center px-2 py-0.5 text-xs leading-none whitespace-nowrap rounded-md btn-compact"
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
                    <>
                      <CheckCircle className="w-3 h-3 text-green-500" />
                      <span className="text-xs font-semibold text-green-600 dark:text-green-400">Yes</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">No</span>
                    </>
                  )}
                </div>
              </div>
              
 {/* Smart Wallet Indicator */}
 <div className="flex items-center justify-between">
 <span className="text-xs font-medium">Wallet Type</span>
 <div className="flex items-center space-x-1">
                  {smartWalletLoading ? (
                    <Skeleton className="h-4 w-24" />
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
              {!smartWalletLoading && !isSmartWallet && (
                <div className="flex items-start space-x-2">
                  <Lightbulb className="w-3 h-3 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <span className="text-xs text-muted-foreground">
                    For best experience, consider using a smart wallet
                  </span>
                </div>
              )}
  </StandardContainer>
 </div>

          {/* Wallet Address */}
	<div className="space-y-2">
	<h3 className="text-sm font-medium text-muted-foreground">
	            Identity
	</h3>
  <StandardContainer className="p-3 rounded-md border bg-card">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 <Avatar address={address} chain={base} />
 <span className="text-sm font-mono break-all">
                    {isNameLoading
                      ? <Skeleton className="h-5 w-32" />
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

          {/* Balances (consolidated) */}
          <BalanceCard variant="wallet-profile" />

          {/* Actions */}
          <div className="pt-4 border-t border-border">
            <div className="grid gap-2 mb-3">
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
 </DialogContent>
    </Dialog>
    <TransferAssetsDialog open={transferOpen} onOpenChange={setTransferOpen} />
    </>
  );
} 