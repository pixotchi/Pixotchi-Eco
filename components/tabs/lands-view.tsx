"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useAccount, useWatchBlockNumber } from "wagmi";
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
import { Land, BuildingData, BuildingType } from "@/lib/types";
import { getLandsByOwner, getVillageBuildingsByLandId, getTownBuildingsByLandId, checkLeafTokenApproval, getLandById, checkLandTokenApproval } from "@/lib/contracts";
import { formatTokenAmount, formatAddress, formatXP } from "@/lib/utils";
// Removed BalanceCard from tabs; status bar now shows balances globally
import BuildingGrid from "@/components/building-grid";
import BuildingDetailsPanel from "@/components/building-details-panel";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { LandPlot, Hash, Star, MapPin, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import LandImage from "../LandImage";
import { EditLandName } from "@/components/edit-land-name";
import { LandMapModal } from "@/components/map/land-map-modal";
import { useLandMap } from "@/hooks/useLandMap";

export default function LandsView() {
  const { address } = useAccount();
  const [lands, setLands] = useState<Land[]>([]);
  const [selectedLand, setSelectedLand] = useState<Land | null>(null);
  const [isMapOpen, setIsMapOpen] = useState(false);
  
  // Map data hook
  const { totalSupply, neighborData } = useLandMap(lands);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Building management state
  const [buildingType, setBuildingType] = useState<BuildingType>('village');
  const [villageBuildings, setVillageBuildings] = useState<BuildingData[]>([]);
  const [townBuildings, setTownBuildings] = useState<BuildingData[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingData | null>(null);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<bigint>(BigInt(0));
  // Remember last selected building id to persist across land switches
  const lastSelectedBuildingIdRef = useRef<number | null>(null);

  // Token approval state for land interactions
  const [needsLeafApproval, setNeedsLeafApproval] = useState<boolean>(true);
  const [needsSeedApproval, setNeedsSeedApproval] = useState<boolean>(true);

  // Fetch land contract approval status (LEAF + SEED)
  const fetchApprovalStatus = useCallback(async () => {
    if (!address) {
      setNeedsLeafApproval(true);
      setNeedsSeedApproval(true);
      return;
    }
    try {
      const [hasLeafApproval, hasSeedApproval] = await Promise.all([
        checkLeafTokenApproval(address),
        checkLandTokenApproval(address),
      ]);
      setNeedsLeafApproval(!hasLeafApproval);
      setNeedsSeedApproval(!hasSeedApproval);
    } catch (error) {
      console.error("Failed to fetch land token approval status:", error);
      setNeedsLeafApproval(true);
      setNeedsSeedApproval(true);
    }
  }, [address]);

  const fetchData = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setError(null);
    try {
      const landsData = await getLandsByOwner(address);

      setLands(landsData);


      if (landsData.length > 0) {
        const currentSelectedId = selectedLand?.tokenId;
        const newSelectedLand = landsData.find(p => p.tokenId === currentSelectedId);
        setSelectedLand(newSelectedLand || landsData[0]);
      } else {
        setSelectedLand(null);
      }
    } catch (err) {
      console.error("Error fetching lands data:", err);
      setError("Failed to load your lands. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  const fetchBuildingData = useCallback(async () => {
    if (!selectedLand) {
      setVillageBuildings([]);
      setTownBuildings([]);
      setSelectedBuilding(null);
      return;
    }

    setBuildingsLoading(true);
    try {
      const [villageData, townData] = await Promise.all([
        getVillageBuildingsByLandId(selectedLand.tokenId),
        getTownBuildingsByLandId(selectedLand.tokenId)
      ]);

      setVillageBuildings(villageData || []);
      
      // Add prebuilt buildings to town data (Warehouse ID 3, Stake House ID 1)
      const prebuiltBuildings = [
        {
          id: 1, // Stake House
          level: 1,
          maxLevel: 1,
          productionRatePlantPointsPerDay: BigInt(0),
          productionRatePlantLifetimePerDay: BigInt(0),
          accumulatedPoints: BigInt(0),
          accumulatedLifetime: BigInt(0),
          levelUpgradeCostLeaf: BigInt(0),
          levelUpgradeCostSeedInstant: BigInt(0),
          levelUpgradeBlockInterval: BigInt(0),
          isUpgrading: false,
          blockHeightUpgradeInitiated: BigInt(0),
          blockHeightUntilUpgradeDone: BigInt(0)
        },
        {
          id: 3, // Warehouse
          level: 1,
          maxLevel: 1,
          productionRatePlantPointsPerDay: BigInt(0),
          productionRatePlantLifetimePerDay: BigInt(0),
          accumulatedPoints: BigInt(0),
          accumulatedLifetime: BigInt(0),
          levelUpgradeCostLeaf: BigInt(0),
          levelUpgradeCostSeedInstant: BigInt(0),
          levelUpgradeBlockInterval: BigInt(0),
          isUpgrading: false,
          blockHeightUpgradeInitiated: BigInt(0),
          blockHeightUntilUpgradeDone: BigInt(0)
        }
      ];
      
      // Combine prebuilt buildings with contract data, avoiding duplicates
      const allTownBuildings = [...prebuiltBuildings];
      if (townData) {
        townData.forEach(building => {
          // Only add if not already in prebuilt (avoid duplicates)
          if (!prebuiltBuildings.some(prebuilt => prebuilt.id === building.id)) {
            allTownBuildings.push(building);
          }
        });
      }
      
      setTownBuildings(allTownBuildings);

      // Choose preferred building for the new land: try last selected id, else first
      const currentBuildings = buildingType === 'village' ? (villageData || []) : allTownBuildings;
      if (currentBuildings.length > 0) {
        const preferredId = lastSelectedBuildingIdRef.current;
        const preferred = preferredId != null ? currentBuildings.find(b => Number(b.id) === Number(preferredId)) : undefined;
        if (preferred) {
          if (!selectedBuilding || Number(selectedBuilding.id) !== Number(preferred.id)) {
            setSelectedBuilding(preferred);
          }
        } else if (!selectedBuilding) {
          setSelectedBuilding(currentBuildings[0]);
        }
      }
    } catch (err) {
      console.error("Error fetching building data:", err);
      setVillageBuildings([]);
      setTownBuildings([]);
    } finally {
      setBuildingsLoading(false);
    }
  }, [selectedLand, buildingType, selectedBuilding]);

  // When switching back to Warehouse, refresh the land summary to get latest warehouse balances
  useEffect(() => {
    const refreshWarehouseOnSelect = async () => {
      if (!selectedLand || buildingType !== 'town' || selectedBuilding?.id !== 3) return;
      try {
        const latest = await getLandById(selectedLand.tokenId);
        if (latest) {
          // Update only the selected land info (keeping array intact to avoid extra renders)
          setSelectedLand(latest);
        }
      } catch (e) {
        // noop
      }
    };
    refreshWarehouseOnSelect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBuilding?.id, buildingType, selectedLand?.tokenId]);

  // Combined function to refresh both building data and balances after transactions
  const handleBuildingTransactionSuccess = useCallback(() => {
    // Refresh building lists and production/upgrade stats
    fetchBuildingData();
    // Also refresh selected land summary (Warehouse totals) so WarehousePanel props stay current
    (async () => {
      try {
        if (selectedLand) {
          const latest = await getLandById(selectedLand.tokenId);
          if (latest) setSelectedLand(latest);
        }
      } catch {}
    })();
    // Balances are refreshed globally via the 'balances:refresh' event
    window.dispatchEvent(new Event('balances:refresh'));
  }, [fetchBuildingData, selectedLand]);

  useEffect(() => {
    if(address) {
      fetchData();
      fetchApprovalStatus();
    }
  }, [address, fetchData, fetchApprovalStatus]);

  // Listen for global buildings refresh events (emitted on tx success in panels)
  useEffect(() => {
    const handler = () => {
      fetchBuildingData();
      // Also refresh the selected land summary to reflect warehouse/accumulated changes
      (async () => {
        try {
          if (selectedLand) {
            const latest = await getLandById(selectedLand.tokenId);
            if (latest) setSelectedLand(latest);
          }
        } catch {}
      })();
    };
    window.addEventListener('buildings:refresh', handler as EventListener);
    return () => window.removeEventListener('buildings:refresh', handler as EventListener);
  }, [fetchBuildingData, selectedLand]);

  // Remove aggressive image preloads; Next/Image will handle efficient lazy-loading

  useEffect(() => {
    fetchBuildingData();
  }, [selectedLand, fetchBuildingData]);

  // When switching lands, refresh the selected land summary and reset visible building
  useEffect(() => {
    if (!selectedLand) return;
    // Reset selected building so fetchBuildingData will pick first of new land
    setSelectedBuilding(null);
    (async () => {
      try {
        const latest = await getLandById(selectedLand.tokenId);
        if (latest) setSelectedLand(latest);
      } catch {}
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLand?.tokenId]);

  // Track last selected building id to persist across land switches
  useEffect(() => {
    if (selectedBuilding && typeof selectedBuilding.id !== 'undefined') {
      lastSelectedBuildingIdRef.current = Number(selectedBuilding.id);
    }
  }, [selectedBuilding?.id]);

  // Watch for block updates to track upgrade progress
  // Only watch when we have buildings that are actually upgrading
  const hasUpgradingBuildings = [...villageBuildings, ...townBuildings].some(building => building.isUpgrading);
  
  useWatchBlockNumber({
    onBlockNumber(blockNumber) {
      setCurrentBlock(blockNumber);
    },
    enabled: hasUpgradingBuildings, // Only watch blocks when buildings are upgrading
    pollingInterval: 3000 // Check every 3 seconds instead of every block
  });


  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <BaseExpandedLoadingPageLoader text="Loading your lands..." />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="py-4 text-center text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (lands.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center p-4">
        <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
          <LandPlot className="w-12 h-12 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold text-foreground mb-2">
          No Lands Yet!
        </h3>
        <p className="text-muted-foreground">
          Head over to the 'Mint' tab to get your first plot of land.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* StatusBar replaces BalanceCard globally under header */}

        {lands.length > 1 && (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>Select Land</CardTitle></CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full justify-between">
                    {selectedLand ? (
                      <div className="flex items-center space-x-2">
                        <LandPlot className="w-4 h-4" />
                        <span>{selectedLand.name || `Land #${selectedLand.tokenId}`}</span>
                      </div>
                    ) : "Select a Land"}
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                  {lands.map((land) => (
                    <DropdownMenuItem key={land.tokenId.toString()} onSelect={() => setSelectedLand(land)}>
                      <div className="flex items-center space-x-2">
                        <LandPlot className="w-4 h-4" />
                        <span>{land.name || `Land #${land.tokenId}`} (XP {formatXP(land.experiencePoints)})</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        )}
      </div>

      {selectedLand && (
        <>
          <Card className="rounded-2xl">
            <CardContent className="space-y-3">
              <div className="relative w-full aspect-square bg-muted/50 overflow-hidden rounded-xl">
                <div className="absolute top-3 left-3 right-3 grid grid-cols-2 gap-2 text-sm font-bold text-foreground/80 z-20">
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1 bg-background/50 backdrop-blur-sm px-2 py-0.5 rounded-full">
                      <Image src="/icons/pts.svg" alt="XP" width={16} height={16} className="w-4 h-4" />
                      <span>{formatXP(selectedLand.experiencePoints)} XP</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button 
                      onClick={() => setIsMapOpen(true)}
                      className="flex items-center gap-1 bg-background/50 hover:bg-background/70 transition-colors backdrop-blur-sm px-2 py-0.5 rounded-full cursor-pointer"
                    >
                      <Image src="/icons/location.svg" alt="Coordinates" width={16} height={16} className="w-4 h-4" />
                      <span>({selectedLand.coordinateX.toString()}, {selectedLand.coordinateY.toString()})</span>
                    </button>
                  </div>
                </div>
                
                <div 
                  className="absolute inset-0 md:inset-8 flex items-center justify-center z-10 cursor-pointer"
                  onClick={() => setIsMapOpen(true)}
                >
                  <LandImage 
                    selectedLand={selectedLand} 
                    buildingType={buildingType}
                    villageBuildings={villageBuildings}
                    townBuildings={townBuildings}
                    priority={true}
                  />
                </div>

                {/* Next/Previous controls for multiple lands */}
                {lands.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = selectedLand ? lands.findIndex(l => l.tokenId === selectedLand.tokenId) : -1;
                        if (idx >= 0) {
                          const prevIndex = (idx - 1 + lands.length) % lands.length;
                          setSelectedLand(lands[prevIndex]);
                        }
                      }}
                      className="absolute left-2 top-1/2 -translate-y-1/2 z-20 inline-flex items-center justify-center h-9 w-9 rounded-full bg-background/70 backdrop-blur-sm border border-border shadow-sm hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                      aria-label="Previous land"
                      title="Previous"
                    >
                      <ChevronLeft className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const idx = selectedLand ? lands.findIndex(l => l.tokenId === selectedLand.tokenId) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx + 1) % lands.length;
                          setSelectedLand(lands[nextIndex]);
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 z-20 inline-flex items-center justify-center h-9 w-9 rounded-full bg-background/70 backdrop-blur-sm border border-border shadow-sm hover:bg-background/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                      aria-label="Next land"
                      title="Next"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </>
                )}
              </div>

              <div className="text-center">
                <div className="relative inline-block">
                  <h3 className="text-lg font-bold font-pixel">{selectedLand.name || `Land #${selectedLand.tokenId}`}</h3>
                  <EditLandName
                    land={selectedLand}
                    onNameChanged={(landId, newName) => {
                      setSelectedLand(prev => prev ? { ...prev, name: newName } : null);
                      // update any cached arrays if present
                    }}
                    iconSize={16}
                    className="absolute top-0 left-full ml-1"
                  />
                </div>
                <p className="text-sm text-muted-foreground">Token ID: {selectedLand.tokenId.toString()}</p>
              </div>
            </CardContent>
          </Card>

          {/* Building Management Section */}
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex justify-between items-center">
              <CardTitle className="font-pixel">Buildings</CardTitle>
              <ToggleGroup
                value={buildingType}
                onValueChange={(v) => {
                  const newType = v as 'village' | 'town';
                  setBuildingType(newType);
                  setSelectedBuilding((newType === 'village' ? villageBuildings[0] : townBuildings[0]) || null);
                }}
                options={[
                  { value: 'village', label: 'Village' },
                  { value: 'town', label: 'Town' },
                ]}
              />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Building Grid */}
              <div>
                {buildingsLoading && (!villageBuildings.length && !townBuildings.length) ? (
                  <div className="text-center text-muted-foreground p-6">
                    Loading buildings...
                  </div>
                ) : (
                  <BuildingGrid
                    buildings={buildingType === 'village' ? villageBuildings : townBuildings}
                    buildingType={buildingType}
                    selectedBuilding={selectedBuilding}
                    onBuildingSelect={setSelectedBuilding}
                    currentBlock={currentBlock}
                  />
                )}
              </div>

              {/* Building Details Panel */}
              {selectedBuilding && (
                <BuildingDetailsPanel
                  selectedBuilding={selectedBuilding}
                  landId={selectedLand.tokenId}
                  buildingType={buildingType}
                  onUpgradeSuccess={handleBuildingTransactionSuccess}
                  currentBlock={currentBlock}
                  needsLeafApproval={needsLeafApproval}
                  onLeafApprovalSuccess={() => setNeedsLeafApproval(false)}
                  needsSeedApproval={needsSeedApproval}
                  onSeedApprovalSuccess={() => setNeedsSeedApproval(false)}
                  warehousePoints={selectedLand.accumulatedPlantPoints}
                  warehouseLifetime={selectedLand.accumulatedPlantLifetime}
                />
              )}
            </div>
          </CardContent>
        </Card>
        </>
      )}
      {/* Map Modal */}
      {selectedLand && (
        <LandMapModal
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          userLands={lands}
          selectedLand={selectedLand}
          onSelectLand={(land) => {
            setSelectedLand(land);
            setIsMapOpen(false);
          }}
          totalSupply={totalSupply}
          neighborData={neighborData}
        />
      )}
    </div>
  );
}