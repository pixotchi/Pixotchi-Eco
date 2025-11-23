"use client";

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { Land } from "@/lib/types";
import { getTokenIdFromCoordinate, getTerrainNoise, visualToContract, getVisualTerrainType } from '@/lib/land-utils';
import { LandLeaderboardEntry } from "@/lib/contracts";

  interface LandMapCanvasProps {
    center: { x: number; y: number }; // Visual coordinates
    zoom: number;
    userLands: Land[];
    selectedLand: Land | null;
    totalSupply: number;
    neighborData: Record<number, LandLeaderboardEntry>;
    onLandClick: (tokenId: number | null, visualData?: { x: number, y: number, type: string }) => void;
    onCenterChange: (center: { x: number; y: number }) => void;
  }

export function LandMapCanvas({
  center,
  zoom,
  userLands,
  selectedLand,
  totalSupply,
  neighborData,
  onLandClick,
  onCenterChange
}: LandMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const dragDistanceRef = useRef(0);
  const didDragRef = useRef(false);
  
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
  const GAP = 0; // No gap for sprites
  const DRAG_CANCEL_THRESHOLD = 5; // Pixels of movement before we treat it as a drag

  const ownedTokenIds = useMemo(() => {
    return new Set(userLands.map((land) => Number(land.tokenId)));
  }, [userLands]);
  
  // Load sprites on mount
  useEffect(() => {
    const loadSprites = async () => {
      const loadedSprites: any = {};

      // Load helper
      const loadImage = (src: string): Promise<HTMLImageElement> => {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.src = src;
          img.onload = () => resolve(img);
          img.onerror = () => resolve(img); // Fallback, don't crash
        });
      };

      try {
        const [taken, unminted, water, forest, mountain] = await Promise.all([
            loadImage('/icons/taken.png'),
            loadImage('/icons/cemetery.png'),
            loadImage('/icons/lake.png'),
            loadImage('/icons/jungle.png'),
            loadImage('/icons/mountains.png')
        ]);

        loadedSprites.taken = taken;
        loadedSprites.unminted = unminted;
        loadedSprites.water = water;
        loadedSprites.forest = forest;
        loadedSprites.mountain = mountain;

      } catch (e) {
        console.error("Failed to load map sprites", e);
      }
      
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

      setSprites(prev => ({ ...prev, ...loadedSprites }));
    };
    
    loadSprites();
  }, []);

  // Resize handler
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        // Use getBoundingClientRect for precise sub-pixel values if needed, 
        // but round them for canvas clarity
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: rect.height
        });
      }
    };
    
    // Initial delay to let dialog animation settle
    const timer = setTimeout(updateSize, 100);
    
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
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
    
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    
    // Ensure CSS style matches exactly 
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    
    ctx.scale(dpr, dpr);
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
            const isMinted = tokenId <= totalSupply;
            const isUserOwned = ownedTokenIds.has(tokenId);
            const isSelected = selectedLand && Number(selectedLand.tokenId) === tokenId;
            const neighbor = neighborData[tokenId];
            
             // Terrain Generation (Deterministic Noise) for variety
             const noise = getTerrainNoise(cx, cy); // Use contract coords for consistent land look
             
             if (isMinted) {
               // MINTED LAND -> taken.png
               if (sprites.taken) {
                   ctx.drawImage(sprites.taken, screenX - size/2, screenY - size/2, size, size);
               } else {
                   // Fallback
                   ctx.fillStyle = '#4ade80'; 
                   ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
               }
               
               if (isUserOwned) {
                  // Add a blue tint or border for user owned
                  ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'; 
                  ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                  ctx.strokeStyle = '#3b82f6';
                  ctx.lineWidth = 2;
                  ctx.strokeRect(screenX - size/2, screenY - size/2, size, size);
               }
     
               // REMOVED: Red dot avatar indicator
     
             } else {
               // UNMINTED LAND -> Randomly pick from other assets (Cemetery, Jungle, Lake, Mountain)
               
               // Use the noise value we already have to pick a random terrain type
               // Normalized noise is 0-1
               
               if (noise < 0.25) {
                   // 25% Chance: Cemetery (Original Unminted Look)
                   if (sprites.unminted) {
                        ctx.drawImage(sprites.unminted, screenX - size/2, screenY - size/2, size, size);
                   } else {
                        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
                        ctx.fillRect(screenX - size/2 + 1, screenY - size/2 + 1, size - 2, size - 2);
                   }
               } else if (noise < 0.50) {
                   // 25% Chance: Jungle
                   if (sprites.forest) {
                       ctx.drawImage(sprites.forest, screenX - size/2, screenY - size/2, size, size);
                   } else {
                       ctx.fillStyle = '#14532d'; 
                       ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                   }
               } else if (noise < 0.75) {
                   // 25% Chance: Lake
                   if (sprites.water) {
                       ctx.drawImage(sprites.water, screenX - size/2, screenY - size/2, size, size);
                   } else {
                       ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'; 
                       ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                   }
               } else {
                   // 25% Chance: Mountain
                   if (sprites.mountain) {
                       ctx.drawImage(sprites.mountain, screenX - size/2, screenY - size/2, size, size);
                   } else {
                       ctx.fillStyle = '#78716c'; 
                       ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
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
                    ctx.drawImage(sprites.water, screenX - size/2, screenY - size/2, size, size);
                } else {
                    ctx.fillStyle = 'rgba(59, 130, 246, 0.3)'; 
                    ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                }
            } else if (terrainType === 'forest') {
                // Jungle
                if (sprites.forest) {
                    ctx.drawImage(sprites.forest, screenX - size/2, screenY - size/2, size, size);
                } else {
                    ctx.fillStyle = '#14532d'; 
                    ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                }
            } else if (terrainType === 'mountain') {
                // Mountain
                if (sprites.mountain) {
                    ctx.drawImage(sprites.mountain, screenX - size/2, screenY - size/2, size, size);
                } else {
                    ctx.fillStyle = '#78716c'; 
                    ctx.fillRect(screenX - size/2, screenY - size/2, size, size);
                }
            }
        }
      }
    }
    
  }, [dimensions, center, zoom, ownedTokenIds, selectedLand, totalSupply, sprites, neighborData]);

  // Interaction Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    setLastPos({ x: e.clientX, y: e.clientY });
    dragDistanceRef.current = 0;
    didDragRef.current = false;
    canvasRef.current?.setPointerCapture(e.pointerId);
  };
  
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    
    const dx = e.clientX - lastPos.x;
    const dy = e.clientY - lastPos.y;

    const distance = Math.sqrt(dx * dx + dy * dy);
    dragDistanceRef.current += distance;
    if (dragDistanceRef.current > DRAG_CANCEL_THRESHOLD) {
      didDragRef.current = true;
    }
    
    // Convert pixel delta to coordinate delta
    const effectiveTileSize = TILE_SIZE * zoom;
    const coordDx = dx / effectiveTileSize;
    const coordDy = -dy / effectiveTileSize; // Invert Y
    
    onCenterChange({
      x: center.x - coordDx,
      y: center.y - coordDy
    });
    
    setLastPos({ x: e.clientX, y: e.clientY });
  };
  
  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    canvasRef.current?.releasePointerCapture(e.pointerId);
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
        onLandClick(tokenId);
    } else {
        // CLICKED ON WILDERNESS GAP
        const terrainType = getVisualTerrainType(x, y);
        onLandClick(null, { x, y, type: terrainType });
    }
  };

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden cursor-move">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none"
        style={{ width: '100%', height: '100%' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onClick={handleClick}
      />
    </div>
  );
}
