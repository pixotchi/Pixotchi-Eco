"use client";

// Use native <img> for tiny icons
import { Card, CardContent } from './ui/card';
import PlantImage from './PlantImage';
import EditPlantName from './edit-plant-name';
import { Plant } from '@/lib/types';
import { formatScore, getPlantStatusColor, getPlantStatusText, getStrainName } from '@/lib/utils';
import React from 'react';

interface PlantCardProps {
  plant: Plant;
  showShopItems?: boolean;
  className?: string;
  onClick?: () => void;
  onNameChanged?: (plantId: number, newName: string) => void;
}

const SHOP_ITEM_ICONS: { [key: string]: string } = {
  'fence': '/icons/Fence.png',
  'bee farm': '/icons/BEE.png',
  'snail': '🐌',
  'water': '/icons/WATERDROPS.png',
  'fertilizer': '/icons/FERTILIZER.png',
  'sun': '/icons/SUN.png',
  'soil': '/icons/SOIL.png',
  'dreamdew': '/icons/DREAMDEW.png',
};

const PlantCard = React.memo(function PlantCard({
  plant,
  showShopItems = true,
  className = "",
  onClick,
  onNameChanged
}: PlantCardProps) {

  // Memoize expensive computations
  const { hasActiveShopItems, activeShopItems } = React.useMemo(() => {
    const hasActive = plant.extensions?.some((extension: any) =>
      extension.shopItemOwned?.some((item: any) => item.effectIsOngoingActive)
    );

    const active = plant.extensions?.flatMap((extension: any) =>
      extension.shopItemOwned?.filter((item: any) => item.effectIsOngoingActive) || []
    ) || [];

    return { hasActiveShopItems: hasActive, activeShopItems: active };
  }, [plant.extensions]);

  const getShopItemIcon = React.useCallback((itemName: string) => {
    const name = itemName.toLowerCase();
    return SHOP_ITEM_ICONS[name] || '/icons/Fence.png';
  }, []);

  // Memoize formatted values
  const formattedScore = React.useMemo(() => formatScore(plant.score), [plant.score]);
  const plantStatusColor = React.useMemo(() => getPlantStatusColor(plant.status), [plant.status]);
  const plantStatusText = React.useMemo(() => getPlantStatusText(plant.status), [plant.status]);
  const strainName = React.useMemo(() => getStrainName(plant.strain), [plant.strain]);

  return (
    <Card 
      className={`cursor-pointer transition-all hover:shadow-md group ${className}`}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-center space-x-3">
          {/* Plant Image with Shop Item Overlay */}
          <div className="relative w-16 h-16 rounded-lg overflow-hidden">
            <PlantImage
              selectedPlant={plant}
              width={64}
              height={64}
              className="w-full h-full object-cover"
              priority={false}
              lazy={true}
              quality={75}
            />
            {/* Active Shop Item Indicator */}
            {showShopItems && hasActiveShopItems && (
              <div className="absolute top-1 right-1">
                <div className="w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                  <img alt="Shield" src="/icons/Fence.png" width={12} height={12} />
                </div>
              </div>
            )}
          </div>

          {/* Plant Details */}
          <div className="flex-1 min-w-0">
            <div className="relative">
              <h3 className="font-semibold text-foreground truncate pr-6">
                {plant.name || `Plant #${plant.id}`}
              </h3>
              <EditPlantName 
                plant={plant} 
                onNameChanged={onNameChanged}
                iconSize={12}
                className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-0 right-0"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {strainName} • Level {plant.level}
            </p>
            <p className={`text-xs font-medium ${plantStatusColor}`}>
              {plantStatusText}
            </p>
            <p className="text-xs text-muted-foreground">
              PTS: {formattedScore}
            </p>
          </div>

          {/* Active Shop Items Icons */}
          {showShopItems && activeShopItems.length > 0 && (
            <div className="flex flex-col space-y-1">
              {activeShopItems.slice(0, 3).map((item: any, index: number) => (
                <div 
                  key={`${item.id}-${index}`}
                  className="w-6 h-6 rounded-sm bg-muted flex items-center justify-center"
                  title={item.name}
                >
                  <img src={getShopItemIcon(item.name)} alt={item.name} width={16} height={16} className="w-4 h-4" />
                </div>
              ))}
              {activeShopItems.length > 3 && (
                <div className="text-xs text-muted-foreground text-center">
                  +{activeShopItems.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
});

export default PlantCard; 