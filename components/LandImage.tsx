"use client";

import React, { useMemo } from 'react';
import Image from 'next/image';
import { Land, BuildingType, BuildingData } from '@/lib/types';
import { getBuildingName } from '@/lib/utils';

interface LandImageProps {
  selectedLand: Land | null;
  buildingType?: BuildingType;
  villageBuildings?: BuildingData[];
  townBuildings?: BuildingData[];
  className?: string;
  priority?: boolean;
}

// Mapping of building names to their layer image files
const BUILDING_LAYERS = {
  "Solar Panels": "solar-layer.png",
  "Soil Factory": "soil-layer.png", 
  "Bee Farm": "bee-layer.png",
  "Farmer House": "farmerhouse-layer.png",
  "Marketplace": "marketplace-layer.png",
} as const;

const LandImage = ({ 
  selectedLand, 
  buildingType = 'village', 
  villageBuildings = [],
  townBuildings = [],
  className = "",
  priority = false 
}: LandImageProps) => {

  const layers = useMemo(() => {
    if (!selectedLand) return [];

    const baseImageUrl = buildingType === 'village' 
      ? '/icons/village-start.png' 
      : '/icons/town-small.png';

    const currentBuildings = buildingType === 'village' ? villageBuildings : townBuildings;
    
    // Filter for completed buildings to render their layers
    const completedBuildings = currentBuildings.filter(building => 
      building.level > 1 || (building.level === 1 && !building.isUpgrading)
    );

    const layerImages = completedBuildings
      .map(building => {
        const buildingName = getBuildingName(building.id, buildingType === 'town');
        const layerImage = BUILDING_LAYERS[buildingName as keyof typeof BUILDING_LAYERS];
        return layerImage ? `/icons/${layerImage}` : null;
      })
      .filter((img): img is string => Boolean(img));

    return [baseImageUrl, ...layerImages];
  }, [selectedLand, buildingType, villageBuildings, townBuildings]);
  
  if (!selectedLand) {
    return null;
  }

  return (
    <div className={`relative w-full h-full ${className}`}>
      {layers.map((src, index) => (
        <Image
          key={src}
          src={src}
          alt={index === 0 ? (selectedLand.name || `Land #${selectedLand.tokenId}`) : "Building Layer"}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          priority={priority && index === 0} // Priority for base layer
          className="object-contain object-center"
        />
      ))}
    </div>
  );
};

export default React.memo(LandImage);
