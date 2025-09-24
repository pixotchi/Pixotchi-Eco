"use client";

import React, { useState, useEffect } from 'react';
import { useAccount, useWalletClient } from 'wagmi';
import { ShopItem, GardenItem, Plant } from '@/lib/types';
import { buyShopItem, buyGardenItem, getTokenBalance } from '@/lib/contracts';
import { formatTokenAmount, formatDuration, getFriendlyErrorMessage } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingSpinner } from '@/components/ui/loading';
import Image from 'next/image';
import { ITEM_ICONS } from '@/lib/constants';
import { toast } from 'react-hot-toast';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { BuyShopItemTransaction, BuyGardenItemTransaction } from '@/components/transactions/buy-item-transaction';
import BundleBuyTransaction from '@/components/transactions/bundle-buy-transaction';
import DisabledTransaction from '@/components/transactions/disabled-transaction';

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
  const [purchasing, setPurchasing] = useState(false);
  const [userSeedBalance, setUserSeedBalance] = useState<bigint>(BigInt(0));
  const [balanceLoading, setBalanceLoading] = useState(true);

  // Calculate total cost and effects based on quantity
  const totalCost = quantity > 0 ? BigInt(selectedItem?.price || 0) * BigInt(quantity) : BigInt(0);
  const hasQuantitySelected = quantity > 0;
  
  // Check if user has insufficient funds
  const hasInsufficientFunds = totalCost > userSeedBalance;
  
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

  if (!selectedItem || !selectedPlant) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-full p-6">
          <p className="text-muted-foreground">Select an item to see details</p>
        </CardContent>
      </Card>
    );
  }

  const hasActiveFence = selectedPlant.extensions?.some((extension: any) =>
    extension.shopItemOwned?.some((item: any) => 
      item.effectIsOngoingActive && item.name.toLowerCase().includes('fence')
    )
  );

  const isFenceItem = selectedItem.name.toLowerCase().includes('fence');
  const preventPurchase = isFenceItem && hasActiveFence;

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
    if (quantity === 0) return 'Select quantity above';
    
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

  const handlePurchase = async () => {
    if (!walletClient || !address || !selectedItem || !selectedPlant) return;
    
    setPurchasing(true);
    try {
      let success = false;
      if (itemType === 'shop') {
        success = await buyShopItem(walletClient, selectedPlant.id, selectedItem.id);
      } else {
        success = await buyGardenItem(walletClient, selectedPlant.id, selectedItem.id);
      }
      if (success) {
        onPurchaseSuccess();
      }
    } catch (error) {
      console.error('Error during purchase:', error);
      toast.error(getFriendlyErrorMessage(error));
    } finally {
      setPurchasing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {itemType === 'shop' ? `Use 1 ${selectedItem.name}` :
           quantity === 0 ? `${selectedItem.name}` : 
           quantity === 1 ? `Use 1 ${selectedItem.name}` : 
           `Use ${quantity} ${selectedItem.name}s`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">
              {quantity > 1 && itemType === 'garden' ? 'Total Cost:' : 'Cost:'}
            </span>
            <span className="font-semibold text-destructive">
              {itemType === 'shop' ? `${formatTokenAmount(selectedItem.price)} SEED` :
               quantity === 0 ? `${formatTokenAmount(selectedItem.price)} SEED each` : 
               `${formatTokenAmount(totalCost)} SEED`}
            </span>
          </div>
          
          <div className="flex justify-between items-center text-sm">
            <span className="text-muted-foreground">Effect:</span>
            <span className="font-semibold text-primary">
              {getItemBenefits()}
            </span>
          </div>

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
              {itemType === 'shop' ? 'Purchase Item' :
               quantity === 0 ? 'Select quantity above' :
               quantity === 1 ? 'Purchase Item' : 
               canBundle && isSmartWallet ? `Purchase ${quantity} Items (Bundle)` :
               canBundle && !isSmartWallet ? `Purchase ${quantity} Items (Smart Wallet Required)` :
               `Purchase ${quantity} Items`}
            </span>
            <SponsoredBadge show={isSponsored && isSmartWallet} />
          </div>
          
          {!hasQuantitySelected && itemType === 'garden' ? (
            <DisabledTransaction
              buttonText="Select quantity above"
              buttonClassName="w-full"
            />
          ) : preventPurchase ? (
            <DisabledTransaction
              buttonText="Fence Already Active"
              buttonClassName="w-full"
            />
          ) : hasInsufficientFunds ? (
            <DisabledTransaction
              buttonText="Insufficient SEED Balance"
              buttonClassName="w-full"
            />
          ) : canBundle && !isSmartWallet ? (
            <DisabledTransaction
              buttonText={smartWalletLoading ? "Detecting Wallet Type..." : "Bundle Transactions Require Smart Wallet"}
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
              <BuyShopItemTransaction
                plantId={selectedPlant.id}
                itemId={selectedItem.id}
                onSuccess={() => {
                  onPurchaseSuccess();
                  try {
                    fetch('/api/gamification/missions', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ address, taskId: 's1_buy_shield' })
                    });
                  } catch {}
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Buy Item"
                buttonClassName="w-full"
                disabled={selectedPlant.status === 4 || hasInsufficientFunds}
              />
            ) : (
              <BuyGardenItemTransaction
                plantId={selectedPlant.id}
                itemId={selectedItem.id}
                onSuccess={() => {
                  onPurchaseSuccess();
                  try {
                    const post = async (attempt = 0) => {
                      try {
                        const res = await fetch('/api/gamification/missions', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ address, taskId: 's1_buy5_elements' })
                        });
                        if (!res.ok) throw new Error('missions post failed');
                      } catch (e) {
                        if (attempt < 2) {
                          const delay = 400 * Math.pow(2, attempt);
                          setTimeout(() => post(attempt + 1), delay);
                        }
                      }
                    };
                    post();
                  } catch {}
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
                buttonText="Buy Accessory"
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
              Not enough SEED. Balance: {formatTokenAmount(userSeedBalance)} SEED
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