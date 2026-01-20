"use client";

import React, { useMemo, useCallback, useState, useEffect } from 'react';
import Image from 'next/image';
import { BuildingData, BuildingType } from '@/lib/types';
import { getBuildingName, getBuildingIcon } from '@/lib/utils';
import { casinoIsBuilt } from '@/lib/contracts';

// Casino feature flag - hide casino building when disabled
const CASINO_ENABLED = process.env.NEXT_PUBLIC_CASINO_ENABLED === 'true';

interface BuildingGridProps {
  buildings: BuildingData[];
  buildingType: BuildingType;
  selectedBuilding: BuildingData | null;
  onBuildingSelect: (building: BuildingData) => void;
  currentBlock: bigint;
  landId: bigint;
}

// Individual building item memoized to prevent unnecessary re-renders
const BuildingItem = React.memo(({
  building,
  buildingType,
  isSelected,
  onBuildingSelect,
  casinoBuiltState
}: {
  building: BuildingData;
  buildingType: BuildingType;
  isSelected: boolean;
  onBuildingSelect: (building: BuildingData) => void;
  casinoBuiltState?: boolean | null;
}) => {
  // Memoize building name and icon computation
  const { buildingName, buildingIcon } = useMemo(() => {
    const name = getBuildingName(building.id, buildingType === 'town');
    const icon = getBuildingIcon(name);
    return { buildingName: name, buildingIcon: icon };
  }, [building.id, buildingType]);

  const isCasino = buildingType === 'town' && building.id === 6;
  // For Casino, use casinoBuiltState; for others, use building.level
  const effectiveLevel = isCasino && casinoBuiltState ? 1 : building.level;
  const isMaxLevel = effectiveLevel >= building.maxLevel;

  return (
    <div className="space-y-1">
      {/* Building Icon Button */}
      <div className="flex justify-center">
        <button
          onClick={() => onBuildingSelect(building)}
          className={`building-button p-0.5 transition-all rounded-md building-element focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${isSelected ? 'bg-primary' : 'bg-transparent'
            }`}
        >
          <div className={`building-element flex items-center justify-center p-2 transition-all rounded-md w-16 h-16 relative ${isSelected ? 'bg-primary/10' : 'bg-card hover:bg-accent'
            }`}>
            <Image
              src={buildingIcon}
              alt={buildingName}
              width={40}
              height={40}
              className={`building-icon ${effectiveLevel === 0 ? 'filter grayscale opacity-50' : ''
                }`}
              style={{ width: 'auto', height: 'auto' }}
            />

            {/* Max Level Badge */}
            {isMaxLevel && (
              <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-sm flex items-center justify-center">
                <span className="text-xs font-bold text-black">★</span>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Building Info */}
      <div className="text-center">
        <div className="text-xs font-semibold truncate" title={buildingName}>
          {buildingName}
        </div>
        <div className="text-xs text-muted-foreground">
          Lv. {effectiveLevel}/{building.maxLevel}
        </div>

        {/* Upgrade Status */}
        {building.isUpgrading && (
          <div className="text-xs text-primary animate-pulse">
            Upgrading...
          </div>
        )}
      </div>
    </div>
  );
});

BuildingItem.displayName = 'BuildingItem';

export default function BuildingGrid({
  buildings,
  buildingType,
  selectedBuilding,
  onBuildingSelect,
  currentBlock,
  landId
}: BuildingGridProps) {
  const [casinoBuiltState, setCasinoBuiltState] = useState<boolean | null>(null);

  // Fetch casino built state for town buildings
  useEffect(() => {
    if (buildingType === 'town' && landId) {
      casinoIsBuilt(landId).then(setCasinoBuiltState).catch(() => setCasinoBuiltState(false));
    }
  }, [buildingType, landId]);

  const handleBuildingSelect = useCallback((building: BuildingData) => {
    onBuildingSelect(building);
  }, [onBuildingSelect]);

  // Filter out casino (ID 6) if feature is disabled
  const visibleBuildings = useMemo(() => {
    if (!CASINO_ENABLED && buildingType === 'town') {
      return buildings.filter(b => b.id !== 6);
    }
    return buildings;
  }, [buildings, buildingType]);

  if (!visibleBuildings || visibleBuildings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
        <div className="w-12 h-12 mb-4 rounded-full bg-muted flex items-center justify-center">
          <span className="text-2xl">🏘️</span>
        </div>
        <p className="text-base font-semibold text-foreground mb-1">No Buildings Available</p>
        <p className="text-sm text-muted-foreground">
          No {buildingType} buildings found
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4 justify-items-center">
      {visibleBuildings.map((building) => {
        const isSelected = selectedBuilding?.id === building.id;

        return (
          <BuildingItem
            key={building.id}
            building={building}
            buildingType={buildingType}
            isSelected={isSelected}
            onBuildingSelect={handleBuildingSelect}
            casinoBuiltState={casinoBuiltState}
          />
        );
      })}
    </div>
  );
}