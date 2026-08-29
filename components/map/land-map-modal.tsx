"use client";

import ChatProfileDialog from "@/components/chat/chat-profile-dialog";
import { formatAddress } from "@/lib/utils";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogTitle } from "@/components/ui/dialog";
import { LandLeaderboardEntry,getLandOwner } from "@/lib/contracts";
import { contractToVisual,getCoordinateFromTokenId } from "@/lib/land-utils";
import { Land } from "@/lib/types";
import { Compass,Minus,Plus,User,X } from "lucide-react";
import Image from "next/image";
import { useEffect,useState } from 'react';
import { LandMapCanvas } from './land-map-canvas';

// Helper to truncate address
const truncateAddress = (address: string) => {
  if (!address || address === '0x0000000000000000000000000000000000000000') return 'Unknown';
  return formatAddress(address);
};

interface LandMapModalProps {
  isOpen: boolean;
  onClose: () => void;
  userLands: Land[];
  selectedLand: Land | null;
  onSelectLand: (land: Land) => void;
  totalSupply: number;
  neighborData: Record<number, LandLeaderboardEntry>;
}

export function LandMapModal({
  isOpen,
  onClose,
  userLands,
  selectedLand,
  onSelectLand,
  totalSupply,
  neighborData
}: LandMapModalProps) {
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [tappedLandId, setTappedLandId] = useState<number | null>(null);
  const [tappedWilderness, setTappedWilderness] = useState<{ x: number, y: number, type: string } | null>(null);
  const [fetchedOwner, setFetchedOwner] = useState<string | null>(null);
  const [isOwnerLoading, setIsOwnerLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  
  // Initialize center to selected land or (0,0)
  useEffect(() => {
    if (isOpen && selectedLand) {
      // Calculate visual coordinates from Token ID instead of relying on coordinateX/Y which might be 0
      const coord = getCoordinateFromTokenId(Number(selectedLand.tokenId));
      const x = contractToVisual(coord.x);
      const y = contractToVisual(coord.y);
      setCenter({ x, y });
      setTappedLandId(null);
      setTappedWilderness(null);
    } else if (isOpen && !selectedLand) {
      setCenter({ x: contractToVisual(0), y: contractToVisual(0) });
      setTappedLandId(null);
      setTappedWilderness(null);
    }
  }, [isOpen, selectedLand]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.5, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.5, 0.2));
  
  const handleCenterOnUser = () => {
    if (selectedLand) {
      // Calculate visual coordinates from Token ID instead of relying on coordinateX/Y which might be 0
      const coord = getCoordinateFromTokenId(Number(selectedLand.tokenId));
      const x = contractToVisual(coord.x);
      const y = contractToVisual(coord.y);
      
      setCenter({ x, y });
      setTappedLandId(null);
      setTappedWilderness(null);
    } else if (userLands.length > 0) {
      const coord = getCoordinateFromTokenId(Number(userLands[0].tokenId));
      const x = contractToVisual(coord.x);
      const y = contractToVisual(coord.y);
      
      setCenter({ x, y });
      setTappedLandId(null);
      setTappedWilderness(null);
    } else {
      setCenter({ x: contractToVisual(0), y: contractToVisual(0) });
      setTappedLandId(null);
      setTappedWilderness(null);
    }
  };

  const neighbor = tappedLandId ? neighborData[tappedLandId] : null;
  const isUserOwned = tappedLandId ? userLands.some(l => Number(l.tokenId) === tappedLandId) : false;
  const isTappedLandMinted = tappedLandId !== null && tappedLandId > 0 && tappedLandId < totalSupply;
  
  // Owners we can resolve without an RPC call, reduced to plain strings so the
  // effect below doesn't re-run (and re-fetch) every time the parent re-renders
  // and hands us new `userLands` / `neighborData` object identities.
  const knownOwnerAddress =
    isUserOwned && userLands.length > 0 ? userLands[0].owner : null;
  const neighborOwnerAddress =
    neighbor?.owner && neighbor.owner !== '' && neighbor.owner !== '0x0000000000000000000000000000000000000000'
      ? neighbor.owner
      : null;

  // Fetch owner on demand
  useEffect(() => {
    if (tappedLandId) {
      // If user owned, we know the owner
      if (knownOwnerAddress) {
        setFetchedOwner(knownOwnerAddress);
        return;
      }

      // If neighbor has owner field (future proof), use it
      if (neighborOwnerAddress) {
        setFetchedOwner(neighborOwnerAddress);
        return;
      }

      // Otherwise fetch from contract.
      // Without this guard, tapping land A then land B races: if A's lookup
      // resolves last it overwrites B's owner, and the tooltip then shows
      // land B while the Profile button opens land A's owner.
      let ignore = false;

      setIsOwnerLoading(true);
      setFetchedOwner(null);
      getLandOwner(tappedLandId)
        .then(owner => {
          if (ignore) return;
          setFetchedOwner(owner);
        })
        .catch(err => {
          if (ignore) return;
          console.error('Error fetching owner', err);
          setFetchedOwner(null);
        })
        .finally(() => {
          if (ignore) return;
          setIsOwnerLoading(false);
        });

      return () => {
        ignore = true;
      };
    } else {
      setFetchedOwner(null);
      setIsOwnerLoading(false);
    }
  }, [tappedLandId, knownOwnerAddress, neighborOwnerAddress]);

  const ownerAddress = fetchedOwner || '';
  
  // Resolve Basename
  const { name: ownerName, loading: isNameLoading } = usePrimaryName(ownerAddress);
  const displayName = ownerName || truncateAddress(ownerAddress);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-[440px] h-[85vh] p-0 sm:p-0 overflow-hidden bg-card bg-[image:var(--gradient-dialog)] border-border/65 flex flex-col gap-0 focus:outline-none"
        hideCloseButton
      >
        <DialogTitle className="sr-only">World Map</DialogTitle>
        <DialogDescription className="sr-only">
          Explore discovered land plots, inspect neighboring owners, and select one of your lands.
        </DialogDescription>
        
        {/* Header overlay */}
        <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start pointer-events-none">
          <div className="pointer-events-auto rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] px-3 py-2 shadow-[var(--shadow-hairline)]">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Compass className="w-4 h-4 text-primary" />
              World Map
            </h2>
            <p className="text-[10px] text-muted-foreground">
              {totalSupply.toLocaleString()} Plots Discovered
            </p>
          </div>

          <Button
            variant="headerIcon"
            size="icon"
            onClick={onClose}
            aria-label="Close world map"
            className="pointer-events-auto"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Map Canvas Area */}
        <div className="relative h-full w-full flex-1 overflow-hidden bg-[hsl(var(--info)/0.18)] touch-none">
          <LandMapCanvas 
            center={center}
            zoom={zoom}
            userLands={userLands}
            selectedLand={selectedLand}
            totalSupply={totalSupply}
            neighborData={neighborData}
            onLandClick={(tokenId, visualData) => {
              // 1. Handle Wilderness Click
              if (tokenId === null && visualData) {
                  setTappedLandId(null);
                  // Toggle off if clicking same spot
                  if (tappedWilderness?.x === visualData.x && tappedWilderness?.y === visualData.y) {
                      setTappedWilderness(null);
                  } else {
                      setTappedWilderness(visualData);
                  }
                  return;
              }
              
              // 2. Handle Land Click (Minted or Unminted)
              if (tokenId !== null) {
                  setTappedWilderness(null);
                  
                  // If clicking same land, toggle off
                  if (tappedLandId === tokenId) {
                      setTappedLandId(null);
                      return;
                  }
                  
                  // If clicking user land, select it and close
                  const userLand = userLands.find(l => Number(l.tokenId) === tokenId);
                  if (userLand) {
                    onSelectLand(userLand);
                    onClose(); 
                    return;
                  } 
                  
                  // If clicking neighbor or unminted, show info
                  setTappedLandId(tokenId);
              }
            }}
            onCenterChange={setCenter}
          />
        </div>
        
        {/* Wilderness Info Tooltip */}
        {tappedWilderness && (
            <div className="absolute bottom-6 left-4 right-16 z-20 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <div className="flex items-center gap-4 rounded-[var(--radius-panel)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-raised)]">
                    {/* Thumbnail */}
                    <div className="relative aspect-square w-16 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-border/50 bg-muted/50">
                        <Image 
                            /* Assets live at /icons/map/*.webp — this pointed at
                               /icons/*.png, which does not exist, so the thumbnail
                               404'd. The terminal fallback is 'jungle' because
                               `type` is typed as string and an unexpected value
                               previously fell through to the raw type. */
                            src={`/icons/map/${
                                tappedWilderness.type === 'water' ? 'lake' :
                                tappedWilderness.type === 'none' ? 'cemetery' :
                                tappedWilderness.type === 'forest' ? 'jungle' :
                                tappedWilderness.type === 'mountain' ? 'mountains' :
                                'jungle'
                            }.webp`}
                            alt={tappedWilderness.type}
                            fill
                            sizes="64px"
                            className="object-contain p-1"
                        />
                    </div>
                    
                    <div className="flex-1">
                        <h3 className="text-lg font-semibold capitalize">
                            {
                                tappedWilderness.type === 'water' ? 'Lake' :
                                tappedWilderness.type === 'none' ? 'Cemetery' : 
                                tappedWilderness.type
                            }
                        </h3>
                    </div>

                    <Button
                        variant="headerIcon"
                        size="iconCompact"
                        aria-label="Dismiss terrain details"
                        className="shrink-0"
                        onClick={() => setTappedWilderness(null)}
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        )}

        {/* Neighbor Info Tooltip / Sheet */}
        {tappedLandId && (
            <div className="absolute bottom-6 left-4 right-16 z-20 animate-in fade-in slide-in-from-bottom-4 duration-200">
                <div className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-raised)]">
                    {/* Thumbnail */}
                    <div className="relative aspect-square w-16 shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-border/50 bg-muted/50">
                        <Image 
                            src={isTappedLandMinted ? "/icons/map/taken.webp" : "/icons/map/cemetery.webp"}
                            alt="Land Thumbnail" 
                            fill 
                            className="object-contain p-1" 
                        />
                    </div>

                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <h3 className="flex items-center gap-2 truncate text-base font-semibold">
                                    {neighbor?.name || (isTappedLandMinted ? `Land #${tappedLandId}` : "Cemetery")}
                                    {isUserOwned && <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded">YOU</span>}
                                </h3>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                                    <span className="font-mono">#{tappedLandId}</span>
                                    {isTappedLandMinted && (
                                        <>
                                            <span className="mx-1">/</span>
                                            <span className="font-mono">
                                                ({getCoordinateFromTokenId(tappedLandId).x}, {getCoordinateFromTokenId(tappedLandId).y})
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <Button
                                variant="headerIcon"
                                size="iconCompact"
                                aria-label="Dismiss land details"
                                className="-mt-1 -mr-1 shrink-0"
                                onClick={() => setTappedLandId(null)}
                            >
                                <X className="w-3.5 h-3.5" />
                            </Button>
                        </div>

                        {isTappedLandMinted ? (
                             /* MINTED LAND STATS - Simplified */
                             <div className="flex items-center justify-between gap-2 mt-1">
                                 <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                                     <span className="text-[10px] text-muted-foreground uppercase font-medium">Owner</span>
                                     <span className="text-xs font-bold font-mono break-all">
                                        {isOwnerLoading || isNameLoading ? (
                                            <span className="animate-pulse text-muted-foreground">Loading...</span>
                                        ) : (
                                            displayName
                                        )}
                                    </span>
                                </div>
                                
                                {ownerAddress && (
                                    <Button
                                        type="button"
                                        onClick={() => setProfileOpen(true)}
                                        variant="outline"
                                        size="compact"
                                        className="h-7 min-h-7 gap-1.5 px-2 text-[11px]"
                                        aria-label="Open owner profile"
                                    >
                                        Profile <User className="w-3 h-3" />
                                    </Button>
                                )}
                             </div>
                        ) : (
                            /* UNMINTED LAND STATS (Simplified) */
                            <div className="flex items-center mt-1">
                                <span className="text-[10px] text-muted-foreground italic">This is where DEAD plants are buried</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}

        {ownerAddress && (
            <ChatProfileDialog
                address={ownerAddress}
                open={profileOpen}
                onOpenChange={setProfileOpen}
                onTransactionOpen={onClose}
            />
        )}

        {/* Controls overlay */}
        <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-2 pointer-events-none">
          <div className="pointer-events-auto flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleZoomIn}
              aria-label="Zoom in on map"
              className="rounded-none border-b border-border/50 active:bg-muted"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleZoomOut}
              aria-label="Zoom out on map"
              className="rounded-none active:bg-muted"
            >
              <Minus className="w-5 h-5" />
            </Button>
          </div>

          <Button 
            variant="outline" 
            size="icon"
            onClick={handleCenterOnUser} 
            aria-label="Center map on selected land"
            className="pointer-events-auto bg-card bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]"
          >
            <Image src="/icons/location.svg" alt="Center" width={20} height={20} className="w-5 h-5" />
          </Button>
        </div>

        {/* Legend overlay (hidden if showing neighbor info) */}
        {!tappedLandId && (
            <div className="absolute bottom-6 left-4 z-10 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-2 shadow-[var(--shadow-hairline)]">
                <div className="flex items-center gap-2 text-[10px]">
                <div className="w-3 h-3 bg-primary rounded-[2px] border border-primary/50"></div>
                <span>Your Land</span>
                </div>
            </div>
            </div>
        )}

      </DialogContent>
    </Dialog>
  );
}
