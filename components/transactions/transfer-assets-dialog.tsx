"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount, useWalletClient } from "wagmi";
import { getPlantsByOwner, getLandsByOwner, transferAllAssets, BATCH_ROUTER_ADDRESS, PIXOTCHI_NFT_ADDRESS, LAND_CONTRACT_ADDRESS, routerBatchTransfer } from "@/lib/contracts";
import { isAddress, getAddress } from "viem";
import { toast } from "react-hot-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicClient } from "wagmi";
import { useDebounce } from "@/hooks/useDebounce";

interface TransferAssetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TransferAssetsDialog({ open, onOpenChange }: TransferAssetsDialogProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{ plants: number; lands: number }>({ plants: 0, lands: 0 });
  const [fetchingCounts, setFetchingCounts] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [ack, setAck] = useState(false);
  const [approvals, setApprovals] = useState<{ plants: boolean; lands: boolean }>({ plants: false, lands: false });
  const routerAvailable = Boolean(BATCH_ROUTER_ADDRESS);

  // ENS resolution state
  const debouncedDest = useDebounce(destination, 400);
  const [resolvingEns, setResolvingEns] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>("");
  const [ensError, setEnsError] = useState<string>("");

  useEffect(() => {
    let active = true;
    const loadCounts = async () => {
      if (!open || !address) return;
      setFetchingCounts(true);
      try {
        const [plants, lands] = await Promise.all([
          getPlantsByOwner(address),
          getLandsByOwner(address),
        ]);
        if (!active) return;
        setCounts({ plants: plants.length, lands: lands.length });
        // Check router approvals when available
        if (routerAvailable && publicClient) {
          try {
            const [ap1, ap2] = await Promise.all([
              publicClient.readContract({
                address: PIXOTCHI_NFT_ADDRESS,
                abi: [{ inputs: [{name:'owner',type:'address'},{name:'operator',type:'address'}], name:'isApprovedForAll', outputs:[{name:'',type:'bool'}], stateMutability:'view', type:'function' }],
                functionName: 'isApprovedForAll',
                args: [address as `0x${string}`, BATCH_ROUTER_ADDRESS],
              }) as Promise<boolean>,
              publicClient.readContract({
                address: LAND_CONTRACT_ADDRESS,
                abi: [{ inputs: [{name:'owner',type:'address'},{name:'operator',type:'address'}], name:'isApprovedForAll', outputs:[{name:'',type:'bool'}], stateMutability:'view', type:'function' }],
                functionName: 'isApprovedForAll',
                args: [address as `0x${string}`, BATCH_ROUTER_ADDRESS],
              }) as Promise<boolean>,
            ]);
            if (active) setApprovals({ plants: ap1, lands: ap2 });
          } catch {}
        }
      } catch (e) {
        if (!active) return;
        setCounts({ plants: 0, lands: 0 });
      } finally {
        if (active) setFetchingCounts(false);
      }
    };
    loadCounts();
    return () => { active = false; };
  }, [open, address]);

  const isValidAddress = useMemo(() => {
    try {
      return destination && isAddress(destination as `0x${string}`);
    } catch { return false; }
  }, [destination]);

  const targetAddress = useMemo(() => {
    if (isValidAddress) return getAddress(destination as `0x${string}`);
    if (resolvedAddress && isAddress(resolvedAddress as `0x${string}`)) return getAddress(resolvedAddress as `0x${string}`);
    return "";
  }, [isValidAddress, destination, resolvedAddress]);

  const isValidRecipient = useMemo(() => {
    return Boolean(isValidAddress || (resolvedAddress && isAddress(resolvedAddress as `0x${string}`)));
  }, [isValidAddress, resolvedAddress]);

  const hasAnythingToTransfer = counts.plants + counts.lands > 0;

  // If router is configured, require approvals for any collection that has items
  const needsApprovals = useMemo(() => {
    if (!routerAvailable) return false;
    const needPlants = counts.plants > 0 && !approvals.plants;
    const needLands = counts.lands > 0 && !approvals.lands;
    return needPlants || needLands;
  }, [routerAvailable, counts, approvals]);

  // Resolve ENS names (simple public API fallback)
  useEffect(() => {
    setEnsError("");
    setResolvedAddress("");
    if (!debouncedDest || isValidAddress) return;
    // Heuristic: attempt ENS if it contains a dot
    if (!debouncedDest.includes('.')) return;
    let cancelled = false;
    const run = async () => {
      try {
        setResolvingEns(true);
        // Public resolver API (no key). Returns { address, name, display }
        const resp = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(debouncedDest)}`);
        if (!resp.ok) throw new Error('ENS lookup failed');
        const data = await resp.json();
        if (cancelled) return;
        const addr = data?.address as string | undefined;
        if (addr && isAddress(addr as `0x${string}`)) {
          setResolvedAddress(getAddress(addr as `0x${string}`));
        } else {
          setEnsError('Name not found');
        }
      } catch (e: any) {
        if (!cancelled) setEnsError('Unable to resolve ENS');
      } finally {
        if (!cancelled) setResolvingEns(false);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [debouncedDest, isValidAddress]);

  const onTransfer = () => {
    if (!walletClient || !address) return;
    if (!isValidAddress) {
      if (!resolvedAddress) {
        toast.error("Enter a valid address or ENS name");
        return;
      }
    }
    if (!targetAddress) {
      toast.error("Destination unresolved");
      return;
    }
    if (!hasAnythingToTransfer) {
      toast.error("No assets to transfer");
      return;
    }
    if (needsApprovals) {
      toast("Approve collections first", { icon: '⚠️' });
      return;
    }
    setConfirmStep(true);
  };

  const onConfirm = async () => {
    if (!walletClient || !address) return;
    setLoading(true);
    try {
      // If router configured and approvals granted, use single-tx batch path
      if (routerAvailable && approvals.plants && approvals.lands) {
        // Fetch current ids (fresh) to avoid stale view
        const [plants, lands] = await Promise.all([
          getPlantsByOwner(address),
          getLandsByOwner(address),
        ]);
        const plantIds = plants.map(p => p.id);
        const landIds = lands.map(l => l.tokenId);
        if (plantIds.length === 0 && landIds.length === 0) {
          toast.error('No assets to transfer');
        } else {
          const r = await routerBatchTransfer(walletClient, targetAddress, plantIds, landIds);
          if (r.success) {
            toast.success('Assets transferred in a single transaction');
          } else {
            toast.error('Batch transfer failed');
          }
        }
      } else {
        // Fallback to per-token loop
        const res = await transferAllAssets(walletClient, address, targetAddress);
        const summary = `Plants: ${res.plants.success}/${res.plants.total}, Lands: ${res.lands.success}/${res.lands.total}`;
        if ((res.plants.failed + res.lands.failed) === 0) {
          toast.success(`All assets transferred. ${summary}`);
        } else if ((res.plants.success + res.lands.success) === 0) {
          toast.error(`Transfers failed. ${summary}`);
        } else {
          toast("Some transfers succeeded", { icon: "⚠️" });
          toast.success(summary);
        }
      }
      onOpenChange(false);
      setConfirmStep(false);
      setAck(false);
    } catch (e: any) {
      const msg = (e?.shortMessage || e?.message || "").toString().toLowerCase();
      if (e?.code === 4001 || e?.cause?.code === 4001 || e?.name === 'UserRejectedRequestError' || msg.includes('user rejected')) {
        toast('Transfer cancelled', { icon: '✖️' });
        // Exit confirm step to prevent any accidental re-trigger
        setConfirmStep(false);
        setAck(false);
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
      } else {
        toast.error('Transfer failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setConfirmStep(false); setAck(false); } onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirmStep ? 'Confirm Transfer' : 'Transfer Assets'}</DialogTitle>
          <DialogDescription>
            {confirmStep ? 'You are about to transfer your assets to:' : 'Send your Pixotchi plants and land NFTs to another wallet.'}
          </DialogDescription>
        </DialogHeader>

        {!confirmStep ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="dest">Destination Address</label>
            <Input
              id="dest"
              placeholder="0x... or ENS name"
              value={destination}
              onChange={(e) => setDestination(e.target.value.trim())}
              autoComplete="off"
            />
            {!isValidRecipient && !resolvingEns && destination.length > 0 && (
              <p className="text-xs text-red-500">Invalid address or ENS name</p>
            )}
          </div>

          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plants</span>
              {fetchingCounts ? <Skeleton className="h-4 w-10"/> : <span className="font-medium">{counts.plants}</span>}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lands</span>
              {fetchingCounts ? <Skeleton className="h-4 w-10"/> : <span className="font-medium">{counts.lands}</span>}
            </div>
          </div>

          {/* ENS resolution result */}
          {(resolvingEns || resolvedAddress || ensError) && (
            <div className="text-xs">
              {resolvingEns && <span className="text-muted-foreground">Resolving ENS…</span>}
              {!resolvingEns && resolvedAddress && (
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Resolved to</span>
                  <span className="font-mono break-all">{resolvedAddress}</span>
                </div>
              )}
              {!resolvingEns && ensError && (
                <span className="text-red-500">{ensError}</span>
              )}
            </div>
          )}

          {routerAvailable && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Using batch router to transfer multiple NFTs in one tx.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={approvals.plants ? "outline" : "secondary"}
                  onClick={async () => {
                    if (!walletClient || !address) return;
                    try {
                      setLoading(true);
                      const hash = await walletClient.writeContract({
                        address: PIXOTCHI_NFT_ADDRESS,
                        abi: [{ inputs:[{name:'operator',type:'address'},{name:'approved',type:'bool'}], name:'setApprovalForAll', outputs:[], stateMutability:'nonpayable', type:'function' }],
                        functionName: 'setApprovalForAll',
                        args: [BATCH_ROUTER_ADDRESS, true],
                        account: walletClient.account!,
                        chain: undefined,
                      });
                      await publicClient!.waitForTransactionReceipt({ hash });
                      setApprovals(s => ({ ...s, plants: true }));
                      toast.success('Plants approved');
                    } catch (e: any) {
                      const msg = (e?.shortMessage || e?.message || "").toString().toLowerCase();
                      if (e?.code === 4001 || e?.cause?.code === 4001 || e?.name === 'UserRejectedRequestError' || msg.includes('user rejected')) {
                        toast('Approval cancelled', { icon: '✖️' });
                      } else {
                        toast.error('Approval failed');
                      }
                    } finally { setLoading(false); }
                  }}
                  disabled={approvals.plants || loading}
                >
                  {approvals.plants ? 'Plants Approved' : 'Approve Plants'}
                </Button>
                <Button
                  variant={approvals.lands ? "outline" : "secondary"}
                  onClick={async () => {
                    if (!walletClient || !address) return;
                    try {
                      setLoading(true);
                      const hash = await walletClient.writeContract({
                        address: LAND_CONTRACT_ADDRESS,
                        abi: [{ inputs:[{name:'operator',type:'address'},{name:'approved',type:'bool'}], name:'setApprovalForAll', outputs:[], stateMutability:'nonpayable', type:'function' }],
                        functionName: 'setApprovalForAll',
                        args: [BATCH_ROUTER_ADDRESS, true],
                        account: walletClient.account!,
                        chain: undefined,
                      });
                      await publicClient!.waitForTransactionReceipt({ hash });
                      setApprovals(s => ({ ...s, lands: true }));
                      toast.success('Lands approved');
                    } catch (e: any) {
                      const msg = (e?.shortMessage || e?.message || "").toString().toLowerCase();
                      if (e?.code === 4001 || e?.cause?.code === 4001 || e?.name === 'UserRejectedRequestError' || msg.includes('user rejected')) {
                        toast('Approval cancelled', { icon: '✖️' });
                      } else {
                        toast.error('Approval failed');
                      }
                    } finally { setLoading(false); }
                  }}
                  disabled={approvals.lands || loading}
                >
                  {approvals.lands ? 'Lands Approved' : 'Approve Lands'}
                </Button>
              </div>
            </div>
          )}

          <Button
            className="w-full"
            onClick={onTransfer}
            disabled={loading || !isValidRecipient || !hasAnythingToTransfer || needsApprovals}
          >
            Continue
          </Button>

          {!hasAnythingToTransfer && (
            <p className="text-xs text-muted-foreground text-center">No assets found to transfer.</p>
          )}
        </div>
        ) : (
        <div className="space-y-4">
          <div className="text-sm break-all bg-muted p-2 rounded-md">
            {resolvedAddress ? (
              <>
                <div className="font-mono">{resolvedAddress}</div>
                <div className="text-xs text-muted-foreground">({destination})</div>
              </>
            ) : (
              <div className="font-mono">{destination}</div>
            )}
          </div>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Plants</span>
              <span className="font-medium">{counts.plants}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lands</span>
              <span className="font-medium">{counts.lands}</span>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-current"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              disabled={loading}
            />
            <span>I understand this action is irreversible.</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => { if (!loading) { setConfirmStep(false); setAck(false); } }} disabled={loading}>Back</Button>
            <Button onClick={onConfirm} disabled={!ack || loading}>{loading ? 'Transferring…' : 'Confirm & Send'}</Button>
          </div>
        </div>
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}


