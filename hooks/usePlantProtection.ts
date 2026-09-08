"use client";

import { useEffect, useReducer, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import type { Plant } from "@/lib/types";
import { getActiveFences } from "@/lib/utils";

function protectionDeadlines(plant: Plant): number[] {
  const deadlines = new Set<number>();
  const add = (value: unknown) => {
    if (
      typeof value !== "number" &&
      typeof value !== "string" &&
      typeof value !== "bigint"
    )
      return;
    const timestamp = Number(value);
    if (Number.isSafeInteger(timestamp) && timestamp > 0)
      deadlines.add(timestamp);
  };
  if (plant.fenceV2?.isActive) add(plant.fenceV2.activeUntil);
  for (const extension of plant.extensions ?? []) {
    for (const item of extension.shopItemOwned ?? []) {
      if (item.effectIsOngoingActive && /fence|shield/i.test(item.name))
        add(item.effectUntil);
    }
  }
  return [...deadlines].sort((left, right) => left - right);
}

/** Reconcile the selected plant when protection expires, without waiting for
 * the owner polling interval or repeatedly refetching stale expired flags. */
export function usePlantProtection(
  plant: Plant | null,
  ownerKey: string | null | undefined,
) {
  const queryClient = useQueryClient();
  const [, updateClock] = useReducer((value: number) => value + 1, 0);
  const owner = ownerKey?.toLowerCase() ?? null;
  const scope =
    owner && plant && plant.owner.toLowerCase() === owner
      ? `${owner}:${plant.id}`
      : null;
  const latestScope = useRef(scope);
  latestScope.current = scope;
  const reconciled = useRef(new Set<string>());

  useEffect(() => {
    if (!scope || !owner || !plant) return;
    const deadlines = protectionDeadlines(plant);
    if (!deadlines.length) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      if (cancelled || latestScope.current !== scope) return;
      if (timeout !== undefined) clearTimeout(timeout);
      const now = Date.now();
      let needsRefresh = false;
      for (const deadline of deadlines) {
        const key = `${scope}:${deadline}`;
        if (deadline * 1000 <= now && !reconciled.current.has(key)) {
          reconciled.current.add(key);
          needsRefresh = true;
        }
      }
      updateClock();
      if (needsRefresh)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.plantsByOwner(owner),
          exact: true,
        });
      const next = deadlines.find((deadline) => deadline * 1000 > now);
      if (next !== undefined)
        timeout = setTimeout(check, Math.min(next * 1000 - now, 2147483647));
    };
    check();
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      document.removeEventListener("visibilitychange", check);
    };
  }, [owner, plant, queryClient, scope]);

  return scope && plant ? getActiveFences(plant) : [];
}
