import assert from 'node:assert/strict';
import { resolveMissionAction, type MissionAssets, type MissionBuilding, type MissionLandState, type MissionRead } from '../lib/mission-actions';
import type { Land, Plant } from '../lib/types';

const owner = '0x1111111111111111111111111111111111111111';
const ready = <T,>(data: T): MissionRead<T> => ({ status: 'ready', data });
const land = (id: number, stored = false): Land => ({
  tokenId: BigInt(id), owner, name: '', tokenUri: '', mintDate: BigInt(0), coordinateX: BigInt(0), coordinateY: BigInt(0),
  experiencePoints: BigInt(0), accumulatedPlantPoints: stored ? BigInt(1) : BigInt(0), accumulatedPlantLifetime: BigInt(0), farmerAvatar: 0,
});
const plant = (id: number, dead = false): Plant => ({
  id, owner, name: '', status: dead ? 4 : 0, score: 0, rewards: 0, level: 1, timeUntilStarving: 1,
  stars: 0, strain: 0, timePlantBorn: '0', lastAttackUsed: '0', lastAttacked: '0', statusStr: '', extensions: [],
});
const building = (id: number, level = 0, isUpgrading = false): MissionBuilding => ({
  id, level, isUpgrading, accumulatedPoints: BigInt(0), accumulatedLifetime: BigInt(0),
});
const farm = (id: number, level = 0, isUpgrading = false): MissionLandState => ({
  landId: String(id), village: ready([building(0, level, isUpgrading)]),
  town: ready([building(5, level, isUpgrading), building(7, level, isUpgrading)]), casino: ready(false),
});
const assets = (override: Partial<MissionAssets> = {}): MissionAssets => ({
  owner, lands: ready([land(11)]), plants: ready([plant(1)]), farms: ready([farm(11)]), casinoEnabled: true, ...override,
});
const action = (id: Parameters<typeof resolveMissionAction>[0], override: Partial<MissionAssets> = {}) => resolveMissionAction(id, assets(override))!;

for (const id of ['s1_place_order', 's3_apply_resources', 's3_send_quest', 's3_claim_production', 's3_play_casino_game'] as const) {
  assert.deepEqual(action(id, { lands: ready([]) }).target, { kind: 'mint', mintType: 'land' });
  assert.equal(action(id, { lands: { status: 'loading' } }).disabled, true);
  assert.equal(action(id, { lands: { status: 'error' } }).retry, true);
}
assert.equal(action('s3_send_quest').label, 'Build Farmer House');
assert.equal(action('s1_place_order').label, 'Build Marketplace');
assert.equal(action('s3_play_casino_game').label, 'Build Casino');
assert.equal(action('s3_claim_production').label, 'Build Solar Panels');
assert.equal(action('s3_send_quest', { farms: ready([farm(11, 0, true)]) }).label, 'View construction');
assert.equal(action('s3_send_quest', { farms: ready([farm(11, 1, true)]) }).label, 'View construction');
assert.equal(action('s1_place_order', { farms: ready([farm(11, 1, true)]) }).label, 'View construction');
const builtSecond = { lands: ready([land(11), land(12)]), farms: ready([farm(11, 1, true), { ...farm(12, 1), casino: ready(true) }]) };
for (const [id, label, buildingId] of [
  ['s3_send_quest', 'Open quests', 7], ['s1_place_order', 'Open Marketplace', 5], ['s3_play_casino_game', 'Open Casino', 6],
] as const) {
  assert.equal(action(id, builtSecond).label, label);
  assert.deepEqual(action(id, builtSecond).target, { kind: 'land', owner, landId: '12', buildingType: 'town', buildingId });
}
const failedFarm: MissionLandState = { landId: '12', village: { status: 'error' }, town: { status: 'error' }, casino: { status: 'error' } };
for (const id of ['s3_send_quest', 's1_place_order', 's3_play_casino_game', 's3_claim_production'] as const) {
  assert.equal(action(id, { lands: ready([land(11), land(12)]), farms: ready([farm(11), failedFarm]) }).retry, true);
}
assert.equal(action('s3_send_quest', { lands: ready([land(11), land(12)]), farms: ready([farm(11, 1), failedFarm]) }).label, 'Open quests');
assert.equal(action('s3_play_casino_game', { farms: ready([{ ...failedFarm, landId: '11', casino: ready(true) }]) }).label, 'Open Casino');
assert.equal(action('s3_send_quest', { farms: ready([{ ...farm(11, 1), casino: { status: 'error' } }]) }).label, 'Open quests');
assert.equal(action('s3_play_casino_game', { casinoEnabled: false }).disabled, true);
assert.equal(action('s3_send_quest', { farms: ready([farm(99, 1)]) }).disabled, true);

for (const id of ['s4_buy10_elements', 's4_buy_shield', 's4_play_arcade'] as const) {
  assert.deepEqual(action(id, { plants: ready([]) }).target, { kind: 'mint', mintType: 'plant' });
  assert.equal(action(id, { plants: { status: 'error' } }).retry, true);
}
assert.equal(action('s4_buy10_elements', { plants: ready([plant(1, true)]) }).label, 'Revive plant');
assert.equal(action('s4_buy_shield', { plants: ready([plant(1, true)]) }).label, 'Revive plant');
assert.equal(action('s4_play_arcade', { plants: ready([plant(1, true)]) }).label, 'Open Arcade');
assert.deepEqual(action('s4_buy_shield', { plants: ready([plant(1, true), plant(2)]) }).target,
  { kind: 'plant', owner, plantId: 2, action: 'protection' });
assert.equal(action('s3_apply_resources', { plants: ready([]) }).label, 'Mint a plant');
assert.equal(action('s3_apply_resources', { plants: ready([plant(1, true)]) }).label, 'Revive plant');
assert.equal(action('s3_apply_resources', { lands: ready([land(11, true)]), farms: { status: 'error' } }).label, 'Open Warehouse');
const availableProduction = { ...farm(11, 1), village: ready([{ ...building(0, 1), accumulatedPoints: BigInt(1) }]) };
assert.equal(action('s3_apply_resources', { farms: ready([availableProduction]) }).label, 'Collect resources');
assert.equal(action('s3_claim_production', { farms: ready([availableProduction]) }).label, 'Open production');
assert.equal(action('s3_claim_production', { farms: ready([farm(11, 1, true)]) }).label, 'View construction');
assert.equal(resolveMissionAction('s1_make_swap', assets()), null);
assert.equal(resolveMissionAction('s2_follow_player', assets()), null);
assert.equal(resolveMissionAction('s4_collect_star', assets()), null);
assert.equal(action('s3_send_quest', { owner: null }).disabled, true);
console.log('PASS mission actions: ownership, independent failures, multiple lands, construction, Casino, plant lifecycle, production and stored resources');
