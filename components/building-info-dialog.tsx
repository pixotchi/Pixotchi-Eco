"use client";

import { getVillageProductionRates } from '@/lib/land-production';
import { ResourceValue } from '@/components/ui/resource-value';
import { ResourceState } from '@/components/ui/resource-state';

import React, { useEffect, useState } from 'react';
import Image from 'next/image';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { BarracksConfigV2, BarracksTroopConfigV2, BuildingData, BuildingType } from '@/lib/types';
import {
  cn,
  formatDuration,
  formatUpgradeDuration,
  formatLifetimeProduction,
  formatProductionRate,
  formatTokenAmount,
  formatTokenAmountPrecise,
} from '@/lib/utils';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { barracksGetConfigV2 } from '@/lib/contracts';

interface BuildingInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  building: BuildingData;
  buildingType: BuildingType;
}

// Roulette game info
const rouletteInfo = {
  description: "Play European Roulette with a single zero. Bet on numbers, colors, or ranges, then reveal the result.",
  features: [
    "European roulette (single zero, 37 pockets)",
    "Results determined from a future block hash",
    "Multiple bet types with different odds",
    "A winning single-number bet returns 36× its stake, including 35× profit"
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
    "Blackjack (Natural 21)": "2.5× total return",
    "Win": "2× total return",
    "Push (Tie)": "Bet returned",
    "Surrender": "Half bet returned"
  }
};

// Baccarat game info
const baccaratInfo = {
  description: "Play Punto Banco Baccarat with Player, Banker, and Tie bets. Place a bet, then reveal the round when it is ready.",
  features: [
    "Classic casino Baccarat with no player decisions after betting",
    "Block reveal mechanism matching Roulette",
    "Player and Banker bets push on Tie",
    "Banker wins pay after the current commission"
  ],
  payouts: {
    "Player": "1:1 (2x return)",
    "Banker": "See current rules",
    "Tie": "See current rules",
    "Player/Banker on Tie": "Bet returned"
  }
};

const buildingInfo = {
  // Village Buildings (Production-Focused)
  "village-0": { // Solar Panels
    name: "Solar Panels",
    description: "Solar Panels turn sunlight into resources for your plants.",
  },
  "village-3": { // Soil Factory
    name: "Soil Factory",
    description: "Soil Factory produces resources to help your plants grow.",
  },
  "village-5": { // Bee Farm
    name: "Bee Farm",
    description: "Bee Farm builds up resources you can save for a plant that needs them.",
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
    description: "Stores production claimed from Village buildings so you can decide which plant receives the PTS or lifetime later.",
    features: [
      "Collect generated PTS and lifetime from Village buildings into a land-level reserve.",
      "Apply stored PTS to a selected plant when you want direct score growth.",
      "Apply stored lifetime in minutes to keep a plant alive longer.",
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
      "Plant items, fences, and garden boosts are in Plant care on the Farm tab."
    ]
  },
  "town-7": { // Farmer House
    name: "Farmer House",
    description: "Runs land quests that turn time and Farmer House capacity into token, XP, and lifetime rewards.",
    features: [
      "Start a quest, return your farmer when it finishes, then open the loot bag before its deadline.",
      "Each level unlocks one more active quest slot, up to three simultaneous quests.",
      "Quest rewards can include LEAF, SEED, land XP, plant points, and plant lifetime.",
      "Higher levels matter most for players who want more parallel quest uptime."
    ],
  },
  "town-6": { // Casino
    name: "Casino",
    isCasino: true, // Flag to show game toggle
    description: "Roulette and Baccarat reveal results using block-based randomness. Blackjack uses verified server-signed cards."
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
  "surface-subpanel rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-[12px] py-3";

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
    <div className="@container/info-rows surface-lifted min-w-0 divide-y divide-border/45 rounded-[var(--radius-control)] border border-border/60 bg-background/45 px-[12px] py-1.5 text-sm shadow-[var(--shadow-hairline)]">
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
    <div className="flex min-h-9 flex-col items-start justify-between gap-x-3 gap-y-1 py-2 @min-[10rem]/info-rows:flex-row">
      <span className={cn("min-w-0 max-w-full text-muted-foreground [overflow-wrap:anywhere]", labelClassName)}>{label}</span>
      <span className={cn("min-w-0 max-w-full self-end text-right font-medium text-foreground [overflow-wrap:anywhere] @min-[10rem]/info-rows:shrink-0 @min-[10rem]/info-rows:self-auto", valueClassName)}>{value}</span>
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="inline-flex min-w-0 max-w-full items-center gap-2">
          <Image src={icon} alt={title} width={18} height={18} className="h-4.5 w-4.5 shrink-0 object-contain" />
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <div className="text-sm font-semibold text-foreground">{title}</div>
            <div className="text-xs text-muted-foreground">{role}</div>
          </div>
        </div>
        <div className="ml-auto text-right text-xs text-muted-foreground">
          {formatDuration(Number(troop.trainingTimePerTroop))} train
        </div>
      </div>

      <div className="mt-3">
        <InfoRows>
          <InfoRow
            label="Strength"
            value={
              <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-x-1.5 gap-y-1">
                <span>{troop.troopAttackStrength.toString()}</span>
                <Image src="/icons/attackpwr.svg" alt="Attack power" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
                <span>/</span>
                <span>{troop.troopDefenseStrength.toString()}</span>
                <Image src="/icons/defpwr.svg" alt="Defense power" width={14} height={14} className="h-3.5 w-3.5 object-contain" />
              </span>
            }
          />
          <InfoRow
            label="Can carry PTS/lifetime"
            value={<span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
              <ResourceValue resource="points">{formatBarracksPoints(troop.troopCarryPoints)}</ResourceValue>
              <ResourceValue resource="lifetime">{formatDuration(Number(troop.troopCarryLifetime))}</ResourceValue>
            </span>}
          />
        </InfoRows>
      </div>
    </div>
  );
}

function BarracksInfoContent({ open }: { open: boolean }) {
  const [configV2, setConfigV2] = useState<BarracksConfigV2 | null>(null);
  const [loading, setLoading] = useState(open);
  const [error, setError] = useState<string | null>(null);
  const [readVersion, setReadVersion] = useState(0);

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
  }, [open, readVersion]);

  if (loading && !configV2) {
    return (
      <ResourceState status="loading" title="Loading Barracks rules…" description="Checking the current training and raid rules." className="min-h-32" />
    );
  }

  if (!configV2) {
    return (
      <ResourceState status="error" title="Barracks rules unavailable" description={error ?? 'Try loading the current rules again.'}
        onRetry={() => setReadVersion(value => value + 1)} />
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
              icon="/icons/swordsman.png"
              troop={configV2.swordsman}
            />
            <BarracksTroopTile
              title="Phalanx"
              role="Defense"
              icon="/icons/phalanx.png"
              troop={configV2.phalanx}
            />
          </div>
        </div>
      </InfoSection>

      <InfoSection title="How Raids Work">
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-0.5">•</span>
            <span>When a raid wins, the defender&apos;s unclaimed production is collected into Warehouse first. The attacker steals up to {effectiveLootShare}, capped by surviving troop carry ability. Stolen PTS and lifetime are added to the attacker&apos;s Warehouse.</span>
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
  building,
  buildingType
}: BuildingInfoDialogProps) {
  const [selectedGame, setSelectedGame] = useState<'roulette' | 'blackjack' | 'baccarat'>('roulette');

  const key = `${buildingType}-${building.id}` as keyof typeof buildingInfo;
  const info = buildingInfo[key];

  if (!info) {
    return null;
  }

  const isProductionBuilding = buildingType === 'village';
  // Town tuples have no production fields. This dialog stays mounted even
  // while closed, so calculating Village rates here would crash the Farm tab.
  const production = isProductionBuilding ? getVillageProductionRates(building) : null;
  const producedResources = [
    building.productionRatePlantPointsPerDay > BigInt(0) ? 'plant points' : null,
    building.productionRatePlantLifetimePerDay > BigInt(0) ? 'plant lifetime' : null,
  ].filter(Boolean).join(' and ');
  const isUtilityBuilding = buildingType === 'town' && 'features' in info;
  const isCasino = 'isCasino' in info && info.isCasino;
  const isBarracks = 'isBarracks' in info && info.isBarracks;
  const hasUpgradeCost = building.level < building.maxLevel && (
    building.levelUpgradeCostLeaf > BigInt(0)
    || building.levelUpgradeCostSeedInstant > BigInt(0)
  );

  // Get current game info based on toggle
  const currentGameInfo = selectedGame === 'roulette'
    ? rouletteInfo
    : selectedGame === 'blackjack'
      ? blackjackInfo
      : baccaratInfo;
  const currentGameIcon = selectedGame === 'roulette' ? '🎰' : selectedGame === 'blackjack' ? '♦️' : '♣';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="detail" className={isBarracks || isCasino ? 'max-w-md' : 'max-w-sm'}>
        <DialogHeader className="pb-4">
          <DialogTitle>{info.name}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {info.description}
            {isProductionBuilding && ` ${producedResources ? `This level produces ${producedResources}. ` : ''}Collect its output into Warehouse, then choose which plant receives it.`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pr-1">
          <div className="surface-subpanel space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-[14px] py-3.5">
            {/* Casino Game Toggle */}
            {isCasino && (
              <>
                <div className="flex justify-center">
                  <ToggleGroup
                    value={selectedGame}
                    onValueChange={(v) => setSelectedGame(v as 'roulette' | 'blackjack' | 'baccarat')}
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
                      {
                        value: 'baccarat',
                        ariaLabel: 'Baccarat info',
                        label: (
                          <span className="inline-flex items-center gap-1.5">
                            <span aria-hidden="true">♣</span>
                            Baccarat
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
                    <p className="text-xs text-muted-foreground">Ratios show profit on a winning bet. Your original stake is also returned.</p>
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
                      <p className="text-xs text-muted-foreground">Total returns include your original stake.</p>
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

                {selectedGame === 'baccarat' && (
                  <InfoSection title="Payouts">
                    <p className="text-xs text-muted-foreground">Open Baccarat to check the current Banker commission and Tie payout before betting.</p>
                    <InfoRows>
                      {Object.entries(baccaratInfo.payouts).map(([result, payout]) => (
                        <InfoRow
                          key={result}
                          label={result}
                          value={payout}
                          valueClassName="text-[hsl(var(--success-strong))]"
                        />
                      ))}
                    </InfoRows>
                  </InfoSection>
                )}
              </>
            )}

            {isBarracks && <BarracksInfoContent open={open} />}

            {production && (
              <InfoSection title="Production Rates">
                {building.isUpgrading && (
                  <p className="mb-3 text-sm text-muted-foreground">Production is paused during this upgrade. These rates start when it completes.</p>
                )}
                <InfoRows>
                  <InfoRow label="Current level" value={`Level ${building.level}/${building.maxLevel}`} />
                  {building.productionRatePlantPointsPerDay > BigInt(0) && (
                    <InfoRow
                      label={building.isUpgrading ? 'Plant points / day after upgrade' : 'Plant points per day'}
                      value={<ResourceValue resource="points">{formatProductionRate(production.pointsPerDayWhenReady)}</ResourceValue>}
                      valueClassName="text-primary"
                    />
                  )}
                  {building.productionRatePlantLifetimePerDay > BigInt(0) && (
                    <InfoRow
                      label={building.isUpgrading ? 'Plant lifetime / day after upgrade' : 'Plant lifetime per day'}
                      value={<ResourceValue resource="lifetime">{formatLifetimeProduction(production.lifetimePerDaySecondsWhenReady)}</ResourceValue>}
                      valueClassName="text-primary"
                    />
                  )}
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

            {hasUpgradeCost && (
              <InfoSection title="Upgrade Costs">
                <InfoRows>
                  <InfoRow
                    label={building.isUpgrading ? `Current upgrade (Level ${building.level})` : `Next upgrade (Level ${building.level + 1})`}
                    value={<ResourceValue resource="leaf">{formatTokenAmount(building.levelUpgradeCostLeaf)} LEAF</ResourceValue>}
                    valueClassName="text-amber-600"
                  />
                  <InfoRow
                    label="Construction time"
                    value={<ResourceValue resource="duration">{formatUpgradeDuration(building.levelUpgradeBlockInterval)}</ResourceValue>}
                  />
                  <InfoRow
                    label="Optional speed up"
                    value={<ResourceValue resource="pixotchi">{formatTokenAmount(building.levelUpgradeCostSeedInstant)} PIXOTCHI</ResourceValue>}
                    valueClassName="text-amber-600"
                  />
                </InfoRows>
                <p className="text-xs text-muted-foreground">Speed up completes an upgrade after it has started.</p>
              </InfoSection>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
