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

  const normalisedAddress = useMemo(() => address?.toLowerCase() ?? "", [address]);

  useEffect(() => {
    if (!open || !normalisedAddress) {
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

    setLoading(true);

    getPlantsByOwner(normalisedAddress)
      .then((plants) => {
        if (cancelled) return;
        if (Array.isArray(plants) && plants.length > 0) {
          const sorted = [...plants].sort((a, b) => b.score - a.score);
          const selected = sorted[0] ?? null;
          setPlant(selected);
          cacheRef.current.set(cacheKey, { plant: selected, timestamp: now });
        } else {
          setPlant(null);
          cacheRef.current.set(cacheKey, { plant: null, timestamp: now });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[ChatProfileDialog] Failed to fetch plants", err);
        setPlant(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
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

