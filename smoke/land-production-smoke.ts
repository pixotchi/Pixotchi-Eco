import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import BuildingInfoDialog from '../components/building-info-dialog';
import type { BuildingData } from '../lib/types';
import { decodeFunctionResult, encodeFunctionResult, type Abi } from 'viem';
import { landAbi } from '../public/abi/pixotchi-v3-abi';
import {
  effectiveDailyPoints, getVillageProductionRates, landPointsToNumber,
  normalizeLandResources, readBuildingProduction, sumLandResources,
} from '../lib/land-production';
import type { UserGameStats } from '../lib/user-stats-service';

const zero = BigInt(0);
// Live Soil Factory L2 data, Land 712. Rates and delta independently captured
// at Base blocks 50970630 -> 50970930, 600 seconds apart (2026-09-06).
const village = {
  id: 3, level: 2, maxLevel: 3,
  blockHeightUpgradeInitiated: BigInt(40000000),
  blockHeightUntilUpgradeDone: BigInt(40010000),
  accumulatedPoints: BigInt('115187164444444'),
  accumulatedLifetime: zero, isUpgrading: false,
  levelUpgradeCostLeaf: BigInt('2000000000000000000000000'),
  levelUpgradeCostSeedInstant: BigInt('123000000000000000000'),
  levelUpgradeBlockInterval: BigInt(86400),
  productionRatePlantLifetimePerDay: zero,
  productionRatePlantPointsPerDay: BigInt('34240000000000'),
  claimedBlockHeight: BigInt(50849000),
};

function abiForms(functionName: string, building: Record<string, unknown>) {
  const definition = landAbi.find(entry => entry.type === 'function' && entry.name === functionName);
  assert(definition && 'outputs' in definition);
  const tuple = definition.outputs[0];
  assert(tuple && 'components' in tuple);
  const data = encodeFunctionResult({ abi: landAbi as Abi, functionName, result: [building] });
  const decoded = decodeFunctionResult({ abi: landAbi as Abi, functionName, data }) as Record<string, unknown>[];
  // Decode the same bytes without component names to exercise actual tuple positions.
  const positionalAbi = [{ ...definition, outputs: [{ ...tuple, components: tuple.components.map(field => ({ ...field, name: '' })) }] }] as Abi;
  const positional = decodeFunctionResult({ abi: positionalAbi, functionName, data }) as unknown[][];
  return [decoded[0], positional[0]];
}

async function main() {
  for (const input of abiForms('villageGetVillageBuildingsByLandId', village)) {
    const result = readBuildingProduction(input, 'village');
    assert.equal(result.pointsPerDay, BigInt('41088000000000'));
    assert.equal(landPointsToNumber(result.pointsPerDay), 41.088);
    assert.equal(result.accumulatedPoints, village.accumulatedPoints, 'Stored PTS must never receive the rate multiplier');
    assert.equal(result.lifetimePerDaySeconds, zero);
    assert.equal(result.isUpgrading, false, 'Upgrade costs must not be decoded as the upgrade flag');
    const observedDelta = BigInt('285333333333');
    assert.equal(result.pointsPerDay * BigInt(600) / BigInt(86400), observedDelta);
  }

  assert.equal(effectiveDailyPoints(BigInt('8150000000000')), BigInt('9780000000000'));
  assert.equal(effectiveDailyPoints(BigInt('85000000000000')), BigInt('102000000000000'));
  const bee = { ...village, id: 5, productionRatePlantPointsPerDay: zero, productionRatePlantLifetimePerDay: BigInt(3636) };
  assert.equal(getVillageProductionRates(bee).lifetimePerDaySeconds, BigInt(3636), 'Lifetime uses plain seconds and no PTS multiplier');
  for (const input of abiForms('villageGetVillageBuildingsByLandId', { ...bee, isUpgrading: true })) {
    const result = readBuildingProduction(input, 'village');
    assert.equal(result.lifetimePerDaySeconds, zero);
    assert.equal(result.lifetimePerDaySecondsWhenReady, BigInt(3636));
  }
  const upgrading = getVillageProductionRates({ ...village, isUpgrading: true });
  assert.equal(upgrading.pointsPerDay, zero);
  assert.equal(upgrading.pointsPerDayWhenReady, BigInt('41088000000000'));
  assert.equal(getVillageProductionRates({ ...village, level: 0 }).pointsPerDay, zero);

  const town = {
    id: 5, level: 1, maxLevel: 1,
    blockHeightUpgradeInitiated: BigInt(49000000), blockHeightUntilUpgradeDone: BigInt(50000000),
    isUpgrading: true, levelUpgradeCostLeaf: BigInt('2000000000000000000000000'),
    levelUpgradeCostSeedInstant: BigInt('999000000000000000000'),
    levelUpgradeBlockInterval: BigInt(12345), levelUpgradeCostSeed: BigInt('789000000000000000000'),
  };
  // The real Town ABI omits Village production fields. BuildingDetailsPanel
  // mounts this dialog even while closed, including after restoring selection.
  for (const id of [1, 3, 5, 6, 7, 8]) {
    for (const level of [0, 1, 3]) {
      const [decodedTown] = abiForms('townGetBuildingsByLandId', { ...town, id, level });
      assert.doesNotThrow(() => renderToString(createElement(BuildingInfoDialog, {
        open: false,
        onOpenChange: () => {},
        building: decodedTown as BuildingData,
        buildingType: 'town',
      })), `Closed Town info dialog must render for building ${id} at level ${level}`);
    }
  }
  for (const input of abiForms('townGetBuildingsByLandId', town)) {
    const result = readBuildingProduction(input, 'town');
    assert.equal(result.isUpgrading, true);
    assert.equal(result.pointsPerDay, zero);
    assert.equal(result.lifetimePerDaySeconds, zero);
    assert.equal(result.accumulatedPoints, zero, 'Town costs must not become PTS');
    assert.equal(result.accumulatedLifetime, zero, 'Town costs must not become lifetime');
  }

  const resources = {
    experiencePoints: BigInt('337000000000000000000'),
    accumulatedPlantPoints: BigInt('164237818894090'),
    accumulatedPlantLifetime: BigInt(3661),
  };
  const normalized = normalizeLandResources(resources);
  assert.deepEqual(normalized, { experiencePoints: 337, storedPTS: 164.23781889409, storedTOD: 3661 });
  assert.deepEqual(sumLandResources([resources, resources]), { experiencePoints: 674, storedPTS: 328.47563778818, storedTOD: 7322 });

  // No network calls: exercise the real formatter with already-normalized stats.
  process.env.RPC_NODE ||= 'http://127.0.0.1:1';
  const { formatStatsForAI } = await import('../lib/user-stats-service');
  const stats = {
    totalPlants: 0, healthyPlants: 0, dyingPlants: 0, totalPTS: 0, totalRewards: 0,
    totalStars: 0, avgLevel: 0, plantDetails: [], totalLands: 1,
    totalLandXP: normalized.experiencePoints, totalStoredPTS: normalized.storedPTS,
    totalStoredTOD: normalized.storedTOD, landsWithCasino: 0, landsWithBarracks: 0,
    landDetails: [{ tokenId: '712', name: 'Land 712', coordinates: { x: -13, y: -3 },
      ...normalized, casinoBuilt: false, barracksBuilt: false, barracks: null, villageBuildings: [], townBuildings: [] }],
    villageBuildings: [], townBuildings: [], totalDailyPTSProduction: 41.088,
    totalDailyTODProduction: 3636, unclaimedPTS: 0.285333333333, unclaimedTOD: 26,
    formattedSeedBalance: '0', formattedLeafBalance: '0', formattedPixotchiBalance: '0',
    plantsNeedingCare: [], timestamp: 0,
  } satisfies UserGameStats;
  const formatted = JSON.parse(formatStatsForAI(stats));
  assert.equal(formatted.landSummary.totalLandXP, '337');
  assert.equal(formatted.landSummary.totalStoredPTS, (164.23781889409).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  assert.equal(formatted.landSummary.totalStoredTOD, '1.02 hours');
  assert.equal(formatted.individualLands[0].storedTOD, '1.02 hours');
  assert.equal(formatted.productionSummary.unclaimedPTS, (0.285333333333).toLocaleString(undefined, { maximumFractionDigits: 2 }));
  console.log('Land production smoke passed: onchain rates, ABI object/tuple forms, upgrades, Town dialog rendering, stored units and AI formatting.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
