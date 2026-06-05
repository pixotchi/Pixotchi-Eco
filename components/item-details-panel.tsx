"use client";

import { SponsoredBadge } from '@/components/paymaster-toggle';
import { SolanaNotSupported,useIsSolanaWallet } from '@/components/solana';
import ApproveTransaction from '@/components/transactions/approve-transaction';
import BundleBuyTransaction from '@/components/transactions/bundle-buy-transaction';
import { BuyGardenItemTransaction,BuyShopItemTransaction } from '@/components/transactions/buy-item-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import SwapBuyItemBundle from '@/components/transactions/swap-buy-item-bundle';
import SwapFencePurchaseBundle from '@/components/transactions/swap-fence-purchase-bundle';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RewardResultPanel } from '@/components/ui/premium';
import { Skeleton } from '@/components/ui/skeleton';
import type { FenceV2Config } from '@/lib/contracts';
import { buildFenceV2PurchaseCall,checkTokenApproval,getEthQuoteForSeedAmount,getFenceV2Config,getTokenBalance,PIXOTCHI_NFT_ADDRESS,quoteFenceV2 } from '@/lib/contracts';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { postMissionProgress } from '@/lib/mission-tracking';
import { usePaymaster } from '@/lib/paymaster-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { formatWsol } from '@/lib/solana-quote';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { GardenItem,Plant,ShopItem } from '@/lib/types';
import { formatDuration,formatTokenAmount,getFriendlyErrorMessage } from '@/lib/utils';
import Image from 'next/image';
import { useEffect,useMemo,useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAccount,useBalance } from 'wagmi';

const parseFenceDaysInput = (value: string): number | null => {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const clampFenceDays = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), max)
);

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
  const [userSeedBalance, setUserSeedBalance] = useState<bigint>(BigInt(0));
  const [, setBalanceLoading] = useState(true);
  const [fenceV2Config, setFenceV2Config] = useState<FenceV2Config | null>(null);
  const [fenceV2Days, setFenceV2Days] = useState<number>(1);
  const [fenceV2DaysInput, setFenceV2DaysInput] = useState("1");
  const [fenceV2Quote, setFenceV2Quote] = useState<bigint>(BigInt(0));
  const [fenceV2QuoteLoading, setFenceV2QuoteLoading] = useState(false);
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));
  const [solanaQuote, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const [purchaseResult, setPurchaseResult] = useState<string | null>(null);

  // ETH Mode state - store per-unit ETH quote, calculate total by multiplication
  const [ethQuotePerUnit, setEthQuotePerUnit] = useState<{ ethAmount: bigint; ethAmountWithBuffer: bigint } | null>(null);
  const [ethQuoteLoading, setEthQuoteLoading] = useState(false);
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
      : isFenceItem
        ? fenceV2Quote > userSeedBalance
        : totalCost > userSeedBalance;

  // Bundle transactions are only available for garden items and Smart Wallets
  const canBundle = itemType === 'garden' && quantity > 1;

  // Fetch user's SEED balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!address) {
        setUserSeedBalance(BigInt(0));
        setBalanceLoading(false);
        return;
      }

      setBalanceLoading(true);
      try {
        const balance = await getTokenBalance(address);
        setUserSeedBalance(balance || BigInt(0));
      } catch (error) {
        console.error("Failed to fetch SEED balance:", error);
        setUserSeedBalance(BigInt(0));
      } finally {
        setBalanceLoading(false);
      }
    };

    fetchBalance();
  }, [address]);

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

  const fenceV2Calls = useMemo(() => {
    if (!selectedPlant || validFenceV2Days === null) return [];
    return [buildFenceV2PurchaseCall(selectedPlant.id, validFenceV2Days)];
  }, [selectedPlant, validFenceV2Days]);

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
      setFenceV2Quote(BigInt(0));
      setFenceV2QuoteLoading(false);
      return;
    }

    let cancelled = false;
    const fetchQuote = async () => {
      setFenceV2QuoteLoading(true);
      try {
        const quote = await quoteFenceV2(validFenceV2Days);
        if (!cancelled) {
          setFenceV2Quote(quote);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to quote Fence:', error);
          setFenceV2Quote(BigInt(0));
        }
      } finally {
        if (!cancelled) {
          setFenceV2QuoteLoading(false);
        }
      }
    };

    fetchQuote();

    return () => {
      cancelled = true;
    };
  }, [isFenceItem, fenceV2Bounds.todCapBreached, validFenceV2Days]);

  // Fetch ETH quote when ETH mode is active - only for per-unit price (fence uses its own quote)
  useEffect(() => {
    // Only fetch for smart wallet users with ETH mode enabled, not Solana
    if (!isSmartWallet || !isEthMode || isSolana) {
      setEthQuotePerUnit(null);
      return;
    }

    // For fence items, use fenceV2Quote; for regular items, use basePrice (per-unit)
    const seedCost = isFenceItem ? fenceV2Quote : basePrice;
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
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="w-12 h-12 mb-4 rounded-full bg-muted flex items-center justify-center">
            <span className="text-2xl">🛍️</span>
          </div>
          <p className="text-base font-semibold text-foreground mb-1">No Item Selected</p>
          <p className="text-sm text-muted-foreground">
            Select an item to see details and purchase options
          </p>
        </CardContent>
      </Card>
    );
  }

  const disabledMessage = (() => {
    if (!hasQuantitySelected && itemType === 'garden') return 'Select quantity above';
    if (isFenceItem && fenceV2Bounds.todCapBreached) return 'Fence duration exceeds plant TOD';
    if (isFenceItem && fenceV2InputInvalid) {
      if (fenceV2DaysInput.trim() === '') return 'Enter fence duration';
      if (fenceV2Bounds.min === fenceV2Bounds.max) return `Use ${fenceV2Bounds.min} day${fenceV2Bounds.min === 1 ? '' : 's'}`;
      return `Use ${fenceV2Bounds.min}-${fenceV2Bounds.max} days`;
    }
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
    if (!selectedItem) return 'Purchase complete.';

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

      if (points > 0 && hours > 0) return `+${points} PTS & +${hours}h TOD`;
      if (points > 0) return `+${points} PTS`;
      if (hours > 0) return `+${hours}h TOD`;
      return 'Item effect';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{headerTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {purchaseResult && (
          <RewardResultPanel title="Purchase complete">
            {purchaseResult}
          </RewardResultPanel>
        )}

        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">
              {isFenceItem
                ? 'Estimated Cost:'
                : quantity > 1 && itemType === 'garden'
                  ? 'Total Cost:'
                  : 'Cost:'}
            </span>
            <div className="font-semibold text-destructive flex items-center gap-2">
              {/* ETH Mode: show ETH price for smart wallet users */}
              {isSmartWallet && isEthMode && !isSolana && ethQuote ? (
                <>
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                  <span>
                    {(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
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
                ) : (
                  `${formatTokenAmount(fenceV2Quote)} SEED`
                )
              ) : itemType === 'shop' ? (
                `${formatTokenAmount(selectedItem.price)} SEED`
              ) : quantity === 0 ? (
                `${formatTokenAmount(selectedItem.price)} SEED each`
              ) : (
                `${formatTokenAmount(totalCost)} SEED`
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
              <span className="text-muted-foreground">Duration (days):</span>
              <div className="flex items-center gap-2">
                <Input
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
                  className="w-20"
                />
                <span className="text-xs text-muted-foreground">
                  {fenceV2Bounds.min === fenceV2Bounds.max
                    ? `${fenceV2Bounds.min} day${fenceV2Bounds.min === 1 ? '' : 's'} required`
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
                toast.success('Purchase submitted via bridge!');
              }}
              onError={(error) => {
                const message = error instanceof Error ? error.message : String(error);
                toast.error(getFriendlyErrorMessage(message));
              }}
            />
          ) : seedAllowance < (isFenceItem ? (fenceV2Quote || BigInt(0)) : totalCost) && !(isSmartWallet && isEthMode && ethQuote) ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground text-center">
                Approve SEED spending once to unlock shop and garden purchases.
              </p>
              <ApproveTransaction
                spenderAddress={PIXOTCHI_NFT_ADDRESS}
                onSuccess={() => {
                  toast.success('SEED approval successful!');
                  // Refresh allowance
                  if (address) {
                    checkTokenApproval(address).then(setSeedAllowance);
                  }
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Approve SEED"
                buttonClassName="w-full"
              />
            </div>
          ) : isSmartWallet && isEthMode && ethQuote && !ethQuoteLoading && selectedPlant && selectedItem ? (
            // ETH Mode purchase - atomic swap + buy transaction
            <div className="flex flex-col space-y-2">
              {isFenceItem ? (
                // Fence purchases use specialized bundle
                <SwapFencePurchaseBundle
                  plantId={selectedPlant.id}
                  days={activeFenceV2Days}
                  ethAmount={ethQuote.ethAmountWithBuffer}
                  minSeedOut={fenceV2Quote}
                  onSuccess={() => {
                    onPurchaseSuccess();
                    toast.success('Fence purchased with ETH!');
                    window.dispatchEvent(new Event('balances:refresh'));
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
                    toast.success('Purchase with ETH successful!');
                    window.dispatchEvent(new Event('balances:refresh'));
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
                <p className="text-xs text-value text-center">
                  Not enough ETH. Balance: {(Number(ethBalance) / 1e18).toFixed(6)} ETH • Required: {(Number(ethQuote.ethAmountWithBuffer) / 1e18).toFixed(6)} ETH
                </p>
              )}
            </div>
          ) : disabledMessage ? (
            <DisabledTransaction
              buttonText={disabledMessage}
              buttonClassName="w-full"
            />
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
                <SponsoredTransaction
                  calls={fenceV2Calls}
                  onSuccess={(tx: UntypedValue) => {
                    onPurchaseSuccess();
                    setPurchaseResult(`${selectedItem.name} applied: ${getItemBenefits()}.`);
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
                  feedbackMode="inline"
                  showToast={false}
                  disabled={selectedPlant.status === 4 || fenceV2QuoteLoading || fenceV2BlockedByV1 || hasInsufficientFunds || fenceV2Bounds.todCapBreached || fenceV2InputInvalid}
                />
              ) : (
                <BuyShopItemTransaction
                  plantId={selectedPlant.id}
                  itemId={selectedItem.id}
                  onSuccess={(tx: UntypedValue) => {
                    onPurchaseSuccess();
                    setPurchaseResult(`${selectedItem.name} applied: ${getItemBenefits()}.`);
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
                  feedbackMode="inline"
                  disabled={selectedPlant.status === 4 || hasInsufficientFunds}
                />
              )
            ) : (
              <BuyGardenItemTransaction
                plantId={selectedPlant.id}
                itemId={selectedItem.id}
                onSuccess={(tx: UntypedValue) => {
                  onPurchaseSuccess();
                  setPurchaseResult(`${selectedItem.name} applied: ${getItemBenefits()}.`);
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
                feedbackMode="inline"
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
            <p className="text-xs text-value text-center mt-2">
              Cannot buy items for dead plants.
            </p>
          )}

          {hasInsufficientFunds && !isEthMode && (
            <p className="text-xs text-value text-center mt-2">
              Not enough SEED. Balance: {formatTokenAmount(userSeedBalance)} SEED • Required: {formatTokenAmount(isFenceItem ? fenceV2Quote : totalCost)} SEED
            </p>
          )}


        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            {itemType === 'shop'
              ? 'Shop items provide ongoing protective effects.'
              : 'Garden items give immediate points and/or TOD.'
            }
          </p>
        </div>
      </CardContent>
    </Card>
  );
} 
