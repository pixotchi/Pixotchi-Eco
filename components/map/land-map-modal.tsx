"use client";
import ChatProfileDialog from "@/components/chat/chat-profile-dialog";
import { formatAddress } from "@/lib/utils";
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogTitle } from "@/components/ui/dialog";
import { usePerformanceMode } from "@/components/ui/performance-mode";
import { LandLeaderboardEntry,getLandOwner } from "@/lib/contracts";
import { contractToVisual,getCoordinateFromTokenId } from "@/lib/land-utils";
import { Land } from "@/lib/types";
import { getMapPlotStatus, MapReadStatus } from '@/lib/land-map-state';
import { MAP_PLOT_MARKERS } from '@/lib/land-map-markers';
import { Minus,Plus,User,X } from "lucide-react";
import Image from "next/image";
import { useEffect,useMemo,useRef,useState } from 'react';
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
  totalSupply: number | null;
  neighborData: Record<number, LandLeaderboardEntry>;
  supplyStatus?: MapReadStatus;
  neighborStatus?: MapReadStatus;
  isRefreshing?: boolean;
  onRetryMapData?: () => void;
}
function useExitPresence<T>(value: T | null, skipMotion: boolean) {
  const [renderedValue, setRenderedValue] = useState<T | null>(value);
  const [isVisible, setIsVisible] = useState(value !== null);
  const wasPresentRef = useRef(value !== null);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    if (value !== null) {
      const isEntering = !wasPresentRef.current;
      wasPresentRef.current = true;
      setRenderedValue(value);
      if (skipMotion || !isEntering) {
        setIsVisible(true);
        return;
      }
      setIsVisible(false);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          setIsVisible(true);
        });
      });
      return () => {
        if (frameRef.current !== null) {
          cancelAnimationFrame(frameRef.current);
          frameRef.current = null;
        }
      };
    }
    wasPresentRef.current = false;
    setIsVisible(false);
    if (skipMotion) {
      setRenderedValue(null);
      return;
    }
    const exitTimer = window.setTimeout(() => setRenderedValue(null), 180);
    return () => window.clearTimeout(exitTimer);
  }, [skipMotion, value]);
  return { isVisible, renderedValue };
}
export function LandMapModal({
  isOpen,
  onClose,
  userLands,
  selectedLand,
  onSelectLand,
  totalSupply,
  neighborData,
  supplyStatus = totalSupply === null ? 'loading' : 'ready',
  neighborStatus = 'ready',
  isRefreshing = false,
  onRetryMapData,
}: LandMapModalProps) {
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({ x: 0, y: 0 });
  const [tappedLandId, setTappedLandId] = useState<number | null>(null);
  const [tappedWilderness, setTappedWilderness] = useState<{ x: number, y: number, type: string } | null>(null);
  const [ownerRead, setOwnerRead] = useState<{ landId: number; owner: string | null; status: MapReadStatus } | null>(null);
  const [ownerRetry, setOwnerRetry] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const syncPreference = () => setPrefersReducedMotion(reducedMotion.matches);
    syncPreference();
    try {
      reducedMotion.addEventListener('change', syncPreference);
      return () => reducedMotion.removeEventListener('change', syncPreference);
    } catch {
      reducedMotion.addListener(syncPreference);
      return () => reducedMotion.removeListener(syncPreference);
    }
  }, []);
  const skipPanelMotion = performanceModeEnabled || prefersReducedMotion;
  const wildernessPresence = useExitPresence(tappedWilderness, skipPanelMotion);
  const landPresence = useExitPresence(tappedLandId, skipPanelMotion);
  const presentedLandId = landPresence.renderedValue;

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
  const neighbor = presentedLandId ? neighborData[presentedLandId] : null;
  const ownedLand = userLands.find(l => Number(l.tokenId) === presentedLandId);
  const isUserOwned = Boolean(ownedLand);
  const knownMintedIds = useMemo(() => new Set([
    ...Object.keys(neighborData).map(Number),
    ...userLands.map(land => Number(land.tokenId)),
    ...(ownerRead?.status === 'ready' ? [ownerRead.landId] : []),
  ]), [neighborData, userLands, ownerRead]);
  const tappedPlotStatus = presentedLandId === null ? 'unknown' : getMapPlotStatus(presentedLandId, totalSupply, knownMintedIds, supplyStatus === 'ready');
  const isTappedLandMinted = tappedPlotStatus === 'minted';
  const isTappedLandUnminted = tappedPlotStatus === 'unminted';

  // Own-land addresses are already known. Neighbor ownership is not included
  // in getLeaderboard and must be read separately when a plot is selected.
  const knownOwnerAddress =
    ownedLand?.owner ?? null;
  // Fetch owner on demand
  useEffect(() => {
    if (presentedLandId && !isTappedLandUnminted) {
      // If user owned, we know the owner
      if (knownOwnerAddress) {
        setOwnerRead({ landId: presentedLandId, owner: knownOwnerAddress, status: 'ready' });
        return;
      }
      // Otherwise fetch from contract.
      // Without this guard, tapping land A then land B races: if A's lookup
      // resolves last it overwrites B's owner, and the tooltip then shows
      // land B while the Profile button opens land A's owner.
      let ignore = false;
      setOwnerRead({ landId: presentedLandId, owner: null, status: 'loading' });
      getLandOwner(presentedLandId)
        .then(owner => {
          if (ignore) return;
          const hasOwner = Boolean(owner && owner !== '0x0000000000000000000000000000000000000000');
          setOwnerRead({ landId: presentedLandId, owner: hasOwner ? owner : null, status: hasOwner ? 'ready' : 'error' });
        })
        .catch(err => {
          if (ignore) return;
          console.error('Error fetching owner', err);
          setOwnerRead({ landId: presentedLandId, owner: null, status: 'error' });
        });
      return () => {
        ignore = true;
      };
    } else {
      setOwnerRead(null);
    }
  // A successful owner lookup changes unknown -> minted; it must not restart
  // itself. Only a verified unminted classification suppresses the read.
  }, [presentedLandId, knownOwnerAddress, isTappedLandUnminted, ownerRetry]);
  const currentOwnerRead = ownerRead?.landId === presentedLandId ? ownerRead : null;
  const ownerAddress = knownOwnerAddress || currentOwnerRead?.owner || '';
  const isOwnerLoading = !currentOwnerRead || currentOwnerRead.status === 'loading';

  // Resolve Basename
  const { name: ownerName, loading: isNameLoading } = usePrimaryName(ownerAddress);
  const displayName = ownerName || truncateAddress(ownerAddress);
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        padding="none"
        className="w-[94vw] max-w-[min(94vw,64rem)] h-[85dvh] overflow-hidden bg-card bg-[image:var(--gradient-dialog)] border-border/65 flex flex-col gap-0 focus:outline-none"
        hideCloseButton
      >
        <DialogTitle className="sr-only">World Map</DialogTitle>
        <DialogDescription className="sr-only">
          Explore discovered land plots, inspect neighboring owners, and select one of your lands.
        </DialogDescription>

        {/* Header remains outside the interactive map and detail region. */}
        <div className="relative z-10 flex shrink-0 justify-between items-start gap-[8px] p-[12px]">
          <div className="min-w-0 pointer-events-auto rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] px-[12px] py-[8px] shadow-[var(--shadow-hairline)]">
            <h2 className="text-sm font-semibold">
              World Map
            </h2>
            <p className="text-xs text-muted-foreground">
              {totalSupply === null ? 'Plot count unavailable' : `${totalSupply.toLocaleString()} Plots Discovered`}
              {totalSupply !== null && supplyStatus !== 'ready' && <span className="block">Last verified count</span>}
            </p>
            <p role="status" className="text-xs text-muted-foreground">
              {supplyStatus === 'loading' ? 'Loading map data…' : supplyStatus === 'error' ? 'Map data unavailable. Unknown plots are shown in gray.' : ''}
              {neighborStatus === 'error' && <span className="block">Neighbor details unavailable.</span>}
              {neighborStatus === 'loading' && <span className="block">Loading neighbor details…</span>}
            </p>
            {(supplyStatus === 'error' || neighborStatus === 'error') && onRetryMapData && (
              <Button variant="link" className="min-h-11 p-0" onClick={onRetryMapData} disabled={isRefreshing}>{isRefreshing ? 'Retrying map data…' : 'Retry map data'}</Button>
            )}
          </div>
          <Button
            variant="headerIcon"
            size="icon"
            onClick={onClose}
            aria-label="Close world map"
            className="pointer-events-auto h-[44px] min-h-[44px] w-[44px] min-w-[44px] shrink-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        {/* Map Canvas Area */}
        <div className="relative min-h-0 w-full flex-1 overflow-hidden bg-[hsl(var(--info)/0.18)]">
          <LandMapCanvas
            center={center}
            zoom={zoom}
            userLands={userLands}
            selectedLand={selectedLand}
            totalSupply={totalSupply}
            supplyIsCurrent={supplyStatus === 'ready'}
            knownMintedIds={knownMintedIds}
            onZoomChange={(nextZoom) => setZoom(Math.min(5, Math.max(0.2, nextZoom)))}
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
          >
        {/* Controls overlay */}
        <div className="absolute bottom-[12px] right-[12px] z-10 flex items-center gap-[8px] pointer-events-none">
          <div className="pointer-events-auto flex overflow-hidden rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              aria-label="Zoom in on map"
              className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] rounded-none border-r border-border/50 active:bg-muted"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              aria-label="Zoom out on map"
              className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] rounded-none active:bg-muted"
            >
              <Minus className="w-5 h-5" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleCenterOnUser}
            aria-label="Center map on selected land"
            className="pointer-events-auto h-[44px] min-h-[44px] w-[44px] min-w-[44px] bg-card bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)]"
          >
            <Image src="/icons/location.svg" alt="Center" width={20} height={20} className="w-5 h-5" />
          </Button>
        </div>
        {/* Legend overlay (hidden if showing neighbor info) */}
        {!presentedLandId && (
            <div className="absolute top-[12px] left-[12px] z-10 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-2 shadow-[var(--shadow-hairline)]">
                <div className="flex items-center gap-2 text-xs">
                <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center text-xs leading-none text-white" style={{ backgroundColor: MAP_PLOT_MARKERS.owned.color }}>{MAP_PLOT_MARKERS.owned.symbol}</span>
                <span>Your land</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                <span aria-hidden="true" className="h-4 w-4 shrink-0 border-2 border-dashed" style={{ borderColor: MAP_PLOT_MARKERS.selected.color }} />
                <span>Selected land</span>
                </div>
            </div>
            </div>
        )}
          </LandMapCanvas>
        </div>

        {/* Wilderness Info Tooltip */}
        {wildernessPresence.renderedValue && (
            <div
              aria-hidden={tappedWilderness === null || !wildernessPresence.isVisible}
              inert={tappedWilderness === null || !wildernessPresence.isVisible}
              className={`relative max-h-[55%] shrink-0 overflow-y-auto p-[12px] transition-[opacity,transform] duration-[180ms] ease-[var(--ease-standard)] ${tappedWilderness !== null && wildernessPresence.isVisible ? 'pointer-events-auto z-20 translate-y-0 opacity-100' : 'pointer-events-none z-10 translate-y-3 opacity-0'}`}
            >
                <div className="flex items-center gap-[12px] rounded-[var(--radius-panel)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-[12px] shadow-[var(--shadow-raised)]">
                    {/* Thumbnail */}
                    <div className="relative aspect-square w-[44px] shrink-0 overflow-hidden rounded-[var(--radius-control)] border border-border/50 bg-muted/50">
                        <Image
                            /* Assets live at /icons/map/*.webp — this pointed at
                               /icons/*.png, which does not exist, so the thumbnail
                               404'd. The terminal fallback is 'jungle' because
                               `type` is typed as string and an unexpected value
                               previously fell through to the raw type. */
                            src={`/icons/map/${
                                wildernessPresence.renderedValue.type === 'water' ? 'lake' :
                                wildernessPresence.renderedValue.type === 'none' ? 'cemetery' :
                                wildernessPresence.renderedValue.type === 'forest' ? 'jungle' :
                                wildernessPresence.renderedValue.type === 'mountain' ? 'mountains' :
                                'jungle'
                            }.webp`}
                            alt={wildernessPresence.renderedValue.type}
                            fill
                            sizes="44px"
                            className="object-contain p-1"
                        />
                    </div>

                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold capitalize [overflow-wrap:anywhere]">
                            {
                                wildernessPresence.renderedValue.type === 'water' ? 'Lake' :
                                wildernessPresence.renderedValue.type === 'none' ? 'Cemetery' :
                                wildernessPresence.renderedValue.type
                            }
                        </h3>
                    </div>
                    <Button
                        variant="headerIcon"
                        size="icon"
                        aria-label="Dismiss terrain details"
                        className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] shrink-0"
                        onClick={() => setTappedWilderness(null)}
                    >
                        <X className="w-4 h-4" />
                    </Button>
                </div>
            </div>
        )}
        {/* Neighbor Info Tooltip / Sheet */}
        {presentedLandId && (
            <div
              aria-hidden={tappedLandId === null || !landPresence.isVisible}
              inert={tappedLandId === null || !landPresence.isVisible}
              className={`relative max-h-[55%] shrink-0 overflow-y-auto p-[12px] transition-[opacity,transform] duration-[180ms] ease-[var(--ease-standard)] ${tappedLandId !== null && landPresence.isVisible ? 'pointer-events-auto z-20 translate-y-0 opacity-100' : 'pointer-events-none z-10 translate-y-3 opacity-0'}`}
            >
                <section aria-label="Land details" className="rounded-[var(--radius-panel)] border border-border/60 bg-card bg-[image:var(--gradient-surface)] p-[12px] shadow-[var(--shadow-raised)]">
                    <div className="flex items-start justify-between gap-[12px]">
                        <div className="min-w-0 flex-1">
                            <h3 className="text-base font-semibold [overflow-wrap:anywhere]">
                                {neighbor?.name || `Land #${presentedLandId}`}
                                {isUserOwned && <span className="ml-2 text-xs text-primary">Your land</span>}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                                #{presentedLandId} · ({getCoordinateFromTokenId(presentedLandId).x}, {getCoordinateFromTokenId(presentedLandId).y})
                            </p>
                        </div>
                        <Button variant="headerIcon" size="icon" aria-label="Dismiss land details" className="h-[44px] min-h-[44px] w-[44px] min-w-[44px] shrink-0" onClick={() => setTappedLandId(null)}>
                            <X className="h-4 w-4" />
                        </Button>
                    </div>
                    {isTappedLandUnminted ? (
                        <p className="mt-3 text-sm text-muted-foreground">This plot has not been minted.</p>
                    ) : (
                        <div className="mt-3 space-y-2">
                            {!isTappedLandMinted && <p className="text-sm text-muted-foreground">Plot status is not yet verified.</p>}
                            {neighborStatus === 'error' && !neighbor && <p className="text-xs text-muted-foreground">Land name unavailable. Retry map data to load it.</p>}
                            <div>
                                <p className="text-xs font-medium text-muted-foreground">Owner</p>
                                <p data-map-owner className="mt-1 font-mono text-sm font-semibold [overflow-wrap:anywhere]">
                                    {isOwnerLoading || isNameLoading ? 'Loading owner…' : currentOwnerRead?.status === 'error' ? 'Owner unavailable' : displayName}
                                </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {currentOwnerRead?.status === 'error' && <Button variant="outline" className="max-w-full whitespace-normal px-[12px]" onClick={() => setOwnerRetry(value => value + 1)}>Retry owner lookup</Button>}
                                {ownerAddress && <Button type="button" onClick={() => setProfileOpen(true)} variant="outline" className="max-w-full whitespace-normal px-[12px]" aria-label="Open owner profile">Profile <User className="h-4 w-4 shrink-0" /></Button>}
                            </div>
                        </div>
                    )}
                </section>
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
      </DialogContent>
    </Dialog>
  );
}
