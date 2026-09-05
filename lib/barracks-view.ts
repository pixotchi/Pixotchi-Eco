import type { BarracksConfigV2, BarracksRaidPreviewV2, BarracksRaidReportV2, BarracksTroopConfigV2, BarracksTroopId, BuildingData, Land } from '@/lib/types';
import { formatDuration, formatTokenAmountPrecise } from '@/lib/utils';
import { formatDurationSeconds } from '@/lib/duration-display';
const ZERO_BIGINT = BigInt(0);
const PLANT_POINTS_DECIMALS = 12;
const HOME_DEFENSE_MAX_BPS = 1000;
const RAID_STATUS_OK = 0;
export const TROOP_OPTIONS = [
  {
    id: "swordsman" as const,
    numericType: 0,
    name: "Swordsman",
    role: "Offense",
    icon: "/icons/swordsman.png",
  },
  {
    id: "phalanx" as const,
    numericType: 1,
    name: "Phalanx",
    role: "Defense",
    icon: "/icons/phalanx.png",
  },
] as const;

export function getTroopOption(type: BarracksTroopId) {
  return TROOP_OPTIONS.find((option) => option.id === type) ?? TROOP_OPTIONS[0];
}

export function troopIdFromNumeric(troopType: number): BarracksTroopId {
  return troopType === 1 ? "phalanx" : "swordsman";
}

export function troopNumericType(type: BarracksTroopId): number {
  return getTroopOption(type).numericType;
}

export function getTroopConfig(config: BarracksConfigV2 | null, troopType: BarracksTroopId): BarracksTroopConfigV2 | null {
  if (!config) return null;
  return troopType === "swordsman" ? config.swordsman : config.phalanx;
}

export function parsePositiveBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = BigInt(value.trim());
  return parsed > ZERO_BIGINT ? parsed : null;
}

export function parseOptionalBigInt(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed === "") return ZERO_BIGINT;
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

export function secondsUntil(timestamp: bigint): number {
  if (timestamp <= ZERO_BIGINT) return 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (timestamp <= now) return 0;
  return Number(timestamp - now);
}

export function formatRemaining(timestamp: bigint): string {
  const remaining = secondsUntil(timestamp);
  return remaining > 0 ? formatDuration(remaining) : "Ready";
}

export function formatCooldownState(timestamp: bigint): string {
  const remaining = secondsUntil(timestamp);
  return remaining > 0 ? formatDuration(remaining) : "Not active";
}

export function formatSigned(value: bigint): string {
  const prefix = value > ZERO_BIGINT ? "+" : "";
  return `${prefix}${value.toString()}`;
}

export function formatBarracksPoints(value: bigint): string {
  return formatTokenAmountPrecise(value, PLANT_POINTS_DECIMALS, 4);
}

export function formatBarracksLifetime(value: bigint): string {
  return formatDurationSeconds(value);
}

export const formatDurationFromBigInt = formatDurationSeconds;

export function formatQueueHint(troopName: string, readyAt: bigint): string {
  return secondsUntil(readyAt) > 0
    ? `${troopName} ready in ${formatRemaining(readyAt)}`
    : `${troopName} ready`;
}

export function formatPercentFromBps(bps: number): string {
  const percent = bps / 100;
  if (Number.isInteger(percent)) {
    return `${percent}%`;
  }
  return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

export function isProductionBuilding(building: BuildingData): boolean {
  return (
    building.maxLevel > 0 &&
    (building.productionRatePlantPointsPerDay > ZERO_BIGINT ||
      building.productionRatePlantLifetimePerDay > ZERO_BIGINT)
  );
}

export function getHomeDefenseBonusBps(villageBuildings: BuildingData[]): number {
  const productionBuildings = villageBuildings.filter(isProductionBuilding);
  if (productionBuildings.length === 0) return 0;

  const totalLevels = productionBuildings.reduce((sum, building) => sum + building.level, 0);
  const totalMaxLevels = productionBuildings.reduce((sum, building) => sum + building.maxLevel, 0);

  if (totalLevels === 0 || totalMaxLevels === 0) {
    return 0;
  }

  return Math.min(
    HOME_DEFENSE_MAX_BPS,
    Math.floor((totalLevels * HOME_DEFENSE_MAX_BPS) / totalMaxLevels),
  );
}

export function formatLandLabel(land: Pick<Land, "tokenId" | "name">): string {
  const trimmed = land.name?.trim();
  return trimmed ? trimmed : `Land #${land.tokenId.toString()}`;
}

export function formatCoordinates(land: Pick<Land, "coordinateX" | "coordinateY">): string {
  return `${formatSigned(land.coordinateX)}, ${formatSigned(land.coordinateY)}`;
}

export function hasReport(report: BarracksRaidReportV2 | null): report is BarracksRaidReportV2 {
  return !!report && report.raidId > ZERO_BIGINT;
}

export function getPreviewMessage(preview: BarracksRaidPreviewV2 | null): string | null {
  if (!preview) return null;

  switch (preview.statusCode) {
    case RAID_STATUS_OK:
      return preview.attackerWon
        ? "Projected win. Loot stays capped by surviving troop carry."
        : "Projected loss. Attack is still allowed, but loot is not expected.";
    case 1:
      return "Choose a different target land.";
    case 2:
      return "This land needs a built Barracks before it can attack.";
    case 3:
      return "The target land cannot be raided until it builds a Barracks.";
    case 4:
      return "You cannot attack your own land.";
    case 5:
      return `Attack cooldown active for ${formatRemaining(preview.attackerCooldownEndsAt)}.`;
    case 6:
      return `Target defense cooldown active for ${formatRemaining(preview.defenderCooldownEndsAt)}.`;
    case 7:
      return "Not enough troops available to send.";
    case 8:
      return "No raidable pending village production is available right now.";
    case 9:
      return "Barracks is currently disabled by admin.";
    default:
      return "Raid preview unavailable.";
  }
}
