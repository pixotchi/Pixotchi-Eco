import { navigateToGameTab } from './game-navigation';

export type PlantMissionTarget = {
  owner: string;
  plantId: number;
  action: 'care' | 'protection' | 'arcade' | 'revive';
};

// Keep the intent until Plants is visible and its owner-scoped list is ready.
// An event alone is lost while a lazy view or React Activity has no effects.
let pendingTarget: PlantMissionTarget | null = null;
const listeners = new Set<() => void>();

function publish() {
  listeners.forEach(listener => listener());
}

export function openMissionPlant(target: PlantMissionTarget) {
  if (typeof window === 'undefined') return;
  pendingTarget = { ...target, owner: target.owner.toLowerCase() };
  publish();
  navigateToGameTab('dashboard', { dashboardView: 'plants' });
}

export function readMissionPlant() {
  return pendingTarget;
}

export function subscribeMissionPlant(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function consumeMissionPlant(target: PlantMissionTarget) {
  if (pendingTarget !== target) return;
  pendingTarget = null;
  publish();
}

export function clearMissionPlantForOwner(owner: string | null) {
  if (pendingTarget && pendingTarget.owner !== owner?.toLowerCase()) {
    consumeMissionPlant(pendingTarget);
  }
}
