"use client";

import { useEffect, useState } from "react";

export type ConfirmedMiniAppSessionSource =
  | "restored"
  | "quick-auth"
  | "chat-session"
  | "manual";

export type ConfirmedMiniAppSessionState = {
  address: string | null;
  confirmed: boolean;
  source: ConfirmedMiniAppSessionSource | null;
  updatedAt: number | null;
};

type Listener = (state: ConfirmedMiniAppSessionState) => void;

const DEFAULT_CONFIRMED_MINIAPP_SESSION: ConfirmedMiniAppSessionState = {
  address: null,
  confirmed: false,
  source: null,
  updatedAt: null,
};

let confirmedMiniAppSessionSnapshot = DEFAULT_CONFIRMED_MINIAPP_SESSION;
const listeners = new Set<Listener>();

function updateConfirmedMiniAppSessionSnapshot(nextState: ConfirmedMiniAppSessionState) {
  confirmedMiniAppSessionSnapshot = nextState;
  listeners.forEach((listener) => {
    listener(nextState);
  });
}

export function confirmMiniAppSession(
  address: string | null,
  source: ConfirmedMiniAppSessionSource,
) {
  const normalizedAddress = address?.toLowerCase() ?? null;

  console.info("[MiniAppSession] confirmed", {
    address: normalizedAddress,
    source,
  });

  updateConfirmedMiniAppSessionSnapshot({
    address: normalizedAddress,
    confirmed: Boolean(normalizedAddress),
    source,
    updatedAt: Date.now(),
  });
}

export function clearConfirmedMiniAppSession(reason: string) {
  if (
    !confirmedMiniAppSessionSnapshot.confirmed &&
    confirmedMiniAppSessionSnapshot.address === null
  ) {
    return;
  }

  console.info("[MiniAppSession] cleared", { reason });

  updateConfirmedMiniAppSessionSnapshot(DEFAULT_CONFIRMED_MINIAPP_SESSION);
}

export function getConfirmedMiniAppSessionSnapshot() {
  return confirmedMiniAppSessionSnapshot;
}

export function subscribeToConfirmedMiniAppSession(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConfirmedMiniAppSession() {
  const [state, setState] = useState<ConfirmedMiniAppSessionState>(
    confirmedMiniAppSessionSnapshot,
  );

  useEffect(() => {
    setState(confirmedMiniAppSessionSnapshot);
    return subscribeToConfirmedMiniAppSession(setState);
  }, []);

  return state;
}
