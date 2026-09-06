import { formatUnits } from 'viem';
import { readBoolean, readSafeUint, readTupleField, readUint } from './contract-value';
import type { BuildingData, BuildingType, Land } from './types';

const ZERO = BigInt(0);

/**
 * Active Village facet 0xacb9D91D83e6eDfEb6CFFa3d94DE42C30a8e5809:
 * LibVillage._calculateAccumulatedPoints multiplies the configured rate by
 * PLANT_POINT_DECIMALS / 10 = 12 / 10. PTS amounts still use 12 decimals.
 * Verified against Base block 50970930. Recheck this rule on facet upgrades.
 * Never apply this conversion to accumulated PTS or lifetime.
 */
export function effectiveDailyPoints(configuredRate: bigint): bigint {
  return configuredRate * BigInt(6) / BigInt(5);
}

type ProductionBuilding = Pick<BuildingData,
  'level' | 'isUpgrading' | 'productionRatePlantPointsPerDay' | 'productionRatePlantLifetimePerDay'>;

export function getVillageProductionRates(building: ProductionBuilding) {
  const pointsPerDayWhenReady = building.level > 0
    ? effectiveDailyPoints(building.productionRatePlantPointsPerDay) : ZERO;
  const lifetimePerDaySecondsWhenReady = building.level > 0
    ? building.productionRatePlantLifetimePerDay : ZERO;
  return {
    pointsPerDay: building.isUpgrading ? ZERO : pointsPerDayWhenReady,
    lifetimePerDaySeconds: building.isUpgrading ? ZERO : lifetimePerDaySecondsWhenReady,
    pointsPerDayWhenReady,
    lifetimePerDaySecondsWhenReady,
  };
}

/** Decode only production-related fields; TownBuilding has no production fields. */
export function readBuildingProduction(value: unknown, kind: BuildingType) {
  const uint = (name: string, index: number) => readUint(readTupleField(value, name, index) ?? ZERO);
  const building = {
    id: readSafeUint(readTupleField(value, 'id', 0)),
    level: readSafeUint(readTupleField(value, 'level', 1)),
    maxLevel: readSafeUint(readTupleField(value, 'maxLevel', 2) ?? 0),
    isUpgrading: readBoolean(readTupleField(value, 'isUpgrading', kind === 'village' ? 7 : 5) ?? false),
    productionRatePlantPointsPerDay: kind === 'village' ? uint('productionRatePlantPointsPerDay', 12) : ZERO,
    productionRatePlantLifetimePerDay: kind === 'village' ? uint('productionRatePlantLifetimePerDay', 11) : ZERO,
    accumulatedPoints: kind === 'village' ? uint('accumulatedPoints', 5) : ZERO,
    accumulatedLifetime: kind === 'village' ? uint('accumulatedLifetime', 6) : ZERO,
  };
  return { ...building, ...getVillageProductionRates(building) };
}

export function landPointsToNumber(points: bigint): number {
  return Number(formatUnits(points, 12));
}

type StoredLandResources = Pick<Land, 'experiencePoints' | 'accumulatedPlantPoints' | 'accumulatedPlantLifetime'>;

/** Numbers returned to statistics consumers are already in XP, PTS and seconds. */
export function normalizeLandResources(land: StoredLandResources) {
  return {
    experiencePoints: Number(formatUnits(land.experiencePoints, 18)),
    storedPTS: landPointsToNumber(land.accumulatedPlantPoints),
    storedTOD: Number(land.accumulatedPlantLifetime),
  };
}

export function sumLandResources(lands: StoredLandResources[]) {
  return normalizeLandResources(lands.reduce((total, land) => ({
    experiencePoints: total.experiencePoints + land.experiencePoints,
    accumulatedPlantPoints: total.accumulatedPlantPoints + land.accumulatedPlantPoints,
    accumulatedPlantLifetime: total.accumulatedPlantLifetime + land.accumulatedPlantLifetime,
  }), { experiencePoints: ZERO, accumulatedPlantPoints: ZERO, accumulatedPlantLifetime: ZERO }));
}
