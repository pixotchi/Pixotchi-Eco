"use client";

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BuildingType } from '@/lib/types';
import { getBuildingName } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { ToggleGroup } from '@/components/ui/toggle-group';

interface BuildingInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingId: number;
  buildingType: BuildingType;
}

// Roulette game info
const rouletteInfo = {
  description: "Play European Roulette with a true 2.7% house edge. Place bets on numbers, colors, or ranges and spin to win tokens!",
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
  }
};

// Blackjack game info
const blackjackInfo = {
  description: "Play classic Blackjack against the dealer! Get as close to 21 as possible without going over. Instant cards with server-signed randomness.",
  features: [
    "Standard blackjack rules (dealer stands on 17)",
    "Server-signed randomness for instant card dealing",
    "Split pairs, double down, and surrender options",
    "Blackjack (natural 21) pays 3:2"
  ],
  actions: {
    "Hit": "Draw another card",
    "Stand": "Keep your current hand",
    "Double Down": "Double bet, take one card",
    "Split": "Split pairs into two hands",
    "Surrender": "Forfeit half your bet"
  },
  payouts: {
    "Blackjack (Natural 21)": "3:2 (1.5x bet)",
    "Win": "1:1 (even money)",
    "Push (Tie)": "Bet returned",
    "Surrender": "Half bet returned"
  }
};

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
  "town-6": { // Casino
    name: "Casino",
    isCasino: true, // Flag to show game toggle
    description: "Play Roulette or Blackjack with provably fair on-chain randomness!"
  }
};

export default function BuildingInfoDialog({
  open,
  onOpenChange,
  buildingId,
  buildingType
}: BuildingInfoDialogProps) {
  const [selectedGame, setSelectedGame] = useState<'roulette' | 'blackjack'>('roulette');

  const buildingName = getBuildingName(buildingId, buildingType === 'town');
  const key = `${buildingType}-${buildingId}` as keyof typeof buildingInfo;
  const info = buildingInfo[key];

  if (!info) {
    return null;
  }

  const isProductionBuilding = buildingType === 'village' && 'production' in info;
  const isUtilityBuilding = buildingType === 'town' && 'features' in info;
  const isCasino = 'isCasino' in info && info.isCasino;

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

  // Get current game info based on toggle
  const currentGameInfo = selectedGame === 'roulette' ? rouletteInfo : blackjackInfo;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm max-h-[80vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <DialogTitle className="font-pixel text-lg">{info.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isCasino ? info.description : info.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Casino Game Toggle */}
          {isCasino && (
            <>
              <div className="flex justify-center">
                <ToggleGroup
                  value={selectedGame}
                  onValueChange={(v) => setSelectedGame(v as 'roulette' | 'blackjack')}
                  options={[
                    { value: 'roulette', label: '🎰 Roulette' },
                    { value: 'blackjack', label: '♦️ Blackjack' }
                  ]}
                  className="bg-muted/50"
                />
              </div>

              {/* Game Description */}
              <div className="bg-muted/30 rounded-lg p-3">
                <p className="text-sm text-muted-foreground">{currentGameInfo.description}</p>
              </div>

              {/* Features */}
              <div className="bg-muted/30 rounded-lg p-3">
                <h4 className="font-semibold text-sm mb-2 text-foreground">Key Features</h4>
                <ul className="space-y-1.5 text-sm">
                  {currentGameInfo.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Roulette bet types */}
              {selectedGame === 'roulette' && (
                <div className="bg-muted/30 rounded-lg p-3">
                  <h4 className="font-semibold text-sm mb-2 text-foreground">Bet Types & Payouts</h4>
                  <div className="space-y-1.5 text-sm">
                    {Object.entries(rouletteInfo.betTypes).map(([betType, payout]) => (
                      <div key={betType} className="flex justify-between items-center">
                        <span className="text-muted-foreground">{betType}:</span>
                        <span className="font-medium text-green-600">{payout}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Blackjack actions */}
              {selectedGame === 'blackjack' && (
                <>
                  <div className="bg-muted/30 rounded-lg p-3">
                    <h4 className="font-semibold text-sm mb-2 text-foreground">Player Actions</h4>
                    <div className="space-y-1.5 text-sm">
                      {Object.entries(blackjackInfo.actions).map(([action, desc]) => (
                        <div key={action} className="flex justify-between items-center">
                          <span className="font-medium text-foreground">{action}:</span>
                          <span className="text-muted-foreground">{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-muted/30 rounded-lg p-3">
                    <h4 className="font-semibold text-sm mb-2 text-foreground">Payouts</h4>
                    <div className="space-y-1.5 text-sm">
                      {Object.entries(blackjackInfo.payouts).map(([result, payout]) => (
                        <div key={result} className="flex justify-between items-center">
                          <span className="text-muted-foreground">{result}:</span>
                          <span className="font-medium text-green-600">{payout}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* Non-casino buildings */}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

