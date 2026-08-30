"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { EfpTransactionBoundary } from "@/components/efp-transaction-boundary";
import PlantProfileDialog from "@/components/plant-profile-dialog";
import type { Plant } from "@/lib/types";
import { getPlantsByOwner } from "@/lib/contracts";

interface ChatProfileDialogProps {
  address: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTransactionOpen?: () => void;
}

type PlantCache = {
  plant: Plant | null;
  timestamp: number;
};

const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

export default function ChatProfileDialog({
  address,
  open,
  onOpenChange,
  onTransactionOpen,
}: ChatProfileDialogProps) {
  const cacheRef = useRef<Map<string, PlantCache>>(new Map());
  const [plant, setPlant] = useState<Plant | null>(null);
  const [loading, setLoading] = useState(false);

  // Request deduplication ref to prevent multiple simultaneous calls
  const fetchPendingRef = useRef<string | null>(null);

  const normalisedAddress = useMemo(() => address?.toLowerCase() ?? "", [address]);

  useEffect(() => {
    if (!open || !normalisedAddress) {
      fetchPendingRef.current = null;
      return;
    }

    let cancelled = false;
    const cacheKey = normalisedAddress;
    const cached = cacheRef.current.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < CACHE_DURATION) {
      setPlant(cached.plant);
      // Clear loading too: a fetch cancelled mid-flight leaves loading=true, and
      // this early return used to preserve it forever on cache-hit reopens.
      setLoading(false);
      return;
    }

    // Prevent duplicate calls for the same address
    if (fetchPendingRef.current === cacheKey) {
      return;
    }

    fetchPendingRef.current = cacheKey;
    setLoading(true);

    getPlantsByOwner(normalisedAddress)
      .then((plants) => {
        if (cancelled) return;
        // Only update if address hasn't changed during the fetch
        if (fetchPendingRef.current === cacheKey) {
          if (Array.isArray(plants) && plants.length > 0) {
            const sorted = [...plants].sort((a, b) => b.score - a.score);
            const selected = sorted[0] ?? null;
            setPlant(selected);
            cacheRef.current.set(cacheKey, { plant: selected, timestamp: now });
          } else {
            setPlant(null);
            cacheRef.current.set(cacheKey, { plant: null, timestamp: now });
          }
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[ChatProfileDialog] Failed to fetch plants", err);
        // Don't leave the previous profile's plant showing for a different
        // address on failure.
        if (fetchPendingRef.current === cacheKey) {
          setPlant(null);
        }
      })
      .finally(() => {
        // Always release the pending flag for THIS request key, even when the
        // effect was cancelled — otherwise loading stuck at true forever.
        if (fetchPendingRef.current === cacheKey) {
          fetchPendingRef.current = null;
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      // Clear pending flag on cleanup
      if (fetchPendingRef.current === cacheKey) {
        fetchPendingRef.current = null;
      }
    };
  }, [open, normalisedAddress]);

  return (
    <EfpTransactionBoundary open={open} onTransactionOpen={onTransactionOpen}>
      <PlantProfileDialog
        open={open}
        onOpenChange={onOpenChange}
        plant={plant}
        variant="wallet"
        /* Every current opener (chat dialog, land map) hosts this inside another
           dialog, so it must sit on the nested modal layer. */
        nested
        walletAddressOverride={normalisedAddress}
        primaryPlantLoading={loading}
        walletNameOverride={null}
      />
    </EfpTransactionBoundary>
  );
}
