"use client";

import { useCallback, useState } from 'react';
import type { Strain } from '@/lib/types';

/** Keep selection identity while every detail comes from the current catalog. */
export function useMintCatalog() {
  const [strains, setStrains] = useState<Strain[]>([]);
  const [selectedStrainId, setSelectedStrainId] = useState<number | null>(null);
  const selectedStrain = strains.find((strain) => strain.id === selectedStrainId) ?? null;
  const updateCatalog = useCallback((catalog: Strain[]) => {
    setStrains(catalog);
    const firstAvailable = catalog.find((strain) => strain.isActive && strain.totalMinted < strain.maxSupply);
    if (firstAvailable) setSelectedStrainId((current) => current ?? firstAvailable.id);
  }, []);
  return { strains, selectedStrainId, selectedStrain, selectStrain: setSelectedStrainId, updateCatalog };
}
