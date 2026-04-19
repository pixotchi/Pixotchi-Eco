"use client";

import { requestBaseChatSessionRefresh } from '@/lib/base-chat-session-refresh';
import { sessionStorageManager } from '@/lib/session-storage-manager';

export type MissionTrackingPayload = Record<string, unknown>;

async function postMissionRequest(
  payload: MissionTrackingPayload,
): Promise<Response> {
  return fetch('/api/gamification/missions', {
    body: JSON.stringify(payload),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

function canRecoverBaseMissionAuth(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return sessionStorageManager.getAuthSurface() === 'base';
}

export async function postMissionProgress(
  payload: MissionTrackingPayload,
): Promise<Response> {
  let response = await postMissionRequest(payload);

  if (response.status !== 401 || !canRecoverBaseMissionAuth()) {
    return response;
  }

  const recovery = await requestBaseChatSessionRefresh('mission-auth-failure');
  if (recovery.status !== 'success') {
    return response;
  }

  response = await postMissionRequest(payload);
  return response;
}
