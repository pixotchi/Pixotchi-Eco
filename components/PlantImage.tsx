"use client";

import { Plant } from '@/lib/types';
import { calculateImageLevel } from '@/lib/utils';
import Image from 'next/image';
import React,{ useMemo,useState } from 'react';

interface PlantImageProps {
  selectedPlant: Plant;
  width?: number;
  height?: number;
  className?: string;
  priority?: boolean;
  lazy?: boolean;
  quality?: number;
}

type PlantImageAssetProps = {
  altText: string;
  fallbackSrc: string;
  height: number;
  imageSrc: string;
  lazy: boolean;
  plantId: Plant['id'];
  priority: boolean;
  quality: number;
  sizes: string;
  width: number;
};

/*
 * Keep loading/error state inside a source-keyed boundary. A cached image can
 * complete before a parent effect runs; resetting `imageLoaded` from an effect
 * after that completion left the already-loaded image permanently transparent.
 * Remounting this small state owner only when the actual asset changes makes old
 * load/error callbacks incapable of mutating the next source.
 */
function PlantImageAsset({
  altText,
  fallbackSrc,
  height,
  imageSrc,
  lazy,
  plantId,
  priority,
  quality,
  sizes,
  width,
}: PlantImageAssetProps) {
  const [imageError, setImageError] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const hasDistinctFallback = fallbackSrc !== imageSrc;
  const resolvedSrc = imageError && hasDistinctFallback ? fallbackSrc : imageSrc;

  const handleImageError = () => {
    if (!imageError && hasDistinctFallback) {
      setImageLoaded(false);
      setImageError(true);
      return;
    }

    setFallbackFailed(true);
  };

  return (
    <>
      {!imageLoaded && !fallbackFailed && (
        <div
          className="absolute inset-0 animate-pulse rounded-[var(--radius-control)] bg-muted"
          style={{ width, height }}
          aria-hidden="true"
        />
      )}

      {!fallbackFailed && (
        <Image
          key={resolvedSrc}
          src={resolvedSrc}
          alt={altText}
          width={width}
          height={height}
          sizes={sizes}
          preload={priority}
          loading={priority ? undefined : lazy ? "lazy" : "eager"}
          quality={quality}
          onError={handleImageError}
          onLoad={() => setImageLoaded(true)}
          className={`transition-opacity duration-[var(--motion-standard)] ${
            imageLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {fallbackFailed && (
        <div className="flex items-center justify-center rounded-[var(--radius-control)] bg-muted/50" style={{ width, height }}>
          <div className="text-xs text-muted-foreground text-center">
            <div>🌱</div>
            <div>Plant #{plantId}</div>
          </div>
        </div>
      )}
    </>
  );
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
  // Memoize expensive calculations
  const { imageSrc, altText, sizes } = useMemo(() => {
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
  // Both imageSrc and fallbackSrc are always `/ipfs/strainN/*.svg`, so the blur
  // placeholder this used to build could never apply. The pulsing skeleton below
  // is the loading state.

  return (
    <div className={`relative ${className}`}>
      <PlantImageAsset
        key={`${imageSrc}|${fallbackSrc}`}
        imageSrc={imageSrc}
        fallbackSrc={fallbackSrc}
        altText={altText}
        width={width}
        height={height}
        sizes={sizes}
        priority={priority}
        lazy={lazy}
        quality={quality}
        plantId={selectedPlant.id}
      />
    </div>
  );
});

PlantImage.displayName = 'PlantImage';

export default PlantImage;
