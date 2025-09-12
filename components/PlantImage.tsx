import React, { useState, useMemo } from 'react';
import Image from 'next/image';
import { calculateImageLevel } from '@/lib/utils';
import { Plant } from '@/lib/types';

interface PlantImageProps {
  selectedPlant: Plant;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  lazy?: boolean;
  quality?: number;
}

const PlantImage = React.memo(({
  selectedPlant,
  width = 500,
  height = 500,
  className = "",
  priority = false,
  lazy = true,
  quality = 85
}: PlantImageProps) => {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Memoize expensive calculations
  const { level, imageSrc, altText, sizes } = useMemo(() => {
    const calculatedLevel = calculateImageLevel(selectedPlant.level);
    const src = `/ipfs/strain${selectedPlant.strain}/${calculatedLevel}.svg`;
    const alt = selectedPlant.name || `Plant #${selectedPlant.id}`;

    // Responsive sizes based on common breakpoints
    const responsiveSizes = width <= 64
      ? "64px"
      : width <= 128
      ? "(max-width: 640px) 64px, 128px"
      : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw";

    return {
      level: calculatedLevel,
      imageSrc: src,
      altText: alt,
      sizes: responsiveSizes
    };
  }, [selectedPlant.strain, selectedPlant.level, selectedPlant.name, selectedPlant.id, width]);

  // Fallback image for errors
  const fallbackSrc = useMemo(() =>
    `/ipfs/strain${selectedPlant.strain}/1.svg`,
    [selectedPlant.strain]
  );

  const handleImageError = () => {
    if (!imageError) {
      setImageError(true);
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Loading placeholder */}
      {!imageLoaded && !imageError && (
        <div
          className="absolute inset-0 bg-muted animate-pulse rounded-lg"
          style={{ width, height }}
          aria-hidden="true"
        />
      )}

      <Image
        src={imageError ? fallbackSrc : imageSrc}
        alt={altText}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        loading={lazy && !priority ? "lazy" : "eager"}
        quality={quality}
        placeholder="blur"
        blurDataURL={`data:image/svg+xml;base64,${btoa(`
          <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#f3f4f6"/>
            <circle cx="50%" cy="50%" r="20%" fill="#d1d5db" opacity="0.5"/>
          </svg>
        `)}`}
        onError={handleImageError}
        onLoad={handleImageLoad}
        className={`transition-opacity duration-300 ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Error state indicator */}
      {imageError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/50 rounded-lg">
          <div className="text-xs text-muted-foreground text-center">
            <div>🌱</div>
            <div>Plant #{selectedPlant.id}</div>
          </div>
        </div>
      )}
    </div>
  );
});

PlantImage.displayName = 'PlantImage';

export default PlantImage; 