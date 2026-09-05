"use client";

import { SponsoredBadge } from '@/components/paymaster-toggle';
import { SolanaNotSupported,useIsSolanaWallet } from '@/components/solana';
import ApprovalActionTransaction from '@/components/transactions/approval-action-transaction';
import BundleBuyTransaction from '@/components/transactions/bundle-buy-transaction';
import { BuyGardenItemTransaction,BuyShopItemTransaction,getBuyGardenItemCall,getBuyShopItemCall } from '@/components/transactions/buy-item-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import GameTransaction from '@/components/transactions/game-transaction';
import SwapBuyItemBundle from '@/components/transactions/swap-buy-item-bundle';
import SwapFencePurchaseBundle from '@/components/transactions/swap-fence-purchase-bundle';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { Skeleton } from '@/components/ui/skeleton';
import type { FenceV2Config } from '@/lib/contracts';
import { buildFenceV2PurchaseCall,checkTokenApproval,getEthQuoteForSeedAmount,getFenceV2Config,PIXOTCHI_NFT_ADDRESS,quoteFenceV2 } from '@/lib/contracts';
import { useBalances } from '@/lib/balance-context';
import { Button } from '@/components/ui/button';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { postMissionProgress } from '@/lib/mission-tracking';
import { usePaymaster } from '@/lib/paymaster-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { formatWsol } from '@/lib/solana-quote';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { GardenItem,Plant,ShopItem,TransactionCall } from '@/lib/types';
import { formatDuration,getFriendlyErrorMessage } from '@/lib/utils';
import { formatTokenDisplay, formatTokenEstimate } from '@/lib/token-display';
import Image from 'next/image';
import { useEffect,useId,useMemo,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';

const formatExactSeed = (amount: bigint) => formatTokenDisplay(amount, 18, 18);

const parseFenceDaysInput = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const clampFenceDays = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), max)
);

type FenceV2QuoteState =
  | { status: 'loading'; days: number }
  | { status: 'known'; days: number; value: bigint }
  | { status: 'error'; days: number };

interface ItemDetailsPanelProps {
  selectedItem: ShopItem | GardenItem | null;
  selectedPlant: Plant | null;
  itemType: 'shop' | 'garden';
  onPurchaseSuccess: () => void;
  quantity: number;
}

export default function ItemDetailsPanel({
  selectedItem,
  selectedPlant,
  itemType,
  onPurchaseSuccess,
  quantity
}: ItemDetailsPanelProps) {
  const { address } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet, isLoading: smartWalletLoading } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const { isEthMode } = useEthModeSafe();
  const { seedBalance: userSeedBalance, seedBalanceStatus, refreshBalances } = useBalances();
  const seedBalanceReady = seedBalanceStatus === 'ready';
  const [fenceV2Config, setFenceV2Config] = useState<FenceV2Config | null>(null);
  const [fenceV2Days, setFenceV2Days] = useState<number>(1);
  const [fenceV2DaysInput, setFenceV2DaysInput] = useState("1");
  const [fenceV2QuoteState, setFenceV2QuoteState] = useState<FenceV2QuoteState>({ status: 'loading', days: 1 });
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));
  const [solanaQuote, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  // ETH Mode state - store per-unit ETH quote, calculate total by multiplication
  const [ethQuotePerUnit, setEthQuotePerUnit] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [ethQuoteLoading, setEthQuoteLoading] = useState(false);
  const fenceDurationInputId = useId();
  const fenceDurationHelpId = useId();
  const { data: ethBalanceData } = useBalance({ address });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  const fenceItemName = selectedItem?.name?.toLowerCase() || '';
  const isFenceItem = fenceItemName.includes('fence') || fenceItemName.includes('shield');

  // Calculate total cost and effects based on quantity
  const basePrice = BigInt(selectedItem?.price || 0);
  const totalCost = itemType === 'garden'
    ? (quantity > 0 ? basePrice * BigInt(quantity) : BigInt(0))
    : basePrice;
  const hasQuantitySelected = itemType === 'garden' ? quantity > 0 : true;

  // Calculate ETH totals from per-unit quote (no RPC call on quantity change)
  const ethQuote = useMemo(() => {
    if (!ethQuotePerUnit) return null;
    // For fence, quote is already for the total (days-based), for items multiply by quantity
    if (isFenceItem) return ethQuotePerUnit;
    const qty = quantity > 0 ? BigInt(quantity) : BigInt(1);
    return {
      ethAmount: ethQuotePerUnit.ethAmount * qty,
      ethAmountWithBuffer: ethQuotePerUnit.ethAmountWithBuffer * qty,
    };
  }, [ethQuotePerUnit, quantity, isFenceItem]);

  // Check if user has insufficient funds
  // For Solana users, skip this check - they pay with SOL and the quote system handles validation
  // For ETH mode, check ETH balance instead of SEED
  const hasInsufficientFunds = isSolana
    ? false
    : isSmartWallet && isEthMode && ethQuote
      ? ethBalance < ethQuote.ethAmountWithBuffer
      : !seedBalanceReady ? false : isFenceItem
        ? fenceV2QuoteState.status === 'known' && fenceV2QuoteState.value > userSeedBalance
        : totalCost > userSeedBalance;

  // Bundle transactions are only available for garden items and Smart Wallets
  const canBundle = itemType === 'garden' && quantity > 1;

  // Fetch SEED approval for Pixotchi NFT contract
  useEffect(() => {
    let cancelled = false;
    const fetchApproval = async () => {
      if (!address) {
        setSeedAllowance(BigInt(0));
        return;
      }
      try {
        const allowance = await checkTokenApproval(address);
        if (!cancelled) {
          setSeedAllowance(allowance);
        }
      } catch (error) {
        console.error('Failed to fetch SEED approval status:', error);
        if (!cancelled) {
          setSeedAllowance(BigInt(0));
        }
      }
    };
    fetchApproval();
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!isFenceItem) return;
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const config = await getFenceV2Config();
        if (!cancelled && config) {
          setFenceV2Config(config);
        }
      } catch (error) {
        console.error('Failed to load Fence config:', error);
      }
    };

    loadConfig();

    return () => {
      cancelled = true;
    };
  }, [isFenceItem]);

  // Calculate fence-related values (must be before any early returns to comply with Rules of Hooks)
  const currentTimeSec = Math.floor(Date.now() / 1000);
  const fenceV2State = selectedPlant?.fenceV2 ?? null;
  const fenceV2Active = Boolean(fenceV2State?.isActive && fenceV2State.activeUntil > currentTimeSec);
  const fenceV2BlockedByV1 = Boolean(fenceV2State?.v1Active);

  const plantTimeUntilStarving = Number(selectedPlant?.timeUntilStarving || 0);
  const plantSecondsLeft = Math.max(0, plantTimeUntilStarving - currentTimeSec);
  const maxFenceSecondsAllowed = Math.max(0, plantSecondsLeft - 1);
  const plantTodDaysCap = Math.floor(maxFenceSecondsAllowed / (24 * 60 * 60));

  // These useMemo hooks must be called unconditionally (before any early returns)
  const fenceV2Bounds = useMemo(() => {
    const minFromConfig = fenceV2Config ? Math.max(1, fenceV2Config.minDurationDays || 1) : 1;
    const maxFromConfig = fenceV2Config ? fenceV2Config.maxDurationDays || 30 : 30;
    const todLimitedMax = plantTodDaysCap > 0 ? Math.min(maxFromConfig, plantTodDaysCap) : plantTodDaysCap;
    const todCapBreached = todLimitedMax < minFromConfig;
    const max = todCapBreached ? minFromConfig : Math.max(minFromConfig, todLimitedMax);
    return { min: minFromConfig, max, todCapBreached };
  }, [fenceV2Config, plantTodDaysCap]);

  const rawFenceV2Days = useMemo(
    () => parseFenceDaysInput(fenceV2DaysInput),
    [fenceV2DaysInput]
  );

  const validFenceV2Days = useMemo(() => {
    if (rawFenceV2Days === null) return null;
    if (rawFenceV2Days < fenceV2Bounds.min || rawFenceV2Days > fenceV2Bounds.max) return null;
    return rawFenceV2Days;
  }, [rawFenceV2Days, fenceV2Bounds.min, fenceV2Bounds.max]);

  const fenceV2InputInvalid = isFenceItem && !fenceV2Bounds.todCapBreached && validFenceV2Days === null;
  const activeFenceV2Days = validFenceV2Days ?? fenceV2Days;
  const fenceV2Quote = fenceV2QuoteState.status === 'known' && fenceV2QuoteState.days === activeFenceV2Days
    ? fenceV2QuoteState.value
    : null;
  const fenceV2QuoteLoading = fenceV2QuoteState.status === 'loading' && fenceV2QuoteState.days === activeFenceV2Days;
  const fenceV2QuoteReady = !isFenceItem || fenceV2Quote !== null;

  const fenceV2Calls = useMemo(() => {
    if (!selectedPlant || validFenceV2Days === null) return [];
    return [buildFenceV2PurchaseCall(selectedPlant.id, validFenceV2Days)];
  }, [selectedPlant, validFenceV2Days]);

  const purchaseActionCalls = useMemo<TransactionCall[]>(() => {
    if (!selectedPlant || !selectedItem) return [];
    if (isFenceItem) return fenceV2Calls as TransactionCall[];
    if (itemType === 'shop') {
      return [getBuyShopItemCall(selectedPlant.id, selectedItem.id)];
    }

    const count = quantity > 0 ? quantity : 0;
    return Array.from({ length: count }, () => getBuyGardenItemCall(selectedPlant.id, selectedItem.id));
  }, [fenceV2Calls, isFenceItem, itemType, quantity, selectedItem, selectedPlant]);

  const fenceButtonText = fenceV2Active
    ? `Extend Fence (+${activeFenceV2Days} day${activeFenceV2Days === 1 ? '' : 's'})`
    : `Buy Fence (${activeFenceV2Days} day${activeFenceV2Days === 1 ? '' : 's'})`;

  // This useEffect must also be before any early returns
  useEffect(() => {
    if (!isFenceItem) return;
    if (fenceV2Bounds.todCapBreached) return;
    if (fenceV2Days > fenceV2Bounds.max) {
      setFenceV2Days(fenceV2Bounds.max);
      setFenceV2DaysInput(fenceV2Bounds.max.toString());
    } else if (fenceV2Days < fenceV2Bounds.min) {
      setFenceV2Days(fenceV2Bounds.min);
      setFenceV2DaysInput(fenceV2Bounds.min.toString());
    }
  }, [isFenceItem, fenceV2Bounds, fenceV2Days]);

  useEffect(() => {
    if (!isFenceItem || validFenceV2Days === null || validFenceV2Days === fenceV2Days) return;
    setFenceV2Days(validFenceV2Days);
  }, [isFenceItem, validFenceV2Days, fenceV2Days]);

  useEffect(() => {
    if (!isFenceItem || fenceV2Bounds.todCapBreached || validFenceV2Days === null) {
      setFenceV2QuoteState({ status: 'error', days: activeFenceV2Days });
      return;
    }

    let cancelled = false;
    const fetchQuote = async () => {
      setFenceV2QuoteState({ status: 'loading', days: validFenceV2Days });
      try {
        const quote = await quoteFenceV2(validFenceV2Days);
        if (!cancelled) {
          setFenceV2QuoteState(
            quote > BigInt(0)
              ? { status: 'known', days: validFenceV2Days, value: quote }
              : { status: 'error', days: validFenceV2Days },
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to quote Fence:', error);
          setFenceV2QuoteState({ status: 'error', days: validFenceV2Days });
        }
      }
    };

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [activeFenceV2Days, isFenceItem, fenceV2Bounds.todCapBreached, validFenceV2Days]);

  // Fetch ETH quote when ETH mode is active - only for per-unit price (fence uses its own quote)
  useEffect(() => {
    // Only fetch for smart wallet users with ETH mode enabled, not Solana
    if (!isSmartWallet || !isEthMode || isSolana) {
      setEthQuotePerUnit(null);
      return;
    }

    // For fence items, use fenceV2Quote; for regular items, use basePrice (per-unit)
    const seedCost = isFenceItem ? (fenceV2Quote ?? BigInt(0)) : basePrice;
    if (seedCost <= BigInt(0)) {
      setEthQuotePerUnit(null);
      return;
    }

    let cancelled = false;

    const fetchEthQuote = async () => {
      setEthQuoteLoading(true);
      try {
        const quote = await getEthQuoteForSeedAmount(seedCost);

        if (!cancelled) {
          if (quote.error || quote.ethAmountWithBuffer <= BigInt(0)) {
            setEthQuotePerUnit(null);
          } else {
            setEthQuotePerUnit({
              ethAmount: quote.ethAmount,
              ethAmountWithBuffer: quote.ethAmountWithBuffer,
            });
          }
        }
      } catch (err) {
        console.error('[ItemDetailsPanel] ETH quote fetch failed:', err);
        if (!cancelled) {
          setEthQuotePerUnit(null);
        }
      } finally {
        if (!cancelled) {
          setEthQuoteLoading(false);
        }
      }
    };

    // Debounce the quote fetch
    const timeoutId = setTimeout(fetchEthQuote, 500);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isSmartWallet, isEthMode, isSolana, isFenceItem, fenceV2Quote, basePrice]);

  const commitFenceV2DaysInput = () => {
    if (fenceV2Bounds.todCapBreached) return;
    const nextDays = rawFenceV2Days === null
      ? fenceV2Days
      : clampFenceDays(rawFenceV2Days, fenceV2Bounds.min, fenceV2Bounds.max);
    setFenceV2Days(nextDays);
    setFenceV2DaysInput(nextDays.toString());
  };

  // Early return AFTER all hooks have been called
  if (!selectedItem || !selectedPlant) {
    return (
      <p className="py-2 text-sm leading-relaxed text-muted-foreground">Choose a care item below to review its effect, cost and purchase options.</p>
    );
  }

  const disabledMessage = (() => {
    if (!hasQuantitySelected && itemType === 'garden') return 'Select quantity above';
    if (isFenceItem && fenceV2Bounds.todCapBreached) return 'Fence duration exceeds plant lifetime';
    if (isFenceItem && fenceV2InputInvalid) {
      if (fenceV2DaysInput.trim() === '') return 'Enter fence duration';
      if (fenceV2Bounds.min === fenceV2Bounds.max) return `Use ${fenceV2Bounds.min} day${fenceV2Bounds.min === 1 ? '' : 's'}`;
      return `Use ${fenceV2Bounds.min}-${fenceV2Bounds.max} days`;
    }
    if (isFenceItem && fenceV2QuoteLoading) return 'Loading Fence quote…';
    if (isFenceItem && !fenceV2QuoteReady) return 'Fence quote unavailable. Retry to continue.';
    if (isFenceItem && fenceV2BlockedByV1) return 'Existing fence active. Wait for expiry.';
    if (hasInsufficientFunds) return 'Insufficient SEED Balance';
    if (canBundle && itemType === 'garden' && !isSmartWallet) {
      return smartWalletLoading ? 'Detecting Wallet Type...' : 'Bundle Transactions Require Smart Wallet';
    }
    return null;
  })();

  const headerTitle = isFenceItem
    ? `Fence (${activeFenceV2Days} day${activeFenceV2Days === 1 ? '' : 's'})`
    : itemType === 'shop'
      ? `Use 1 ${selectedItem.name}`
      : quantity === 0
        ? `${selectedItem.name}`
        : quantity === 1
          ? `Use 1 ${selectedItem.name}`
          : `Use ${quantity} ${selectedItem.name}s`;

  // Debug logging for bundle conditions
  // console.log('🔍 Bundle Debug Info:', {
  //   itemType,
  //   quantity,
  //   canBundle,
  //   isSmartWallet,
  //   hasQuantitySelected,
  //   preventPurchase,
  //   selectedPlant: !!selectedPlant,
  //   selectedItem: !!selectedItem,
  //   isSponsored,
  //   bundleCondition: canBundle && isSmartWallet && selectedPlant && selectedItem
  // });

  const getItemBenefits = () => {
    if (!selectedItem) return 'Item effect';

    if (isFenceItem) {
      return `${activeFenceV2Days} day${activeFenceV2Days === 1 ? '' : 's'} protection`;
    }

    if (quantity === 0 && itemType === 'garden') return 'Select quantity above';

    if (itemType === 'shop') {
      const shopItem = selectedItem as ShopItem;
      return `${formatDuration(shopItem.effectTime)} protection`;
    } else {
      const gardenItem = selectedItem as GardenItem;
      const points = Number(gardenItem.points) / 1e12 * quantity;
      const hours = Math.floor(Number(gardenItem.timeExtension) / 3600) * quantity;

      if (points > 0 && hours > 0) return `+${points} PTS & +${hours}h lifetime`;
      if (points > 0) return `+${points} PTS`;
      if (hours > 0) return `+${hours}h lifetime`;
      return 'Item effect';
    }
  };

  const requiredSeedAllowance = isFenceItem ? (fenceV2Quote ?? BigInt(0)) : totalCost;
  const needsSeedApproval =
    !isSolana
    && seedAllowance < requiredSeedAllowance
    && !(isSmartWallet && isEthMode && ethQuote);
  const approvalActionButtonText = isFenceItem
    ? 'Approve + Buy Fence'
    : itemType === 'garden' && quantity > 1
      ? `Approve + Buy ${quantity}x`
      : 'Approve + Buy Item';
  const purchaseActionButtonText = isFenceItem
    ? fenceButtonText
    : itemType === 'garden' && quantity > 1
      ? `Buy ${quantity}x ${selectedItem.name}`
      : 'Buy Item';

  const handlePurchaseSuccess = (tx: UntypedValue) => {
    onPurchaseSuccess();

    try {
      if (itemType === 'shop') {
        const payload: Record<string, UntypedValue> = { address, taskId: 's4_buy_shield' };
        const txHash = extractTransactionHash(tx);
        if (txHash) {
          payload.proof = { txHash };
        }
        void postMissionProgress(payload);
      } else if (itemType === 'garden') {
        const post = async (currentTx: UntypedValue, attempt = 0) => {
          try {
            const payload: Record<string, UntypedValue> = {
              address,
              taskId: 's4_buy10_elements',
              count: quantity,
            };
            const txHash = extractTransactionHash(currentTx);
            if (txHash) {
              payload.proof = { txHash };
            }
            const res = await postMissionProgress(payload);
            if (!res.ok) throw new Error('missions post failed');
          } catch {
            if (attempt < 2) {
              const delay = 400 * Math.pow(2, attempt);
              setTimeout(() => post(currentTx, attempt + 1), delay);
            }
          }
        };
        void post(tx);
      }
    } catch { }
  };

  return (
    <Card className="bg-muted/30">
      <CardHeader>
        <CardTitle>{headerTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 text-sm">
            <span className="text-muted-foreground">
              {isFenceItem
                ? 'Estimated Cost:'
                : quantity > 1 && itemType === 'garden'
                  ? 'Total Cost:'
                  : 'Cost:'}
            </span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-right font-semibold tabular-nums [overflow-wrap:anywhere]">
              {/* ETH Mode: show ETH price for smart wallet users */}
              {isSmartWallet && isEthMode && !isSolana && ethQuote ? (
                <>
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                  <span>
                    {formatTokenEstimate(ethQuote.ethAmountWithBuffer)} ETH
                    {itemType === 'garden' && quantity === 0 ? ' each' : ''}
                  </span>
                </>
              ) : isSmartWallet && isEthMode && !isSolana && ethQuoteLoading ? (
                <>
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                  <Skeleton className="h-4 w-20" />
                </>
              ) : isSolana ? (
                solanaQuote ? (
                  solanaQuote.error ? (
                    <span className="text-amber-500">Quote error</span>
                  ) : (
                    `${formatWsol(solanaQuote.wsolAmount)} SOL`
                  )
                ) : (
                  <Skeleton className="h-4 w-24" />
                )
              ) : isFenceItem ? (
                fenceV2QuoteLoading ? (
                  <Skeleton className="h-4 w-20" />
                ) : fenceV2Quote === null ? (
                  <span className="text-muted-foreground" title="Fence quote unavailable">—</span>
                ) : (
                  `${formatExactSeed(fenceV2Quote)} SEED`
                )
              ) : itemType === 'shop' ? (
                `${formatExactSeed(selectedItem.price)} SEED`
              ) : quantity === 0 ? (
                `${formatExactSeed(selectedItem.price)} SEED each`
              ) : (
                `${formatExactSeed(totalCost)} SEED`
              )}
            </div>
          </div>

          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Effect:</span>
            <span className="font-semibold text-primary">
              {getItemBenefits()}
            </span>
          </div>

          {isFenceItem && (
            <div className="flex justify-between items-center text-sm">
              <label htmlFor={fenceDurationInputId} className="text-muted-foreground">Duration (days):</label>
              <div className="flex items-center gap-2">
                <Input
                  id={fenceDurationInputId}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={fenceV2DaysInput}
                  onChange={(event) => {
                    const value = event.target.value.trim();
                    if (value === '' || /^\d+$/.test(value)) {
                      setFenceV2DaysInput(value);
                    }
                  }}
                  onBlur={commitFenceV2DaysInput}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      commitFenceV2DaysInput();
                      event.currentTarget.blur();
                    }
                  }}
                  aria-invalid={fenceV2InputInvalid}
                  aria-describedby={fenceDurationHelpId}
                  className="w-20"
                />
                <span id={fenceDurationHelpId} className="text-xs text-muted-foreground">
                  {fenceV2Bounds.min === fenceV2Bounds.max
                    ? `${fenceV2Bounds.min}d${fenceV2Bounds.min === 1 ? '' : 's'} minimum`
                    : `${fenceV2Bounds.min}-${fenceV2Bounds.max} days`}
                </span>
              </div>
            </div>
          )}

          {isFenceItem && fenceV2Active && fenceV2State && (
            <p className="text-xs text-muted-foreground">
              Fence active until {new Date(fenceV2State.activeUntil * 1000).toLocaleString()}.
            </p>
          )}

          {isFenceItem && fenceV2BlockedByV1 && (
            <p className="text-xs text-muted-foreground">
              Existing fence is still active. Please wait for it to expire before purchasing again.
            </p>
          )}

          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">For Plant:</span>
            <span className="font-pixel">
              {selectedPlant.name || `#${selectedPlant.id}`}
            </span>
          </div>
        </div>

        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {isFenceItem
                ? 'Purchase Fence'
                : itemType === 'shop'
                  ? 'Purchase Item'
                  : quantity === 0
                    ? 'Select quantity above'
                    : quantity === 1
                      ? 'Purchase Item'
                      : canBundle && isSmartWallet
                        ? `Purchase ${quantity} Items (Bundle)`
                        : canBundle && !isSmartWallet
                          ? `Purchase ${quantity} Items (Smart Wallet Required)`
                          : `Purchase ${quantity} Items`}
            </span>
            <SponsoredBadge show={isSponsored && isSmartWallet} />
          </div>

          {/* Solana users: Gate fence items and bundle transactions */}
          {isSolana && isFenceItem ? (
            <SolanaNotSupported feature="Fence protection" />
          ) : isSolana && canBundle && quantity > 1 ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Solana bridge supports one item at a time. Select quantity of 1.
              </p>
              <DisabledTransaction
                buttonText="Bundle Not Available via Bridge"
                buttonClassName="w-full"
              />
            </div>
          ) : isSolana ? (
            // Solana bridge transaction for shop/garden items
            <SolanaBridgeButton
              actionType={itemType === 'shop' ? 'shopItem' : 'gardenItem'}
              plantId={selectedPlant?.id}
              itemId={selectedItem?.id}
              buttonText="Buy Item via Bridge"
              buttonClassName="w-full"
              onQuote={setSolanaQuote}
              disabled={!selectedPlant || !selectedItem || selectedPlant.status === 4 || (itemType === 'garden' && !hasQuantitySelected)}
              onSuccess={() => {
                onPurchaseSuccess();

              }}
              onError={(error) => {
                const message = error instanceof Error ? error.message : String(error);
                toast.error(getFriendlyErrorMessage(message));
              }}
            />
          ) : isSmartWallet && isEthMode && ethQuote && !ethQuoteLoading && fenceV2QuoteReady && selectedPlant && selectedItem ? (
            // ETH Mode purchase - atomic swap + buy transaction
            <div className="flex flex-col space-y-2">
              {isFenceItem ? (
                // Fence purchases use specialized bundle
                <SwapFencePurchaseBundle
                  plantId={selectedPlant.id}
                  days={activeFenceV2Days}
                  ethAmount={ethQuote.ethAmountWithBuffer}
                  minSeedOut={fenceV2Quote ?? BigInt(0)}
                  onSuccess={() => {
                    onPurchaseSuccess();

                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={
                    ethBalance < ethQuote.ethAmountWithBuffer
                      ? "Insufficient ETH Balance"
                      : `Buy ${activeFenceV2Days} Day${activeFenceV2Days === 1 ? '' : 's'} Fence with ETH`
                  }
                  buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
                  disabled={selectedPlant.status === 4 || ethBalance < ethQuote.ethAmountWithBuffer || fenceV2Bounds.todCapBreached || fenceV2BlockedByV1 || fenceV2InputInvalid}
                />
              ) : (
                // Regular item purchases
                <SwapBuyItemBundle
                  item={selectedItem}
                  plant={selectedPlant}
                  itemType={itemType}
                  quantity={itemType === 'garden' ? quantity : 1}
                  ethAmount={ethQuote.ethAmountWithBuffer}
                  minSeedOut={totalCost}
                  onSuccess={() => {
                    onPurchaseSuccess();

                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={
                    ethBalance < ethQuote.ethAmountWithBuffer
                      ? "Insufficient ETH Balance"
                      : quantity > 1
                        ? `Buy ${quantity}x with ETH`
                        : `Buy with ETH`
                  }
                  buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
                  disabled={selectedPlant.status === 4 || ethBalance < ethQuote.ethAmountWithBuffer || (!hasQuantitySelected && itemType === 'garden')}
                />
              )}
              {ethBalance < ethQuote.ethAmountWithBuffer && (
                <InlineBalanceNotice className="mt-0">
                  Not enough ETH. Balance: {formatTokenDisplay(ethBalance, 18, 18)} • Required: {formatTokenDisplay(ethQuote.ethAmountWithBuffer, 18, 18)}
                </InlineBalanceNotice>
              )}
            </div>
          ) : !seedBalanceReady ? (
            <div className="space-y-2">
              <DisabledTransaction
                buttonText={seedBalanceStatus === 'unknown' ? 'Checking SEED balance' : 'SEED balance unavailable'}
                buttonClassName="w-full"
              />
              {seedBalanceStatus === 'error' && (
                <>
                  <p role="status" className="text-center text-xs text-muted-foreground">We could not refresh your SEED balance. Retry to check what you can spend.</p>
                  <Button type="button" variant="outline" className="w-full" onClick={() => void refreshBalances()}>Retry balance check</Button>
                </>
              )}
            </div>
          ) : disabledMessage ? (
            <DisabledTransaction
              buttonText={disabledMessage}
              buttonClassName="w-full"
            />
          ) : needsSeedApproval ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Approve SEED spending once to unlock shop and garden purchases.
              </p>
              <ApprovalActionTransaction
                intentKey={isFenceItem
                  ? `fence:purchase:${selectedPlant.id}`
                  : `purchase:${itemType}:${selectedPlant.id}`}
                actionCalls={purchaseActionCalls}
                approvalSpender={PIXOTCHI_NFT_ADDRESS}
                needsApproval={needsSeedApproval}
                onApprovalSuccess={() => {

                  if (address) {
                    checkTokenApproval(address).then(setSeedAllowance);
                  }
                }}
                onSuccess={(tx) => {

                  if (address) {
                    checkTokenApproval(address).then(setSeedAllowance);
                  }
                  handlePurchaseSuccess(tx);
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                batchButtonText={approvalActionButtonText}
                approvalButtonText="Approve SEED"
                actionButtonText={purchaseActionButtonText}
                buttonClassName="w-full"
                disabled={
                  selectedPlant.status === 4
                  || fenceV2QuoteLoading
                  || !fenceV2QuoteReady
                  || fenceV2BlockedByV1
                  || fenceV2Bounds.todCapBreached
                  || fenceV2InputInvalid
                  || purchaseActionCalls.length === 0
                }
                resetKey={`${itemType}-${selectedPlant.id}-${selectedItem.id}-${quantity}-${activeFenceV2Days}`}
              />
            </div>
          ) : canBundle && isSmartWallet && selectedPlant && selectedItem ? (
            // Bundle Purchase for multiple garden items (Smart Wallet only)
            <BundleBuyTransaction
              item={selectedItem}
              plant={selectedPlant}
              itemType={itemType}
              quantity={quantity}
              onSuccess={() => {
                onPurchaseSuccess();
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
              disabled={selectedPlant.status === 4 || hasInsufficientFunds}
            />
          ) : selectedPlant && selectedItem ? (
            // Single Purchase for 1 item (both sponsored and regular)
            itemType === 'shop' ? (
              isFenceItem ? (
                <GameTransaction
                  effects={{ domains: ["plants", "balances"] }}
                  intentKey={`fence:purchase:${selectedPlant.id}`}
                  calls={fenceV2Calls}
                  onSuccess={(tx: UntypedValue) => {
                    onPurchaseSuccess();
                    try {
                      const payload: Record<string, UntypedValue> = { address, taskId: 's4_buy_shield' };
                      const txHash = extractTransactionHash(tx);
                      if (txHash) {
                        payload.proof = { txHash };
                      }
                      postMissionProgress(payload);
                    } catch { }
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={fenceButtonText}
                  buttonClassName="w-full"
                  disabled={selectedPlant.status === 4 || fenceV2QuoteLoading || !fenceV2QuoteReady || fenceV2BlockedByV1 || hasInsufficientFunds || fenceV2Bounds.todCapBreached || fenceV2InputInvalid}
                />
              ) : (
                <BuyShopItemTransaction
                  plantId={selectedPlant.id}
                  itemId={selectedItem.id}
                  onSuccess={(tx: UntypedValue) => {
                    onPurchaseSuccess();
                    try {
                      const payload: Record<string, UntypedValue> = { address, taskId: 's4_buy_shield' };
                      const txHash = extractTransactionHash(tx);
                      if (txHash) {
                        payload.proof = { txHash };
                      }
                      postMissionProgress(payload);
                    } catch { }
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText="Buy Item"
                  buttonClassName="w-full"
                  disabled={selectedPlant.status === 4 || hasInsufficientFunds}
                />
              )
            ) : (
              <BuyGardenItemTransaction
                plantId={selectedPlant.id}
                itemId={selectedItem.id}
                onSuccess={(tx: UntypedValue) => {
                  onPurchaseSuccess();
                  try {
                    const post = async (currentTx: UntypedValue, attempt = 0) => {
                      try {
                        const payload: Record<string, UntypedValue> = { address, taskId: 's4_buy10_elements' };
                        const txHash = extractTransactionHash(currentTx);
                        if (txHash) {
                          payload.proof = { txHash };
                        }
                        const res = await postMissionProgress(payload);
                        if (!res.ok) throw new Error('missions post failed');
                      } catch {
                        if (attempt < 2) {
                          const delay = 400 * Math.pow(2, attempt);
                          setTimeout(() => post(currentTx, attempt + 1), delay);
                        }
                      }
                    };
                    post(tx);
                  } catch { }
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Buy Item"
                buttonClassName="w-full"
                disabled={selectedPlant.status === 4 || hasInsufficientFunds}
              />
            )
          ) : (
            <DisabledTransaction
              buttonText="Manual purchase not available"
              buttonClassName="w-full"
            />
          )}

          {selectedPlant.status === 4 && (
            <InlineBalanceNotice>
              Cannot buy items for dead plants.
            </InlineBalanceNotice>
          )}

          {hasInsufficientFunds && !isEthMode && (
            <InlineBalanceNotice>
              Not enough SEED. Balance: {formatExactSeed(userSeedBalance)} • Required: {formatExactSeed(isFenceItem ? (fenceV2Quote ?? BigInt(0)) : totalCost)}
            </InlineBalanceNotice>
          )}


        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            {isFenceItem
              ? 'Fence protection keeps your PTS safe from attacks while it is active.'
              : itemType === 'shop'
                ? 'Protection items provide ongoing defensive effects.'
                : 'Care items add points, lifetime, or both immediately.'
            }
          </p>
        </div>
      </CardContent>
    </Card>
  );
} 
