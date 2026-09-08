"use client";

import { useEffect, useMemo, useState } from "react";
import { BatchReconciliation, type BatchScanState } from "@/lib/batch-reconciliation";
import { onOwnerResourceInvalidation, ownerInvalidationMatches } from "@/lib/owner-resource-invalidation";

/** Keep a batch's local census inside the canonical building reconciliation. */
export function useBatchReconciliation<T>({
  identity,
  address,
  read,
  key,
  errorMessage,
}: {
  identity: string;
  address?: string;
  read: (minimumBlock?: bigint) => Promise<T[]>;
  key: (item: T) => string;
  errorMessage: string;
}) {
  const [snapshot, setSnapshot] = useState<{ identity: string; coordinator: BatchReconciliation<T>; state: BatchScanState<T> }>();
  const coordinator = useMemo(() => {
    const instance = new BatchReconciliation(
      read,
      key,
      (state) => setSnapshot({ identity, coordinator: instance, state }),
      errorMessage,
    );
    return instance;
  }, [errorMessage, identity, key, read]);

  useEffect(() => {
    coordinator.activate();
    void coordinator.refresh();
    const removeOwnerListener = onOwnerResourceInvalidation((detail) => {
      if (!ownerInvalidationMatches(detail, address, "buildings")) return;
      const receiptBlock = detail.receiptBlock === undefined ? undefined : BigInt(detail.receiptBlock);
      return coordinator.refresh(receiptBlock);
    }, ["buildings"]);
    const refresh = () => { void coordinator.refresh(); };
    window.addEventListener("buildings:refresh", refresh);
    return () => {
      coordinator.dispose();
      removeOwnerListener();
      window.removeEventListener("buildings:refresh", refresh);
    };
  }, [address, coordinator]);

  // Ownership or a replacement reader must gate the first render, before effects.
  // The same owner string cannot make a former coordinator's snapshot current.
  const state = snapshot?.coordinator === coordinator ? snapshot.state : coordinator.state;
  return { ...state, coordinator, refresh: coordinator.refresh };
}
