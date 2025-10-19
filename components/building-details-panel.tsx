"use client";

import React from 'react';
import { BuildingData, BuildingType } from '@/lib/types';
import { getBuildingName, getBuildingIcon } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';

// Import the new specialized panel components
import UpgradePanel from './building-details/UpgradePanel';
import ProductionPanel from './building-details/ProductionPanel';
import WarehousePanel from './building-details/WarehousePanel';
import FarmerHousePanel from './building-details/FarmerHousePanel';
import MarketplacePanel from './building-details/MarketplacePanel';
import StakeHousePanel from './building-details/StakeHousePanel';

interface BuildingDetailsPanelProps {
  selectedBuilding: BuildingData | null;
  landId: bigint;
  buildingType: BuildingType;
  onUpgradeSuccess: () => void;
  currentBlock: bigint;
  needsLeafApproval?: boolean;
  onLeafApprovalSuccess?: () => void;
  warehousePoints?: bigint;
  warehouseLifetime?: bigint;
}

function BuildingDetailsPanel({ 
  selectedBuilding, 
  landId,
  buildingType,
  onUpgradeSuccess,
  currentBlock,
  needsLeafApproval = false,
  onLeafApprovalSuccess,
  warehousePoints,
  warehouseLifetime
}: BuildingDetailsPanelProps) {
  
  if (!selectedBuilding) {
    return (
      <Card>
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

  const renderBuildingContent = () => {
    // Globally gate building functions while upgrading, regardless of level/type
    if (selectedBuilding.isUpgrading) {
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
                Building hasn't been constructed yet. Upgrade to level 1 to start.
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
          return <MarketplacePanel landId={landId} />;
        case 7: // Farmer House
          return (
            <FarmerHousePanel 
              landId={landId} 
              farmerHouseLevel={selectedBuilding.level} 
              onQuestUpdate={onUpgradeSuccess}
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
    <Card>
      <CardHeader>
        <div className="flex items-center space-x-3">
          <Image 
            src={buildingIcon} 
            alt={buildingName} 
            width={48} 
            height={48} 
            className="rounded-md"
            style={{ height: 'auto' }}
          />
          <div>
            <CardTitle className="font-pixel">{buildingName}</CardTitle>
            <p className="text-sm text-muted-foreground">
              Level {selectedBuilding.level}/{selectedBuilding.maxLevel}
            </p>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {renderBuildingContent()}

        {!isPrebuiltTown && (
          <UpgradePanel 
            building={selectedBuilding}
            landId={landId}
            buildingType={buildingType}
            currentBlock={currentBlock}
            needsLeafApproval={needsLeafApproval}
            onUpgradeSuccess={onUpgradeSuccess}
            onLeafApprovalSuccess={onLeafApprovalSuccess || (() => {})}
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
    </Card>
  );
}

export default React.memo(BuildingDetailsPanel); 