import { navigateToGameTab } from '@/lib/game-navigation';
import type { BuildingType } from '@/lib/types';

const PUBLIC_CHAT_OPEN_EVENT = 'pixotchi:public-chat:open';

export type LandMissionTarget = {
  owner: string;
  landId: string;
  buildingType: BuildingType;
  buildingId: number;
};

export type LandMissionRequest = LandMissionTarget & { requestId: number };

let nextLandRequestId = 0;
let pendingLandRequest: LandMissionRequest | null = null;
const landRequestListeners = new Set<() => void>();

function publishLandRequest(request: LandMissionRequest | null) {
  pendingLandRequest = request;
  for (const listener of landRequestListeners) listener();
}

/** Retain the destination until the lazy Lands view can verify and reveal it. */
export function openMissionLand(target: LandMissionTarget) {
  publishLandRequest({ ...target, owner: target.owner.toLowerCase(), requestId: ++nextLandRequestId });
  navigateToGameTab('dashboard', { dashboardView: 'lands' });
}

export function getPendingMissionLand() {
  return pendingLandRequest;
}

export function getServerMissionLand(): null {
  return null;
}

export function subscribeMissionLand(listener: () => void) {
  landRequestListeners.add(listener);
  return () => { landRequestListeners.delete(listener); };
}

export function consumeMissionLand(requestId: number) {
  if (pendingLandRequest?.requestId === requestId) publishLandRequest(null);
}

/** Call from the shell's owner lifecycle as well as the destination on resume. */
export function clearMissionLandForOwner(owner: string | null | undefined) {
  if (pendingLandRequest && pendingLandRequest.owner !== owner?.toLowerCase()) publishLandRequest(null);
}

export function openPublicChat() {
  window.dispatchEvent(new Event(PUBLIC_CHAT_OPEN_EVENT));
}

export function onPublicChatOpen(listener: () => void) {
  window.addEventListener(PUBLIC_CHAT_OPEN_EVENT, listener);
  return () => window.removeEventListener(PUBLIC_CHAT_OPEN_EVENT, listener);
}
