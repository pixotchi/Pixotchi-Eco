"use client";
import { getBalanceShortfallMessage } from '@/lib/balance-shortfall';
import { microSound } from '@/lib/sensory-feedback';

import { SolanaNotSupported,useIsSolanaWallet } from '@/components/solana';
import ApprovalActionTransaction from '@/components/transactions/approval-action-transaction';
import { getBuyGardenItemCall,getBuyShopItemCall } from '@/components/transactions/buy-item-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import SolanaBridgeButton from '@/components/transactions/solana-bridge-button';
import SwapBuyItemBundle from '@/components/transactions/swap-buy-item-bundle';
import SwapFencePurchaseBundle from '@/components/transactions/swap-fence-purchase-bundle';
import { carePurchaseLabel } from '@/lib/care-copy';
import { Card,CardContent,CardHeader,CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { InlineBalanceNotice } from '@/components/ui/premium';
import { Skeleton } from '@/components/ui/skeleton';
import { ResourceValue } from '@/components/ui/resource-value';
import { TokenAmount } from '@/components/ui/token-amount';
import { getCareCapabilities, type CareResourceStatus } from '@/lib/care-catalog';
import { useQuery } from '@tanstack/react-query';
import { buildFenceV2PurchaseCall,checkTokenApproval,getFenceV2Config,PIXOTCHI_NFT_ADDRESS,quoteFenceV2 } from '@/lib/contracts';
import { useSeedPurchaseQuote } from '@/hooks/useSeedPurchaseQuote';
import { useBalances } from '@/lib/balance-context';
import { Button } from '@/components/ui/button';
import QuantitySelector from '@/components/quantity-selector';
import { useEthModeSafe } from '@/lib/eth-mode-context';
import { postMissionProgress } from '@/lib/mission-tracking';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { formatWsol } from '@/lib/solana-quote';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { GardenItem,Plant,ShopItem,TransactionCall } from '@/lib/types';
import { formatDuration,formatNumber,getFriendlyErrorMessage } from '@/lib/utils';
import { formatTokenEstimate } from '@/lib/token-display';
import { useEffect,useId,useMemo,useState } from 'react';
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
  onQuantityChange?: (quantity: number) => void;
  embedded?: boolean;
  catalogStatus?: CareResourceStatus;
  catalogChanged?: boolean;
  onRetryCatalog?: () => void;
  onReviewCatalog?: () => void;
  onBeforePurchase?: () => Promise<void>;
}

export default function ItemDetailsPanel({
  selectedItem,
  selectedPlant,
  itemType,
  onPurchaseSuccess,
  quantity,
  onQuantityChange,
  embedded = false,
  catalogStatus = 'ready',
  catalogChanged = false,
  onRetryCatalog,
  onReviewCatalog,
  onBeforePurchase,
}: ItemDetailsPanelProps) {
  const { address } = useAccount();
  const { isSmartWallet, isLoading: smartWalletLoading } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const { isEthMode } = useEthModeSafe();
  const { seedBalance: userSeedBalance, seedBalanceStatus, refreshBalances } = useBalances();
  const seedBalanceReady = seedBalanceStatus === 'ready';
  const [fenceV2Days, setFenceV2Days] = useState<number>(1);
  const [fenceV2DaysInput, setFenceV2DaysInput] = useState("1");
  const [quantityValid, setQuantityValid] = useState(true);
  useEffect(() => { setQuantityValid(true); }, [itemType, selectedItem?.id]);
  const [solanaQuote, setSolanaQuote] = useState<{ wsolAmount: bigint; error?: string } | null>(null);
  const fenceDurationInputId = useId();
  const fenceDurationHelpId = useId();
  const { data: ethBalanceData } = useBalance({ address });
  const ethBalance = ethBalanceData?.value ?? BigInt(0);

  const isFenceItem = selectedItem !== null && getCareCapabilities(selectedItem, itemType).purchase === 'fence-v2';

  // Calculate total cost and effects based on quantity
  const basePrice = BigInt(selectedItem?.price || 0);
  const totalCost = itemType === 'garden'
    ? (quantity > 0 ? basePrice * BigInt(quantity) : BigInt(0))
    : basePrice;
  const hasQuantitySelected = itemType === 'garden' ? quantity > 0 : true;

  // Bundle transactions are only available for garden items and Smart Wallets
  const canBundle = itemType === 'garden' && quantity > 1;

  const allowanceQuery = useQuery({ queryKey: ['care-allowance', address?.toLowerCase()],
    enabled: Boolean(address) && !isSolana, retry: false,
    queryFn: () => address ? checkTokenApproval(address) : Promise.reject(new Error('Connect a wallet')) });
  const seedAllowance = allowanceQuery.data ?? BigInt(0);
  const allowanceReady = !allowanceQuery.isError && allowanceQuery.data !== undefined;
  const configQuery = useQuery({ queryKey: ['care-fence-config'], enabled: isFenceItem, retry: false, staleTime: 60_000,
    queryFn: async () => {
      const config = await getFenceV2Config();
      if (!config || !Number.isSafeInteger(config.minDurationDays) || !Number.isSafeInteger(config.maxDurationDays)
        || config.minDurationDays < 1 || config.maxDurationDays < config.minDurationDays) throw new Error('Fence duration rules unavailable');
      return config;
    } });
  const fenceV2Config = configQuery.data;
  const fenceConfigReady = !configQuery.isError && fenceV2Config !== undefined;

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
  const canQuoteFence = isFenceItem && fenceConfigReady && !fenceV2Bounds.todCapBreached && validFenceV2Days !== null;
  const fenceQuoteQuery = useQuery({ queryKey: ['care-fence-quote', selectedPlant?.id, validFenceV2Days, fenceV2Config?.minDurationDays, fenceV2Config?.maxDurationDays, String(fenceV2Config?.pricePerDay ?? '')],
    enabled: canQuoteFence, retry: false, staleTime: 30_000,
    queryFn: async () => {
      const quote = await quoteFenceV2(validFenceV2Days!);
      if (quote <= BigInt(0)) throw new Error('Fence quote unavailable');
      return quote;
    } });
  const fenceV2Quote = canQuoteFence && !fenceQuoteQuery.isError ? fenceQuoteQuery.data ?? null : null;
  const fenceV2QuoteLoading = canQuoteFence && fenceQuoteQuery.isPending;
  const fenceV2QuoteReady = !isFenceItem || fenceV2Quote !== null;

  const usesEthPayment = isSmartWallet && isEthMode && !isSolana;
  const quoteSeedCost = isFenceItem ? (fenceV2Quote ?? BigInt(0)) : totalCost;
  const { quote: ethQuote, isLoading: ethQuoteLoading, error: ethQuoteError, retry: retryEthQuote, requireCurrentQuote } = useSeedPurchaseQuote(quoteSeedCost, usesEthPayment, undefined,
    `care:${address?.toLowerCase()}:${selectedPlant?.id}:${itemType}:${selectedItem?.id}:${quantity}:${activeFenceV2Days}`);

  const ethAmount = ethQuote?.ethAmountWithBuffer ?? BigInt(0);

  // Solana quotes validate SOL funds. ETH mode must never fall back to SEED.
  const hasInsufficientFunds = isSolana
    ? false
    : usesEthPayment
      ? ethQuote !== null && ethBalance < ethAmount
      : seedBalanceReady && quoteSeedCost > userSeedBalance;

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
      <div className="space-y-2 py-2 text-sm leading-relaxed text-muted-foreground"><p>This item is no longer available in the current catalog. Choose another item or retry.</p>
        {onRetryCatalog && <Button variant="outline" onClick={onRetryCatalog}>Retry catalog</Button>}</div>
    );
  }

  const disabledMessage = (() => {
    if (!quantityValid) return 'Enter a valid quantity';
    if (catalogStatus !== 'ready') return catalogStatus === 'loading' ? 'Loading item catalog…' : 'Item catalog unavailable';
    if (catalogChanged) return 'Review updated price and effects';
    if (!hasQuantitySelected && itemType === 'garden') return 'Choose quantity';
    if (isFenceItem && !fenceConfigReady) return configQuery.isError ? 'Fence duration rules unavailable' : 'Loading fence duration rules…';
    if (isFenceItem && fenceV2Bounds.todCapBreached) return 'Fence duration exceeds plant lifetime';
    if (isFenceItem && fenceV2InputInvalid) {
      if (fenceV2DaysInput.trim() === '') return 'Enter fence duration';
      if (fenceV2Bounds.min === fenceV2Bounds.max) return `Use ${fenceV2Bounds.min} day${fenceV2Bounds.min === 1 ? '' : 's'}`;
      return `Use ${fenceV2Bounds.min}-${fenceV2Bounds.max} days`;
    }
    if (isFenceItem && fenceV2QuoteLoading) return 'Loading Fence quote…';
    if (isFenceItem && !fenceV2QuoteReady) return 'Fence quote unavailable. Retry to continue.';
    if (isFenceItem && fenceV2BlockedByV1) return 'Existing fence active. Wait for expiry.';
    if (hasInsufficientFunds) return usesEthPayment ? 'Insufficient ETH Balance' : 'Insufficient SEED Balance';
    if (canBundle && itemType === 'garden' && !isSmartWallet) {
      return smartWalletLoading ? 'Detecting Wallet Type...' : 'Bundle Transactions Require Smart Wallet';
    }
    return null;
  })();

  const requireCurrentPurchase = async () => {
    if (disabledMessage || selectedPlant.status === 4) throw new Error(disabledMessage || 'This plant needs revival.');
    await onBeforePurchase?.();
    if (isFenceItem) {
      const [config, quote] = await Promise.all([configQuery.refetch(), fenceQuoteQuery.refetch()]);
      if (config.isError || quote.isError || !config.data || quote.data === undefined) throw new Error('Fence price and duration could not be verified. Retry before buying.');
      if (config.data.minDurationDays !== fenceV2Config?.minDurationDays || config.data.maxDurationDays !== fenceV2Config?.maxDurationDays
        || config.data.pricePerDay !== fenceV2Config?.pricePerDay || quote.data !== fenceV2Quote) {
        throw new Error('Fence price or duration changed. Review the updated purchase before buying.');
      }
    }
    if (usesEthPayment) await requireCurrentQuote();
  };

  const itemPurchaseLabel = carePurchaseLabel(selectedItem.name, itemType === 'garden' ? quantity : 1);
  const headerTitle = isFenceItem
    ? `Fence (${activeFenceV2Days} day${activeFenceV2Days === 1 ? '' : 's'})`
    : itemPurchaseLabel;

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
  //   bundleCondition: canBundle && isSmartWallet && selectedPlant && selectedItem
  // });

  const getItemBenefits = () => {
    if (!selectedItem) return 'Item effect';

    if (isFenceItem) {
      return <ResourceValue resource="protection">{activeFenceV2Days} day{activeFenceV2Days === 1 ? '' : 's'} protection</ResourceValue>;
    }

    if (quantity === 0 && itemType === 'garden') return 'Select quantity above';

    if (itemType === 'shop') {
      const shopItem = selectedItem as ShopItem;
      return <ResourceValue resource="protection">{formatDuration(shopItem.effectTime)} protection</ResourceValue>;
    } else {
      const gardenItem = selectedItem as GardenItem;
      const points = Number(gardenItem.points) / 1e12 * quantity;
      const lifetime = Number(gardenItem.timeExtension) * quantity;

      if (points > 0 || lifetime > 0) return <>
        {points > 0 && <ResourceValue resource="points">+{formatNumber(points)} PTS</ResourceValue>}
        {points > 0 && lifetime > 0 && <span className="sr-only"> and </span>}
        {lifetime > 0 && <ResourceValue resource="lifetime">+{formatDuration(lifetime)} lifetime</ResourceValue>}
      </>;
      return 'Item effect';
    }
  };

  const requiredSeedAllowance = isFenceItem ? (fenceV2Quote ?? BigInt(0)) : totalCost;
  const needsSeedApproval =
    !isSolana
    && seedAllowance < requiredSeedAllowance
    && !usesEthPayment;
  const approvalActionButtonText = isFenceItem
    ? 'Approve + Buy Fence'
    : `Approve + ${itemPurchaseLabel}`;
  const purchaseActionButtonText = isFenceItem
    ? fenceButtonText
    : itemPurchaseLabel;

  const handlePurchaseSuccess = (tx: UntypedValue) => {
    if (itemType === 'garden') microSound('water');
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
    <Card className={embedded ? 'border-0 !bg-transparent p-0 shadow-none' : 'bg-muted/30'}>
      {!embedded && <CardHeader>
        <CardTitle>{headerTitle}</CardTitle>
      </CardHeader>}
      <CardContent className="space-y-4">
        {usesEthPayment && ethQuoteError && <Button variant="outline" onClick={() => void retryEthQuote()}>Retry ETH quote</Button>}
        {catalogChanged && <div role="status" className="space-y-2 rounded-[var(--radius-control)] border border-border p-3 text-sm">
          <p>The price or effects changed. Review the updated details before buying.</p>
          <Button variant="outline" onClick={onReviewCatalog}>Use updated details</Button>
        </div>}
        {catalogStatus === 'error' && <Button variant="outline" onClick={onRetryCatalog}>Retry item catalog</Button>}
        {isFenceItem && configQuery.isError && <Button variant="outline" onClick={() => void configQuery.refetch()}>Retry fence duration rules</Button>}
        {isFenceItem && fenceConfigReady && fenceQuoteQuery.isError && <Button variant="outline" onClick={() => void fenceQuoteQuery.refetch()}>Retry fence quote</Button>}
        {itemType === 'garden' && isSmartWallet && onQuantityChange && (
          <div className="flex items-center justify-between gap-3 text-sm" role="group" aria-label="Purchase quantity">
            <span className="text-muted-foreground">Quantity</span>
            <QuantitySelector key={`${itemType}:${selectedItem.id}`} quantity={quantity} onQuantityChange={onQuantityChange} onValidityChange={setQuantityValid} min={1} max={80} />
          </div>
        )}
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
              {usesEthPayment && ethQuote ? (
                <ResourceValue resource="eth">
                  {formatTokenEstimate(ethAmount)} ETH
                  {itemType === 'garden' && quantity === 0 ? ' each' : ''}
                </ResourceValue>
              ) : usesEthPayment && ethQuoteLoading ? (
                <ResourceValue resource="eth">
                  <Skeleton className="h-4 w-20" />
                </ResourceValue>
              ) : usesEthPayment ? (
                <span className="text-muted-foreground">{hasQuantitySelected ? 'ETH quote unavailable' : 'Choose quantity'}</span>
              ) : isSolana ? (
                solanaQuote ? (
                  solanaQuote.error ? (
                    <span className="text-amber-500">Quote error</span>
                  ) : (
                    <ResourceValue resource="sol">{formatWsol(solanaQuote.wsolAmount)} SOL</ResourceValue>
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
                  <TokenAmount amount={fenceV2Quote} unit="SEED" mode="cost" />
                )
              ) : itemType === 'shop' ? (
                <TokenAmount amount={selectedItem.price} unit="SEED" mode="cost" />
              ) : quantity === 0 ? (
                <span><TokenAmount amount={selectedItem.price} unit="SEED" mode="cost" /> each</span>
              ) : (
                <TokenAmount amount={totalCost} unit="SEED" mode="cost" />
              )}
            </div>
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 text-sm">
            <span className="text-muted-foreground">Effect:</span>
            <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-right font-semibold text-primary">
              {getItemBenefits()}
            </span>
          </div>

          {isFenceItem && fenceConfigReady && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <label htmlFor={fenceDurationInputId} className="whitespace-nowrap text-muted-foreground">Duration (days):</label>
              <div className="ml-auto flex shrink-0 items-center gap-2">
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
                <span id={fenceDurationHelpId} className="whitespace-nowrap text-xs text-muted-foreground">
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
            <span className="font-semibold tracking-tight">
              {selectedPlant.name || `#${selectedPlant.id}`}
            </span>
          </div>
        </div>

        <div className="pt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">
              {isFenceItem ? 'Buy Fence' : itemPurchaseLabel}
            </span>
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
              buttonText={`${itemPurchaseLabel} via Bridge`}
              buttonClassName="w-full"
              onQuote={setSolanaQuote}
              onBeforeSubmit={requireCurrentPurchase}
              disabled={disabledMessage !== null || !selectedPlant || !selectedItem || selectedPlant.status === 4 || (itemType === 'garden' && !hasQuantitySelected)}
              onSuccess={() => {
                onPurchaseSuccess();

              }}
              onError={(error) => {
                const message = error instanceof Error ? error.message : String(error);
                toast.error(getFriendlyErrorMessage(message));
              }}
            />
          ) : usesEthPayment ? (
            // ETH Mode purchase - atomic swap + buy transaction
            <div className="flex flex-col space-y-2">
              {isFenceItem ? (
                // Fence purchases use specialized bundle
                <SwapFencePurchaseBundle
                  plantId={selectedPlant.id}
                  days={activeFenceV2Days}
                  ethAmount={ethAmount}
                  minSeedOut={fenceV2Quote ?? BigInt(0)}
                  onSuccess={() => {
                    onPurchaseSuccess();

                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={
                    !ethQuote ? (ethQuoteLoading ? 'Updating ETH quote…' : 'ETH quote unavailable') : ethBalance < ethAmount
                      ? "Insufficient ETH Balance"
                      : `Buy ${activeFenceV2Days} Day${activeFenceV2Days === 1 ? '' : 's'} Fence with ETH`
                  }
                  buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
                  onButtonClick={requireCurrentPurchase}
                  disabled={!ethQuote || disabledMessage !== null || ethQuoteLoading || selectedPlant.status === 4 || ethBalance < ethAmount || fenceV2Bounds.todCapBreached || fenceV2BlockedByV1 || fenceV2InputInvalid}
                />
              ) : (
                // Regular item purchases
                <SwapBuyItemBundle
                  item={selectedItem}
                  plant={selectedPlant}
                  itemType={itemType}
                  quantity={itemType === 'garden' ? quantity : 1}
                  ethAmount={ethAmount}
                  minSeedOut={totalCost}
                  onSuccess={() => {
                    onPurchaseSuccess();

                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={
                    !ethQuote ? (ethQuoteLoading ? 'Updating ETH quote…' : 'ETH quote unavailable') : ethBalance < ethAmount
                      ? "Insufficient ETH Balance"
                      : `${itemPurchaseLabel} with ETH`
                  }
                  buttonClassName="w-full bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))] hover:bg-[hsl(var(--success)/0.9)]"
                  onButtonClick={requireCurrentPurchase}
                  disabled={!ethQuote || disabledMessage !== null || ethQuoteLoading || selectedPlant.status === 4 || ethBalance < ethAmount || (!hasQuantitySelected && itemType === 'garden')}
                />
              )}
              {ethBalance < ethAmount && (
                <InlineBalanceNotice className="mt-0">
                  <p>You need <TokenAmount amount={ethAmount - ethBalance} unit="ETH" mode="cost" precision={6} withIcon={false} /> more.</p>
                  <p className="mt-1">Available: <TokenAmount amount={ethBalance} unit="ETH" precision={6} withIcon={false} />.</p>
                </InlineBalanceNotice>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {!allowanceReady && <p role="status" className="text-sm text-muted-foreground">{allowanceQuery.isError ? 'SEED spending permission could not be verified.' : 'Checking SEED spending permission…'}</p>}
              {allowanceQuery.isError && <Button variant="outline" onClick={() => void allowanceQuery.refetch()}>Retry SEED permission</Button>}
              {seedBalanceStatus === 'error' && <Button variant="outline" onClick={() => void refreshBalances()}>Retry balance check</Button>}
              <ApprovalActionTransaction
                intentKey={isFenceItem ? `fence:purchase:${selectedPlant.id}` : `purchase:${itemType}:${selectedPlant.id}:${selectedItem.id}`}
                actionCalls={purchaseActionCalls}
                approvalSpender={PIXOTCHI_NFT_ADDRESS}
                needsApproval={needsSeedApproval}
                onApprovalSuccess={() => { void allowanceQuery.refetch(); }}
                onSuccess={handlePurchaseSuccess}
                onButtonClick={requireCurrentPurchase}
                onError={error => toast.error(getFriendlyErrorMessage(error))}
                batchButtonText={disabledMessage || approvalActionButtonText}
                approvalButtonText={disabledMessage || 'Approve SEED'}
                actionButtonText={disabledMessage || (!seedBalanceReady ? 'SEED balance unavailable' : !allowanceReady ? 'Checking SEED permission…' : purchaseActionButtonText)}
                buttonClassName="w-full"
                disabled={selectedPlant.status === 4 || disabledMessage !== null || !seedBalanceReady || !allowanceReady || purchaseActionCalls.length === 0}
                resetKey={`${itemType}-${selectedPlant.id}-${selectedItem.id}-${quantity}-${activeFenceV2Days}`}
              />
            </div>
          )}

          {selectedPlant.status === 4 && (
            <InlineBalanceNotice>
              Cannot buy items for dead plants.
            </InlineBalanceNotice>
          )}

          {hasInsufficientFunds && !isEthMode && (
            <InlineBalanceNotice>
              {getBalanceShortfallMessage(userSeedBalance, quoteSeedCost, 'SEED')}
            </InlineBalanceNotice>
          )}


        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            {isFenceItem
              ? 'A fence blocks incoming attacks while it is active.'
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
