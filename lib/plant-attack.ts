import type { Plant } from './types';

export const PLANT_ATTACK_COOLDOWN_SECONDS = 30 * 60;
export const PLANT_TARGET_COOLDOWN_SECONDS = 60 * 60;

export type AttackPlant = Pick<Plant, 'id' | 'owner' | 'status' | 'level' | 'lastAttackUsed' | 'lastAttacked'>;

export function getPlantAttackReadyAt(lastAttack: string, cooldown = PLANT_ATTACK_COOLDOWN_SECONDS): number | null {
  if (!/^\d+$/.test(lastAttack)) return null;
  const timestamp = Number(lastAttack);
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(timestamp + cooldown)) return null;
  return timestamp === 0 ? 0 : timestamp + cooldown;
}

export function canPlantAttack(attacker: AttackPlant, target: AttackPlant, now: number, targetHasFence: boolean): boolean {
  const attackerReadyAt = getPlantAttackReadyAt(attacker.lastAttackUsed);
  const targetReadyAt = getPlantAttackReadyAt(target.lastAttacked, PLANT_TARGET_COOLDOWN_SECONDS);
  return attacker.status !== 4 && target.status !== 4
    && attacker.id !== target.id && attacker.owner.toLowerCase() !== target.owner.toLowerCase()
    && attacker.level < target.level && !targetHasFence
    && attackerReadyAt !== null && targetReadyAt !== null
    && attackerReadyAt <= now && targetReadyAt <= now;
}

export type PlantAttackAvailability =
  | { kind: 'no-plants' | 'no-living-plants' | 'unavailable' | 'ready' }
  | { kind: 'cooldown'; readyAt: number; livingCount: number };

/** Describes the player's ability to attack separately from the target filters. */
export function getPlantAttackAvailability(plants: readonly AttackPlant[], now: number): PlantAttackAvailability {
  if (plants.length === 0) return { kind: 'no-plants' };
  const living = plants.filter(plant => plant.status !== 4);
  if (living.length === 0) return { kind: 'no-living-plants' };
  const readyTimes = living.map(plant => getPlantAttackReadyAt(plant.lastAttackUsed));
  if (readyTimes.some(time => time !== null && time <= now)) return { kind: 'ready' };
  if (readyTimes.some(time => time === null)) return { kind: 'unavailable' };
  return { kind: 'cooldown', readyAt: Math.min(...readyTimes as number[]), livingCount: living.length };
}
