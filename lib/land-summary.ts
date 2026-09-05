import type { BuildingData, BuildingType } from './types';

/** Pure selectors keep the overview and building panels on the same resource units. */
export function getLandActionSummary(village: readonly BuildingData[], town: readonly BuildingData[], block: bigint) {
  const production = village.filter(building => [0, 3, 5].includes(building.id) && building.level > 0 && !building.isUpgrading);
  const ready = production.filter(building => building.accumulatedPoints > BigInt(0) || building.accumulatedLifetime > BigInt(0));
  const upgrades = ([['village', village], ['town', town]] as const).flatMap(([type, buildings]) =>
    buildings.filter(building => building.isUpgrading).map(building => ({
      type: type as BuildingType, building,
      ready: block > BigInt(0) && block >= building.blockHeightUntilUpgradeDone,
    })));
  return { ready, upgrades, points: ready.reduce((sum, b) => sum + b.accumulatedPoints, BigInt(0)), lifetime: ready.reduce((sum, b) => sum + b.accumulatedLifetime, BigInt(0)) };
}
