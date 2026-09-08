"use client";

import { useCallback, useEffect, useRef } from "react";
import { formatUnits } from "viem";
import { loadBetPreference, storeBetPreference } from "@/lib/casino-bet-preferences";

type CasinoBetPreferenceOptions = {
  game: "roulette" | "blackjack" | "baccarat";
  /** Owner/game session identity. Null closes the session and permits fresh initialization. */
  scope: string | null;
  enabled: boolean;
  token: string | null | undefined;
  decimals: number | undefined;
  minBet: bigint;
  maxBet: bigint;
  onInitialize: (value: string) => void;
};

/** Initialize a draft once; live limits never replace text the player is editing. */
export function useCasinoBetPreference({
  game, scope, enabled, token, decimals, minBet, maxBet, onInitialize,
}: CasinoBetPreferenceOptions) {
  const initializedScope = useRef<string | null>(null);
  useEffect(() => {
    if (scope === null) { initializedScope.current = null; return; }
    if (!enabled || !token || decimals === undefined) return;
    const identity = `${game}:${scope}:${token.toLowerCase()}:${decimals}`;
    if (initializedScope.current === identity) return;
    initializedScope.current = identity;
    onInitialize(loadBetPreference({
      game, token, decimals, minBet, maxBet, fallback: formatUnits(minBet, decimals),
    }));
  }, [decimals, enabled, game, maxBet, minBet, onInitialize, scope, token]);

  // Call from explicit input/preset handlers, never from a state synchronization effect.
  return useCallback((value: string) => {
    if (scope !== null && decimals !== undefined) storeBetPreference(game, token, value, decimals);
  }, [decimals, game, scope, token]);
}
