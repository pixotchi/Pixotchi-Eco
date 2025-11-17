"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ShopItem, GardenItem, Plant } from '@/lib/types';
import { buyShopItem, buyGardenItem, getTokenBalance, quoteFenceV2, buildFenceV2PurchaseCall, getFenceV2Config } from '@/lib/contracts';
import { formatTokenAmount, formatDuration, getFriendlyErrorMessage } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { ITEM_ICONS } from '@/lib/constants';
import { toast } from 'react-hot-toast';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { BuyShopItemTransaction, BuyGardenItemTransaction } from '@/components/transactions/buy-item-transaction';
import BundleBuyTransaction from '@/components/transactions/bundle-buy-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';
import { Input } from '@/components/ui/input';
import SponsoredTransaction from '@/components/transactions/sponsored-transaction';
import type { FenceV2Config } from '@/lib/contracts';
import { Skeleton } from '@/components/ui/skeleton';
import { extractTransactionHash } from '@/lib/transaction-utils';

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
  const { data: walletClient } = useWalletClient();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet, walletType, isLoading: smartWalletLoading } = useSmartWallet();
  const [userSeedBalance, setUserSeedBalance] = useState<bigint>(BigInt(0));
  const [balanceLoading, setBalanceLoading] = useState(true);
  const [fenceV2Config, setFenceV2Config] = useState<FenceV2Config | null>(null);
  const [fenceV2Days, setFenceV2Days] = useState<number>(1);
  const [fenceV2Quote, setFenceV2Quote] = useState<bigint>(BigInt(0));
  const [fenceV2QuoteLoading, setFenceV2QuoteLoading] = useState(false);

  const fenceItemName = selectedItem?.name?.toLowerCase() || '';
  const isFenceItem = fenceItemName.includes('fence') || fenceItemName.includes('shield');

  // Calculate total cost and effects based on quantity
  const basePrice = BigInt(selectedItem?.price || 0);
  const totalCost = itemType === 'garden'
    ? (quantity > 0 ? basePrice * BigInt(quantity) : BigInt(0))
    : basePrice;
  const hasQuantitySelected = itemType === 'garden' ? quantity > 0 : true;
  
  // Check if user has insufficient funds
  const hasInsufficientFunds = isFenceItem
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

  useEffect(() => {
    if (!isFenceItem) return;
    let cancelled = false;
    const loadConfig = async () => {
      try {
        const config = await getFenceV2Config();
        if (!cancelled && config) {
          setFenceV2Config(config);
          setFenceV2Days((prev) => {
            const min = Math.max(1, config.minDurationDays || 1);
            const max = Math.max(min, config.maxDurationDays || 30);
            if (prev >= min && prev <= max) return prev;
            return min;
          });
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

  useEffect(() => {
    if (!isFenceItem) return;
    let cancelled = false;
    const fetchQuote = async () => {
      setFenceV2QuoteLoading(true);
      try {
        const quote = await quoteFenceV2(fenceV2Days);
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
  }, [isFenceItem, fenceV2Days]);

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

  const currentTimeSec = Math.floor(Date.now() / 1000);
  const fenceV2State = selectedPlant.fenceV2 ?? null;
  const fenceV2Active = Boolean(fenceV2State?.isActive && fenceV2State.activeUntil > currentTimeSec);
  const fenceV2MirroringV1 = Boolean(fenceV2State?.isMirroringV1);
  const fenceV2EffectUntil = Number(fenceV2State?.activeUntil || 0);
  const fenceV2BlockedByV1 = Boolean(fenceV2State?.v1Active);

  const plantTimeUntilStarving = Number(selectedPlant.timeUntilStarving || 0);
  const plantSecondsLeft = Math.max(0, plantTimeUntilStarving - currentTimeSec);
  const maxFenceSecondsAllowed = Math.max(0, plantSecondsLeft - 1);
  const plantTodDaysCap = Math.floor(maxFenceSecondsAllowed / (24 * 60 * 60));
  const fenceV2Bounds = useMemo(() => {
    const minFromConfig = fenceV2Config ? Math.max(1, fenceV2Config.minDurationDays || 1) : 1;
    const maxFromConfig = fenceV2Config ? fenceV2Config.maxDurationDays || 30 : 30;
    const todLimitedMax = plantTodDaysCap > 0 ? Math.min(maxFromConfig, plantTodDaysCap) : plantTodDaysCap;
    const todCapBreached = todLimitedMax < minFromConfig;
    const max = todCapBreached ? minFromConfig : Math.max(minFromConfig, todLimitedMax);
    return { min: minFromConfig, max, todCapBreached };
  }, [fenceV2Config, plantTodDaysCap]);

  const fenceV2Calls = useMemo(() => {
    return [buildFenceV2PurchaseCall(selectedPlant.id, fenceV2Days)];
  }, [selectedPlant.id, fenceV2Days]);

  const fenceButtonText = fenceV2Active
    ? `Extend Fence (+${fenceV2Days} day${fenceV2Days === 1 ? '' : 's'})`
    : `Buy Fence (${fenceV2Days} day${fenceV2Days === 1 ? '' : 's'})`;

  useEffect(() => {
    if (!isFenceItem) return;
    if (fenceV2Bounds.todCapBreached) return;
    if (fenceV2Days > fenceV2Bounds.max) {
      setFenceV2Days(fenceV2Bounds.max);
    } else if (fenceV2Days < fenceV2Bounds.min) {
      setFenceV2Days(fenceV2Bounds.min);
    }
  }, [isFenceItem, fenceV2Bounds, fenceV2Days]);

  const disabledMessage = (() => {
    if (!hasQuantitySelected && itemType === 'garden') return 'Select quantity above';
    if (isFenceItem && fenceV2Bounds.todCapBreached) return 'Fence duration exceeds plant TOD';
    if (isFenceItem && fenceV2BlockedByV1) return 'Existing fence active. Wait for expiry.';
    if (hasInsufficientFunds) return 'Insufficient SEED Balance';
    if (canBundle && itemType === 'garden' && !isSmartWallet) {
      return smartWalletLoading ? 'Detecting Wallet Type...' : 'Bundle Transactions Require Smart Wallet';
    }
    return null;
  })();

  const headerTitle = isFenceItem
    ? `Fence (${fenceV2Days} day${fenceV2Days === 1 ? '' : 's'})`
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
    if (isFenceItem) {
      return `${fenceV2Days} day${fenceV2Days === 1 ? '' : 's'} protection`;
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
              {isFenceItem ? (
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
                  type="number"
                  min={fenceV2Bounds.min}
                  max={fenceV2Bounds.max}
                  value={fenceV2Days}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isNaN(value)) return;
                    const clamped = Math.min(Math.max(value, fenceV2Bounds.min), fenceV2Bounds.max);
                    setFenceV2Days(clamped);
                  }}
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
            <span className="font-medium">
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
          
          {disabledMessage ? (
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
                  onSuccess={(tx: any) => {
                    onPurchaseSuccess();
                    try {
                      const payload: Record<string, unknown> = { address, taskId: 's1_buy_shield' };
                      const txHash = extractTransactionHash(tx);
                      if (txHash) {
                        payload.proof = { txHash };
                      }
                      fetch('/api/gamification/missions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                    } catch {}
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText={fenceButtonText}
                  buttonClassName="w-full"
                  disabled={selectedPlant.status === 4 || fenceV2QuoteLoading || fenceV2BlockedByV1 || hasInsufficientFunds || fenceV2Bounds.todCapBreached}
                />
              ) : (
                <BuyShopItemTransaction
                  plantId={selectedPlant.id}
                  itemId={selectedItem.id}
                  onSuccess={(tx: any) => {
                    onPurchaseSuccess();
                    try {
                      const payload: Record<string, unknown> = { address, taskId: 's1_buy_shield' };
                      const txHash = extractTransactionHash(tx);
                      if (txHash) {
                        payload.proof = { txHash };
                      }
                      fetch('/api/gamification/missions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                    } catch {}
                  }}
                  onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                  buttonText="Buy Item"
                  buttonClassName="w-full"
                  disabled={true}
                />
              )
            ) : (
              <BuyGardenItemTransaction
                plantId={selectedPlant.id}
                itemId={selectedItem.id}
                onSuccess={(tx: any) => {
                  onPurchaseSuccess();
                  try {
                    const post = async (currentTx: any, attempt = 0) => {
                      try {
                        const payload: Record<string, unknown> = { address, taskId: 's1_buy5_elements' };
                        const txHash = extractTransactionHash(currentTx);
                        if (txHash) {
                          payload.proof = { txHash };
                        }
                        const res = await fetch('/api/gamification/missions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(payload)
                        });
                        if (!res.ok) throw new Error('missions post failed');
                      } catch (e) {
                        if (attempt < 2) {
                          const delay = 400 * Math.pow(2, attempt);
                          setTimeout(() => post(currentTx, attempt + 1), delay);
                        }
                      }
                    };
                    post(tx);
                  } catch {}
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
            <p className="text-xs text-destructive text-center mt-2">
              Cannot buy items for dead plants.
            </p>
          )}
          
          {hasInsufficientFunds && (
            <p className="text-xs text-destructive text-center mt-2">
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