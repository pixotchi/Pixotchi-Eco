"use client";

import { Plant } from '@/lib/types';
import { calculateImageLevel } from '@/lib/utils';
import Image from 'next/image';
import React,{ useEffect,useMemo,useState } from 'react';

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
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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

  // Reset when the plant (and therefore the source) changes: without this, one
  // failed load made this memoized instance show the fallback + error overlay
  // for every later plant it was reused for, and level-ups popped in with no
  // skeleton or fade because imageLoaded stayed true.
  useEffect(() => {
    setImageError(false);
    setFallbackFailed(false);
    setImageLoaded(false);
  }, [imageSrc]);

  // First failure retries with the strain's base art; only when that also
  // fails does the placeholder replace the image entirely.
  const handleImageError = () => {
    if (!imageError) {
      setImageError(true);
    } else {
      setFallbackFailed(true);
    }
  };

  const handleImageLoad = () => {
    setImageLoaded(true);
  };
  // Both imageSrc and fallbackSrc are always `/ipfs/strainN/*.svg`, so the blur
  // placeholder this used to build could never apply. The pulsing skeleton below
  // is the loading state.
  const resolvedSrc = imageError ? fallbackSrc : imageSrc;

  return (
    <div className={`relative ${className}`}>
      {/* Loading placeholder */}
      {!imageLoaded && !imageError && (
        <div
          className="absolute inset-0 animate-pulse rounded-[var(--radius-control)] bg-muted"
          style={{ width, height }}
          aria-hidden="true"
        />
      )}

      {!fallbackFailed && (
      <Image
        src={resolvedSrc}
        alt={altText}
        width={width}
        height={height}
        sizes={sizes}
        preload={priority}
        loading={priority ? undefined : lazy ? "lazy" : "eager"}
        quality={quality}
        onError={handleImageError}
        onLoad={handleImageLoad}
        className={`transition-opacity duration-[var(--motion-standard)] ${
          imageLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
      )}

      {/* Placeholder, rendered INSTEAD of the image once the fallback also failed
          (it used to paint semi-transparently OVER a successfully loaded fallback) */}
      {fallbackFailed && (
        <div className="flex items-center justify-center rounded-[var(--radius-control)] bg-muted/50" style={{ width, height }}>
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
