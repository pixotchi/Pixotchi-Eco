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
import { Identity, Avatar, Name, Address, Badge } from "@coinbase/onchainkit/identity";

// ... (keeping existing imports like Dialog, Button, etc.)

export function WalletProfile({ open, onOpenChange }: WalletProfileProps) {
  const { address, isConnected, connector } = useAccount();
  
  // ... (keeping existing hooks like useDisconnect, usePrivy etc.)

  // Use OnchainKit's Identity for consistent UI
  // Memoize filter logic to fix issue #11 (Heavy Client-Side Filtering)
  const embeddedWallets = useMemo(() => {
    if (!privyUser?.linkedAccounts) return [] as Array<{ address: string }>;
    
    return privyUser.linkedAccounts.filter((account): account is WalletWithMetadata => {
      return (
        account.type === "wallet" &&
        account.walletClientType === "privy" &&
        account.chainType === "ethereum" &&
        typeof account.address === "string"
      );
    }).map((wallet) => ({ address: wallet.address }));
  }, [privyUser?.linkedAccounts]);

  // ...

  return (
    <React.Fragment>
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ... Dialog Header ... */}
      
          {/* Wallet Address Section Modernized */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Identity
            </h3>
            <StandardContainer className="p-4 rounded-md border bg-card">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {/* OnchainKit Identity Component */}
                  <Identity 
                    address={address} 
                    className="flex items-center space-x-2"
                    schemaId="0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9" // Optional: Base Verifications
                  >
                    <Avatar />
                    <Name className="text-sm font-semibold text-foreground" />
                    <Badge />
                    <Address className="text-sm text-muted-foreground" />
                  </Identity>
                </div>
                
                {/* Keep existing Copy/View buttons if not fully replaced by OnchainKit's internal behavior */}
                <div className="flex items-center space-x-1">
                   {/* ... buttons ... */}
                </div>
              </div>
            </StandardContainer>
          </div>

          {/* ... Rest of the component ... */}
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