"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAccount } from "wagmi";
import Image from "next/image";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { Plant, ShopItem, GardenItem } from "@/lib/types";
import {
  getPlantsByOwner,
} from "@/lib/contracts";
import { getStrainName, formatScore, formatEth, formatTokenAmount, getPlantStatusText, cn, getActiveFences } from '@/lib/utils';
import PlantImage from "../PlantImage";
import CountdownTimer from "../countdown-timer";
import FenceTimer from "../fence-timer";
import ItemDetailsPanel from "../item-details-panel";
import {
  Shield,
  Heart,
  Star,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Apple,
  Flower,
  Award,
  TrendingUp,
  Info,
} from "lucide-react";
import { toast } from "react-hot-toast";
import { ITEM_ICONS } from "@/lib/constants";
import { usePaymaster } from "@/lib/paymaster-context";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import QuantitySelector from "@/components/quantity-selector";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { StandardContainer } from "@/components/ui/pixel-container";
import EditPlantName from "@/components/edit-plant-name";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ClaimRewardsTransaction from "@/components/transactions/claim-rewards-transaction";
import ArcadeDialog from "@/components/arcade/ArcadeDialog";
import { Gamepad2 } from "lucide-react";
import { useItemCatalogs } from "@/hooks/useItemCatalogs";
import { useIsSolanaWallet, useTwinAddress, SolanaNotSupported } from "@/components/solana";
import SolanaBridgeButton from "@/components/transactions/solana-bridge-button";
// Removed BalanceCard from tabs; status bar now shows balances globally

export default function PlantsView() {
  const { address: evmAddress } = useAccount();
  
  // Solana wallet support - use Twin address for Solana users
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  
  // Use Twin address for Solana users, EVM address otherwise
  const address = evmAddress || (isSolana && twinAddress ? twinAddress as `0x${string}` : undefined);
  const { isSponsored } = usePaymaster();
  const { isSmartWallet, isLoading: smartWalletLoading } = useSmartWallet();
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [selectedItem, setSelectedItem] = useState<ShopItem | GardenItem | null>(null);
  const { shopItems, gardenItems, isLoading: catalogsLoading } = useItemCatalogs();
  const [itemType, setItemType] = useState<"shop" | "garden">("garden");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [claimOpen, setClaimOpen] = useState(false);
  const [arcadeOpen, setArcadeOpen] = useState(false);

  const fenceStatuses = useMemo(() => {
    if (!selectedPlant) return [];
    return getActiveFences(selectedPlant);
  }, [selectedPlant]);

  const hasActiveFence = fenceStatuses.length > 0;

  const handleItemTypeChange = (type: 'garden' | 'shop') => {
    setItemType(type);
    if (type === 'garden' && gardenItems.length > 0) {
      setSelectedItem(gardenItems[0]);
    } else if (type === 'shop' && shopItems.length > 0) {
      setSelectedItem(shopItems[0]);
    } else {
      setSelectedItem(null);
    }
  };

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setItemQuantities(prev => ({
      ...prev,
      [itemId]: quantity
    }));
  };

  const getItemQuantity = (itemId: string) => {
    // For regular wallets, default to 1 for garden items since they can't change quantity
    // For smart wallets, default to 0 (user selects quantity)
    const defaultQuantity = (!isSmartWallet && !smartWalletLoading && itemType === 'garden') ? 1 : 0;
    return itemQuantities[itemId] || defaultQuantity;
  };

  const fetchData = useCallback(async () => {
    if (!address) return;

    try {
      // Keep loading spinner for refetches
      setLoading(true);
      setError(null);

      const plantsData = await getPlantsByOwner(address);

      setPlants(plantsData);
      
      // After refetching, try to find the previously selected plant in the new data
      if (plantsData.length > 0) {
        const currentSelectedId = selectedPlant?.id;
        const newSelectedPlant = plantsData.find(p => p.id === currentSelectedId);
        setSelectedPlant(newSelectedPlant || plantsData[0]);
      } else {
        setSelectedPlant(null);
      }

    } catch (err) {
      console.error("Error fetching dashboard data:", err);
      setError("Failed to load dashboard data. Please refresh.");
    } finally {
      setLoading(false);
    }
  }, [address, selectedPlant?.id]); // Only depend on address and selected plant ID

  // Set default selected item when catalogs are loaded
  useEffect(() => {
    if (!selectedItem) {
      if (gardenItems.length > 0) {
        setSelectedItem(gardenItems[0]);
        setItemType('garden');
      } else if (shopItems.length > 0) {
        setSelectedItem(shopItems[0]);
        setItemType('shop');
      }
    }
  }, [selectedItem, gardenItems, shopItems]);

  useEffect(() => {
    if(address) {
      fetchData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  const onPurchaseSuccess = useCallback(() => {
    console.log("Purchase successful, refetching data...");
    toast.success("Purchase successful! Updating plant data...");
    fetchData(); // Refetch all data
    // Manually trigger a balance refresh across the app
    window.dispatchEvent(new Event('balances:refresh'));
  }, [fetchData]);

  const renderNoPlantsView = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-4">
      <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
        <Flower className="w-12 h-12 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No Plants Yet!
      </h3>
      <p className="text-muted-foreground">
        Head over to the 'Mint' tab to grow your first plant.
      </p>
    </div>
  );

  if (loading || catalogsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <BaseExpandedLoadingPageLoader text="Loading dashboard..." />
      </div>
    );
  }
  if (error) return <Card><CardContent className="py-4 text-center text-destructive">{error}</CardContent></Card>;
  if (plants.length === 0) return renderNoPlantsView();

  return (
    <div className="space-y-4">
        {/* Top Section */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* StatusBar replaces BalanceCard globally under header */}

            {plants.length > 1 && (
                 <Card>
                    <CardHeader><CardTitle>Select Plant</CardTitle></CardHeader>
                    <CardContent>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="w-full justify-between">
                                {selectedPlant ? (
                                    <div className="flex items-center space-x-2">
                                        <PlantImage selectedPlant={selectedPlant} width={24} height={24} />
                                        <span>{selectedPlant.name || `Plant #${selectedPlant.id}`}</span>
                                    </div>
                                ) : "Select a Plant"}
                                <ChevronDown className="w-4 h-4" />
                            </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                            {plants.map((plant) => (
                                <DropdownMenuItem key={plant.id} onSelect={() => setSelectedPlant(plant)}>
                                <div className="flex items-center space-x-2">
                                    <PlantImage selectedPlant={plant} width={24} height={24} />
                                    <span>{plant.name || `Plant #${plant.id}`} (Lvl {plant.level})</span>
                                </div>
                                </DropdownMenuItem>
                            ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </CardContent>
                 </Card>
            )}
        </div>

      {selectedPlant && (
        <>
          {/* Plant "Screen" Display */}
          <Card>
            <CardContent className="p-4 space-y-3">
              {/* Main image container with stats overlay */}
              <div className="relative w-full aspect-square bg-muted/50 overflow-hidden rounded-xl">
                
                {/* Top Stats Bar - LVL, PTS, STARS */}
                <div className="absolute top-3 left-3 right-3 grid grid-cols-3 gap-2 text-sm font-bold text-foreground/80 z-20">
                  {/* Left: Level */}
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Image src="/icons/level.svg" alt="Level" width={16} height={16} className="w-4 h-4" />
                      <span>LVL {selectedPlant.level}</span>
                    </div>
                  </div>
                  {/* Center: Points */}
                  <div className="flex justify-center">
                    <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Image src="/icons/pts.svg" alt="Points" width={16} height={16} className="w-4 h-4 text-yellow-500" />
                      <span>{formatScore(selectedPlant.score)} PTS</span>
                    </div>
                  </div>
                  {/* Right: Stars */}
                  <div className="flex justify-end">
                    <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Image src="/icons/Star.svg" alt="Star" width={16} height={16} className="w-4 h-4 text-amber-400" />
                      <span>{selectedPlant.stars}</span>
                    </div>
                  </div>
                </div>
                
                {/* Center: Plant Image - restore previous inner padding */}
                <div className="absolute inset-6 sm:inset-8 flex items-center justify-center z-10">
                  <div className="relative">
                    <PlantImage selectedPlant={selectedPlant} width={180} height={180} priority={true} />
                    {hasActiveFence && (
                        <div className="absolute top-0 right-0 z-10">
                            <Image src="/icons/Shield.svg" alt="Shield" width={28} height={28} title="Fence protection active" />
                        </div>
                    )}
                  </div>
                </div>

                {/* Next/Previous controls for multiple plants */}
                {plants.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = selectedPlant ? plants.findIndex(p => p.id === selectedPlant.id) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx - 1 + plants.length) % plants.length;
                          setSelectedPlant(plants[nextIndex]);
                        }
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-20 inline-flex items-center justify-center h-9 w-9 rounded-full bg-background/70 backdrop-blur-sm border border-border shadow-sm hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                      aria-label="Previous plant"
                      title="Previous"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = selectedPlant ? plants.findIndex(p => p.id === selectedPlant.id) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx + 1) % plants.length;
                          setSelectedPlant(plants[nextIndex]);
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-20 inline-flex items-center justify-center h-9 w-9 rounded-full bg-background/70 backdrop-blur-sm border border-border shadow-sm hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                      aria-label="Next plant"
                      title="Next"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
                
                {/* Bottom Status Bar - Timer and Health */}
                <div className="absolute bottom-3 left-3 right-3 z-20">
                  <div className="flex justify-between items-end text-sm font-bold text-foreground/80">
                    {/* Bottom-left: Timers */}
                    <div className="flex flex-col justify-start gap-1">
                      {/* Fence Timer (if active) */}
                      {hasActiveFence && (
                        <div className="flex flex-col gap-1">
                          {fenceStatuses.map((fence) => (
                            <div key={`${fence.type}-${fence.effectUntil}`} className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                              <FenceTimer effectUntil={fence.effectUntil} noBackground={true} className="text-sm" label={fence.type} />
                            </div>
                          ))}
                        </div>
                      )}
                      {/* TOD Timer */}
                      <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                        <CountdownTimer timeUntilStarving={selectedPlant.timeUntilStarving} noBackground={true} className="text-sm" />
                      </div>
                    </div>
                    {/* Bottom-right: Health Status */}
                    <div className="flex justify-end">
                      <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                        <Image src="/icons/HEART.svg" alt="Heart" width={16} height={16} className="w-4 h-4 text-red-500" />
                        <span>{getPlantStatusText(selectedPlant.status)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Plant Name and Strain */}
              <div className="text-center">
                <div className="relative inline-block">
                  <h3 className="text-lg font-bold font-pixel">{selectedPlant.name || `Plant #${selectedPlant.id}`}</h3>
                  <EditPlantName 
                    plant={selectedPlant} 
                    onNameChanged={(plantId, newName) => {
                      // Update the selected plant name locally
                      setSelectedPlant(prev => prev ? { ...prev, name: newName } : null);
                      // Update the plants array
                      setPlants(prev => prev.map(p => 
                        p.id === plantId ? { ...p, name: newName } : p
                      ));
                    }}
                    iconSize={16}
                    className="absolute top-0 left-full ml-1"
                  />
                </div>
                <p className="text-sm text-muted-foreground">{getStrainName(selectedPlant.strain)}</p>
                {selectedPlant.timePlantBorn && (
                  <p className="text-xs text-muted-foreground">
                    Planted on {new Date(Number(selectedPlant.timePlantBorn) * 1000).toLocaleDateString()}
                  </p>
                )}
              </div>

              {/* Actions Section: Unclaimed Rewards + Arcade */}
              <div className="pt-3 border-t border-border">
                <div className="grid grid-cols-2 gap-2">
                  {/* Claim Rewards (half width) */}
                  <button
                    className="w-full"
                    onClick={() => {
                      if (!selectedPlant || Number(selectedPlant.rewards) <= 0) {
                        toast.error('No rewards to claim');
                        return;
                      }
                      setClaimOpen(true);
                    }}
                    title="Claim ETH rewards"
                  >
                    <StandardContainer className="flex items-center justify-center space-x-2 bg-primary/10 text-foreground p-2 rounded-md border border-border hover:bg-primary/15 transition-colors">
                      <Image src="/icons/ethlogo.svg" alt="ETH" width={18} height={18} />
                      <div>
                        <p className="text-xs font-semibold leading-tight">Rewards</p>
                        <p className="text-sm font-bold">{formatEth(selectedPlant.rewards)} ETH</p>
                      </div>
                    </StandardContainer>
                  </button>

                  {/* Arcade Games (half width) */}
                  <button
                    className="w-full"
                    onClick={() => setArcadeOpen(true)}
                    title="Arcade games"
                  >
                    <StandardContainer className="flex items-center justify-center space-x-2 bg-accent/15 text-foreground p-2 rounded-md border border-border hover:bg-accent transition-colors">
                      <Image src="/icons/GAME.png" alt="Arcade" width={18} height={18} />
                      <div>
                        <p className="text-xs font-semibold leading-tight">Arcade</p>
                        <p className="text-sm font-bold">Play games</p>
                      </div>
                    </StandardContainer>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Claim Rewards Dialog */}
          <Dialog open={claimOpen} onOpenChange={setClaimOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Claim ETH Rewards?</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Claiming rewards will burn your current points and reset this plant's level to 0.</p>
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                  <span>{formatEth(selectedPlant.rewards)} ETH</span>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setClaimOpen(false)}>No</Button>
                <div className="flex-1">
                  {isSolana ? (
                    <SolanaBridgeButton
                      actionType="claimRewards"
                      plantId={selectedPlant.id}
                      buttonText="Yes, Claim"
                      buttonClassName="w-full"
                      disabled={Number(selectedPlant.rewards) <= 0}
                      onSuccess={() => {
                        setClaimOpen(false);
                        toast.success('Rewards claimed via bridge!');
                        fetchData();
                        window.dispatchEvent(new Event('balances:refresh'));
                      }}
                      onError={() => {
                        toast.error('Claim failed');
                      }}
                    />
                  ) : (
                    <ClaimRewardsTransaction
                      plantId={selectedPlant.id}
                      buttonText="Yes, Claim"
                      buttonClassName="w-full"
                      disabled={Number(selectedPlant.rewards) <= 0}
                      minimal
                      onSuccess={() => {
                        setClaimOpen(false);
                        toast.success('Rewards claimed!');
                        fetchData();
                        window.dispatchEvent(new Event('balances:refresh'));
                      }}
                      onError={() => {
                        toast.error('Claim failed');
                      }}
                    />
                  )}
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Arcade Dialog */}
          <ArcadeDialog
            open={arcadeOpen}
            onOpenChange={setArcadeOpen}
            plant={selectedPlant}
          />
          
          {/* Items Section */}
          <Card>
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle className="font-pixel">Marketplace</CardTitle>
                <ToggleGroup
                  value={itemType}
                  onValueChange={(v) => handleItemTypeChange(v as 'garden' | 'shop')}
                  options={[
                    { value: 'garden', label: 'Garden' },
                    { value: 'shop', label: 'Shop' },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                        {/* Regular Wallet Info Message */}
                        {itemType === 'garden' && !smartWalletLoading && !isSmartWallet && (
                <StandardContainer className="p-3 rounded-md border bg-primary/10">
                            <div className="flex items-start space-x-2">
                              <Info className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                              <div className="text-sm text-foreground">
                                <div className="font-medium">Regular Wallet Mode</div>
                                <div className="text-xs mt-1">Purchasing 1 item at a time. For bulk purchases, consider using a smart wallet.</div>
                              </div>
                            </div>
                          </StandardContainer>
                        )}
                        
                        {/* Item Selection with Quantity */}
                        <div className="space-y-2">
                          <div className="grid grid-cols-3 gap-2">
                                {(itemType === 'garden' ? gardenItems : shopItems).map((item: ShopItem | GardenItem) => {
                                  const quantity = getItemQuantity(item.id);
                                  return (
                                    <div key={item.id} className="space-y-1">
                                      <div className="flex justify-center">
                                        <button
                                          onClick={() => setSelectedItem(item)}
                                          className={`p-0.5 transition-all rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${selectedItem?.id === item.id ? 'bg-primary' : 'bg-transparent'}`}
                                        >
                                          <div className={`flex items-center justify-center p-2 transition-all rounded-md w-12 h-12 ${selectedItem?.id === item.id ? 'bg-primary/10' : 'bg-card hover:bg-accent'}`}>
                                            <Image src={ITEM_ICONS[item.name.toLowerCase()] || '/icons/BEE.png'} alt={item.name} width={32} height={32} />
                                          </div>
                                        </button>
                                      </div>
                                      {itemType === 'garden' && isSmartWallet && (
                                        <div className="flex justify-center">
                                          <QuantitySelector
                                            quantity={quantity}
                                            onQuantityChange={(newQuantity) => {
                                              handleQuantityChange(item.id, newQuantity);
                                              setSelectedItem(item); // Auto-select item when quantity changes
                                            }}
                                            max={80}
                                            min={0}
                                            size="sm"
                                          />
                                        </div>
                                      )}
                                      {itemType === 'garden' && !smartWalletLoading && !isSmartWallet && (
                                        <div className="flex justify-center">
                                          <div className="text-xs text-muted-foreground px-2 py-1">
                                            Qty: 1
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                          </div>
                        </div>

                        {/* Item Details and Purchase */}
                        <ItemDetailsPanel
                          selectedItem={selectedItem}
                          selectedPlant={selectedPlant}
                          itemType={itemType}
                          onPurchaseSuccess={onPurchaseSuccess}
                          quantity={selectedItem ? getItemQuantity(selectedItem.id) : 0}
                        />
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}