"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount } from "wagmi";
import { landAbi } from "@/public/abi/pixotchi-v3-abi";
import { PIXOTCHI_TOKEN_ADDRESS, LAND_CONTRACT_ADDRESS, LEAF_CONTRACT_ADDRESS, ERC20_APPROVE_ABI } from '@/lib/contracts';
import SponsoredTransaction from "@/components/transactions/sponsored-transaction";
import { toast } from "react-hot-toast";

type OrderView = {
  id: bigint;
  seller: `0x${string}`;
  sellToken: number; // 0=SEED,1=LEAF
  amount: bigint; // wei
  isActive: boolean;
  amountAsk: bigint; // wei
};

function formatToken(amount: bigint): string {
  const s = (Number(amount) / 1e18).toFixed(6);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function toNumberWei(v: bigint): number {
  return Number(v) / 1e18;
}

function computePriceLeafPerSeed(o: OrderView): number {
  // Guide: price displayed as LEAF per SEED
  // sellToken=1 (Sell LEAF): price = amount / amountAsk (LEAF/SEED)
  // sellToken=0 (Sell SEED): price = amountAsk / amount (LEAF/SEED)
  const a = toNumberWei(o.amount);
  const b = toNumberWei(o.amountAsk);
  if (o.sellToken === 1) return b === 0 ? 0 : a / b;
  return a === 0 ? 0 : b / a;
}

function fmt(n: number, dp = 6): string {
  const s = n.toFixed(dp);
  return s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

// Compact formatter for large numbers: 1_000 -> 1K, 1_000_000 -> 1M, 1_000_000_000 -> 1B
function formatCompact(n: number, dpSmall = 6): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${Math.round(n / 1e12)}T`;
  if (abs >= 1e9) return `${Math.round(n / 1e9)}B`;
  if (abs >= 1e6) return `${Math.round(n / 1e6)}M`;
  if (abs >= 1e3) return `${Math.round(n / 1e3)}K`;
  if (abs >= 1) return Math.round(n).toString();
  return fmt(n, dpSmall);
}

export default function MarketplaceDialog({ open, onOpenChange, landId }: { open: boolean; onOpenChange: (v: boolean) => void; landId: bigint; }) {
  const { address } = useAccount();
  const [activeOrders, setActiveOrders] = useState<OrderView[]>([]);
  const [userOrders, setUserOrders] = useState<OrderView[]>([]);
  const [sellSide, setSellSide] = useState<"SEED" | "LEAF">("LEAF");
  const [amount, setAmount] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [focusedSide, setFocusedSide] = useState<"asks" | "bids" | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [selectedSide, setSelectedSide] = useState<"asks" | "bids" | null>(null);
  const [showUserOrders, setShowUserOrders] = useState<boolean>(false);
  const [isMarketplaceActive, setIsMarketplaceActive] = useState<boolean>(true);

  const fetchOrders = useCallback(async () => {
      try {
        setLoading(true);
        const { createPublicClient, http } = await import("viem");
        const { base } = await import("viem/chains");
        const c = createPublicClient({ chain: base, transport: http() });
        const [active, mine, activeFlag] = await Promise.all([
          c.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as any, functionName: 'marketPlaceGetActiveOrders', args: [] }) as Promise<any[]>,
          address ? c.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as any, functionName: 'marketPlaceGetUserOrders', args: [address as `0x${string}`] }) as Promise<any[]> : Promise.resolve([]),
          c.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi as any, functionName: 'marketPlaceIsActive', args: [] }) as Promise<boolean>
        ]);
        setActiveOrders((active || []).map(mapOrder));
        setUserOrders((mine || []).map(mapOrder));
        setIsMarketplaceActive(Boolean(activeFlag));
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
  }, [address]);

  useEffect(() => {
    if (open) fetchOrders();

    // Refresh orders after transactions complete elsewhere
    const refreshHandler = () => { if (open) fetchOrders(); };
    window.addEventListener('balances:refresh', refreshHandler as EventListener);
    return () => window.removeEventListener('balances:refresh', refreshHandler as EventListener);
  }, [open, address, fetchOrders]);

  const mapOrder = (o: any): OrderView => ({
    id: BigInt(o.id),
    seller: o.seller,
    sellToken: Number(o.sellToken),
    amount: BigInt(o.amount),
    isActive: Boolean(o.isActive),
    amountAsk: BigInt(o.amountAsk),
  });

  const createOrderCall: { address: `0x${string}`; abi: any; functionName: string; args: any[] } | null = useMemo(() => {
    if (!amount || !price) return null;
    const toWei = (v: string) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return null;
      return BigInt(Math.floor(n * 1e18));
    };
    const sellToken = sellSide === 'LEAF' ? 1 : 0;
    const orderAmount = toWei(amount);
    const amountAsk = toWei(price);
    if (orderAmount === null || amountAsk === null) return null;
    return {
      address: LAND_CONTRACT_ADDRESS as `0x${string}`,
      abi: landAbi as any,
      functionName: 'marketPlaceCreateOrder',
      args: [landId, BigInt(sellToken), orderAmount, amountAsk] as any[],
    };
  }, [sellSide, amount, price, landId]);

  const refresh = () => {
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
  };

  // Build order book (asks: sell LEAF; bids: sell SEED)
  const asks = useMemo(() => {
    // Aggregate by price (6 dp) and compute cumulative depth
    const rows = (activeOrders || [])
      .filter(o => o.sellToken === 1)
      .map(o => ({ o, price: computePriceLeafPerSeed(o), size: toNumberWei(o.amount) }))
      .reduce((acc: Array<{ price: number; size: number }>, cur) => {
        const key = Number((Math.round(cur.price * 1e6) / 1e6).toFixed(6));
        const found = acc.find(r => r.price === key);
        if (found) found.size += cur.size; else acc.push({ price: key, size: cur.size });
        return acc;
      }, [])
      .sort((a, b) => a.price - b.price)
      .slice(0, 20);
    let cum = 0;
    const max = rows.reduce((m, r) => Math.max(m, r.size + (m === 0 ? 0 : 0)), 0);
    return rows.map(r => { cum += r.size; return { ...r, cum, depth: max ? Math.min(100, (cum / (rows.reduce((s, rr) => s + rr.size, 0))) * 100) : 0 }; });
  }, [activeOrders]);
  const bids = useMemo(() => {
    const rows = (activeOrders || [])
      .filter(o => o.sellToken === 0)
      .map(o => ({ o, price: computePriceLeafPerSeed(o), size: toNumberWei(o.amount) }))
      .reduce((acc: Array<{ price: number; size: number }>, cur) => {
        const key = Number((Math.round(cur.price * 1e6) / 1e6).toFixed(6));
        const found = acc.find(r => r.price === key);
        if (found) found.size += cur.size; else acc.push({ price: key, size: cur.size });
        return acc;
      }, [])
      .sort((a, b) => b.price - a.price)
      .slice(0, 20);
    let cum = 0;
    const total = rows.reduce((s, r) => s + r.size, 0);
    return rows.map(r => { cum += r.size; return { ...r, cum, depth: total ? Math.min(100, (cum / total) * 100) : 0 }; });
  }, [activeOrders]);
  const bestAsk = asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const mid = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : (bestAsk || bestBid || 0);

  // Local balances to validate actions
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [leafBalance, setLeafBalance] = useState<bigint>(BigInt(0));
  const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));
  const [leafAllowance, setLeafAllowance] = useState<bigint>(BigInt(0));

  useEffect(() => {
    const fetchBalances = async () => {
      if (!address) { setSeedBalance(BigInt(0)); setLeafBalance(BigInt(0)); return; }
      setLoadingBalances(true);
      try {
        const { createPublicClient, http } = await import("viem");
        const { base } = await import("viem/chains");
        const c = createPublicClient({ chain: base, transport: http() });
        const [seed, leaf, seedAll, leafAll] = await Promise.all([
          getTokenBalance(address),
          getLeafBalance(address),
          c.readContract({ address: PIXOTCHI_TOKEN_ADDRESS, abi: ERC20_APPROVE_ABI as any, functionName: 'allowance', args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS] }) as Promise<bigint>,
          c.readContract({ address: LEAF_CONTRACT_ADDRESS, abi: ERC20_APPROVE_ABI as any, functionName: 'allowance', args: [address as `0x${string}`, LAND_CONTRACT_ADDRESS] }) as Promise<bigint>,
        ]);
        setSeedBalance(seed || BigInt(0));
        setLeafBalance(leaf || BigInt(0));
        setSeedAllowance(seedAll || BigInt(0));
        setLeafAllowance(leafAll || BigInt(0));
      } catch {
        setSeedBalance(BigInt(0));
        setLeafBalance(BigInt(0));
        setSeedAllowance(BigInt(0));
        setLeafAllowance(BigInt(0));
      } finally {
        setLoadingBalances(false);
      }
    };
    if (open) fetchBalances();
  }, [open, address]);

  const hasSufficientForOrder = (o: OrderView): boolean => {
    // If order sells LEAF (asks), taker pays SEED = amountAsk
    // If order sells SEED (bids), taker pays LEAF = amountAsk
    if (o.sellToken === 1) {
      return seedBalance >= o.amountAsk;
    }
    return leafBalance >= o.amountAsk;
  };

  const isOrderActive = (orderId: bigint): boolean => {
    return activeOrders.some((x) => x.id === orderId && x.isActive);
  };

  // Helpers to consistently apply best prices into the controlled input
  const useBestBid = () => {
    if (bids.length > 0) {
      setSellSide('LEAF');
      setPrice(fmt(bids[0].price, 6));
      setFocusedSide('bids');
    }
  };

  const useBestAsk = () => {
    if (asks.length > 0) {
      setSellSide('SEED');
      setPrice(fmt(asks[0].price, 6));
      setFocusedSide('asks');
    }
  };

  // Build create order call from amount and price (exact math, 18 decimals)
  const buildCreateOrderCall = () => {
    if (!amount || !price) return null;
    const toWei = (v: string) => {
      try { return BigInt(Math.floor(Number(v) * 1e6)) * BigInt(1e12); } catch { return null; }
    };
    const amountWei = toWei(amount);
    const priceWei = toWei(price); // price in 1e18 fixed-point (LEAF/SEED)
    if (amountWei === null || amountWei <= BigInt(0) || priceWei === null || priceWei <= BigInt(0)) return null;
    // Compute amountAsk per side
    let amountAskWei: bigint;
    if (sellSide === 'LEAF') {
      // price = amount / amountAsk => amountAsk = amount / price
      amountAskWei = (amountWei * BigInt(1e18)) / priceWei;
    } else {
      // price = amountAsk / amount => amountAsk = price * amount
      amountAskWei = (priceWei * amountWei) / BigInt(1e18);
    }
    if (amountAskWei <= BigInt(0)) return null;
    const sellToken = sellSide === 'LEAF' ? 1 : 0;
    return {
      address: LAND_CONTRACT_ADDRESS as `0x${string}`,
      abi: landAbi as any,
      functionName: 'marketPlaceCreateOrder',
      args: [landId, BigInt(sellToken), amountWei, amountAskWei] as any[],
    };
  };

  // After successful create order, mark mission progress
  const onOrderSuccess = (tx: any) => {
    fetch('/api/gamification/missions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, taskId: 's3_place_order', proof: { txHash: tx?.transactionHash } })
    }).catch(err => console.warn('Gamification tracking failed (non-critical):', err));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,64rem)] max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Marketplace (Experimental)</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Top bar with mid price and quick actions */}
          <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs text-muted-foreground">Mid (LEAF / SEED)</div>
              <div className="text-xl sm:text-2xl font-semibold">{mid ? fmt(mid, 6) : '—'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <Button variant="outline" className="h-9 px-4" onClick={useBestBid}>Use Best Bid</Button>
              <Button variant="outline" className="h-9 px-4" onClick={useBestAsk}>Use Best Ask</Button>
            </div>
          </div>

          {/* Mobile: keep orders (asks+bids) together, then trade panel */}
          <div className="md:hidden space-y-4">
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Asks header and list */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 text-sm bg-red-500/10 text-red-600">
                <span>Asks (Sell LEAF)</span>
                <span className="opacity-70">Price • Size</span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {asks.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground p-4">—</div>
                ) : (
                  asks.map((row, idx) => {
                    const isSelected = selectedSide === 'asks' && selectedLevel === row.price;
                    return (
                      <button
                        key={`m-ask-${idx}`}
                        className={`relative w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30 ${isSelected ? 'bg-muted/40' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background`}
                        onClick={() => { setSellSide('SEED'); setPrice(fmt(row.price)); setFocusedSide('asks'); setSelectedLevel(row.price); setSelectedSide('asks'); }}
                        aria-label={`Select price ${fmt(row.price, 6)} LEAF per SEED`}
                      >
                        <div className="absolute inset-0 bg-red-500/10" style={{ width: `${row.depth}%` }} />
                        <span className="relative text-red-600 font-semibold">{formatCompact(row.price)}</span>
                        <span className="relative">{formatCompact(row.size)} LEAF</span>
                      </button>
                    );
                  })
                )}
              </div>
              {/* Bids header and list */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 text-sm bg-green-500/10 text-green-600 border-t border-border">
                <span>Bids (Sell SEED)</span>
                <span className="opacity-70">Price • Size</span>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {bids.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground p-4">—</div>
                ) : (
                  bids.map((row, idx) => {
                    const isSelected = selectedSide === 'bids' && selectedLevel === row.price;
                    return (
                      <button
                        key={`m-bid-${idx}`}
                        className={`relative w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/30 ${isSelected ? 'bg-muted/40' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background`}
                        onClick={() => { setSellSide('LEAF'); setPrice(fmt(row.price)); setFocusedSide('bids'); setSelectedLevel(row.price); setSelectedSide('bids'); }}
                        aria-label={`Select price ${fmt(row.price, 6)} LEAF per SEED`}
                      >
                        <div className="absolute inset-0 bg-green-500/10" style={{ width: `${row.depth}%` }} />
                        <span className="relative text-green-600 font-semibold">{formatCompact(row.price)}</span>
                        <span className="relative">{formatCompact(row.size)} SEED</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Trade panel (mobile below orders) */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Button variant={sellSide === 'LEAF' ? 'default' : 'outline'} className="h-9 px-4" onClick={() => setSellSide('LEAF')}>Sell LEAF</Button>
                <Button variant={sellSide === 'SEED' ? 'default' : 'outline'} className="h-9 px-4" onClick={() => setSellSide('SEED')}>Sell SEED</Button>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Amount ({sellSide})</div>
                  <div className="relative">
                    <Input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="h-12 pr-20"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{sellSide}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">Balance: {sellSide === 'LEAF' ? formatCompact(toNumberWei(leafBalance)) + ' LEAF' : formatCompact(toNumberWei(seedBalance)) + ' SEED'}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Price (LEAF / SEED)</div>
                  <div className="relative">
                    <Input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="h-12 pr-24"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">LEAF / SEED</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Tip: Tap an order to pre-fill the price.</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAmount('')}>Clear</Button>
                </div>
              </div>
              <div className="flex gap-2">
                {sellSide === 'SEED' && seedAllowance < (buildCreateOrderCall()?.args?.[3] as bigint || BigInt(0)) && (
                  <SponsoredTransaction
                    calls={[{ address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`, abi: ERC20_APPROVE_ABI as any, functionName: 'approve', args: [LAND_CONTRACT_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')] }]}
                    buttonText="Approve SEED"
                    buttonClassName="h-9 px-4"
                    hideStatus
                    onSuccess={() => { toast.success('SEED approved'); }}
                  />
                )}
                {sellSide === 'LEAF' && leafAllowance < (buildCreateOrderCall()?.args?.[3] as bigint || BigInt(0)) && (
                  <SponsoredTransaction
                    calls={[{ address: LEAF_CONTRACT_ADDRESS as `0x${string}`, abi: ERC20_APPROVE_ABI as any, functionName: 'approve', args: [LAND_CONTRACT_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')] }]}
                    buttonText="Approve LEAF"
                    buttonClassName="h-9 px-4"
                    hideStatus
                    onSuccess={() => { toast.success('LEAF approved'); }}
                  />
                )}
              </div>
              <SponsoredTransaction
                calls={buildCreateOrderCall() ? [buildCreateOrderCall() as any] : []}
                buttonText={`Create Order`}
                buttonClassName="w-full h-10"
                disabled={!isMarketplaceActive || !buildCreateOrderCall() || (sellSide === 'SEED' ? seedBalance < (buildCreateOrderCall()?.args?.[2] as bigint || BigInt(0)) : leafBalance < (buildCreateOrderCall()?.args?.[2] as bigint || BigInt(0)))}
                hideStatus
                onSuccess={(tx) => { toast.success('Order created'); setAmount(''); setPrice(''); refresh(); onOrderSuccess(tx); }}
              />
            </div>
          </div>

          {/* Desktop/tablet: three-column layout */}
          <div className="hidden md:grid md:grid-cols-3 items-start gap-4">
            {/* Asks */}
            <div className={`rounded-lg border border-border bg-card overflow-hidden ${focusedSide === 'asks' ? 'ring-1 ring-red-500/50' : ''}`}>
              <div className="max-h-72 overflow-y-auto min-h-[18rem] md:max-h-[22rem]">
                <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 text-xs bg-red-500/10 text-red-600">
                  <span>Asks (Sell LEAF)</span>
                  <span className="opacity-70">Price • Size</span>
                </div>
                {asks.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground p-4">—</div>
                ) : (
                  asks.map((row, idx) => {
                    const isSelected = selectedSide === 'asks' && selectedLevel === row.price;
                    return (
                      <button
                        key={`ask-${idx}`}
                        className={`relative w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 ${isSelected ? 'bg-muted/40' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background`}
                        onClick={() => { setSellSide('SEED'); setPrice(fmt(row.price)); setFocusedSide('asks'); setSelectedLevel(row.price); setSelectedSide('asks'); }}
                        aria-label={`Select price ${fmt(row.price, 6)} LEAF per SEED`}
                      >
                        <div className="absolute inset-0 bg-red-500/10" style={{ width: `${row.depth}%` }} />
                        <span className="relative text-red-600 font-semibold">{formatCompact(row.price)}</span>
                        <span className="relative">{formatCompact(row.size)} LEAF</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Trade panel */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-4 min-h-[18rem] md:max-h-[22rem] md:overflow-y-auto">
              <div className="flex items-center gap-2 text-sm">
                <Button variant={sellSide === 'LEAF' ? 'default' : 'outline'} className="h-9 px-4" onClick={() => setSellSide('LEAF')}>Sell LEAF</Button>
                <Button variant={sellSide === 'SEED' ? 'default' : 'outline'} className="h-9 px-4" onClick={() => setSellSide('SEED')}>Sell SEED</Button>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Amount ({sellSide})</div>
                  <div className="relative">
                    <Input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="h-12 pr-20"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">{sellSide}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground">Balance: {sellSide === 'LEAF' ? formatCompact(toNumberWei(leafBalance)) + ' LEAF' : formatCompact(toNumberWei(seedBalance)) + ' SEED'}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground mb-2">Price (LEAF / SEED)</div>
                  <div className="relative">
                    <Input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0.0"
                      inputMode="decimal"
                      className="h-12 pr-24"
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">LEAF / SEED</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Tip: Click an order row to pre-fill the price.</span>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="h-8 px-2 text-xs" onClick={() => setAmount('')}>Clear</Button>
                </div>
              </div>
              {/* Allowance helpers */}
              <div className="flex gap-2">
                {sellSide === 'SEED' && seedAllowance < (buildCreateOrderCall()?.args?.[3] as bigint || BigInt(0)) && (
                  <SponsoredTransaction
                    calls={[{ address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`, abi: ERC20_APPROVE_ABI as any, functionName: 'approve', args: [LAND_CONTRACT_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')] }]}
                    buttonText="Approve SEED"
                    buttonClassName="h-9 px-4"
                    hideStatus
                    onSuccess={() => { toast.success('SEED approved'); }}
                  />
                )}
                {sellSide === 'LEAF' && leafAllowance < (buildCreateOrderCall()?.args?.[3] as bigint || BigInt(0)) && (
                  <SponsoredTransaction
                    calls={[{ address: LEAF_CONTRACT_ADDRESS as `0x${string}`, abi: ERC20_APPROVE_ABI as any, functionName: 'approve', args: [LAND_CONTRACT_ADDRESS, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')] }]}
                    buttonText="Approve LEAF"
                    buttonClassName="h-9 px-4"
                    hideStatus
                    onSuccess={() => { toast.success('LEAF approved'); }}
                  />
                )}
              </div>
              <SponsoredTransaction
                calls={buildCreateOrderCall() ? [buildCreateOrderCall() as any] : []}
                buttonText={`Create Order`}
                buttonClassName="w-full h-10"
                disabled={!isMarketplaceActive || !buildCreateOrderCall() || (sellSide === 'SEED' ? seedBalance < (buildCreateOrderCall()?.args?.[2] as bigint || BigInt(0)) : leafBalance < (buildCreateOrderCall()?.args?.[2] as bigint || BigInt(0)))}
                hideStatus
                onSuccess={(tx) => { toast.success('Order created'); setAmount(''); setPrice(''); refresh(); onOrderSuccess(tx); }}
              />
            </div>

            {/* Bids */}
            <div className={`rounded-lg border border-border bg-card overflow-hidden ${focusedSide === 'bids' ? 'ring-1 ring-green-500/50' : ''}`}> 
              <div className="max-h-72 overflow-y-auto min-h-[18rem] md:max-h-[22rem]">
                <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 text-xs bg-green-500/10 text-green-600">
                  <span>Bids (Sell SEED)</span>
                  <span className="opacity-70">Price • Size</span>
                </div>
                {bids.length === 0 ? (
                  <div className="text-center text-sm text-muted-foreground p-4">—</div>
                ) : (
                  bids.map((row, idx) => {
                    const isSelected = selectedSide === 'bids' && selectedLevel === row.price;
                    return (
                      <button
                        key={`bid-${idx}`}
                        className={`relative w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/30 ${isSelected ? 'bg-muted/40' : ''} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background`}
                        onClick={() => { setSellSide('LEAF'); setPrice(fmt(row.price)); setFocusedSide('bids'); setSelectedLevel(row.price); setSelectedSide('bids'); }}
                        aria-label={`Select price ${fmt(row.price, 6)} LEAF per SEED`}
                      >
                        <div className="absolute inset-0 bg-green-500/10" style={{ width: `${row.depth}%` }} />
                        <span className="relative text-green-600 font-semibold">{formatCompact(row.price)}</span>
                        <span className="relative">{formatCompact(row.size)} SEED</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Price level details (individual orders with Take buttons) */}
          {selectedLevel !== null && selectedSide && (
            <div className="rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                <div className="text-sm font-medium">
                  Orders @ {fmt(selectedLevel, 6)} LEAF/SEED • {selectedSide === 'asks' ? 'Sell LEAF' : 'Sell SEED'}
                </div>
                <button className="text-xs text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-sm px-1" onClick={() => { setSelectedLevel(null); setSelectedSide(null); }}>Clear</button>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {(() => {
                  const level = Number((Math.round((selectedLevel || 0) * 1e6) / 1e6).toFixed(6));
                  const list = (activeOrders || []).filter(o => {
                    const side = o.sellToken === 1 ? 'asks' : 'bids';
                    if (side !== selectedSide) return false;
                    const p = Number((Math.round(computePriceLeafPerSeed(o) * 1e6) / 1e6).toFixed(6));
                    return p === level;
                  });
                  if (list.length === 0) {
                    return <div className="text-center text-sm text-muted-foreground p-3">No orders at this price.</div>;
                  }
                  return (
                    <div className="divide-y divide-border">
                      {list.map((o) => (
                        <div key={String(o.id)} className="px-3 py-2 text-xs flex items-center justify-between gap-3">
                          <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                            <span className="font-medium">#{String(o.id)}</span>
                            <span className="text-muted-foreground">Size {formatCompact(toNumberWei(o.amount))} {o.sellToken === 1 ? 'LEAF' : 'SEED'} • Needs {formatCompact(toNumberWei(o.amountAsk))} {o.sellToken === 1 ? 'SEED' : 'LEAF'}</span>
                          </div>
                          <SponsoredTransaction
                            calls={[{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi as any, functionName: 'marketPlaceTakeOrder', args: [landId, o.id] as any[] }]}
                            buttonText="Take"
                            buttonClassName="h-8 px-3 text-xs min-w-[80px] shrink-0"
                            disabled={loadingBalances || !hasSufficientForOrder(o) || (address && o.seller.toLowerCase() === address.toLowerCase())}
                            hideStatus
                            onSuccess={() => { toast.success('Order filled'); refresh(); }}
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* My Orders */}
          <div className="space-y-2">
            <div className="text-sm font-medium flex items-center justify-between">
              <span>Orders</span>
              <div className="flex items-center gap-2 text-xs">
                <Button variant={showUserOrders ? 'default' : 'outline'} className="h-8 px-3" onClick={() => setShowUserOrders(true)}>Mine</Button>
                <Button variant={!showUserOrders ? 'default' : 'outline'} className="h-8 px-3" onClick={() => setShowUserOrders(false)}>All</Button>
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-card">
              {((showUserOrders ? userOrders : activeOrders) || []).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 px-6 text-center">
                  <div className="w-12 h-12 mb-3 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-2xl">📋</span>
                  </div>
                  <p className="text-sm font-medium text-foreground mb-1">No Orders</p>
                  <p className="text-xs text-muted-foreground">
                    {showUserOrders ? 'You have no active orders' : 'No orders available'}
                  </p>
                </div>
              ) : (
                (showUserOrders ? userOrders : activeOrders).map((o) => (
                  <div key={String(o.id)} className="p-2 border-b border-border last:border-b-0">
                    <div className="text-xs flex items-center justify-between gap-3">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:gap-3">
                        <span className="font-medium">{o.sellToken === 1 ? 'Sell LEAF' : 'Sell SEED'} • #{String(o.id)}</span>
                        <span className="text-muted-foreground">Price {formatCompact(computePriceLeafPerSeed(o))} • Size {formatCompact(toNumberWei(o.amount))} {o.sellToken === 1 ? 'LEAF' : 'SEED'} • Needs {formatCompact(toNumberWei(o.amountAsk))} {o.sellToken === 1 ? 'SEED' : 'LEAF'}</span>
                      </div>
                      {showUserOrders && address && o.seller.toLowerCase() === address.toLowerCase() && o.isActive && (
                        <SponsoredTransaction
                          calls={[{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi as any, functionName: 'marketPlaceCancelOrder', args: [landId, o.id] as any[] }]}
                          buttonText="Cancel"
                          buttonClassName="h-8 px-3 text-xs min-w-[80px] shrink-0"
                          disabled={!isOrderActive(o.id)}
                          hideStatus
                          onSuccess={() => { toast.success('Order canceled'); fetchOrders(); refresh(); }}
                        />
                      )}
                      {!showUserOrders && (!address || o.seller.toLowerCase() !== address.toLowerCase()) && o.isActive && (
                        <SponsoredTransaction
                          calls={[{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi as any, functionName: 'marketPlaceTakeOrder', args: [landId, o.id] as any[] }]}
                          buttonText="Take"
                          buttonClassName="h-8 px-3 text-xs min-w-[80px] shrink-0"
                          disabled={loadingBalances || !hasSufficientForOrder(o) || !isOrderActive(o.id)}
                          hideStatus
                          onSuccess={() => { toast.success('Order filled'); fetchOrders(); refresh(); }}
                        />
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}


