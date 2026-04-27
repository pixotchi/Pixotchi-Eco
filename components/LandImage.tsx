"use client";

import { casinoIsBuilt } from '@/lib/contracts';
import { BuildingData,BuildingType,Land } from '@/lib/types';
import { getBuildingName } from '@/lib/utils';
import React,{ useEffect,useMemo,useState } from 'react';

interface LandImageProps {
  selectedLand: Land | null;
  buildingType?: BuildingType;
  villageBuildings?: BuildingData[];
  townBuildings?: BuildingData[];
  className?: string;
  priority?: boolean; // Will be used for preloading, not directly on the div
}

// Mapping of building names to their layer image files
const BUILDING_LAYERS = {
  "Solar Panels": "solar-layer.png",
  "Soil Factory": "soil-layer.png",
  "Bee Farm": "bee-layer.png",
  "Farmer House": "farmerhouse-layer.png",
  "Marketplace": "marketplace-layer.png",
  "Casino": "casino-layer.png",
  "Barracks": "barrackslayer.png",
} as const;

const LandImage = ({
  selectedLand,
  buildingType = 'village',
  villageBuildings = [],
  townBuildings = [],
  className = ""
}: LandImageProps) => {
  const [casinoBuiltState, setCasinoBuiltState] = useState<boolean>(false);
  const landId = selectedLand?.tokenId;

  // Fetch casino built state
  useEffect(() => {
    let cancelled = false;

    if (!landId) {
      setCasinoBuiltState(false);
      return;
    }

    casinoIsBuilt(landId)
      .then((built) => {
        if (!cancelled) setCasinoBuiltState(built);
      })
      .catch(() => {
        if (!cancelled) setCasinoBuiltState(false);
      });

    return () => {
      cancelled = true;
    };
  }, [landId]);

  const backgroundStyle = useMemo(() => {
    if (!selectedLand) return {};

    const baseImageUrl = buildingType === 'village'
      ? '/icons/village-start.png'
      : '/icons/town-small.png';

    const currentBuildings = buildingType === 'village' ? villageBuildings : townBuildings;

    // Filter for completed buildings to render their layers
    // Special case: Casino uses casinoBuiltState instead of building.level
    const completedBuildings = currentBuildings.filter(building => {
      const isCasino = building.id === 6;
      if (isCasino) {
        return casinoBuiltState; // Use async-fetched state for Casino
      }
      return building.level > 1 || (building.level === 1 && !building.isUpgrading);
    });

    const layerImageUrls = completedBuildings
      .map(building => {
        const buildingName = getBuildingName(building.id, buildingType === 'town');
        const layerImage = BUILDING_LAYERS[buildingName as keyof typeof BUILDING_LAYERS];
        return layerImage ? `url(/icons/${layerImage})` : null;
      })
      .filter(Boolean); // Remove nulls for buildings without layers

    const allImageUrls = [...layerImageUrls, `url(${baseImageUrl})`];

    return {
      backgroundImage: allImageUrls.join(', '),
      backgroundSize: 'contain',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      width: '100%',
      height: '100%',
    };
  }, [selectedLand, buildingType, villageBuildings, townBuildings, casinoBuiltState]);

  if (!selectedLand) {
    return null;
  }

  // The `priority` prop could be used with <link rel="preload"> in the parent component if needed
  return (
    <div
      className={className}
      style={backgroundStyle}
      role="img"
      aria-label={selectedLand?.name || `Land #${selectedLand?.tokenId}`}
    />
  );
};

export default React.memo(LandImage); 
