"use client";

import { BuildingData,BuildingType,Land } from '@/lib/types';
import { getBuildingName } from '@/lib/utils';
import React,{ useMemo } from 'react';
import { preload } from 'react-dom';

interface LandImageProps {
  selectedLand: Land | null;
  buildingType?: BuildingType;
  villageBuildings?: BuildingData[];
  townBuildings?: BuildingData[];
  className?: string;
  priority?: boolean;
}

// Mapping of building names to their layer image files
// WebP re-encodes of the old PNG layers (895KB -> 307KB for the full set; the
// casino and barracks layers alone dropped from 333KB/260KB to 47KB/41KB).
const BUILDING_LAYERS = {
  "Solar Panels": "solar-layer.webp",
  "Soil Factory": "soil-layer.webp",
  "Bee Farm": "bee-layer.webp",
  "Farmer House": "farmerhouse-layer.webp",
  "Marketplace": "marketplace-layer.webp",
  "Casino": "casino-layer.webp",
  "Barracks": "barrackslayer.webp",
} as const;

const LandImage = ({
  selectedLand,
  buildingType = 'village',
  villageBuildings = [],
  townBuildings = [],
  className = "",
  priority = false,
}: LandImageProps) => {
  const { backgroundStyle, imageUrls } = useMemo(() => {
    if (!selectedLand) return { backgroundStyle: {}, imageUrls: [] };

    const baseImageUrl = buildingType === 'village'
      ? '/icons/village-start.png'
      : '/icons/town-small.png';

    const currentBuildings = buildingType === 'village' ? villageBuildings : townBuildings;

    // `lands-view` owns the complete building snapshot, including the Casino's
    // synthesized level. Reusing it avoids an identical RPC from every child.
    const completedBuildings = currentBuildings.filter(
      (building) => building.level > 1 || (building.level === 1 && !building.isUpgrading),
    );

    const layerImagePaths = completedBuildings
      .map(building => {
        const buildingName = getBuildingName(building.id, buildingType === 'town');
        const layerImage = BUILDING_LAYERS[buildingName as keyof typeof BUILDING_LAYERS];
        return layerImage ? `/icons/${layerImage}` : null;
      })
      .filter((path): path is string => Boolean(path));

    const nextImageUrls = [...layerImagePaths, baseImageUrl];

    return {
      imageUrls: nextImageUrls,
      backgroundStyle: {
        backgroundImage: nextImageUrls.map((url) => `url(${url})`).join(', '),
        backgroundSize: 'contain',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
        width: '100%',
        height: '100%',
      },
    };
  }, [selectedLand, buildingType, villageBuildings, townBuildings]);

  if (priority) {
    imageUrls.forEach((url) => preload(url, { as: 'image', fetchPriority: 'high' }));
  }

  if (!selectedLand) {
    return null;
  }

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
