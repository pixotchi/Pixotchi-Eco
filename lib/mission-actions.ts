import type { GmTaskId } from './gamification-types';
import type { BuildingType, Land, Plant } from './types';

export type MissionRead<T> =
  | { status: 'loading' | 'error' }
  | { status: 'ready'; data: T };

export type MissionBuilding = {
  id: number;
  level: number;
  isUpgrading: boolean;
  accumulatedPoints: bigint;
  accumulatedLifetime: bigint;
};

export type MissionLandState = {
  landId: string;
  village: MissionRead<readonly MissionBuilding[]>;
  town: MissionRead<readonly MissionBuilding[]>;
  casino: MissionRead<boolean>;
};

export type MissionAssets = {
  owner: string | null;
  lands: MissionRead<readonly Land[]>;
  plants: MissionRead<readonly Plant[]>;
  farms: MissionRead<readonly MissionLandState[]>;
  casinoEnabled: boolean;
};

export type MissionActionTarget =
  | { kind: 'land'; owner: string; landId: string; buildingType: BuildingType; buildingId: number }
  | { kind: 'mint'; mintType: 'land' | 'plant' }
  | { kind: 'plant'; owner: string; plantId: number; action: 'care' | 'protection' | 'arcade' | 'revive' };

export type MissionAction = {
  label: string;
  description?: string;
  disabled?: boolean;
  retry?: boolean;
  target?: MissionActionTarget;
};

const loading = (): MissionAction => ({ label: 'Checking farm…', disabled: true });
const failed = (): MissionAction => ({
  label: 'Retry farm check',
  description: 'Your farm could not be verified. Retry to find the right action.',
  retry: true,
});
const mint = (mintType: 'land' | 'plant'): MissionAction => ({
  label: `Mint a ${mintType}`,
  description: `This task needs an owned ${mintType === 'land' ? 'land' : 'plant'}.`,
  target: { kind: 'mint', mintType },
});

function pending<T>(read: MissionRead<T>): MissionAction | null {
  return read.status === 'loading' ? loading() : read.status === 'error' ? failed() : null;
}

function landAction(assets: MissionAssets, landId: string, buildingType: BuildingType,
  buildingId: number, label: string, description?: string): MissionAction {
  return { label, description, target: { kind: 'land', owner: assets.owner!, landId, buildingType, buildingId } };
}

function plantAction(assets: MissionAssets, action: 'care' | 'protection' | 'arcade'): MissionAction {
  const state = pending(assets.plants);
  if (state) return state;
  if (assets.plants.status !== 'ready') return loading();
  const plants = assets.plants.data;
  if (!plants.length) return mint('plant');
  const living = plants.find(plant => plant.status !== 4);
  const plant = living ?? plants[0];
  const needsRevival = !living && action !== 'arcade';
  return {
    label: needsRevival ? 'Revive plant' : action === 'care' ? 'Open plant care' : action === 'protection' ? 'Open protection' : 'Open Arcade',
    description: needsRevival ? 'Revive a plant before continuing this task.' : undefined,
    target: { kind: 'plant', owner: assets.owner!, plantId: plant.id, action: needsRevival ? 'revive' : action },
  };
}

function townAction(assets: MissionAssets, farms: readonly MissionLandState[], buildingId: number,
  name: string, readyLabel: string): MissionAction {
  const candidates = farms.flatMap(farm => farm.town.status === 'ready'
    ? farm.town.data.filter(building => building.id === buildingId).map(building => ({ farm, building })) : []);
  const built = candidates.find(({ building }) => building.level > 0 && !building.isUpgrading);
  if (built) return landAction(assets, built.farm.landId, 'town', buildingId, readyLabel,
    buildingId === 7 ? 'Choose an available farmer or check a quest already in progress.' : undefined);
  // A failed read must never turn a potentially built building into a build prompt.
  const unknown = farms.find(farm => farm.town.status !== 'ready');
  if (unknown) return pending(unknown.town)!;
  const construction = candidates.find(({ building }) => building.isUpgrading);
  if (construction) return landAction(assets, construction.farm.landId, 'town', buildingId,
    'View construction', `${name} construction is already in progress.`);
  const unbuilt = candidates[0];
  if (unbuilt) return landAction(assets, unbuilt.farm.landId, 'town', buildingId, `Build ${name}`,
    buildingId === 7 ? 'Build a Farmer House to unlock quests.' : 'Build a Marketplace to place orders on this land.');
  return { label: `${name} unavailable`, description: 'This building is not available on your lands.', disabled: true };
}

function productionAction(assets: MissionAssets, farms: readonly MissionLandState[], forResources: boolean): MissionAction {
  const candidates = farms.flatMap(farm => farm.village.status === 'ready'
    ? farm.village.data.filter(building => [0, 3, 5].includes(building.id)).map(building => ({ farm, building })) : []);
  const available = candidates.find(({ building }) => building.level > 0 && !building.isUpgrading
    && (building.accumulatedPoints > BigInt(0) || building.accumulatedLifetime > BigInt(0)));
  if (available) return landAction(assets, available.farm.landId, 'village', available.building.id,
    forResources ? 'Collect resources' : 'Open production', forResources ? 'Collect production, then apply it to your plant.' : 'This building has production to collect.');
  const producing = candidates.find(({ building }) => building.level > 0 && !building.isUpgrading);
  if (producing) return landAction(assets, producing.farm.landId, 'village', producing.building.id,
    'Open production', 'Check when this building’s next collection is ready.');
  const unknown = farms.find(farm => farm.village.status !== 'ready');
  if (unknown) return pending(unknown.village)!;
  const construction = candidates.find(({ building }) => building.isUpgrading);
  if (construction) return landAction(assets, construction.farm.landId, 'village', construction.building.id,
    'View construction', 'Production resumes when construction is complete.');
  const unbuilt = candidates.find(({ building }) => building.id === 0) ?? candidates[0];
  if (unbuilt) {
    const name = unbuilt.building.id === 0 ? 'Solar Panels' : unbuilt.building.id === 3 ? 'Soil Factory' : 'Bee Farm';
    return landAction(assets, unbuilt.farm.landId, 'village', unbuilt.building.id, `Build ${name}`);
  }
  return { label: 'Production unavailable', description: 'No production buildings are available on your lands.', disabled: true };
}

/** Resolves a navigation action, never a transaction or a claim of task completion. */
export function resolveMissionAction(taskId: GmTaskId, assets: MissionAssets): MissionAction | null {
  const plantTasks = ['s4_buy10_elements', 's4_buy_shield', 's4_play_arcade'];
  const landTasks = ['s1_place_order', 's3_apply_resources', 's3_send_quest', 's3_claim_production', 's3_play_casino_game'];
  if (!plantTasks.includes(taskId) && !landTasks.includes(taskId)) return null;
  if (!assets.owner) return { label: 'Connect wallet', disabled: true };
  if (plantTasks.includes(taskId)) return plantAction(assets,
    taskId === 's4_buy10_elements' ? 'care' : taskId === 's4_buy_shield' ? 'protection' : 'arcade');
  if (taskId === 's3_play_casino_game' && !assets.casinoEnabled)
    return { label: 'Casino unavailable', description: 'Casino games are currently unavailable.', disabled: true };
  const landState = pending(assets.lands);
  if (landState) return landState;
  if (assets.lands.status !== 'ready') return loading();
  if (!assets.lands.data.length) return mint('land');
  if (taskId === 's3_apply_resources') {
    const plant = plantAction(assets, 'care');
    if (plant.target?.kind !== 'plant' || plant.target.action === 'revive') return plant;
    const stocked = assets.lands.data.find(land => land.accumulatedPlantPoints > BigInt(0)
      || land.accumulatedPlantLifetime > BigInt(0));
    if (stocked) return landAction(assets, stocked.tokenId.toString(), 'town', 3, 'Open Warehouse',
      'Apply stored resources to a living plant.');
  }
  const farmState = pending(assets.farms);
  if (farmState) return farmState;
  if (assets.farms.status !== 'ready') return loading();
  const ownedIds = new Set(assets.lands.data.map(land => land.tokenId.toString()));
  const farms = assets.farms.data.filter(farm => ownedIds.has(farm.landId));
  if (farms.length !== ownedIds.size) return loading();
  if (taskId === 's1_place_order') return townAction(assets, farms, 5, 'Marketplace', 'Open Marketplace');
  if (taskId === 's3_send_quest') return townAction(assets, farms, 7, 'Farmer House', 'Open quests');
  if (taskId === 's3_play_casino_game') {
    const built = farms.find(farm => farm.casino.status === 'ready' && farm.casino.data);
    if (built) return landAction(assets, built.landId, 'town', 6, 'Open Casino', 'Choose a casino game. Games involve a wager.');
    const unknown = farms.find(farm => farm.casino.status !== 'ready');
    if (unknown) return pending(unknown.casino)!;
    return landAction(assets, farms[0].landId, 'town', 6, 'Build Casino', 'Build a Casino to unlock its games.');
  }
  return productionAction(assets, farms, taskId === 's3_apply_resources');
}
