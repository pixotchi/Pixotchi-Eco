"use client";

import { casinoIsBuilt } from '@/lib/contracts';
import { CLIENT_ENV } from '@/lib/env-config';
import { BuildingData,BuildingType } from '@/lib/types';
import { getBuildingIcon,getBuildingName } from '@/lib/utils';
import Image from 'next/image';
import React,{ useCallback,useEffect,useMemo,useState } from 'react';

// Casino feature flag - hide casino building when disabled
const CASINO_ENABLED = CLIENT_ENV.CASINO_ENABLED;
const BARRACKS_ENABLED = CLIENT_ENV.BARRACKS_ENABLED;
interface BuildingGridProps {
  buildings: BuildingData[];
  buildingType: BuildingType;
  selectedBuilding: BuildingData | null;
  selectedBuildingType?: BuildingType;
  onBuildingSelect: (building: BuildingData) => void;
  currentBlock: bigint;
  landId: bigint;
  gridClassName?: string;
  denseLabels?: boolean;
}

// Individual building item memoized to prevent unnecessary re-renders
const BuildingItem = React.memo(({
  building,
  buildingType,
  isSelected,
  onBuildingSelect,
  casinoBuiltState,
  denseLabels
}: {
  building: BuildingData;
  buildingType: BuildingType;
  isSelected: boolean;
  onBuildingSelect: (building: BuildingData) => void;
  casinoBuiltState?: boolean | null;
  denseLabels?: boolean;
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
    <div className={`${denseLabels ? 'w-20 min-w-0 ' : ''}space-y-1`}>
      {/* Building Icon Button */}
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => onBuildingSelect(building)}
          aria-label={`Select ${buildingName}`}
          aria-pressed={isSelected}
          className={`building-button rounded-[var(--radius-control)] border p-0 transition-[background-color,border-color,box-shadow,transform] building-element focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background disabled:cursor-default disabled:opacity-100 ${isSelected ? 'border-primary/45 bg-primary/10 bg-[image:var(--gradient-selection)] shadow-[var(--shadow-glow)]' : 'border-border/45 bg-card/75 surface-shadow hover:-translate-y-0.5 hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))]'
            }`}
        >
          <div className="building-element relative flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] p-2">
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
              <div className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-sm bg-[hsl(var(--warning))]">
                <span className="text-xs font-bold text-[hsl(var(--warning-foreground))]">★</span>
              </div>
            )}
          </div>
        </button>
      </div>

      {/* Building Info */}
      <div className={`${denseLabels ? 'min-w-0 ' : ''}text-center`}>
        <div
          className={denseLabels
            ? "min-h-[1.75rem] text-[11px] font-semibold leading-tight [overflow-wrap:anywhere]"
            : "text-xs font-semibold truncate"
          }
          title={buildingName}
        >
          {buildingName}
        </div>
        <div className={denseLabels ? "text-[11px] leading-tight text-muted-foreground" : "text-xs text-muted-foreground"}>
          {`Lv. ${effectiveLevel}/${building.maxLevel}`}
        </div>

        {/* Upgrade Status */}
        {building.isUpgrading && (
          <div className={denseLabels ? "text-[11px] leading-tight text-primary animate-pulse" : "text-xs text-primary animate-pulse"}>
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
  selectedBuildingType = buildingType,
  onBuildingSelect,
  landId,
  gridClassName,
  denseLabels = false
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
    if (buildingType === 'town') {
      return buildings.filter((building) => {
        if (!CASINO_ENABLED && building.id === 6) return false;
        if (!BARRACKS_ENABLED && building.id === 8) return false;
        return true;
      });
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
    <div className={gridClassName || "grid grid-cols-4 gap-4 justify-items-center"}>
      {visibleBuildings.map((building) => {
        const isSelected = selectedBuildingType === buildingType && selectedBuilding?.id === building.id;

        return (
          <BuildingItem
            key={building.id}
            building={building}
            buildingType={buildingType}
            isSelected={isSelected}
            onBuildingSelect={handleBuildingSelect}
            casinoBuiltState={casinoBuiltState}
            denseLabels={denseLabels}
          />
        );
      })}
    </div>
  );
}
