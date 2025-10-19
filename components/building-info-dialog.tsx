"use client";

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BuildingType } from '@/lib/types';
import { getBuildingName } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface BuildingInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: number;
  buildingType: BuildingType;
}

const buildingInfo = {
  // Village Buildings (Production-Focused)
  "village-0": { // Solar Panels
    name: "Solar Panels",
    description: "Generates Plant Points over time for your plants.",
    production: {
      level1: "~50 PTS/day",
      level2: "~100 PTS/day", 
      level3: "~150 PTS/day"
    },
    upgradeCosts: {
      level1: "800K LEAF (36h)",
      level2: "4.5M LEAF (48h)",
      level3: "19M LEAF (78h)"
    }
  },
  "village-3": { // Soil Factory
    name: "Soil Factory", 
    description: "Generates PTS daily for your plants.",
    production: {
      level1: "~70 PTS/day",
      level2: "~150 PTS/day",
      level3: "~300 PTS/day"
    },
    upgradeCosts: {
      level1: "750K LEAF (24h)",
      level2: "5M LEAF (60h)", 
      level3: "20M LEAF (96h)"
    }
  },
  "village-5": { // Bee Farm
    name: "Bee Farm",
    description: "Generates Plant Lifetime (TOD) for your plants.",
    production: {
      level1: "~3 hours/day",
      level2: "~6 hours/day",
      level3: "~9 hours/day"
    },
    upgradeCosts: {
      level1: "500K LEAF (6h)",
      level2: "2.5M LEAF (18h)",
      level3: "12.5M LEAF (30h)"
    }
  },
  // Town Buildings (Utility-Focused)
  "town-1": { // Stake House
    name: "Stake House",
    description: "Enables SEED token staking for passive LEAF rewards.",
    features: [
      "Stake SEED tokens to earn LEAF rewards",
      "Real-time reward calculation", 
      "No lock-up period - unstake anytime"
    ]
  },
  "town-3": { // Warehouse (Town)
    name: "Warehouse",
    description: "Provides resource storage and inventory management.",
    features: [
      "Store collected Plant Points and Lifetime",
      "Apply resources to your plants",
      "Resource management interface"
    ]
  },
  "town-5": { // Marketplace
    name: "Marketplace", 
    description: "Enables token trading and item purchases.",
    features: [
      "Orderbook trading system for LEAF ↔ SEED swaps",
      "Buy/sell orders with custom pricing",
      "Item shop access"
    ]
  },
  "town-7": { // Farmer House
    name: "Farmer House",
    description: "Unlocks the Quest System for earning rewards.",
    features: [
      "Level 1: 1 active quest",
      "Level 2: 2 active quests", 
      "Level 3: 3 active quests",
      "Quest rewards: LEAF tokens, SEED tokens, Experience Points, Plant Lifetime"
    ],
    upgradeCosts: {
      level1: "550K LEAF (24h)",
      level2: "12M LEAF (50h)",
      level3: "18M LEAF (90h)"
    }
  }
};

export default function BuildingInfoDialog({ 
  open, 
  onOpenChange, 
  buildingId, 
  buildingType 
}: BuildingInfoDialogProps) {
  const buildingName = getBuildingName(buildingId, buildingType === 'town');
  const key = `${buildingType}-${buildingId}` as keyof typeof buildingInfo;
  const info = buildingInfo[key];

  if (!info) {
    return null;
  }

  const isProductionBuilding = buildingType === 'village' && info.production;
  const isUtilityBuilding = buildingType === 'town' && info.features;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader className="pb-4">
          <DialogTitle className="font-pixel text-lg">{info.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {info.description}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3">
          {isProductionBuilding && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Production Rates</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 1:</span>
                  <span className="font-medium text-primary">{info.production.level1}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 2:</span>
                  <span className="font-medium text-primary">{info.production.level2}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 3:</span>
                  <span className="font-medium text-primary">{info.production.level3}</span>
                </div>
              </div>
            </div>
          )}

          {isUtilityBuilding && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Key Features</h4>
              <ul className="space-y-1.5 text-sm">
                {info.features.map((feature, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-primary mt-0.5">•</span>
                    <span className="text-muted-foreground">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {info.upgradeCosts && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Upgrade Costs</h4>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 1:</span>
                  <span className="font-medium text-amber-600">{info.upgradeCosts.level1}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 2:</span>
                  <span className="font-medium text-amber-600">{info.upgradeCosts.level2}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Level 3:</span>
                  <span className="font-medium text-amber-600">{info.upgradeCosts.level3}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
