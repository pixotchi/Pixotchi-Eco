"use client";
import { drawMapPlotMarkers } from '@/lib/land-map-markers';

import { getTerrainNoise,getTokenIdFromCoordinate,getVisualTerrainType,visualToContract } from '@/lib/land-utils';
import { Land } from "@/lib/types";
import { applyMapPinch, getMapPlotStatus } from '@/lib/land-map-state';
import React,{ useEffect,useId,useMemo,useRef,useState } from 'react';

interface LandMapCanvasProps {
  center: { x: number; y: number }; // Visual coordinates
  zoom: number;
  userLands: Land[];
  selectedLand: Land | null;
  totalSupply: number | null;
  supplyIsCurrent?: boolean;
  knownMintedIds?: ReadonlySet<number>;
  onLandClick: (tokenId: number | null, visualData?: { x: number, y: number, type: string }) => void;
  onCenterChange: (center: { x: number; y: number }) => void;
  /** Enables pinch-to-zoom on touch (the canvas sets touch-none, so native pinch is suppressed). */
  onZoomChange?: (zoom: number) => void;
  /** Controls and legends positioned within the measured map viewport. */
  children?: React.ReactNode;
}

const NO_KNOWN_IDS = new Set<number>();

export function LandMapCanvas({
  center,
  zoom,
  userLands,
  selectedLand,
  totalSupply,
  supplyIsCurrent = true,
  knownMintedIds = NO_KNOWN_IDS,
  onLandClick,
  onCenterChange,
  onZoomChange,
  children
}: LandMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const instructionsId = useId();
  const statusId = useId();
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const pendingCenterRef = useRef(center);
  const centerChangeFrameRef = useRef<number | null>(null);
  const dragDistanceRef = useRef(0);
  const didDragRef = useRef(false);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const [failedSprites, setFailedSprites] = useState(false);
  const [spriteRetry, setSpriteRetry] = useState(0);

  // Image assets
  const [sprites, setSprites] = useState<{
    taken: HTMLImageElement | null,
    unminted: HTMLImageElement | null,
    water: HTMLImageElement | null,
    forest: HTMLImageElement | null,
    mountain: HTMLImageElement | null
  }>({
    taken: null,
    unminted: null,
    water: null,
    forest: null,
    mountain: null
  });

  // Constants for rendering
  const TILE_SIZE = 40; // Base size of a tile in pixels
  const DRAG_CANCEL_THRESHOLD = 5; // Pixels of movement before we treat it as a drag

  const ownedTokenIds = useMemo(() => {
    return new Set(userLands.map((land) => Number(land.tokenId)));
  }, [userLands]);
  const verifiedMintedIds = useMemo(() => new Set([...knownMintedIds, ...ownedTokenIds]), [knownMintedIds, ownedTokenIds]);

  useEffect(() => {
    centerRef.current = center;
    pendingCenterRef.current = center;
  }, [center]);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  useEffect(() => {
    return () => {
      if (centerChangeFrameRef.current !== null) {
        cancelAnimationFrame(centerChangeFrameRef.current);
      }
    };
  }, []);

  // Load sprites on mount
  useEffect(() => {
    // The canvas mounts/unmounts with the map dialog. Closing it before the WebP
    // sprites resolve would otherwise setState on an unmounted component.
    let cancelled = false;

    const loadSprites = async () => {
      // Load helper
      const loadImage = (src: string): Promise<HTMLImageElement | null> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.complete && img.naturalWidth > 0 ? img : null);
          img.onerror = () => resolve(null);
          img.src = src;
        });
      };

      try {
        const [taken, unminted, water, forest, mountain] = await Promise.all([
          loadImage('/icons/map/taken.webp'),
          loadImage('/icons/map/cemetery.webp'),
          loadImage('/icons/map/lake.webp'),
          loadImage('/icons/map/jungle.webp'),
          loadImage('/icons/map/mountains.webp')
        ]);

        if (cancelled) return;
        setSprites({ taken, unminted, water, forest, mountain });
        setFailedSprites([taken, unminted, water, forest, mountain].some(sprite => sprite === null));

      } catch (e) {
        console.error("Failed to load map sprites", e);
        if (!cancelled) setFailedSprites(true);
      }
    };

    loadSprites();

    return () => {
      cancelled = true;
    };
  }, [spriteRetry]);

  // Resize handler
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        // Use getBoundingClientRect for precise sub-pixel values if needed,
        // but round them for canvas clarity
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions(prev =>
          prev.width === rect.width && prev.height === rect.height
            ? prev
            : { width: rect.width, height: rect.height }
        );
      }
    };

    // Initial delay to let dialog animation settle
    const timer = setTimeout(updateSize, 100);

    // A single delayed measurement plus window 'resize' misses the cases that
    // actually matter on mobile: the dialog's own open animation still settling,
    // the URL bar showing/hiding, and the on-screen keyboard - none of which
    // reliably fire 'resize'. Observing the container catches all of them.
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      observer = new ResizeObserver(updateSize);
      observer.observe(containerRef.current);
    }

    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, []);

  // Main Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A successfully loaded image can still become unusable in a browser.
    // Keep that failure local to its tile and let the colored fallback draw.
    let drawingFailed = false;
    const drawSprite = (sprite: HTMLImageElement | null, x: number, y: number, size: number) => {
      if (!sprite || !sprite.complete || sprite.naturalWidth === 0) return false;
      try {
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        return true;
      } catch {
        drawingFailed = true;
        return false;
      }
    };

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    // Use Math.floor for width/height to match CSS pixel boundaries exactly
    // This prevents subtle 1px squashing/stretching which blurs pixel art
    const displayWidth = Math.floor(dimensions.width);
    const displayHeight = Math.floor(dimensions.height);

    const targetCanvasWidth = displayWidth * dpr;
    const targetCanvasHeight = displayHeight * dpr;

    if (canvas.width !== targetCanvasWidth || canvas.height !== targetCanvasHeight) {
      canvas.width = targetCanvasWidth;
      canvas.height = targetCanvasHeight;
    }

    // Ensure CSS style matches exactly 
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false; // Pixel art style

    // Clear canvas with water color (ocean background)
    ctx.fillStyle = '#93c5fd'; // Light Sky Blue
    ctx.fillRect(0, 0, displayWidth, displayHeight);

    const effectiveTileSize = TILE_SIZE * zoom;
    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;

    // Calculate visible coordinate bounds
    const tilesX = Math.ceil(displayWidth / effectiveTileSize / 2) + 1;
    const tilesY = Math.ceil(displayHeight / effectiveTileSize / 2) + 1;

    const startX = Math.floor(center.x - tilesX);
    const endX = Math.ceil(center.x + tilesX);
    const startY = Math.floor(center.y - tilesY);
    const endY = Math.ceil(center.y + tilesY);

    // Draw Loop
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        // x, y are VISUAL coordinates
        const screenX = centerX + (x - center.x) * effectiveTileSize;
        const screenY = centerY - (y - center.y) * effectiveTileSize; // Y is inverted

        // 1. Determine if this visual tile maps to a contract land
        const cx = visualToContract(x);
        const cy = visualToContract(y);

        const size = effectiveTileSize;

        if (cx !== null && cy !== null) {
          // VALID LAND SLOT
          const tokenId = getTokenIdFromCoordinate(cx, cy);

          // Determine Status
          const plotStatus = getMapPlotStatus(tokenId, totalSupply, verifiedMintedIds, supplyIsCurrent);
          const isUserOwned = ownedTokenIds.has(tokenId);
          const isSelected = selectedLand && Number(selectedLand.tokenId) === tokenId;
          // Terrain Generation (Deterministic Noise) for variety
          const noise = getTerrainNoise(cx, cy); // Use contract coords for consistent land look

          if (plotStatus === 'unknown') {
            ctx.fillStyle = '#64748b';
            ctx.fillRect(screenX - size / 2 + 1, screenY - size / 2 + 1, size - 2, size - 2);
          } else if (plotStatus === 'minted') {
            // MINTED LAND -> taken.png
            if (!drawSprite(sprites.taken, screenX, screenY, size)) {
              // Fallback
              ctx.fillStyle = '#4ade80';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }

          } else {
            // UNMINTED LAND -> Randomly pick from other assets (Cemetery, Jungle, Lake, Mountain)

            // Use the noise value we already have to pick a random terrain type
            // Normalized noise is 0-1

            if (noise < 0.25) {
              // 25% Chance: Cemetery (Original Unminted Look)
              if (!drawSprite(sprites.unminted, screenX, screenY, size)) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fillRect(screenX - size / 2 + 1, screenY - size / 2 + 1, size - 2, size - 2);
              }
            } else if (noise < 0.50) {
              // 25% Chance: Jungle
              if (!drawSprite(sprites.forest, screenX, screenY, size)) {
                ctx.fillStyle = '#14532d';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            } else if (noise < 0.75) {
              // 25% Chance: Lake
              if (!drawSprite(sprites.water, screenX, screenY, size)) {
                ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            } else {
              // 25% Chance: Mountain
              if (!drawSprite(sprites.mountain, screenX, screenY, size)) {
                ctx.fillStyle = '#78716c';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            }
          }

          drawMapPlotMarkers(ctx, screenX, screenY, size, isUserOwned, Boolean(isSelected));
        } else {
          // GAP / WILDERNESS SLOT
          const terrainType = getVisualTerrainType(x, y);

          if (terrainType === 'water') {
            // Lake
            if (!drawSprite(sprites.water, screenX, screenY, size)) {
              ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          } else if (terrainType === 'forest') {
            // Jungle
            if (!drawSprite(sprites.forest, screenX, screenY, size)) {
              ctx.fillStyle = '#14532d';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          } else if (terrainType === 'mountain') {
            // Mountain
            if (!drawSprite(sprites.mountain, screenX, screenY, size)) {
              ctx.fillStyle = '#78716c';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          }
        }
      }
    }

    if (drawingFailed) setFailedSprites(true);
  }, [dimensions, center, zoom, ownedTokenIds, verifiedMintedIds, selectedLand, totalSupply, supplyIsCurrent, sprites]);

  // Capture both fingers. Pending values update on every event, while React
  // receives one coherent center/zoom update per animation frame.
  const localPoint = (e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || activePointersRef.current.size >= 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const point = localPoint(e);
    activePointersRef.current.set(e.pointerId, point);
    if (activePointersRef.current.size === 2) {
      isDraggingRef.current = false;
      didDragRef.current = true;
      return;
    }
    isDraggingRef.current = true;
    lastPosRef.current = point;
    pendingCenterRef.current = centerRef.current;
    dragDistanceRef.current = 0;
    didDragRef.current = false;
  };

  const scheduleCenterChange = () => {
    if (centerChangeFrameRef.current !== null) return;
    centerChangeFrameRef.current = requestAnimationFrame(() => {
      centerChangeFrameRef.current = null;
      centerRef.current = pendingCenterRef.current;
      onCenterChange(pendingCenterRef.current);
      onZoomChange?.(zoomRef.current);
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    const previous = [...activePointersRef.current.values()];
    const point = localPoint(e);
    activePointersRef.current.set(e.pointerId, point);
    if (activePointersRef.current.size === 2) {
      const next = [...activePointersRef.current.values()];
      const view = applyMapPinch(
        { center: pendingCenterRef.current, zoom: zoomRef.current },
        [previous[0], previous[1]], [next[0], next[1]], dimensions,
      );
      if (onZoomChange) {
        pendingCenterRef.current = view.center;
        zoomRef.current = view.zoom;
        scheduleCenterChange();
      }
      return;
    }
    if (!isDraggingRef.current) return;
    const dx = point.x - lastPosRef.current.x;
    const dy = point.y - lastPosRef.current.y;
    dragDistanceRef.current += Math.hypot(dx, dy);
    if (dragDistanceRef.current > DRAG_CANCEL_THRESHOLD) didDragRef.current = true;
    pendingCenterRef.current = {
      x: pendingCenterRef.current.x - dx / (TILE_SIZE * zoomRef.current),
      y: pendingCenterRef.current.y + dy / (TILE_SIZE * zoomRef.current),
    };
    scheduleCenterChange();
    lastPosRef.current = point;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePointersRef.current.delete(e.pointerId)) return;
    const remaining = [...activePointersRef.current.values()];
    isDraggingRef.current = remaining.length === 1;
    if (remaining.length === 1) lastPosRef.current = remaining[0];
    if (e.type !== 'pointerup') didDragRef.current = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Keyboard access: the canvas is otherwise a pointer-only surface.
  const handleCanvasKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 5 : 1;
    let dx = 0;
    let dy = 0;
    if (e.key === 'ArrowLeft') dx = -step;
    else if (e.key === 'ArrowRight') dx = step;
    else if (e.key === 'ArrowUp') dy = step;
    else if (e.key === 'ArrowDown') dy = -step;
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const x = Math.round(centerRef.current.x);
      const y = Math.round(centerRef.current.y);
      const cx = visualToContract(x);
      const cy = visualToContract(y);
      if (cx !== null && cy !== null) {
        const tokenId = getTokenIdFromCoordinate(cx, cy);
        onLandClick(tokenId > 0 ? tokenId : null, tokenId > 0 ? undefined : { x, y, type: 'none' });
      } else {
        onLandClick(null, { x, y, type: getVisualTerrainType(x, y) });
      }
      return;
    } else {
      return;
    }
    e.preventDefault();
    const next = { x: centerRef.current.x + dx, y: centerRef.current.y + dy };
    centerRef.current = next;
    pendingCenterRef.current = next;
    onCenterChange(next);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (didDragRef.current) {
      didDragRef.current = false;
      dragDistanceRef.current = 0;
      return;
    }

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Recalculate center based on current dimensions state to ensure sync
    const displayWidth = dimensions.width;
    const displayHeight = dimensions.height;

    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;
    const effectiveTileSize = TILE_SIZE * zoom;

    const rawX = center.x + (clickX - centerX) / effectiveTileSize;
    const rawY = center.y - (clickY - centerY) / effectiveTileSize;

    const x = Math.round(rawX);
    const y = Math.round(rawY);

    // Convert Visual -> Contract
    const cx = visualToContract(x);
    const cy = visualToContract(y);

    if (cx !== null && cy !== null) {
      // CLICKED ON LAND SLOT (Minted or Unminted)
      const tokenId = getTokenIdFromCoordinate(cx, cy);
      if (tokenId > 0) {
        onLandClick(tokenId);
      } else {
        onLandClick(null, { x, y, type: 'none' });
      }
    } else {
      // CLICKED ON WILDERNESS GAP
      const terrainType = getVisualTerrainType(x, y);
      onLandClick(null, { x, y, type: terrainType });
    }
  };

  const mapStatus = useMemo(() => {
    const x = Math.round(center.x);
    const y = Math.round(center.y);
    const contractX = visualToContract(x);
    const contractY = visualToContract(y);

    if (contractX === null || contractY === null) {
      return `Centre coordinates ${x}, ${y}. ${getVisualTerrainType(x, y)} wilderness.`;
    }

    const tokenId = getTokenIdFromCoordinate(contractX, contractY);
    const ownership = ownedTokenIds.has(tokenId)
      ? 'You own this plot.'
      : getMapPlotStatus(tokenId, totalSupply, verifiedMintedIds, supplyIsCurrent) === 'minted'
        ? 'This plot is owned.'
        : getMapPlotStatus(tokenId, totalSupply, verifiedMintedIds, supplyIsCurrent) === 'unknown'
          ? 'Ownership data is unavailable for this plot.'
          : 'This plot is unminted.';
    const selection = selectedLand && Number(selectedLand.tokenId) === tokenId
      ? ' Selected.'
      : '';

    return `Centre coordinates ${x}, ${y}. Plot ${tokenId}. ${ownership}${selection}`;
  }, [center.x, center.y, ownedTokenIds, verifiedMintedIds, selectedLand, totalSupply, supplyIsCurrent]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <p id={instructionsId} className="sr-only">
        Use the arrow keys to pan. Hold Shift to move five plots at a time. Press Enter or Space to select the centre plot.
      </p>
      <p id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
        {mapStatus}
      </p>
      {/* Reserve a bounded, scrollable row so enlarged text cannot cover the
          map overlays. Only the inner viewport participates in map coordinates. */}
      {failedSprites && (
        <div role="status" className="m-[8px] flex max-h-[40%] shrink-0 flex-wrap items-center justify-between gap-[8px] overflow-y-auto overscroll-contain rounded-[var(--radius-control)] border border-border bg-card p-[8px] text-xs touch-pan-y">
          <span>Some map artwork is unavailable. Plots remain interactive.</span>
          <button type="button" className="min-h-[44px] max-w-full whitespace-normal px-[12px] text-left underline" onClick={() => setSpriteRetry(value => value + 1)}>Retry map artwork</button>
        </div>
      )}
      <div ref={containerRef} className="relative min-h-0 w-full flex-1 overflow-hidden cursor-move">
      {/* pointercancel: OS gestures / browser back-swipes end a captured drag
          with neither pointerup nor pointerleave — without the handler the map
          kept panning with no button pressed. */}
      <canvas
        ref={canvasRef}
        className="block touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ width: '100%', height: '100%' }}
        tabIndex={0}
        role="region"
        aria-roledescription="interactive land map"
        aria-label="Land map"
        aria-describedby={`${instructionsId} ${statusId}`}
        onKeyDown={handleCanvasKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onLostPointerCapture={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      />
      {children}
      </div>
    </div>
  );
}
