"use client";

import { parseAmountInput } from "@/lib/amount-input";
import { getEconomicReadState } from "@/lib/economic-read-state";
import { parseMarketplaceOrder, type MarketplaceOrder } from "@/lib/marketplace-order";
import type { TransactionProof } from "@/components/transactions/transaction-kit";
import { MarketplaceOrderSummary } from "./marketplace-order-summary";
import { MarketplaceOrderList } from "./marketplace-order-list";
import GameTransaction from "@/components/transactions/game-transaction";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { AmountField } from "@/components/ui/amount-field";
import { ToggleGroup } from '@/components/ui/toggle-group';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatTokenDisplay, formatTokenDisplayCompact } from "@/lib/token-display";
import { ERC20_APPROVE_ABI,getLeafAllowanceForLand,getLeafBalance,getReadClient,getSeedAllowanceForLand,getTokenBalance,LAND_CONTRACT_ADDRESS,LEAF_CONTRACT_ADDRESS,PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { postMissionProgress } from '@/lib/mission-tracking';
import { onBalanceRefresh } from '@/lib/app-events';
import {
  buildMarketplacePriceLevels,
  getMarketplaceRatioKey,
  computeMarketplaceAmountAsk,
  formatMarketplacePriceRatio,
  getMarketplacePriceRatio,
  type MarketplacePriceRatio,
} from '@/lib/marketplace-price';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { cn } from "@/lib/utils";
import { landAbi } from "@/public/abi/pixotchi-v3-abi";
import { useCallback,useEffect,useId,useMemo,useRef,useState } from "react";
import { TokenAmount } from '@/components/ui/token-amount';
import { useAccount } from "wagmi";

type OrderView = MarketplaceOrder;

const MARKETPLACE_ORDER_LIST_LIMIT = 48;
const PRICE_LEVEL_ORDER_LIST_LIMIT = 20;
const MAX_ALLOWANCE = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
const marketplacePanelClassName =
  "surface-group rounded-[var(--radius-panel)]";
const marketplacePaddedPanelClassName = `${marketplacePanelClassName} p-4`;

const mapOrder = parseMarketplaceOrder;

export default function MarketplaceDialog({ open, onOpenChange, landId }: { open: boolean; onOpenChange: (v: boolean) => void; landId: bigint; }) {
  const { address } = useAccount();
  const [activeOrders, setActiveOrders] = useState<OrderView[]>([]);
  const [userOrders, setUserOrders] = useState<OrderView[]>([]);
  const [sellSide, setSellSide] = useState<"SEED" | "LEAF">("LEAF");
  const [amount, setAmount] = useState<string>("");
  const [price, setPrice] = useState<string>("");
  const [exactPriceRatio, setExactPriceRatio] = useState<MarketplacePriceRatio | null>(null);
  const [ordersLoading, setLoading] = useState<boolean>(false);
  const [focusedSide, setFocusedSide] = useState<"asks" | "bids" | null>(null);
  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<"asks" | "bids" | null>(null);
  const [showUserOrders, setShowUserOrders] = useState<boolean>(false);
  const [showHistory, setShowHistory] = useState<boolean>(false);
  const [isMarketplaceActive, setIsMarketplaceActive] = useState<boolean>(true);
  const [ordersOwner, setOrdersOwner] = useState<string | null>(null);
  const [ordersFresh, setOrdersFresh] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [leafBalance, setLeafBalance] = useState<bigint>(BigInt(0));
  const [loadingBalances, setLoadingBalances] = useState<boolean>(false);
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));
  const [leafAllowance, setLeafAllowance] = useState<bigint>(BigInt(0));
  const [balanceOwner, setBalanceOwner] = useState<string | null>(null);
  const [balancesFresh, setBalancesFresh] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const amountInputId = useId();
  const priceInputId = useId();
  const balanceRequestRef = useRef(0);
  const orderRequestRef = useRef(0);
  const currentAddressRef = useRef(address?.toLowerCase() ?? null);
  currentAddressRef.current = address?.toLowerCase() ?? null;

  useEffect(() => {
    // Never render one wallet's spendable state for another wallet, even for
    // the single frame before the new request effect runs.
    balanceRequestRef.current += 1;
    setSeedBalance(BigInt(0));
    setLeafBalance(BigInt(0));
    setSeedAllowance(BigInt(0));
    setLeafAllowance(BigInt(0));
    setBalanceOwner(null);
    setBalancesFresh(false);
    setBalanceError(null);
    setLoadingBalances(false);
  }, [address]);

  // NEW: State for user's lands to ensure we use a valid landId for transactions
  const [userLandIds, setUserLandIds] = useState<bigint[]>([]);
  const [userLandOwner, setUserLandOwner] = useState<string | null>(null);
  const [userLandsLoading, setUserLandsLoading] = useState(false);
  const [userLandsError, setUserLandsError] = useState<string | null>(null);
  const [userLandsRetryRevision, setUserLandsRetryRevision] = useState(0);

  useEffect(() => {
    orderRequestRef.current += 1;
    setActiveOrders([]);
    setUserOrders([]);
    setOrdersOwner(null);
    setOrdersFresh(false);
    setOrdersError(null);
  }, [address]);

  // Fetch user's lands to determine valid transaction signer
  useEffect(() => {
    setUserLandIds([]);
    setUserLandOwner(null);
    setUserLandsError(null);
    if (!address) {
      setUserLandsLoading(false);
      return;
    }
    setUserLandsLoading(true);
    let cancelled = false;
    const fetchUserLands = async () => {
      try {
        const client = getReadClient();
        // Use landOverviewByOwner to get tokenIds efficiently
        const lands = await client.readContract({
          address: LAND_CONTRACT_ADDRESS,
          abi: landAbi,
          functionName: 'landOverviewByOwner',
          args: [address as `0x${string}`]
        });
        // lands is array of struct { tokenId, ... }
        if (!cancelled && Array.isArray(lands)) {
          setUserLandIds(lands.map(l => BigInt(l.tokenId)));
          setUserLandOwner(address.toLowerCase());
        }
      } catch (e) {
        console.warn('Failed to fetch user lands for marketplace:', e);
        if (!cancelled) {
          setUserLandsError('Land ownership could not be verified. Trading actions are paused until this check succeeds.');
        }
      } finally {
        if (!cancelled) setUserLandsLoading(false);
      }
    };
    void fetchUserLands();
    return () => {
      cancelled = true;
    };
  }, [address, userLandsRetryRevision]);

  // Determine which landId to use for transactions (Create/Take/Cancel)
  // Contract requires isApproved(landId), so we must use a land OWNED by the sender.
  // PREFERENCE: Use current landId if owned (context relevant), otherwise use first owned land.
  const transactionLandId = useMemo(() => {
    if (!address || userLandOwner !== address.toLowerCase()) return null;
    if (userLandIds.some(id => id === landId)) return landId;
    if (userLandIds.length > 0) return userLandIds[0];
    return null; // User owns no lands -> Cannot trade (per contract logic requiring valid landId)
  }, [address, landId, userLandIds, userLandOwner]);
  const normalizedAddress = address?.toLowerCase() ?? null;
  const hasBalanceSnapshot = normalizedAddress !== null && balanceOwner === normalizedAddress;
  const balanceReadState = getEconomicReadState({
    hasSnapshot: balanceOwner !== null && balancesFresh,
    identityMatches: hasBalanceSnapshot,
    loading: loadingBalances,
    error: balanceError,
  });
  const balancesCurrent = open && balanceReadState === 'ready';
  const unavailableBalanceLabel = balanceReadState === 'error' ? 'Balances unavailable' : 'Checking balances';
  const ordersCurrent = normalizedAddress !== null && ordersOwner === normalizedAddress && ordersFresh;
  const currentUserOrders = ordersOwner === normalizedAddress ? userOrders : [];
  const unavailableLandLabel = userLandsLoading
    ? 'Checking land'
    : userLandsError
      ? 'Land unavailable'
      : 'No land';

  const fetchOrders = useCallback(async () => {
    const requestId = ++orderRequestRef.current;
    const requestedOwner = address?.toLowerCase() ?? null;
    try {
      setLoading(true);
      setOrdersFresh(false);
      setOrdersError(null);
      const client = getReadClient();
      const [active, mine, activeFlag] = await Promise.all([
        client.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'marketPlaceGetActiveOrders', args: [] }) as Promise<unknown[]>,
        address ? client.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'marketPlaceGetUserOrders', args: [address as `0x${string}`] }) as Promise<unknown[]> : Promise.resolve([]),
        client.readContract({ address: LAND_CONTRACT_ADDRESS, abi: landAbi, functionName: 'marketPlaceIsActive', args: [] }) as Promise<boolean>
      ]);
      if (requestId !== orderRequestRef.current) return;
      setActiveOrders((active || []).map(mapOrder));
      setUserOrders((mine || []).map(mapOrder));
      setIsMarketplaceActive(Boolean(activeFlag));
      setOrdersOwner(requestedOwner);
      setOrdersFresh(true);
    } catch (error) {
      console.warn('[Marketplace] Failed to fetch orders:', error);
      if (requestId === orderRequestRef.current) {
        setOrdersError('Marketplace orders could not be refreshed. Trading actions are paused to prevent using stale data.');
      }
    } finally {
      if (requestId === orderRequestRef.current) setLoading(false);
    }
  }, [address]);

  const fetchBalances = useCallback(async () => {
    const requestId = ++balanceRequestRef.current;
    const requestedOwner = address?.toLowerCase() ?? null;
    setBalancesFresh(false);
    if (!address) {
      setSeedBalance(BigInt(0));
      setLeafBalance(BigInt(0));
      setSeedAllowance(BigInt(0));
      setLeafAllowance(BigInt(0));
      setBalanceOwner(null);
      setBalanceError(null);
      setLoadingBalances(false);
      return;
    }
    setLoadingBalances(true);
    setBalanceError(null);
    try {
      const [seed, leaf, seedAll, leafAll] = await Promise.all([
        getTokenBalance(address),
        getLeafBalance(address),
        getSeedAllowanceForLand(address),
        getLeafAllowanceForLand(address),
      ]);
      if (requestId !== balanceRequestRef.current || requestedOwner !== currentAddressRef.current) return;
      if ([seed, leaf, seedAll, leafAll].some(value => typeof value !== 'bigint' || value < BigInt(0))) {
        throw new Error('Marketplace balance snapshot is incomplete');
      }
      setSeedBalance(seed);
      setLeafBalance(leaf);
      setSeedAllowance(seedAll);
      setLeafAllowance(leafAll);
      setBalanceOwner(requestedOwner);
      setBalancesFresh(true);
    } catch (error) {
      console.warn('[Marketplace] Failed to fetch balances:', error);
      if (requestId === balanceRequestRef.current && requestedOwner === currentAddressRef.current) {
        setBalanceError('Balances and approvals could not be refreshed. New trades and approvals are paused until a refresh succeeds.');
      }
    } finally {
      if (requestId === balanceRequestRef.current) setLoadingBalances(false);
    }
  }, [address]);

  useEffect(() => {
    if (!open) return;

    void fetchBalances();
    void fetchOrders();

    let refreshTimer: number | null = null;
    let refreshTargetAt = Number.POSITIVE_INFINITY;
    const unsubscribe = onBalanceRefresh((detail) => {
      if (detail.address && address && detail.address.toLowerCase() !== address.toLowerCase()) {
        return;
      }

      const targetAt = Date.now() + detail.delayMs;
      if (refreshTimer !== null && refreshTargetAt <= targetAt) return;
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTargetAt = targetAt;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        refreshTargetAt = Number.POSITIVE_INFINITY;
        void Promise.allSettled([fetchBalances(), fetchOrders()]);
      }, Math.max(0, targetAt - Date.now()));
    });

    return () => {
      balanceRequestRef.current += 1;
      setBalancesFresh(false);
      unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [address, fetchBalances, fetchOrders, open]);

  const refreshNow = useCallback(() => {
    void Promise.allSettled([fetchBalances(), fetchOrders()]);
  }, [fetchBalances, fetchOrders]);

  const renderCancelOrder = (order: OrderView) => (
    <GameTransaction
      effects={{ domains: ["plants", "lands", "balances"] }}
      intentKey={`marketplace:cancel-order:${transactionLandId}:${order.id}`}
      calls={transactionLandId ? [{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi, functionName: 'marketPlaceCancelOrder', args: [transactionLandId, order.id] }] : []}
      buttonText={transactionLandId ? 'Cancel' : unavailableLandLabel}
      buttonClassName="h-11 min-h-11 w-auto min-w-[64px] shrink-0 px-2.5 py-0 text-xs"
      disabled={!transactionLandId || !ordersCurrent || !isOrderActive(order.id)}
      onSuccess={() => { setOrdersFresh(false); refreshNow(); }}
      hideStatus
    />
  );

  // Quote currency is LEAF per SEED; order by what the taker receives.
  const asks = useMemo(() => buildMarketplacePriceLevels(activeOrders, 1), [activeOrders]);
  const bids = useMemo(() => buildMarketplacePriceLevels(activeOrders, 0), [activeOrders]);

  const hasSufficientForOrder = (o: OrderView): boolean => {
    if (!balancesCurrent) return false;
    // If order sells LEAF (asks), taker pays SEED = amountAsk
    // If order sells SEED (bids), taker pays LEAF = amountAsk
    if (o.sellToken === 1) {
      return seedBalance >= o.amountAsk;
    }
    return leafBalance >= o.amountAsk;
  };

  const isOrderActive = (orderId: bigint): boolean => {
    return ordersCurrent && activeOrders.some((x) => x.id === orderId && x.isActive);
  };

  // Helpers to consistently apply best prices into the controlled input
  const useBestBid = () => {
    if (bids.length > 0) {
      setSellSide('LEAF');
      setPrice(formatMarketplacePriceRatio(bids[0].exactRatio));
      setExactPriceRatio(bids[0].exactRatio);
      setFocusedSide('bids');
    }
  };

  const useBestAsk = () => {
    if (asks.length > 0) {
      setSellSide('SEED');
      setPrice(formatMarketplacePriceRatio(asks[0].exactRatio));
      setExactPriceRatio(asks[0].exactRatio);
      setFocusedSide('asks');
    }
  };

  const parsedAmount = useMemo(() => {
    if (!amount.trim()) return null;
    return parseAmountInput(amount);
  }, [amount]);
  const parsedPrice = useMemo(() => {
    if (!price.trim()) return null;
    return parseAmountInput(price);
  }, [price]);
  const amountInputError = amount && (parsedAmount === null || parsedAmount <= BigInt(0))
    ? 'Enter a positive amount with no more than 18 decimal places.'
    : null;
  const priceInputError = !exactPriceRatio && price && (parsedPrice === null || parsedPrice <= BigInt(0))
    ? 'Enter a positive price with no more than 18 decimal places.'
    : null;

  // Build one stable call object so responsive layout changes do not remount or
  // reset the transaction controller.
  const createOrderCall = useMemo(() => {
    if (
      parsedAmount === null
      || parsedAmount <= BigInt(0)
      || (exactPriceRatio === null && (parsedPrice === null || parsedPrice <= BigInt(0)))
      || transactionLandId === null
    ) return null;
    // Compute amountAsk per side
    let amountAskWei: bigint;
    if (exactPriceRatio !== null) {
      const exactAmountAsk = computeMarketplaceAmountAsk(sellSide, parsedAmount, exactPriceRatio);
      if (exactAmountAsk === null) return null;
      amountAskWei = exactAmountAsk;
    } else if (sellSide === 'LEAF' && parsedPrice !== null) {
      // price = amount / amountAsk => amountAsk = amount / price
      amountAskWei = (parsedAmount * BigInt(1e18)) / parsedPrice;
    } else if (parsedPrice !== null) {
      // price = amountAsk / amount => amountAsk = price * amount
      amountAskWei = (parsedPrice * parsedAmount) / BigInt(1e18);
    } else return null;
    if (amountAskWei <= BigInt(0)) return null;
    const sellToken = sellSide === 'LEAF' ? 1 : 0;
    return {
      address: LAND_CONTRACT_ADDRESS as `0x${string}`,
      abi: landAbi,
      functionName: 'marketPlaceCreateOrder',
      args: [transactionLandId, BigInt(sellToken), parsedAmount, amountAskWei],
    };
  }, [exactPriceRatio, parsedAmount, parsedPrice, sellSide, transactionLandId]);

  // After successful create order, mark mission progress
  const onOrderSuccess = (tx: TransactionProof) => {
    const payload: Record<string, unknown> = { address, taskId: 's1_place_order' };
    const txHash = extractTransactionHash(tx);
    if (txHash) {
      payload.proof = { txHash };
    }
    postMissionProgress(payload).catch(err => console.warn('Gamification tracking failed (non-critical):', err));
  };

  const createOrderAmount = (createOrderCall?.args?.[2] as bigint | undefined) ?? BigInt(0);
  // Keep a known approval controller mounted during refreshes. Freshness gates
  // its submit action; it must not replace an in-flight wallet operation.
  const needsSeedApproval = hasBalanceSnapshot && sellSide === 'SEED' && seedAllowance < createOrderAmount;
  const needsLeafApproval = hasBalanceSnapshot && sellSide === 'LEAF' && leafAllowance < createOrderAmount;
  const needsCreateApproval = needsSeedApproval || needsLeafApproval;
  const hasCreateBalance = balancesCurrent && (sellSide === 'SEED'
    ? seedBalance >= createOrderAmount
    : leafBalance >= createOrderAmount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent surface="soft" className="w-[min(94vw,28rem)] max-w-md tablet:w-[min(92vw,64rem)] tablet:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Marketplace (Experimental)</DialogTitle>
          <DialogDescription>
            Review live SEED and LEAF orders, select a price level, and create a marketplace order.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-y-auto py-3 pr-1">
          <div className="space-y-4 pb-4">
            {/* Top bar with mid price and quick actions */}
            <div className={cn(marketplacePaddedPanelClassName, "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <div className="text-base font-semibold">Community orders</div>
                <p className="text-xs text-muted-foreground">Rates are quoted in LEAF per SEED.</p>
                <div className="mt-1 text-xs text-muted-foreground">
                  {activeOrders.length} active • {currentUserOrders.filter((order) => order.isActive).length} mine
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <Button variant="outline" size="touchCompact" className="h-auto whitespace-normal [overflow-wrap:anywhere]" onClick={useBestBid} disabled={!ordersCurrent || bids.length === 0}>Best rate to sell LEAF</Button>
                <Button variant="outline" size="touchCompact" className="h-auto whitespace-normal [overflow-wrap:anywhere]" onClick={useBestAsk} disabled={!ordersCurrent || asks.length === 0}>Best rate to sell SEED</Button>
                <Button
                  variant="outline"
                  size="touchCompact"
                  className="h-auto whitespace-normal [overflow-wrap:anywhere]"
                  onClick={refreshNow}
                  loading={ordersLoading || loadingBalances}
                  loadingText="Refreshing"
                >
                  Refresh
                </Button>
              </div>
            </div>

            {balanceError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] px-3 py-2 text-sm text-foreground">
                <span>{balanceError}</span>
                <Button variant="outline" size="touchCompact" className="h-auto whitespace-normal [overflow-wrap:anywhere]" onClick={() => void fetchBalances()} loading={loadingBalances} loadingText="Retrying">
                  Retry balances
                </Button>
              </div>
            )}

            {ordersError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] px-3 py-2 text-sm text-foreground">
                <span>{ordersError}</span>
                <Button variant="outline" size="touchCompact" className="h-auto whitespace-normal [overflow-wrap:anywhere]" onClick={() => void fetchOrders()} loading={ordersLoading} loadingText="Retrying">
                  Retry orders
                </Button>
              </div>
            )}

            {userLandsError && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning)/0.12)] px-3 py-2 text-sm text-foreground">
                <span>{userLandsError}</span>
                <Button
                  variant="outline"
                  size="touchCompact"
                  className="h-auto whitespace-normal [overflow-wrap:anywhere]"
                  onClick={() => setUserLandsRetryRevision((revision) => revision + 1)}
                  loading={userLandsLoading}
                  loadingText="Retrying"
                >
                  Retry land check
                </Button>
              </div>
            )}

            {/* One physical tree keeps transaction state stable across responsive resizes. */}
            <div className="grid grid-cols-1 gap-4 tablet:grid-cols-3 tablet:items-start">
              <details className="order-last space-y-3 tablet:col-span-3">
                <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium">Browse existing offers</summary>
                <p className="text-xs text-muted-foreground">Select a rate to inspect offers, then use Take to trade immediately. Creating a new order waits for another player.</p>
                <div className="grid gap-4 sm:grid-cols-2">
              {/* Asks */}
              <div className={cn(
                marketplacePanelClassName,
                "order-1 overflow-hidden",
                focusedSide === 'asks' && "ring-1 ring-destructive/50",
              )}>
                <div className="max-h-60 overflow-y-auto tablet:min-h-[18rem] tablet:max-h-[22rem]">
                  <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-destructive/10 px-3 py-2 text-sm text-destructive tablet:text-xs">
                    <span>Buy LEAF · most LEAF first</span>
                    <span className="opacity-70">Price • Size</span>
                  </div>
                  {asks.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">—</div>
                  ) : (
                    asks.map((row, idx) => {
                      const isSelected = selectedSide === 'asks' && selectedLevel === row.key;
                      return (
                        <button
                          key={"ask-" + idx}
                          className={cn(
                            "relative flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-[hsl(var(--nav-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background tablet:text-xs",
                            isSelected && "bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-inner",
                          )}
                          onClick={() => {
                            setSellSide('SEED');
                            setPrice(formatMarketplacePriceRatio(row.exactRatio));
                            setExactPriceRatio(row.exactRatio);
                            setFocusedSide('asks');
                            setSelectedLevel(row.key);
                            setSelectedSide('asks');
                          }}
                          aria-label={"Select price " + formatMarketplacePriceRatio(row.exactRatio) + " LEAF per SEED"}
                        >
                          <div className="absolute inset-0 bg-destructive/10" style={{ width: row.depth + "%" }} />
                          <span className={cn("relative min-w-0 break-all pr-2 font-semibold", isSelected ? "text-primary-foreground" : "text-destructive")}>
                            {formatMarketplacePriceRatio(row.exactRatio)}
                          </span>
                          <span className="relative shrink-0">{formatTokenDisplayCompact(row.amount)} LEAF</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Bids */}
              <div className={cn(
                marketplacePanelClassName,
                "order-2 overflow-hidden",
                focusedSide === 'bids' && "ring-1 ring-[hsl(var(--success)/0.5)]",
              )}>
                <div className="max-h-60 overflow-y-auto tablet:min-h-[18rem] tablet:max-h-[22rem]">
                  <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-[hsl(var(--success)/0.12)] px-3 py-2 text-sm text-[hsl(var(--success-strong))] tablet:text-xs">
                    <span>Buy SEED · lowest cost first</span>
                    <span className="opacity-70">Price • Size</span>
                  </div>
                  {bids.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">—</div>
                  ) : (
                    bids.map((row, idx) => {
                      const isSelected = selectedSide === 'bids' && selectedLevel === row.key;
                      return (
                        <button
                          key={"bid-" + idx}
                          className={cn(
                            "relative flex min-h-11 w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-[hsl(var(--nav-hover-bg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background tablet:text-xs",
                            isSelected && "bg-[image:var(--gradient-control-active)] text-primary-foreground shadow-inner",
                          )}
                          onClick={() => {
                            setSellSide('LEAF');
                            setPrice(formatMarketplacePriceRatio(row.exactRatio));
                            setExactPriceRatio(row.exactRatio);
                            setFocusedSide('bids');
                            setSelectedLevel(row.key);
                            setSelectedSide('bids');
                          }}
                          aria-label={"Select price " + formatMarketplacePriceRatio(row.exactRatio) + " LEAF per SEED"}
                        >
                          <div className="absolute inset-0 bg-[hsl(var(--success)/0.12)]" style={{ width: row.depth + "%" }} />
                          <span className={cn("relative min-w-0 break-all pr-2 font-semibold", isSelected ? "text-primary-foreground" : "text-[hsl(var(--success-strong))]")}>
                            {formatMarketplacePriceRatio(row.exactRatio)}
                          </span>
                          <span className="relative shrink-0">{formatTokenDisplayCompact(row.amount)} SEED</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

                </div>
              </details>

              {/* Trade panel */}
              <div className={cn(
                marketplacePaddedPanelClassName,
                "order-first space-y-4 tablet:col-span-3",
              )}>
                <ToggleGroup className="max-w-full flex-wrap" getButtonClassName={() => "whitespace-normal [overflow-wrap:anywhere]"} ariaLabel="Token to sell" value={sellSide} onValueChange={(value) => setSellSide(value as 'LEAF' | 'SEED')}
                  options={[{ value: 'LEAF', label: 'Sell LEAF' }, { value: 'SEED', label: 'Sell SEED' }]} />

                <div className="space-y-4">
                  <AmountField id={amountInputId} label="Amount to sell" unit={sellSide} value={amount}
                    onChange={event => setAmount(event.target.value)} placeholder="0.0" error={amountInputError || undefined}
                    balance={hasBalanceSnapshot
                      ? `${formatTokenDisplay(sellSide === 'LEAF' ? leafBalance : seedBalance)}${balancesCurrent ? '' : ' (last known)'}`
                      : balanceReadState === 'error' ? 'Unavailable' : 'Loading…'} />
                  <AmountField id={priceInputId} label="Price" unit="LEAF per SEED" value={price}
                    onChange={event => { setExactPriceRatio(null); setPrice(event.target.value); }} placeholder="0.0" error={priceInputError || undefined} />
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 flex-1 basis-[7rem] [overflow-wrap:anywhere]">Tip: Tap an order to pre-fill the price.</span>
                  <Button variant="ghost" size="touchCompact" className="max-w-full whitespace-normal [overflow-wrap:anywhere]" onClick={() => setAmount('')}>Clear</Button>
                </div>

                {createOrderCall && (
                  <div className="surface-inset space-y-1 rounded-[var(--radius-control)] p-3 text-sm" aria-label="Order preview">
                    <p>You give <TokenAmount amount={parsedAmount!} unit={sellSide} mode="exact" className="font-bold" /></p>
                    <p>You receive <TokenAmount amount={createOrderCall.args[3] as bigint} unit={sellSide === 'LEAF' ? 'SEED' : 'LEAF'} mode="exact" className="font-bold" /> if this order is filled.</p>
                    <p className="text-xs text-muted-foreground">Creating an order does not guarantee a trade.</p>
                  </div>
                )}

                {needsCreateApproval && (
                  <div className="flex gap-2">
                    {needsSeedApproval && (
                      <GameTransaction
                        effects={{ domains: ["plants", "lands", "balances"] }}
                        intentKey="marketplace:approve-seed"
                        calls={[{
                          address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`,
                          abi: ERC20_APPROVE_ABI,
                          functionName: 'approve',
                          args: [LAND_CONTRACT_ADDRESS, MAX_ALLOWANCE],
                        }]}
                        buttonText="Approve SEED"
                        disabled={!balancesCurrent || !ordersCurrent || !transactionLandId || !isMarketplaceActive || !hasCreateBalance}
                        buttonClassName="h-auto min-h-11 whitespace-normal [overflow-wrap:anywhere] px-4 py-3"
                        hideStatus
                        onSuccess={() => {

                          setSeedAllowance(MAX_ALLOWANCE);
                        }}
                      />
                    )}
                    {needsLeafApproval && (
                      <GameTransaction
                        effects={{ domains: ["plants", "lands", "balances"] }}
                        intentKey="marketplace:approve-leaf"
                        calls={[{
                          address: LEAF_CONTRACT_ADDRESS as `0x${string}`,
                          abi: ERC20_APPROVE_ABI,
                          functionName: 'approve',
                          args: [LAND_CONTRACT_ADDRESS, MAX_ALLOWANCE],
                        }]}
                        buttonText="Approve LEAF"
                        disabled={!balancesCurrent || !ordersCurrent || !transactionLandId || !isMarketplaceActive || !hasCreateBalance}
                        buttonClassName="h-auto min-h-11 whitespace-normal [overflow-wrap:anywhere] px-4 py-3"
                        hideStatus
                        onSuccess={() => {

                          setLeafAllowance(MAX_ALLOWANCE);
                        }}
                      />
                    )}
                  </div>
                )}

                <GameTransaction
                  effects={{ domains: ["plants", "lands", "balances"] }}
                  intentKey="marketplace:create-order"
                  calls={createOrderCall ? [createOrderCall] : []}
                  buttonText="Create Order"
                  buttonClassName="mx-auto h-auto min-h-11 w-full whitespace-normal [overflow-wrap:anywhere] px-5 py-3 text-sm"
                  disabled={
                    loadingBalances
                    || !balancesCurrent
                    || !ordersCurrent
                    || userLandsLoading
                    || Boolean(userLandsError)
                    || !isMarketplaceActive
                    || !createOrderCall
                    || !hasCreateBalance
                    || needsCreateApproval
                  }
                  hideStatus
                  onSuccess={(tx) => {

                    setAmount('');
                    setPrice('');
                    setExactPriceRatio(null);
                    onOrderSuccess(tx);
                  }}
                />
              </div>
            </div>

            {/* Price level details (individual orders with Take buttons) */}
            {selectedLevel !== null && selectedSide && (
              <div className={marketplacePanelClassName}>
                <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <div className="text-sm font-medium">
                    Orders at selected rate • {selectedSide === 'asks' ? 'Buy LEAF' : 'Buy SEED'}
                  </div>
                  <Button variant="ghost" size="touchCompact" className="text-muted-foreground" onClick={() => { setSelectedLevel(null); setSelectedSide(null); }}>Clear</Button>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {(() => {
                    const list = activeOrders.filter(o => {
                      const side = o.sellToken === 1 ? 'asks' : 'bids';
                      const ratio = getMarketplacePriceRatio(o);
                      return side === selectedSide && ratio !== null && getMarketplaceRatioKey(ratio) === selectedLevel;
                    });
                    if (list.length === 0) {
                      return <div className="text-center text-sm text-muted-foreground p-3">No orders at this price.</div>;
                    }
                    return (
                      <div className="divide-y divide-border/55">
                        <MarketplaceOrderList orders={list} pageSize={PRICE_LEVEL_ORDER_LIST_LIMIT}>
                        {(o) => {
                          const payTokenIsLeaf = o.sellToken === 0;
                          const currentAllowance = payTokenIsLeaf ? leafAllowance : seedAllowance;
                          const needsApproval = hasBalanceSnapshot && currentAllowance < o.amountAsk;
                          const isMyOrder = address && o.seller.toLowerCase() === address.toLowerCase();
                          const disabledReason = isMyOrder
                            ? 'Your order'
                            : !transactionLandId
                              ? unavailableLandLabel
                              : !ordersCurrent
                                ? 'Orders unavailable'
                              : !balancesCurrent
                                ? unavailableBalanceLabel
                              : !hasSufficientForOrder(o)
                                ? 'Low balance'
                                : '';

                          return (
                            <div key={String(o.id)} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-xs [content-visibility:auto]">
                              <div className="min-w-0 flex-1 basis-[7rem]"><MarketplaceOrderSummary order={o} /></div>
                              {isMyOrder ? renderCancelOrder(o) : needsApproval ? (
                                <GameTransaction
                                  effects={{ domains: ["plants", "lands", "balances"] }}
                                  intentKey={`marketplace:approve-${payTokenIsLeaf ? 'leaf' : 'seed'}`}
                                  calls={[{
                                    address: (payTokenIsLeaf ? LEAF_CONTRACT_ADDRESS : PIXOTCHI_TOKEN_ADDRESS) as `0x${string}`,
                                    abi: ERC20_APPROVE_ABI,
                                    functionName: 'approve',
                                    args: [LAND_CONTRACT_ADDRESS, MAX_ALLOWANCE]
                                  }]}
                                  buttonText={`Approve ${payTokenIsLeaf ? 'LEAF' : 'SEED'}`}
                                  disabled={!balancesCurrent || !ordersCurrent || !transactionLandId || !hasSufficientForOrder(o)}
                                  buttonClassName="h-11 min-h-11 w-auto min-w-[72px] shrink-0 px-2.5 py-0 text-xs"
                                  hideStatus
                                  onSuccess={() => {

                                    if (payTokenIsLeaf) setLeafAllowance(MAX_ALLOWANCE);
                                    else setSeedAllowance(MAX_ALLOWANCE);
                                  }}
                                />
                              ) : (
                                <GameTransaction
                                  effects={{ domains: ["plants", "lands", "balances"] }}
                                  intentKey={`marketplace:take-order:${transactionLandId}:${o.id}`}
                                  calls={transactionLandId ? [{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi, functionName: 'marketPlaceTakeOrder', args: [transactionLandId, o.id] }] : []}
                                  buttonText={disabledReason || "Take"}
                                  buttonClassName="h-11 min-h-11 w-auto min-w-[56px] shrink-0 px-2.5 py-0 text-xs"
                                  disabled={!ordersCurrent || loadingBalances || !hasSufficientForOrder(o) || !!isMyOrder || !transactionLandId}
                                  hideStatus
                                />
                              )}
                            </div>
                          );
                        }}
                        </MarketplaceOrderList>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* My Orders */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
                <span>Orders</span>
                <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                  {/* The checkbox below was "rounded border-gray-300 text-primary
                      focus:ring-primary". On a native checkbox the border and text colours do
                      nothing, focus:ring-primary has no ring width so it never painted, and
                      border-gray-300 is off-token in all eight themes. Without an explicit
                      size it also drew at the ~13px OS default. accent-primary is the one
                      property that actually tints a native control. */}
                  {showUserOrders && (
                    <label className="flex min-h-11 items-center gap-2 text-xs cursor-pointer select-none mr-2">
                      <input
                        type="checkbox"
                        checked={showHistory}
                        onChange={(e) => setShowHistory(e.target.checked)}
                        className="h-5 w-5 rounded accent-primary"
                      />
                      Show History
                    </label>
                  )}
                  <ToggleGroup ariaLabel="Orders to show" value={showUserOrders ? 'mine' : 'all'} onValueChange={(value) => setShowUserOrders(value === 'mine')}
                    options={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'All' }]} />
                </div>
              </div>
              <div className={cn(marketplacePanelClassName, "max-h-[18rem] overflow-y-auto")}>
                {(() => {
                  const ordersToShow = showUserOrders
                    ? (showHistory ? currentUserOrders : currentUserOrders.filter(o => o.isActive))
                    : activeOrders;
                  const sortedOrders = [...ordersToShow]
                    .sort((a, b) => {
                      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
                      return a.id === b.id ? 0 : a.id > b.id ? -1 : 1;
                    });

                  if (!ordersCurrent && ordersToShow.length === 0 && (ordersLoading || ordersError)) {
                    return (
                      <div role={ordersError ? 'alert' : 'status'} className="px-6 py-8 text-center text-sm text-muted-foreground">
                        {ordersError ? 'Orders are unavailable until the refresh succeeds.' : 'Loading current orders…'}
                      </div>
                    );
                  }

                  if (ordersToShow.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-8 px-6 text-center">
                        <div className="w-12 h-12 mb-3 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-2xl">📋</span>
                        </div>
                        <p className="text-sm font-medium text-foreground mb-1">No Orders</p>
                        <p className="text-xs text-muted-foreground">
                          {showUserOrders ? 'You have no active orders' : 'No orders available'}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <MarketplaceOrderList orders={sortedOrders} pageSize={MARKETPLACE_ORDER_LIST_LIMIT}>
                      {(o) => {
                    // Determine what token the buyer pays (User pays amountAsk)
                    // If sellToken is LEAF(1), buyer pays SEED(0) -> Check SEED Allowance
                    // If sellToken is SEED(0), buyer pays LEAF(1) -> Check LEAF Allowance
                    const payTokenIsLeaf = o.sellToken === 0;
                    const currentAllowance = payTokenIsLeaf ? leafAllowance : seedAllowance;
                    const needsApproval = hasBalanceSnapshot && currentAllowance < o.amountAsk;
                    const isMyOrder = !!address && o.seller.toLowerCase() === address.toLowerCase();
                    const canTakeOrder = ordersCurrent && !loadingBalances && hasSufficientForOrder(o) && isOrderActive(o.id) && !isMyOrder && !!transactionLandId;
                    const disabledReason = isMyOrder
                      ? 'Mine'
                      : !transactionLandId
                        ? unavailableLandLabel
                        : !ordersCurrent
                          ? 'Orders unavailable'
                        : !balancesCurrent
                          ? unavailableBalanceLabel
                        : !hasSufficientForOrder(o)
                          ? 'Low balance'
                          : !isOrderActive(o.id)
                            ? 'Inactive'
                            : '';

                    return (
                      <div key={String(o.id)} className="border-b border-border p-2 last:border-b-0 [content-visibility:auto]">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                          <div className="min-w-0 flex-1 basis-[7rem]"><MarketplaceOrderSummary order={o} /></div>
                          {isMyOrder && o.isActive && renderCancelOrder(o)}
                          {/* Take Order Button (or Approve) */}
                          {!showUserOrders && !isMyOrder && o.isActive && (
                            <>
                              {needsApproval ? (
                                <GameTransaction
                                  effects={{ domains: ["plants", "lands", "balances"] }}
                                  intentKey={`marketplace:approve-${payTokenIsLeaf ? 'leaf' : 'seed'}`}
                                  calls={[{
                                    address: (payTokenIsLeaf ? LEAF_CONTRACT_ADDRESS : PIXOTCHI_TOKEN_ADDRESS) as `0x${string}`,
                                    abi: ERC20_APPROVE_ABI,
                                    functionName: 'approve',
                                    args: [LAND_CONTRACT_ADDRESS, MAX_ALLOWANCE]
                                  }]}
                                  buttonText={`Approve ${payTokenIsLeaf ? 'LEAF' : 'SEED'}`}
                                  disabled={!balancesCurrent || !ordersCurrent || !transactionLandId || !hasSufficientForOrder(o)}
                                  buttonClassName="h-11 min-h-11 w-auto min-w-[72px] shrink-0 px-2.5 py-0 text-xs"
                                  hideStatus
                                  onSuccess={() => {

                                    // Determine which setAllowance to call
                                    if (payTokenIsLeaf) setLeafAllowance(MAX_ALLOWANCE);
                                    else setSeedAllowance(MAX_ALLOWANCE);
                                  }}
                                />
                              ) : (
                                <GameTransaction
                                  effects={{ domains: ["plants", "lands", "balances"] }}
                                  intentKey={`marketplace:take-order:${transactionLandId}:${o.id}`}
                                  calls={transactionLandId ? [{ address: LAND_CONTRACT_ADDRESS as `0x${string}`, abi: landAbi, functionName: 'marketPlaceTakeOrder', args: [transactionLandId, o.id] }] : []}
                                  buttonText={disabledReason || "Take"}
                                  buttonClassName="h-11 min-h-11 w-auto min-w-[56px] shrink-0 px-2.5 py-0 text-xs"
                                  disabled={!canTakeOrder}
                                  hideStatus
                                />
                              )}
                            </>
                          )}
                          {!o.isActive && (
                            <span className="rounded-[var(--radius-control)] border border-border/60 px-2.5 py-2 text-xs font-semibold text-muted-foreground">
                              {disabledReason || 'Unavailable'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  }}
                    </MarketplaceOrderList>
                  );
                })()}
              </div>
            </div>

          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
