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
    description: "Generates Plant Points over time for your plants. At Level 4 it upgrades into a hybrid that also delivers Plant Lifetime (TOD).",
    production: {
      level1: "~8 PTS/day",
      level2: "~24 PTS/day",
      level3: "~41 PTS/day",
      level4: "~85 PTS/day + ~3.56h TOD/day"
    },
    upgradeCosts: {
      level1: "1.35M LEAF (36h)",
      level2: "2.12M LEAF (48h)",
      level3: "2.84M LEAF (78h)",
      level4: "6.5M LEAF (93.6h)"
    }
  },
  "village-3": { // Soil Factory
    name: "Soil Factory",
    description: "Generates PTS daily for your plants.",
    production: {
      level1: "~12 PTS/day",
      level2: "~34 PTS/day",
      level3: "~61 PTS/day"
    },
    upgradeCosts: {
      level1: "2.03M LEAF (24h)",
      level2: "2.86M LEAF (60h)",
      level3: "4.69M LEAF (96h)"
    }
  },
  "village-5": { // Bee Farm
    name: "Bee Farm",
    description: "Generates Plant Lifetime (TOD) for your plants.",
    production: {
      level1: "~1.0 hours/day",
      level2: "~2.5 hours/day",
      level3: "~4.5 hours/day"
    },
    upgradeCosts: {
      level1: "1.13M LEAF (6h)",
      level2: "1.32M LEAF (18h)",
      level3: "2.37M LEAF (30h)"
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
  },
  "town-6": { // Casino (Roulette)
    name: "Casino",
    description: "Play European Roulette with a true 2.7% house edge. Place bets on numbers, colors, or ranges and spin to win SEED tokens!",
    features: [
      "European roulette (single zero, 37 pockets)",
      "Commit-reveal mechanism for provably fair results",
      "Multiple bet types with different odds",
      "Win up to 35x your bet on single numbers"
    ],
    betTypes: {
      "Straight (Single Number)": "35:1 payout",
      "Split (2 Numbers)": "17:1 payout",
      "Street (3 Numbers)": "11:1 payout",
      "Corner (4 Numbers)": "8:1 payout",
      "Six Line (6 Numbers)": "5:1 payout",
      "Dozen / Column": "2:1 payout",
      "Red / Black / Odd / Even": "1:1 payout"
    },
    howToPlay: [
      "1. Build the Casino (one-time cost)",
      "2. Approve SEED token spending",
      "3. Select bet type and amount",
      "4. Spin and wait for the result",
      "5. Winnings are paid out automatically"
    ]
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

  const isProductionBuilding = buildingType === 'village' && 'production' in info;
  const isUtilityBuilding = buildingType === 'town' && 'features' in info;
  const productionEntries = isProductionBuilding && 'production' in info
    ? Object.entries(info.production as Record<string, string>)
    : null;
  const upgradeEntries = 'upgradeCosts' in info && info.upgradeCosts
    ? Object.entries(info.upgradeCosts as Record<string, string>)
    : null;

  const formatLevelLabel = (key: string) => {
    if (key.toLowerCase().startsWith('level')) {
      const levelNumber = key.replace(/[^0-9]/g, '');
      return `Level ${levelNumber || key.slice(5)}`;
    }
    return key;
  };

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
          {isProductionBuilding && productionEntries && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Production Rates</h4>
              <div className="space-y-1.5 text-sm">
                {productionEntries.map(([levelKey, value]) => (
                  <div key={levelKey} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{formatLevelLabel(levelKey)}:</span>
                    <span className="font-medium text-primary">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isUtilityBuilding && 'features' in info && (
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

          {upgradeEntries && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Upgrade Costs</h4>
              <div className="space-y-1.5 text-sm">
                {upgradeEntries.map(([levelKey, value]) => (
                  <div key={levelKey} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{formatLevelLabel(levelKey)}:</span>
                    <span className="font-medium text-amber-600">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {'betTypes' in info && info.betTypes && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">Bet Types & Payouts</h4>
              <div className="space-y-1.5 text-sm">
                {Object.entries(info.betTypes as Record<string, string>).map(([betType, payout]) => (
                  <div key={betType} className="flex justify-between items-center">
                    <span className="text-muted-foreground">{betType}:</span>
                    <span className="font-medium text-green-600">{payout}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {'howToPlay' in info && info.howToPlay && (
            <div className="bg-muted/30 rounded-lg p-3">
              <h4 className="font-semibold text-sm mb-2 text-foreground">How to Play</h4>
              <ul className="space-y-1.5 text-sm">
                {(info.howToPlay as string[]).map((step, index) => (
                  <li key={index} className="text-muted-foreground text-xs">
                    {step}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
