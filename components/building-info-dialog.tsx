"use client";

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BarracksConfigV2, BarracksTroopConfigV2, BuildingType } from '@/lib/types';
import { cn, formatDuration, formatTokenAmountPrecise } from '@/lib/utils';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { barracksGetConfigV2 } from '@/lib/contracts';

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
    description: "Stake SEED to earn LEAF rewards while your lands and plants keep working. This is a yield utility, not a production building.",
    features: [
      "Stake SEED and start accruing LEAF through the staking contract.",
      "View your staked SEED, unclaimed LEAF, and reward rate in one place.",
      "Unstake any time; staking does not consume quests, warehouse reserves, or plant actions.",
      "Useful when you want idle SEED to keep generating value between plant and land upgrades."
    ]
  },
  "town-3": { // Warehouse (Town)
    name: "Warehouse",
    description: "Stores production claimed from Village buildings so you can decide which plant receives the PTS or TOD later.",
    features: [
      "Collect generated PTS and TOD from Village buildings into a land-level reserve.",
      "Apply stored PTS to a selected plant when you want direct score growth.",
      "Apply stored TOD in minutes to extend a plant's remaining lifetime.",
      "Best used for saving production until a plant needs help or you are ready for a leaderboard push."
    ]
  },
  "town-5": { // Marketplace
    name: "Marketplace",
    description: "Land-based order book for trading SEED and LEAF with other players. It does not sell plant items.",
    features: [
      "Create limit orders to sell SEED for LEAF or LEAF for SEED at your chosen price.",
      "Take existing orders from the live book when price and depth fit your plan.",
      "Uses your owned land for marketplace permissions; trades are token swaps only.",
      "Plant items, fences, and garden boosts stay in the plant Marketplace on the Farm tab."
    ]
  },
  "town-7": { // Farmer House
    name: "Farmer House",
    description: "Runs land quests that turn time and Farmer House capacity into token, XP, and lifetime rewards.",
    features: [
      "Start quests, wait for them to complete, then finalize to claim the result.",
      "Each level unlocks one more active quest slot, up to three simultaneous quests.",
      "Quest rewards can include LEAF, SEED, land XP, and Plant Lifetime.",
      "Higher levels matter most for players who want more parallel quest uptime."
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
    description: "Play Roulette or Blackjack with provably fair onchain randomness!"
  },
  "town-8": { // Barracks
    name: "Barracks",
    isBarracks: true,
    description: "Train troops for land raids, attack rival Barracks, and compete over unclaimed production with cooldown-based risk."
  }
};

const PLANT_POINTS_DECIMALS = 12;
const XP_DECIMALS = 18;
const INFO_NESTED_SURFACE_CLASS =
  "building-subpanel-surface rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3";

function formatBarracksPoints(value: bigint): string {
  return formatTokenAmountPrecise(value, PLANT_POINTS_DECIMALS, 2);
}

function formatBarracksXp(value: bigint): string {
  return formatTokenAmountPrecise(value, XP_DECIMALS, 0);
}

function formatPercentFromBps(bps: number): string {
  const percent = bps / 100;
  return Number.isInteger(percent) ? `${percent}%` : `${percent.toFixed(2).replace(/\.?0+$/, '')}%`;
}

function InfoSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {children}
    </section>
  );
}

function InfoRows({ children }: { children: React.ReactNode }) {
  return (
    <div className="chromatic-white-surface divide-y divide-border/45 rounded-[var(--radius-control)] border border-border/60 bg-background/45 px-3 py-1.5 text-sm shadow-[var(--shadow-hairline)]">
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
  labelClassName,
  valueClassName,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  labelClassName?: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex min-h-9 items-start justify-between gap-3 py-2">
      <span className={cn("min-w-0 text-muted-foreground", labelClassName)}>{label}</span>
      <span className={cn("shrink-0 text-right font-medium text-foreground", valueClassName)}>{value}</span>
    </div>
  );
}

function BarracksTroopTile({
  title,
  role,
  icon,
  troop,
}: {
  title: string;
  role: string;
  icon: string;
  troop: BarracksTroopConfigV2;
}) {
  return (
    <div className={INFO_NESTED_SURFACE_CLASS}>
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex items-center gap-2">
          <Image src={icon} alt={title} width={18} height={18} className="h-4.5 w-4.5 object-contain" />
          <div>
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{role}</div>
          </div>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {formatDuration(Number(troop.trainingTimePerTroop))} train
        </div>
      </div>

      <div className="mt-3">
        <InfoRows>
          <InfoRow
            label="Strength"
            value={
              <span className="inline-flex items-center gap-1.5">
                <span>{troop.troopAttackStrength.toString()}</span>
                <Image src="/icons/attackpwr.svg" alt="Attack power" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
                <span>/</span>
                <span>{troop.troopDefenseStrength.toString()}</span>
                <Image src="/icons/defpwr.svg" alt="Defense power" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
              </span>
            }
          />
          <InfoRow
            label="Can Carry PTS/TOD"
            value={`${formatBarracksPoints(troop.troopCarryPoints)}/${formatDuration(Number(troop.troopCarryLifetime))}`}
          />
        </InfoRows>
      </div>
    </div>
  );
}

function BarracksInfoContent({ open }: { open: boolean }) {
  const [configV2, setConfigV2] = useState<BarracksConfigV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadConfig() {
      if (!open) return;

      try {
        setLoading(true);
        setError(null);

        const nextConfigV2 = await barracksGetConfigV2();
        if (cancelled) return;

        if (!nextConfigV2) {
          setError('Barracks rules are unavailable right now.');
          setConfigV2(null);
          return;
        }

        setConfigV2(nextConfigV2);
      } catch (err) {
        console.error('Failed to load barracks config for info dialog:', err);
        if (!cancelled) {
          setError('Barracks rules are unavailable right now.');
          setConfigV2(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [open]);

  if (loading && !configV2) {
    return (
      <InfoSection title="Command Brief">
        <p className="text-sm text-muted-foreground">Loading current Barracks rules...</p>
      </InfoSection>
    );
  }

  if (!configV2) {
    return (
      <InfoSection title="Command Brief">
        <p className="text-sm text-muted-foreground">
          {error || 'Barracks rules are unavailable right now.'}
        </p>
      </InfoSection>
    );
  }

  const effectiveAttackCooldown = formatDuration(Number(configV2.attackCooldown));
  const effectiveDefenseCooldown = formatDuration(Number(configV2.defenseCooldown));
  const effectiveLootShare = formatPercentFromBps(configV2.lootPercentageBps);
  const raidXp = formatBarracksXp(configV2.successfulRaidXP);
  const defenseXp = formatBarracksXp(configV2.successfulDefenseXP);

  return (
    <>
      <InfoSection title="Battle Values">
        <div className="space-y-3">
          <InfoRows>
            <InfoRow label="Raid/Defense XP" value={`${raidXp}/${defenseXp}`} />
            <InfoRow label="Loot share" value={effectiveLootShare} />
          </InfoRows>
          <div className="space-y-2">
            <BarracksTroopTile
              title="Swordsman"
              role="Offense"
              icon="/icons/swordsman.svg"
              troop={configV2.swordsman}
            />
            <BarracksTroopTile
              title="Phalanx"
              role="Defense"
              icon="/icons/phalanx.svg"
              troop={configV2.phalanx}
            />
          </div>
        </div>
      </InfoSection>

      <InfoSection title="How Raids Work">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>When a raid wins, the defender&apos;s unclaimed productions claim to Warehouse first. The attacker steals up to {effectiveLootShare}, capped by surviving troop carry ability. Stolen PTS and TOD are added to the attacker&apos;s Warehouse.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>Defending at home grants up to a 10% defense bonus based on how upgraded your production buildings are. Maxed production reaches the full bonus.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>Lands without a Barracks, lands on defense cooldown, and lands with no productions cannot be attacked.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>After a raid, the attacker needs to wait {effectiveAttackCooldown} before the next strike, and the defender gets {effectiveDefenseCooldown} of protection.</span>
          </li>
        </ul>
      </InfoSection>
    </>
  );
}

export default function BuildingInfoDialog({
  open,
  onOpenChange,
  buildingId,
  buildingType
}: BuildingInfoDialogProps) {
  const [selectedGame, setSelectedGame] = useState<'roulette' | 'blackjack'>('roulette');

  const key = `${buildingType}-${buildingId}` as keyof typeof buildingInfo;
  const info = buildingInfo[key];

  if (!info) {
    return null;
  }

  const isProductionBuilding = buildingType === 'village' && 'production' in info;
  const isUtilityBuilding = buildingType === 'town' && 'features' in info;
  const isCasino = 'isCasino' in info && info.isCasino;
  const isBarracks = 'isBarracks' in info && info.isBarracks;

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
  const currentGameIcon = selectedGame === 'roulette' ? '🎰' : '♦️';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={isBarracks || isCasino ? 'max-w-md' : 'max-w-sm'}>
        <DialogHeader className="pb-4">
          <DialogTitle>{info.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {isCasino ? info.description : info.description}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pr-1">
          <div className="building-subpanel-surface space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3.5">
            {/* Casino Game Toggle */}
            {isCasino && (
              <>
                <div className="flex justify-center">
                  <ToggleGroup
                    value={selectedGame}
                    onValueChange={(v) => setSelectedGame(v as 'roulette' | 'blackjack')}
                    options={[
                      {
                        value: 'roulette',
                        ariaLabel: 'Roulette info',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true">🎰</span>
                            Roulette
                          </span>
                        ),
                      },
                      {
                        value: 'blackjack',
                        ariaLabel: 'Blackjack info',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true">♦️</span>
                            Blackjack
                          </span>
                        ),
                      },
                    ]}
                    ariaLabel="Casino game info"
                  />
                </div>

                <div className={`${INFO_NESTED_SURFACE_CLASS} flex items-start gap-3`}>
                  <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-primary/30 bg-primary/10 text-base leading-none">
                    <span aria-hidden="true">{currentGameIcon}</span>
                  </span>
                  <p className="text-sm leading-relaxed text-muted-foreground">{currentGameInfo.description}</p>
                </div>

                <InfoSection title="Key Features">
                  <ul className="space-y-1.5 text-sm">
                    {currentGameInfo.features.map((feature, index) => (
                      <li key={index} className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">•</span>
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </InfoSection>

                {selectedGame === 'roulette' && (
                  <InfoSection title="Bet Types & Payouts">
                    <InfoRows>
                      {Object.entries(rouletteInfo.betTypes).map(([betType, payout]) => (
                        <InfoRow
                          key={betType}
                          label={betType}
                          value={payout}
                          valueClassName="text-[hsl(var(--success-strong))]"
                        />
                      ))}
                    </InfoRows>
                  </InfoSection>
                )}

                {selectedGame === 'blackjack' && (
                  <>
                    <InfoSection title="Player Actions">
                      <InfoRows>
                        {Object.entries(blackjackInfo.actions).map(([action, desc]) => (
                          <InfoRow
                            key={action}
                            label={action}
                            value={desc}
                            labelClassName="font-medium text-foreground"
                            valueClassName="max-w-[62%] text-muted-foreground"
                          />
                        ))}
                      </InfoRows>
                    </InfoSection>

                    <InfoSection title="Payouts">
                      <InfoRows>
                        {Object.entries(blackjackInfo.payouts).map(([result, payout]) => (
                          <InfoRow
                            key={result}
                            label={result}
                            value={payout}
                            valueClassName="text-[hsl(var(--success-strong))]"
                          />
                        ))}
                      </InfoRows>
                    </InfoSection>
                  </>
                )}
              </>
            )}

            {isBarracks && <BarracksInfoContent open={open} />}

            {isProductionBuilding && productionEntries && (
              <InfoSection title="Production Rates">
                <InfoRows>
                  {productionEntries.map(([levelKey, value]) => (
                    <InfoRow
                      key={levelKey}
                      label={formatLevelLabel(levelKey)}
                      value={value}
                      valueClassName="text-primary"
                    />
                  ))}
                </InfoRows>
              </InfoSection>
            )}

            {isUtilityBuilding && 'features' in info && (
              <InfoSection title="How It Works">
                <ul className="space-y-1.5 text-sm">
                  {info.features.map((feature, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </InfoSection>
            )}

            {upgradeEntries && (
              <InfoSection title="Upgrade Costs">
                <InfoRows>
                  {upgradeEntries.map(([levelKey, value]) => (
                    <InfoRow
                      key={levelKey}
                      label={formatLevelLabel(levelKey)}
                      value={value}
                      valueClassName="text-amber-600"
                    />
                  ))}
                </InfoRows>
              </InfoSection>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
