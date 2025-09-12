"use client";

import React, { useMemo, useCallback } from 'react';
import Image from 'next/image';
import { BuildingData, BuildingType } from '@/lib/types';
import { getBuildingName, getBuildingIcon } from '@/lib/utils';

interface BuildingGridProps {
  buildings: BuildingData[];
  buildingType: BuildingType;
  selectedBuilding: BuildingData | null;
  onBuildingSelect: (building: BuildingData) => void;
  currentBlock: bigint;
}

// Individual building item memoized to prevent unnecessary re-renders
const BuildingItem = React.memo(({ 
  building, 
  buildingType, 
  isSelected, 
  onBuildingSelect 
}: {
  building: BuildingData;
  buildingType: BuildingType;
  isSelected: boolean;
  onBuildingSelect: (building: BuildingData) => void;
}) => {
  // Memoize building name and icon computation
  const { buildingName, buildingIcon } = useMemo(() => {
    const name = getBuildingName(building.id, buildingType === 'town');
    const icon = getBuildingIcon(name);
    return { buildingName: name, buildingIcon: icon };
  }, [building.id, buildingType]);

  const isMaxLevel = building.level >= building.maxLevel;

  return (
    <div className="space-y-1">
      {/* Building Icon Button */}
      <div className="flex justify-center">
        <button
          onClick={() => onBuildingSelect(building)}
        className={`building-button p-0.5 transition-all rounded-md building-element focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${
            isSelected ? 'bg-primary' : 'bg-transparent'
          }`}
        >
        <div className={`building-element flex items-center justify-center p-2 transition-all rounded-md w-16 h-16 relative ${
            isSelected ? 'bg-primary/10' : 'bg-card hover:bg-accent'
          }`}>
            <Image 
              src={buildingIcon} 
              alt={buildingName} 
              width={40} 
              height={40} 
              className={`building-icon ${
                building.level === 0 ? 'filter grayscale opacity-50' : ''
              }`}
              style={{ height: 'auto' }}
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
          Lv. {building.level}/{building.maxLevel}
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
  currentBlock
}: BuildingGridProps) {

  const handleBuildingSelect = useCallback((building: BuildingData) => {
    onBuildingSelect(building);
  }, [onBuildingSelect]);

  if (!buildings || buildings.length === 0) {
    return (
      <div className="text-center text-muted-foreground p-6">
        No {buildingType} buildings available
      </div>
    );
  }

  return (
    <div className="grid grid-cols-4 gap-4 justify-items-center">
      {buildings.map((building) => {
        const isSelected = selectedBuilding?.id === building.id;

        return (
          <BuildingItem
            key={building.id}
            building={building}
            buildingType={buildingType}
            isSelected={isSelected}
            onBuildingSelect={handleBuildingSelect}
          />
        );
      })}
    </div>
  );
}