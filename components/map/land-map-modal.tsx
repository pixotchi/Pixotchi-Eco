"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Land } from "@/lib/types";
import { X, Minus, Plus, Compass, MapPin, Info, Trophy, User, Copy, ExternalLink } from "lucide-react";
import { LandMapCanvas } from './land-map-canvas';
import { formatXP, cn } from "@/lib/utils";
import { contractToVisual, getCoordinateFromTokenId } from "@/lib/land-utils";
import Image from "next/image";
import { LandLeaderboardEntry, getLandOwner } from "@/lib/contracts";
import { getAddress } from 'viem';
import { usePrimaryName } from "@/components/hooks/usePrimaryName";
import ChatProfileDialog from "@/components/chat/chat-profile-dialog";
import { useTransactions } from 'ethereum-identity-kit';

// Helper to truncate address
const truncateAddress = (address: string) => {
  if (!address || address === '0x0000000000000000000000000000000000000000') return 'Unknown';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
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
  const [copied, setCopied] = useState(false);
  const [fetchedOwner, setFetchedOwner] = useState<string | null>(null);
  const [isOwnerLoading, setIsOwnerLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  
  // Get TransactionModal state to detect when it's open/closed
  const { txModalOpen } = useTransactions();
  
  // Close map modal when TransactionModal opens (e.g. when following a user)
  useEffect(() => {
    if (txModalOpen && isOpen) {
      onClose();
    }
  }, [txModalOpen, isOpen, onClose]);
  
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

  const copyAddress = (address: string) => {
      if (!address) return;
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
  };

  const neighbor = tappedLandId ? neighborData[tappedLandId] : null;
  const isUserOwned = tappedLandId ? userLands.some(l => Number(l.tokenId) === tappedLandId) : false;
  
  // Fetch owner on demand
  useEffect(() => {
    if (tappedLandId) {
      // If user owned, we know the owner
      if (isUserOwned && userLands.length > 0) {
        setFetchedOwner(userLands[0].owner);
        return;
      }
      
      // If neighbor has owner field (future proof), use it
      if (neighbor?.owner && neighbor.owner !== '' && neighbor.owner !== '0x0000000000000000000000000000000000000000') {
        setFetchedOwner(neighbor.owner);
        return;
      }

      // Otherwise fetch from contract
      setIsOwnerLoading(true);
      setFetchedOwner(null);
      getLandOwner(tappedLandId)
        .then(owner => {
          setFetchedOwner(owner);
        })
        .catch(err => {
          console.error('Error fetching owner', err);
          setFetchedOwner(null);
        })
        .finally(() => setIsOwnerLoading(false));
    } else {
      setFetchedOwner(null);
      setIsOwnerLoading(false);
    }
  }, [tappedLandId, isUserOwned, userLands, neighbor]);

  const ownerAddress = fetchedOwner || '';
  
  // Resolve Basename
  const { name: ownerName, loading: isNameLoading } = usePrimaryName(ownerAddress);
  const displayName = ownerName || truncateAddress(ownerAddress);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[440px] h-[85vh] p-0 overflow-hidden bg-background/95 border-border flex flex-col gap-0 focus:outline-none">
        <DialogTitle className="sr-only">World Map</DialogTitle>
        
        {/* Header overlay */}
        <div className="absolute top-4 left-4 right-4 z-10 flex justify-between items-start pointer-events-none">
          <div className="bg-background/80 backdrop-blur-md px-3 py-2 rounded-lg border border-border shadow-sm pointer-events-auto">
            <h2 className="font-pixel text-sm font-bold flex items-center gap-2">
              <Compass className="w-4 h-4 text-primary" />
              World Map
            </h2>
            <p className="text-[10px] text-muted-foreground">
              {totalSupply.toLocaleString()} Plots Discovered
            </p>
          </div>
          
          <Button 
            variant="outline" 
            size="icon" 
            onClick={onClose}
            className="bg-background/80 backdrop-blur-md pointer-events-auto h-8 w-8 rounded-full"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Map Canvas Area */}
        <div className="flex-1 relative w-full h-full bg-[#a7c7e7] overflow-hidden touch-none">
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
                <div className="bg-card/95 backdrop-blur-md p-4 rounded-xl border border-border shadow-lg flex gap-4 items-center">
                    {/* Thumbnail */}
                    <div className="relative w-16 shrink-0 rounded-lg overflow-hidden border border-border/50 bg-muted/50 aspect-square">
                        <Image 
                            src={`/icons/${
                                tappedWilderness.type === 'water' ? 'lake' :
                                tappedWilderness.type === 'none' ? 'cemetery' : 
                                tappedWilderness.type === 'forest' ? 'jungle' : 
                                tappedWilderness.type === 'mountain' ? 'mountains' : 
                                tappedWilderness.type
                            }.png`} 
                            alt={tappedWilderness.type} 
                            fill 
                            className="object-contain p-1" 
                        />
                    </div>
                    
                    <div className="flex-1">
                        <h3 className="font-pixel font-bold text-lg capitalize">
                            {
                                tappedWilderness.type === 'water' ? 'Lake' :
                                tappedWilderness.type === 'none' ? 'Cemetery' : 
                                tappedWilderness.type
                            }
                        </h3>
                    </div>

                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
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
                <div className="bg-card/95 backdrop-blur-md p-3 rounded-xl border border-border shadow-lg flex gap-3 items-center">
                    {/* Thumbnail */}
                    <div className="relative w-16 shrink-0 rounded-lg overflow-hidden border border-border/50 bg-muted/50 aspect-square">
                        <Image 
                            src={tappedLandId <= totalSupply ? "/icons/taken.png" : "/icons/cemetery.png"} 
                            alt="Land Thumbnail" 
                            fill 
                            className="object-contain p-1" 
                        />
                    </div>

                    <div className="flex flex-col gap-1 flex-1 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex-1 min-w-0">
                                <h3 className="font-pixel font-bold text-base truncate flex items-center gap-2">
                                    {neighbor?.name || (tappedLandId <= totalSupply ? `Land #${tappedLandId}` : "Cemetery")}
                                    {isUserOwned && <span className="text-[9px] bg-primary/20 text-primary px-1 py-0.5 rounded">YOU</span>}
                                </h3>
                                <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                                    <span className="font-mono">#{tappedLandId}</span>
                                    {tappedLandId <= totalSupply && (
                                        <>
                                            <span className="mx-1">•</span>
                                            <span className="font-mono">
                                                ({getCoordinateFromTokenId(tappedLandId).x}, {getCoordinateFromTokenId(tappedLandId).y})
                                            </span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-6 w-6 text-muted-foreground hover:text-foreground -mt-1 -mr-1"
                                onClick={() => setTappedLandId(null)}
                            >
                                <X className="w-3.5 h-3.5" />
                            </Button>
                        </div>

                        {tappedLandId <= totalSupply ? (
                             /* MINTED LAND STATS - Simplified */
                             <div className="flex items-center justify-between gap-2 mt-1">
                                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                    <span className="text-[10px] text-muted-foreground uppercase font-medium whitespace-nowrap">Owner:</span>
                                    <span className="text-xs font-bold truncate font-mono">
                                        {isOwnerLoading || isNameLoading ? (
                                            <span className="animate-pulse text-muted-foreground">Loading...</span>
                                        ) : (
                                            displayName
                                        )}
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-4 w-4 ml-0.5 opacity-50 hover:opacity-100 transition-opacity"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            copyAddress(ownerAddress);
                                        }}
                                    >
                                        {copied ? <span className="text-[8px]">✓</span> : <Copy className="w-2.5 h-2.5" />}
                                    </Button>
                                </div>
                                
                                {ownerAddress && (
                                    <button 
                                        onClick={() => setProfileOpen(true)}
                                        className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-1 font-medium transition-colors whitespace-nowrap"
                                    >
                                        Profile <User className="w-3 h-3" />
                                    </button>
                                )}
                             </div>
                        ) : (
                            /* UNMINTED LAND STATS (Simplified) */
                            <div className="flex items-center mt-1">
                                <span className="text-[10px] text-muted-foreground italic">Available for minting</span>
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
            />
        )}

        {/* Controls overlay */}
        <div className="absolute bottom-6 right-4 z-10 flex flex-col gap-2 pointer-events-none">
          <div className="flex flex-col bg-background/80 backdrop-blur-md rounded-lg border border-border shadow-sm overflow-hidden pointer-events-auto">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleZoomIn}
              className="h-10 w-10 rounded-none border-b border-border/50 active:bg-muted"
            >
              <Plus className="w-5 h-5" />
            </Button>
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleZoomOut}
              className="h-10 w-10 rounded-none active:bg-muted"
            >
              <Minus className="w-5 h-5" />
            </Button>
          </div>

          <Button 
            variant="outline" 
            size="icon"
            onClick={handleCenterOnUser} 
            className="bg-background/80 backdrop-blur-md pointer-events-auto h-10 w-10 rounded-lg shadow-sm"
          >
            <Image src="/icons/location.svg" alt="Center" width={20} height={20} className="w-5 h-5" />
          </Button>
        </div>

        {/* Legend overlay (hidden if showing neighbor info) */}
        {!tappedLandId && (
            <div className="absolute bottom-6 left-4 z-10 pointer-events-none">
            <div className="bg-background/80 backdrop-blur-md p-2 rounded-lg border border-border shadow-sm pointer-events-auto flex flex-col gap-1.5">
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
