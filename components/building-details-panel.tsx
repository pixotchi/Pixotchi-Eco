"use client";

import React, { useState } from 'react';
import { BuildingData, BuildingType } from '@/lib/types';
import { CLIENT_ENV } from '@/lib/env-config';
import { getBuildingName, getBuildingIcon } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { Info } from 'lucide-react';
import BuildingInfoDialog from './building-info-dialog';

// Import the new specialized panel components
import UpgradePanel from './building-details/UpgradePanel';
import ProductionPanel from './building-details/ProductionPanel';
import WarehousePanel from './building-details/WarehousePanel';
import FarmerHousePanel from './building-details/FarmerHousePanel';
import MarketplacePanel from './building-details/MarketplacePanel';
import StakeHousePanel from './building-details/StakeHousePanel';
import CasinoPanel from './building-details/CasinoPanel';
import BarracksPanelV2 from './building-details/BarracksPanelV2';

// Casino feature flag - hide casino when disabled
const CASINO_ENABLED = CLIENT_ENV.CASINO_ENABLED;
const BARRACKS_ENABLED = CLIENT_ENV.BARRACKS_ENABLED;

interface BuildingDetailsPanelProps {
  selectedBuilding: BuildingData | null;
  landId: bigint;
  buildingType: BuildingType;
  onUpgradeSuccess: () => void;
  currentBlock: bigint;
  leafAllowance?: bigint;
  onLeafApprovalSuccess?: () => void;
  seedAllowance?: bigint;
  onSeedApprovalSuccess?: () => void;
  warehousePoints?: bigint;
  warehouseLifetime?: bigint;
  villageBuildings?: BuildingData[];
  allowancesReady?: boolean;
  allowancesError?: string | null;
  onRetryAllowances?: () => void;
}

function BuildingDetailsPanel({
  selectedBuilding,
  landId,
  buildingType,
  onUpgradeSuccess,
  currentBlock,
  leafAllowance = BigInt(0),
  onLeafApprovalSuccess,
  seedAllowance = BigInt(0),
  onSeedApprovalSuccess,
  warehousePoints,
  warehouseLifetime,
  villageBuildings = [],
  allowancesReady = true,
  allowancesError,
  onRetryAllowances,
}: BuildingDetailsPanelProps) {
  const [showInfoDialog, setShowInfoDialog] = useState(false);

  const isCasino = buildingType === 'town' && selectedBuilding?.id === 6;

  if (!selectedBuilding) {
    return (
      <Card className="surface-detail">
        <CardContent className="flex flex-col items-center justify-center py-12 px-6 text-center">
          <div className="w-12 h-12 mb-4 rounded-full bg-muted flex items-center justify-center">
            <span className="text-2xl">🏗️</span>
          </div>
          <p className="text-base font-semibold text-foreground mb-1">No Building Selected</p>
          <p className="text-sm text-muted-foreground">
            Select a building to view details and upgrade options
          </p>
        </CardContent>
      </Card>
    );
  }

  const buildingName = getBuildingName(selectedBuilding.id, buildingType === 'town');
  const buildingIcon = getBuildingIcon(buildingName);

  const isPrebuiltTown = buildingType === 'town' && (selectedBuilding.id === 1 || selectedBuilding.id === 3);
  const isBarracks = buildingType === 'town' && selectedBuilding.id === 8;
  // isCasino is defined above via useEffect

  const renderBuildingContent = () => {
    // Existing quests remain claimable onchain throughout a Farmer House upgrade.
    if (selectedBuilding.isUpgrading && !(buildingType === 'town' && selectedBuilding.id === 7)) {
      return (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Building is upgrading. Functions are temporarily unavailable until the upgrade completes.
        </div>
      );
    }

    if (buildingType === 'village') {
      if (selectedBuilding.level === 0) {
        return (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Building hasn&apos;t been constructed yet. Upgrade to level 1 to start.
          </div>
        )
      }
      return <ProductionPanel building={selectedBuilding} landId={landId} onClaimSuccess={onUpgradeSuccess} />;
    }

    if (buildingType === 'town') {
      switch (selectedBuilding.id) {
        case 1: // Stake House
          return <StakeHousePanel />;
        case 3: // Warehouse
          return (
            <WarehousePanel
              landId={landId}
              warehousePoints={warehousePoints}
              warehouseLifetime={warehouseLifetime}
              onApplySuccess={onUpgradeSuccess}
            />
          );
        case 5: // Marketplace
          if (selectedBuilding.level === 0) {
            return (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Building hasn&apos;t been constructed yet. Upgrade to level 1 to start.
              </div>
            );
          }
          return <MarketplacePanel landId={landId} />;
        case 6: // Casino/Roulette - CasinoPanel handles both build (level 0) and game UI
          if (!CASINO_ENABLED) return null;
          return (
            <CasinoPanel
              landId={landId}
              initialIsBuilt={selectedBuilding.level > 0}
              onSpinComplete={onUpgradeSuccess}
            />
          );
        case 7: // Farmer House
          if (selectedBuilding.level === 0) {
            return (
              <div className="text-center py-8 text-muted-foreground text-sm">
                Building hasn&apos;t been constructed yet. Upgrade to level 1 to start.
              </div>
            );
          }
          return (
            <FarmerHousePanel
              landId={landId}
              farmerHouseLevel={selectedBuilding.level}
              isUpgrading={selectedBuilding.isUpgrading}
              onQuestUpdate={onUpgradeSuccess}
            />
          );
        case 8: // Barracks
          if (!BARRACKS_ENABLED) return null;
          return (
            <BarracksPanelV2
              landId={landId}
              currentBlock={currentBlock}
              onUpdate={onUpgradeSuccess}
              villageBuildings={villageBuildings}
            />
          );
        default:
          return (
            <div className="text-center py-4 space-y-2 text-muted-foreground text-sm">
              This building provides special services.
            </div>
          );
      }
    }

    return null;
  };

  return (
    <Card className="surface-detail">
      <CardHeader className="@container/building-heading">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 @min-[18rem]/building-heading:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Image
            src={buildingIcon}
            alt={buildingName}
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-md object-contain"
          />
          <div className="col-span-2 row-start-2 min-w-0 @min-[18rem]/building-heading:col-span-1 @min-[18rem]/building-heading:col-start-2 @min-[18rem]/building-heading:row-start-1">
            <CardTitle className="[overflow-wrap:anywhere]">{buildingName}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {`Level ${selectedBuilding.level}/${selectedBuilding.maxLevel}`}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="col-start-2 row-start-1 @min-[18rem]/building-heading:col-start-3"
            onClick={() => setShowInfoDialog(true)}
            aria-label={`Info about ${buildingName}`}
            title={`Info about ${buildingName}`}
          >
            <Info className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {renderBuildingContent()}

        {!isPrebuiltTown && !isCasino && !isBarracks && (
          <UpgradePanel
            building={selectedBuilding}
            landId={landId}
            buildingType={buildingType}
            currentBlock={currentBlock}
            leafAllowance={leafAllowance}
            onUpgradeSuccess={onUpgradeSuccess}
            onLeafApprovalSuccess={onLeafApprovalSuccess || (() => { })}
            seedAllowance={seedAllowance}
            allowancesReady={allowancesReady}
            allowancesError={allowancesError}
            onRetryAllowances={onRetryAllowances}
            onSeedApprovalSuccess={onSeedApprovalSuccess || (() => { })}
          />
        )}

        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            {buildingType === 'village'
              ? 'Village buildings produce daily resources for your plants.'
              : 'Town buildings provide advanced services and perks.'
            }
          </p>
        </div>
      </CardContent>

      {/* Building Info Dialog */}
      <BuildingInfoDialog
        open={showInfoDialog}
        onOpenChange={setShowInfoDialog}
        building={selectedBuilding}
        buildingType={buildingType}
      />
    </Card>
  );
}

export default React.memo(BuildingDetailsPanel); 
