"use client";

import { EmptyState } from '@/components/ui/empty-state';
import { Building2 } from 'lucide-react';
import { CLIENT_ENV } from '@/lib/env-config';
import { BuildingData,BuildingType } from '@/lib/types';
import { getBuildingIcon,getBuildingName } from '@/lib/utils';
import Image from 'next/image';
import React,{ useCallback,useMemo } from 'react';

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
  extraItems?: React.ReactNode;
  gridClassName?: string;
  denseLabels?: boolean;
}

/** One full-size interactive tile, shared by buildings and cross-land tools. */
export function BuildingTile({ label, subtitle, selected, onSelect, icon, status, ariaLabel }: {
  label: string; subtitle: string; selected: boolean; onSelect: () => void;
  icon: React.ReactNode; status?: React.ReactNode; ariaLabel: string;
}) {
  return <button type="button" onClick={onSelect} aria-label={ariaLabel} aria-pressed={selected}
    className={`building-button building-element relative flex min-h-28 min-w-0 w-full flex-col items-center gap-1 rounded-[var(--radius-control)] border px-1 py-2 text-center transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${selected ? 'border-primary/45 bg-primary/10 bg-[image:var(--gradient-selection)] shadow-[var(--shadow-glow)]' : 'border-border/45 bg-card/75 surface-shadow hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))]'}`}>
    <span className="relative flex h-16 w-16 shrink-0 items-center justify-center">{icon}</span>
    <span className="flex w-full flex-col items-center gap-0.5">
      <span className="w-full text-xs font-semibold leading-4 [overflow-wrap:anywhere]">{label}</span>
      <span className="text-xs leading-4 tabular-nums text-muted-foreground">{subtitle}</span>
      {status && <span className="text-xs leading-4 text-primary">{status}</span>}
    </span>
  </button>;
}

const BuildingItem = React.memo(({ building, buildingType, isSelected, onBuildingSelect }: {
  building: BuildingData; buildingType: BuildingType; isSelected: boolean;
  onBuildingSelect: (building: BuildingData) => void;
}) => {
  const name = getBuildingName(building.id, buildingType === 'town');
  return <BuildingTile label={name} subtitle={`Level ${building.level}/${building.maxLevel}`}
    selected={isSelected} onSelect={() => onBuildingSelect(building)} ariaLabel={`Select ${name}`}
    status={building.isUpgrading ? 'Upgrading…' : building.level >= building.maxLevel ? 'Max level' : undefined}
    icon={<Image src={getBuildingIcon(name)} alt="" width={64} height={64}
      className={`building-icon h-16 w-16 object-contain ${building.level === 0 ? 'grayscale opacity-50' : ''}`} />} />;
});

BuildingItem.displayName = 'BuildingItem';

export default function BuildingGrid({
  buildings,
  buildingType,
  selectedBuilding,
  selectedBuildingType = buildingType,
  onBuildingSelect,
  extraItems,
  gridClassName
}: BuildingGridProps) {
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
      <EmptyState
        icon={Building2}
        title="No buildings available"
        description={`No ${buildingType} buildings found.`}
      />
    );
  }

  return (
    <div className="@container/buildings"><div className={gridClassName || "grid grid-cols-[repeat(auto-fit,minmax(min(100%,6rem),1fr))] gap-3 items-stretch"}>
      {visibleBuildings.map((building) => {
        const isSelected = selectedBuildingType === buildingType && selectedBuilding?.id === building.id;

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
      {extraItems}
    </div></div>
  );
}
