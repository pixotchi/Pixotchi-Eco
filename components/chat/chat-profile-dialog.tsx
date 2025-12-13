"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import PlantProfileDialog from "@/components/plant-profile-dialog";
import type { Plant } from "@/lib/types";
import { getPlantsByOwner } from "@/lib/contracts";

interface ChatProfileDialogProps {
  address: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
        // Only set error if address hasn't changed
        if (fetchPendingRef.current === cacheKey) {
          setPlant(null);
        }
      })
      .finally(() => {
        if (cancelled) return;
        // Clear pending flag only if address hasn't changed
        if (fetchPendingRef.current === cacheKey) {
          setLoading(false);
          fetchPendingRef.current = null;
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
    <PlantProfileDialog
      open={open}
      onOpenChange={onOpenChange}
      plant={plant}
      variant="wallet"
      walletAddressOverride={normalisedAddress}
      primaryPlantLoading={loading}
      walletNameOverride={null}
    />
  );
}

