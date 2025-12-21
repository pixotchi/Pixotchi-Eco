"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount, useWalletClient } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import { getPlantsByOwner, getLandsByOwner, transferPlants, transferLands, BATCH_ROUTER_ADDRESS, PIXOTCHI_NFT_ADDRESS, LAND_CONTRACT_ADDRESS, routerBatchTransfer } from "@/lib/contracts";
import { isAddress, getAddress, encodeFunctionData } from "viem";
import { toast } from "react-hot-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { usePublicClient } from "wagmi";
import { useDebounce } from "@/hooks/useDebounce";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Land, Plant } from "@/lib/types";
import { appendBuilderSuffix, isPrivyEmbeddedWallet } from "@/lib/builder-code";

interface TransferAssetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TransferAssetsDialog({ open, onOpenChange }: TransferAssetsDialogProps) {
  const { address } = useAccount();
  const { data: walletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const { user: privyUser } = usePrivy();

  // Check if current wallet is a Privy embedded wallet
  const isEmbeddedWallet = isPrivyEmbeddedWallet(address, privyUser);
  const [destination, setDestination] = useState("");
  const [loading, setLoading] = useState(false);
  const [counts, setCounts] = useState<{ plants: number; lands: number }>({ plants: 0, lands: 0 });
  const [fetchingCounts, setFetchingCounts] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);
  const [ack, setAck] = useState(false);
  const [approvals, setApprovals] = useState<{ plants: boolean; lands: boolean }>({ plants: false, lands: false });
  const routerAvailable = Boolean(BATCH_ROUTER_ADDRESS);
  const [plantsList, setPlantsList] = useState<Plant[]>([]);
  const [landsList, setLandsList] = useState<Land[]>([]);
  const [selectedPlantIds, setSelectedPlantIds] = useState<number[]>([]);
  const [selectedLandIds, setSelectedLandIds] = useState<string[]>([]);

  // Request deduplication ref to prevent multiple simultaneous calls
  const loadCountsPendingRef = useRef<string | null>(null);

  // ENS resolution state
  const debouncedDest = useDebounce(destination, 400);
  const [resolvingEns, setResolvingEns] = useState(false);
  const [resolvedAddress, setResolvedAddress] = useState<string>("");
  const [ensError, setEnsError] = useState<string>("");

  useEffect(() => {
    let active = true;
    const loadCounts = async () => {
      if (!open || !address) {
        if (active) {
          setCounts({ plants: 0, lands: 0 });
          setPlantsList([]);
          setLandsList([]);
          setSelectedPlantIds([]);
          setSelectedLandIds([]);
        }
        loadCountsPendingRef.current = null;
        return;
      }

      // Prevent duplicate calls for the same address
      if (loadCountsPendingRef.current === address) {
        return;
      }

      loadCountsPendingRef.current = address;
      setFetchingCounts(true);

      try {
        const [plants, lands] = await Promise.all([
          getPlantsByOwner(address),
          getLandsByOwner(address),
        ]);
        if (!active) return;
        // Only update if address hasn't changed during the fetch
        if (loadCountsPendingRef.current === address) {
          setCounts({ plants: plants.length, lands: lands.length });
          setPlantsList(plants);
          setLandsList(lands);
          setSelectedPlantIds(plants.map((p) => p.id));
          setSelectedLandIds(lands.map((l) => l.tokenId.toString()));
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
              if (active && loadCountsPendingRef.current === address) {
                setApprovals({ plants: ap1, lands: ap2 });
              }
            } catch {}
          }
        }
      } catch (e) {
        if (!active) return;
        // Only set error if address hasn't changed
        if (loadCountsPendingRef.current === address) {
          setCounts({ plants: 0, lands: 0 });
          setPlantsList([]);
          setLandsList([]);
          setSelectedPlantIds([]);
          setSelectedLandIds([]);
        }
      } finally {
        if (active) {
          // Clear pending flag only if address hasn't changed
          if (loadCountsPendingRef.current === address) {
            setFetchingCounts(false);
            loadCountsPendingRef.current = null;
          }
        }
      }
    };
    loadCounts();
    return () => { 
      active = false;
      // Clear pending flag on cleanup
      if (loadCountsPendingRef.current === address) {
        loadCountsPendingRef.current = null;
      }
    };
  }, [open, address, routerAvailable, publicClient]);

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
  const selectedPlantsCount = selectedPlantIds.length;
  const selectedLandsCount = selectedLandIds.length;
  const hasSelectedAnything = selectedPlantsCount + selectedLandsCount > 0;

  // If router is configured, require approvals for any collection that has items
  const needsApprovals = useMemo(() => {
    if (!routerAvailable) return false;
    const needPlants = selectedPlantIds.length > 0 && !approvals.plants;
    const needLands = selectedLandIds.length > 0 && !approvals.lands;
    return needPlants || needLands;
  }, [routerAvailable, selectedPlantIds, selectedLandIds, approvals]);

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
        if (cancelled) return;
        setResolvingEns(true);
        // Public resolver API (no key). Returns { address, name, display }
        const resp = await fetch(`https://api.ensideas.com/ens/resolve/${encodeURIComponent(debouncedDest)}`);
        if (cancelled) return;
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
    if (!hasSelectedAnything) {
      toast.error("Select at least one asset to transfer");
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
      const wantsPlants = selectedPlantIds.length > 0;
      const wantsLands = selectedLandIds.length > 0;
      const canUseRouter = routerAvailable &&
        (wantsPlants ? approvals.plants : true) &&
        (wantsLands ? approvals.lands : true);

      // If router configured and approvals granted, use single-tx batch path
      if (canUseRouter) {
        // Fetch current ids (fresh) to avoid stale view
        const [plants, lands] = await Promise.all([
          getPlantsByOwner(address),
          getLandsByOwner(address),
        ]);
        const selectedPlantSet = new Set(selectedPlantIds);
        const selectedLandSet = new Set(selectedLandIds);
        const plantIds = plants.filter(p => selectedPlantSet.has(p.id)).map(p => p.id);
        const landIds = lands.filter(l => selectedLandSet.has(l.tokenId.toString())).map(l => l.tokenId);
        if (plantIds.length === 0 && landIds.length === 0) {
          toast.error('No assets to transfer');
        } else {
          const r = await routerBatchTransfer(walletClient, targetAddress, plantIds, landIds, isEmbeddedWallet);
          if (r.success) {
            toast.success('Assets transferred in a single transaction');
          } else {
            toast.error('Batch transfer failed');
          }
        }
      } else {
        // Fallback to per-token loop for selected assets
        const plantIds = selectedPlantIds;
        const landIds = selectedLandIds.map((id) => BigInt(id));
        if (plantIds.length === 0 && landIds.length === 0) {
          toast.error('No assets to transfer');
        } else {
          const [plantRes, landRes] = await Promise.all([
            plantIds.length ? transferPlants(walletClient, targetAddress, plantIds, isEmbeddedWallet) : Promise.resolve({ successIds: [], failedIds: [] }),
            landIds.length ? transferLands(walletClient, targetAddress, landIds, isEmbeddedWallet) : Promise.resolve({ successIds: [], failedIds: [] }),
          ]);
          const summary = `Plants: ${plantRes.successIds.length}/${plantIds.length}, Lands: ${landRes.successIds.length}/${landIds.length}`;
          const totalFailed = plantRes.failedIds.length + landRes.failedIds.length;
          const totalSuccess = plantRes.successIds.length + landRes.successIds.length;
          if (totalFailed === 0) {
            toast.success(`Assets transferred. ${summary}`);
          } else if (totalSuccess === 0) {
            toast.error(`Transfers failed. ${summary}`);
          } else {
            toast("Some transfers succeeded", { icon: "⚠️" });
            toast.success(summary);
          }
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

          {(plantsList.length > 0 || landsList.length > 0) && (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-xs text-muted-foreground">Choose which assets to send.</p>
              {plantsList.length > 0 && (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Plants selected</span>
                    <span className="text-xs text-muted-foreground">{selectedPlantsCount}/{plantsList.length}</span>
                  </div>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{selectedPlantsCount > 0 ? `${selectedPlantsCount} selected` : 'Select plants'}</span>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 max-h-64 overflow-y-auto">
                      {plantsList.map((plant) => (
                        <DropdownMenuCheckboxItem
                          key={plant.id}
                          checked={selectedPlantIds.includes(plant.id)}
                          onCheckedChange={(checked) => {
                            const isChecked = checked === true;
                            setSelectedPlantIds((prev) => {
                              if (isChecked) {
                                if (prev.includes(plant.id)) return prev;
                                return [...prev, plant.id];
                              }
                              return prev.filter((id) => id !== plant.id);
                            });
                          }}
                        >
                          {plant.name || `Plant #${plant.id}`}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}

              {landsList.length > 0 && (
                <div className="space-y-1 text-sm">
                  <div className="flex items-center justify-between">
                    <span>Lands selected</span>
                    <span className="text-xs text-muted-foreground">{selectedLandsCount}/{landsList.length}</span>
                  </div>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="w-full justify-between">
                        <span>{selectedLandsCount > 0 ? `${selectedLandsCount} selected` : 'Select lands'}</span>
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 max-h-64 overflow-y-auto">
                      {landsList.map((land) => {
                        const id = land.tokenId.toString();
                        return (
                          <DropdownMenuCheckboxItem
                            key={id}
                            checked={selectedLandIds.includes(id)}
                            onCheckedChange={(checked) => {
                              const isChecked = checked === true;
                              setSelectedLandIds((prev) => {
                                if (isChecked) {
                                  if (prev.includes(id)) return prev;
                                  return [...prev, id];
                                }
                                return prev.filter((item) => item !== id);
                              });
                            }}
                          >
                            {land.name || `Land #${id}`}
                          </DropdownMenuCheckboxItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          )}

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
                      // Encode function data and append builder code suffix for ERC-8021 attribution
                      const abi = [{ inputs:[{name:'operator',type:'address'},{name:'approved',type:'bool'}], name:'setApprovalForAll', outputs:[], stateMutability:'nonpayable', type:'function' }] as const;
                      const encodedData = encodeFunctionData({
                        abi,
                        functionName: 'setApprovalForAll',
                        args: [BATCH_ROUTER_ADDRESS, true],
                      });
                      const dataWithSuffix = appendBuilderSuffix(encodedData);
                      const hash = await walletClient.sendTransaction({
                        to: PIXOTCHI_NFT_ADDRESS,
                        data: dataWithSuffix,
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
                      // Encode function data and append builder code suffix for ERC-8021 attribution
                      const abi = [{ inputs:[{name:'operator',type:'address'},{name:'approved',type:'bool'}], name:'setApprovalForAll', outputs:[], stateMutability:'nonpayable', type:'function' }] as const;
                      const encodedData = encodeFunctionData({
                        abi,
                        functionName: 'setApprovalForAll',
                        args: [BATCH_ROUTER_ADDRESS, true],
                      });
                      const dataWithSuffix = appendBuilderSuffix(encodedData);
                      const hash = await walletClient.sendTransaction({
                        to: LAND_CONTRACT_ADDRESS,
                        data: dataWithSuffix,
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
            disabled={loading || !isValidRecipient || !hasSelectedAnything || needsApprovals}
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
              <span className="font-medium">{selectedPlantsCount} / {counts.plants}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Lands</span>
              <span className="font-medium">{selectedLandsCount} / {counts.lands}</span>
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


