"use client";

import { getTerrainNoise,getTokenIdFromCoordinate,getVisualTerrainType,visualToContract } from '@/lib/land-utils';
import { Land } from "@/lib/types";
import React,{ useEffect,useId,useMemo,useRef,useState } from 'react';

interface LandMapCanvasProps {
  center: { x: number; y: number }; // Visual coordinates
  zoom: number;
  userLands: Land[];
  selectedLand: Land | null;
  totalSupply: number;
  onLandClick: (tokenId: number | null, visualData?: { x: number, y: number, type: string }) => void;
  onCenterChange: (center: { x: number; y: number }) => void;
  /** Enables pinch-to-zoom on touch (the canvas sets touch-none, so native pinch is suppressed). */
  onZoomChange?: (zoom: number) => void;
}

function isNormalMintedLandId(tokenId: number, totalSupply: number): boolean {
  return tokenId > 0 && tokenId < totalSupply;
}

export function LandMapCanvas({
  center,
  zoom,
  userLands,
  selectedLand,
  totalSupply,
  onLandClick,
  onCenterChange,
  onZoomChange
}: LandMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const instructionsId = useId();
  const statusId = useId();
  const centerRef = useRef(center);
  const isDraggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const pendingCenterRef = useRef(center);
  const centerChangeFrameRef = useRef<number | null>(null);
  const dragDistanceRef = useRef(0);
  const didDragRef = useRef(false);
  const activePointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchDistanceRef = useRef<number | null>(null);

  // Image assets
  const [sprites, setSprites] = useState<{
    taken: HTMLImageElement | null,
    unminted: HTMLImageElement | null,
    water: HTMLImageElement | null,
    forest: HTMLImageElement | null,
    mountain: HTMLImageElement | null,
    avatar: HTMLImageElement | null
  }>({
    taken: null,
    unminted: null,
    water: null,
    forest: null,
    mountain: null,
    avatar: null
  });

  // Constants for rendering
  const TILE_SIZE = 40; // Base size of a tile in pixels
  const DRAG_CANCEL_THRESHOLD = 5; // Pixels of movement before we treat it as a drag

  const ownedTokenIds = useMemo(() => {
    return new Set(userLands.map((land) => Number(land.tokenId)));
  }, [userLands]);

  useEffect(() => {
    centerRef.current = center;
    pendingCenterRef.current = center;
  }, [center]);

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
      const loadedSprites: UntypedValue = {};

      // Load helper
      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve) => {
          const img = new Image();
          img.src = src;
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img); // Fallback, don't crash
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

        loadedSprites.taken = taken;
        loadedSprites.unminted = unminted;
        loadedSprites.water = water;
        loadedSprites.forest = forest;
        loadedSprites.mountain = mountain;

      } catch (e) {
        console.error("Failed to load map sprites", e);
      }

      if (cancelled) return;

      // Simple Avatar Placeholder (keep procedural for now or load if exists)
      const avCanvas = document.createElement('canvas');
      avCanvas.width = 20;
      avCanvas.height = 20;
      const avCtx = avCanvas.getContext('2d');
      if (avCtx) {
        avCtx.fillStyle = '#ef4444';
        avCtx.beginPath();
        avCtx.arc(10, 10, 8, 0, Math.PI * 2);
        avCtx.fill();
        avCtx.strokeStyle = 'white';
        avCtx.lineWidth = 2;
        avCtx.stroke();

        const img = new Image();
        img.src = avCanvas.toDataURL();
        loadedSprites.avatar = img;
      }

      if (cancelled) return;

      setSprites(prev => ({ ...prev, ...loadedSprites }));
    };

    loadSprites();

    return () => {
      cancelled = true;
    };
  }, []);

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
          const isMinted = isNormalMintedLandId(tokenId, totalSupply);
          const isUserOwned = ownedTokenIds.has(tokenId);
          const isSelected = selectedLand && Number(selectedLand.tokenId) === tokenId;
          // Terrain Generation (Deterministic Noise) for variety
          const noise = getTerrainNoise(cx, cy); // Use contract coords for consistent land look

          if (isMinted) {
            // MINTED LAND -> taken.png
            if (sprites.taken) {
              ctx.drawImage(sprites.taken, screenX - size / 2, screenY - size / 2, size, size);
            } else {
              // Fallback
              ctx.fillStyle = '#4ade80';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }

            if (isUserOwned) {
              // Add a blue tint or border for user owned
              ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              ctx.strokeStyle = '#3b82f6';
              ctx.lineWidth = 2;
              ctx.strokeRect(screenX - size / 2, screenY - size / 2, size, size);
            }

            // REMOVED: Red dot avatar indicator

          } else {
            // UNMINTED LAND -> Randomly pick from other assets (Cemetery, Jungle, Lake, Mountain)

            // Use the noise value we already have to pick a random terrain type
            // Normalized noise is 0-1

            if (noise < 0.25) {
              // 25% Chance: Cemetery (Original Unminted Look)
              if (sprites.unminted) {
                ctx.drawImage(sprites.unminted, screenX - size / 2, screenY - size / 2, size, size);
              } else {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                ctx.fillRect(screenX - size / 2 + 1, screenY - size / 2 + 1, size - 2, size - 2);
              }
            } else if (noise < 0.50) {
              // 25% Chance: Jungle
              if (sprites.forest) {
                ctx.drawImage(sprites.forest, screenX - size / 2, screenY - size / 2, size, size);
              } else {
                ctx.fillStyle = '#14532d';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            } else if (noise < 0.75) {
              // 25% Chance: Lake
              if (sprites.water) {
                ctx.drawImage(sprites.water, screenX - size / 2, screenY - size / 2, size, size);
              } else {
                ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            } else {
              // 25% Chance: Mountain
              if (sprites.mountain) {
                ctx.drawImage(sprites.mountain, screenX - size / 2, screenY - size / 2, size, size);
              } else {
                ctx.fillStyle = '#78716c';
                ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
              }
            }
          }

          // Highlight selection
          if (isSelected) {
            ctx.strokeStyle = '#fbbf24'; // Amber ring
            ctx.lineWidth = 3 * zoom;
            ctx.strokeRect(
              screenX - size / 2,
              screenY - size / 2,
              size,
              size
            );
          }
        } else {
          // GAP / WILDERNESS SLOT
          const terrainType = getVisualTerrainType(x, y);

          if (terrainType === 'water') {
            // Lake
            if (sprites.water) {
              ctx.drawImage(sprites.water, screenX - size / 2, screenY - size / 2, size, size);
            } else {
              ctx.fillStyle = 'rgba(59, 130, 246, 0.3)';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          } else if (terrainType === 'forest') {
            // Jungle
            if (sprites.forest) {
              ctx.drawImage(sprites.forest, screenX - size / 2, screenY - size / 2, size, size);
            } else {
              ctx.fillStyle = '#14532d';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          } else if (terrainType === 'mountain') {
            // Mountain
            if (sprites.mountain) {
              ctx.drawImage(sprites.mountain, screenX - size / 2, screenY - size / 2, size, size);
            } else {
              ctx.fillStyle = '#78716c';
              ctx.fillRect(screenX - size / 2, screenY - size / 2, size, size);
            }
          }
        }
      }
    }

  }, [dimensions, center, zoom, ownedTokenIds, selectedLand, totalSupply, sprites]);

  // Interaction Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointersRef.current.size === 2) {
      // Second finger down: switch from pan to pinch.
      const [a, b] = [...activePointersRef.current.values()];
      pinchDistanceRef.current = Math.hypot(a.x - b.x, a.y - b.y);
      isDraggingRef.current = false;
      didDragRef.current = true; // suppress the synthetic click after a pinch
      return;
    }
    isDraggingRef.current = true;
    lastPosRef.current = { x: e.clientX, y: e.clientY };
    pendingCenterRef.current = centerRef.current;
    dragDistanceRef.current = 0;
    didDragRef.current = false;
    canvasRef.current?.setPointerCapture(e.pointerId);
  };

  const scheduleCenterChange = () => {
    if (centerChangeFrameRef.current !== null) return;

    centerChangeFrameRef.current = requestAnimationFrame(() => {
      centerChangeFrameRef.current = null;
      const nextCenter = pendingCenterRef.current;
      centerRef.current = nextCenter;
      onCenterChange(nextCenter);
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Two-finger pinch drives zoom (touch-action: none suppresses the native one).
    if (activePointersRef.current.size === 2 && onZoomChange) {
      const [a, b] = [...activePointersRef.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const previous = pinchDistanceRef.current;
      pinchDistanceRef.current = distance;
      if (previous && previous > 0) {
        onZoomChange(zoom * (distance / previous));
      }
      return;
    }

    if (!isDraggingRef.current) return;

    const dx = e.clientX - lastPosRef.current.x;
    const dy = e.clientY - lastPosRef.current.y;

    const distance = Math.sqrt(dx * dx + dy * dy);
    dragDistanceRef.current += distance;
    if (dragDistanceRef.current > DRAG_CANCEL_THRESHOLD) {
      didDragRef.current = true;
    }

    // Convert pixel delta to coordinate delta
    const effectiveTileSize = TILE_SIZE * zoom;
    const coordDx = dx / effectiveTileSize;
    const coordDy = -dy / effectiveTileSize; // Invert Y

    const currentCenter = pendingCenterRef.current;
    pendingCenterRef.current = {
      x: currentCenter.x - coordDx,
      y: currentCenter.y - coordDy
    };
    scheduleCenterChange();

    lastPosRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      pinchDistanceRef.current = null;
    }
    isDraggingRef.current = false;
    try {
      canvasRef.current?.releasePointerCapture(e.pointerId);
    } catch {}
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
      : isNormalMintedLandId(tokenId, totalSupply)
        ? 'This plot is owned.'
        : 'This plot is available.';
    const selection = selectedLand && Number(selectedLand.tokenId) === tokenId
      ? ' Selected.'
      : '';

    return `Centre coordinates ${x}, ${y}. Plot ${tokenId}. ${ownership}${selection}`;
  }, [center.x, center.y, ownedTokenIds, selectedLand, totalSupply]);

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden cursor-move">
      <p id={instructionsId} className="sr-only">
        Use the arrow keys to pan. Hold Shift to move five plots at a time. Press Enter or Space to select the centre plot.
      </p>
      <p id={statusId} className="sr-only" aria-live="polite" aria-atomic="true">
        {mapStatus}
      </p>
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
        onPointerLeave={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleClick}
      />
    </div>
  );
}
