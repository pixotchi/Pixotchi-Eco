import type { BuildingData, BuildingType } from './types';

/** A render can happen before effects run. Never expose another land's arrays. */
export function readMatchingLandBuildings(currentIdentity: string | null, snapshotIdentity: string | null,
  village: BuildingData[], town: BuildingData[], type: BuildingType, selectedId: number | null) {
  const matches = currentIdentity !== null && currentIdentity === snapshotIdentity;
  const villageBuildings = matches ? village : [];
  const townBuildings = matches ? town : [];
  return { matches, villageBuildings, townBuildings,
    selectedBuilding: (type === 'village' ? villageBuildings : townBuildings).find(building => building.id === selectedId) ?? null };
}
