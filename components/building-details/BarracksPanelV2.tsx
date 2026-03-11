"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { StandardContainer } from "@/components/ui/pixel-container";
import ApproveTransaction from "@/components/transactions/approve-transaction";
import DisabledTransaction from "@/components/transactions/disabled-transaction";
import SponsoredTransaction from "@/components/transactions/sponsored-transaction";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenSymbol } from "@/hooks/useTokenSymbol";
import {
  LAND_CONTRACT_ADDRESS,
  barracksGetConfigV2,
  barracksGetEligibleAttackableLandIds,
  barracksGetLandStateV2,
  barracksGetLastIncomingReportV2,
  barracksGetLastOutgoingReportV2,
  barracksPreviewRaidV2,
  buildBarracksAttackCallV2,
  buildBarracksBuildCall,
  buildBarracksTrainCallV2,
  checkBarracksApproval,
  getLandsByIds,
} from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import type {
  BarracksConfigV2,
  BarracksLandStateV2,
  BarracksRaidPreviewV2,
  BarracksRaidReportV2,
  BarracksTroopConfigV2,
  BarracksTroopId,
  BuildingData,
  Land,
} from "@/lib/types";
import {
  formatDuration,
  formatLifetimeProduction,
  formatTokenAmount,
  formatTokenAmountPrecise,
} from "@/lib/utils";
import { toast } from "react-hot-toast";

interface BarracksPanelV2Props {
  landId: bigint;
  currentBlock: bigint;
  onUpdate: () => void;
  villageBuildings: BuildingData[];
}

type BarracksTab = "train" | "raid" | "history";
type ReportMode = "outgoing" | "incoming";
type BarracksSnapshotV2 = {
  config: BarracksConfigV2 | null;
  landState: BarracksLandStateV2 | null;
  lastOutgoingReport: BarracksRaidReportV2 | null;
  lastIncomingReport: BarracksRaidReportV2 | null;
};

const RAID_STATUS_OK = 0;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BIGINT = BigInt(0);
const SECONDS_PER_MINUTE = BigInt(60);
const SECONDS_PER_HOUR = BigInt(3600);
const SECONDS_PER_DAY = BigInt(86400);
const PLANT_POINTS_DECIMALS = 12;
const BARRACKS_PREVIEW_ENABLED = CLIENT_ENV.BARRACKS_PREVIEW_ENABLED;
const HOME_DEFENSE_MAX_BPS = 1000;

const TROOP_OPTIONS = [
  {
    id: "swordsman" as const,
    numericType: 0,
    name: "Swordsman",
    role: "Offense",
    icon: "/icons/swordsman.svg",
  },
  {
    id: "phalanx" as const,
    numericType: 1,
    name: "Phalanx",
    role: "Defense",
    icon: "/icons/phalanx.svg",
  },
] as const;

function getTroopOption(type: BarracksTroopId) {
  return TROOP_OPTIONS.find((option) => option.id === type) ?? TROOP_OPTIONS[0];
}

function troopIdFromNumeric(troopType: number): BarracksTroopId {
  return troopType === 1 ? "phalanx" : "swordsman";
}

function troopNumericType(type: BarracksTroopId): number {
  return getTroopOption(type).numericType;
}

function getTroopConfig(config: BarracksConfigV2 | null, troopType: BarracksTroopId): BarracksTroopConfigV2 | null {
  if (!config) return null;
  return troopType === "swordsman" ? config.swordsman : config.phalanx;
}

function parsePositiveBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = BigInt(value.trim());
  return parsed > ZERO_BIGINT ? parsed : null;
}

function parseOptionalBigInt(value: string): bigint | null {
  const trimmed = value.trim();
  if (trimmed === "") return ZERO_BIGINT;
  if (!/^\d+$/.test(trimmed)) return null;
  return BigInt(trimmed);
}

function secondsUntil(timestamp: bigint): number {
  if (timestamp <= ZERO_BIGINT) return 0;
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (timestamp <= now) return 0;
  return Number(timestamp - now);
}

function formatRemaining(timestamp: bigint): string {
  const remaining = secondsUntil(timestamp);
  return remaining > 0 ? formatDuration(remaining) : "Ready";
}

function formatCooldownState(timestamp: bigint): string {
  const remaining = secondsUntil(timestamp);
  return remaining > 0 ? formatDuration(remaining) : "Not active";
}

function formatSigned(value: bigint): string {
  const prefix = value > ZERO_BIGINT ? "+" : "";
  return `${prefix}${value.toString()}`;
}

function formatBarracksPoints(value: bigint): string {
  return formatTokenAmountPrecise(value, PLANT_POINTS_DECIMALS, 4);
}

function formatBarracksLifetime(value: bigint): string {
  const seconds = Number(value);
  if (seconds <= 0) return "0s";
  if (seconds < 3600) return formatDuration(seconds);
  return formatLifetimeProduction(value);
}

function formatDurationFromBigInt(seconds: bigint): string {
  if (seconds <= ZERO_BIGINT) return "0s";

  const days = seconds / SECONDS_PER_DAY;
  const hours = (seconds % SECONDS_PER_DAY) / SECONDS_PER_HOUR;
  const minutes = (seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE;
  const secs = seconds % SECONDS_PER_MINUTE;

  let result = "";
  if (days > 0) result += `${days.toString()}d `;
  if (hours > 0) result += `${hours.toString()}h `;
  if (minutes > 0 && days === ZERO_BIGINT) result += `${minutes.toString()}m `;
  if (secs > 0 && hours === ZERO_BIGINT && days === ZERO_BIGINT) result += `${secs.toString()}s`;

  return result.trim() || "0s";
}

function formatPercentFromBps(bps: number): string {
  const percent = bps / 100;
  if (Number.isInteger(percent)) {
    return `${percent}%`;
  }
  return `${percent.toFixed(1).replace(/\.0$/, "")}%`;
}

function isProductionBuilding(building: BuildingData): boolean {
  return (
    building.maxLevel > 0 &&
    (building.productionRatePlantPointsPerDay > ZERO_BIGINT ||
      building.productionRatePlantLifetimePerDay > ZERO_BIGINT)
  );
}

function getHomeDefenseBonusBps(villageBuildings: BuildingData[]): number {
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

function formatLandLabel(land: Pick<Land, "tokenId" | "name">): string {
  const trimmed = land.name?.trim();
  return trimmed ? trimmed : `Land #${land.tokenId.toString()}`;
}

function formatCoordinates(land: Pick<Land, "coordinateX" | "coordinateY">): string {
  return `${formatSigned(land.coordinateX)}, ${formatSigned(land.coordinateY)}`;
}

function hasReport(report: BarracksRaidReportV2 | null): report is BarracksRaidReportV2 {
  return !!report && report.raidId > ZERO_BIGINT;
}

function getPreviewMessage(preview: BarracksRaidPreviewV2 | null): string | null {
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

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-muted/50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function TroopCount({
  type,
  amount,
  withName = false,
  withRole = false,
}: {
  type: BarracksTroopId;
  amount: bigint | string;
  withName?: boolean;
  withRole?: boolean;
}) {
  const troop = getTroopOption(type);
  const hasAmount = typeof amount === "bigint" || amount !== "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Image src={troop.icon} alt={troop.name} width={16} height={16} className="h-4 w-4 object-contain opacity-90" />
      {hasAmount ? <span>{typeof amount === "bigint" ? amount.toString() : amount}</span> : null}
      {withName ? <span className="text-xs font-medium text-muted-foreground">{troop.name}</span> : null}
      {withRole ? <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{troop.role}</span> : null}
    </span>
  );
}

function TroopLossSummary({
  label,
  swordsmen,
  phalanx,
}: {
  label: string;
  swordsmen: bigint;
  phalanx: bigint;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/40 p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-3 grid grid-cols-[1fr,auto] gap-x-3 gap-y-2 text-sm">
        <div className="text-muted-foreground">Swordsman</div>
        <div className="font-semibold">
          <TroopCount type="swordsman" amount={swordsmen} />
        </div>
        <div className="text-muted-foreground">Phalanx</div>
        <div className="font-semibold">
          <TroopCount type="phalanx" amount={phalanx} />
        </div>
      </div>
    </div>
  );
}

function ReportCard({
  report,
  mode,
}: {
  report: BarracksRaidReportV2 | null;
  mode: ReportMode;
}) {
  if (!hasReport(report)) {
    return (
      <StandardContainer className="space-y-2">
        <div className="text-sm font-semibold">
          {mode === "outgoing" ? "Last Attack" : "Last Defense"}
        </div>
        <p className="text-sm text-muted-foreground">
          No {mode === "outgoing" ? "attack" : "defense"} report recorded yet.
        </p>
      </StandardContainer>
    );
  }

  const success = mode === "outgoing" ? report.attackerWon : !report.attackerWon;
  const opponentLabel =
    mode === "outgoing"
      ? `Target Land #${report.defenderLandId.toString()}`
      : `Attacker Land #${report.attackerLandId.toString()}`;

  return (
    <StandardContainer className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">
            {mode === "outgoing" ? "Last Attack" : "Last Defense"}
          </div>
          <div className="text-xs text-muted-foreground">
            Raid #{report.raidId.toString()} • {opponentLabel}
          </div>
        </div>
        <div className={`text-xs font-semibold ${success ? "text-green-600" : "text-red-600"}`}>
          {success ? "Won" : "Lost"}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <TroopLossSummary
          label="Attacker Sent"
          swordsmen={report.swordsmenSent}
          phalanx={report.phalanxSent}
        />
        <TroopLossSummary
          label="Attacker Lost"
          swordsmen={report.attackerSwordsmenLost}
          phalanx={report.attackerPhalanxLost}
        />
        <TroopLossSummary
          label="Defender Present"
          swordsmen={report.defenderSwordsmenBefore}
          phalanx={report.defenderPhalanxBefore}
        />
        <TroopLossSummary
          label="Defender Lost"
          swordsmen={report.defenderSwordsmenLost}
          phalanx={report.defenderPhalanxLost}
        />
      </div>

      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm">
        <span className="font-semibold">Raided:</span>{" "}
        <span className="text-primary">{formatBarracksPoints(report.pointsStolen)} PTS</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-primary">{formatBarracksLifetime(report.lifetimeStolen)} TOD</span>
      </div>

      <div className="text-xs text-muted-foreground">
        Settled {formatBarracksPoints(report.pendingPointsSettled)} pending PTS and{" "}
        {formatBarracksLifetime(report.pendingLifetimeSettled)} pending TOD on{" "}
        {new Date(Number(report.timestamp) * 1000).toLocaleString()}.
      </div>
    </StandardContainer>
  );
}

export default function BarracksPanelV2({
  landId,
  currentBlock,
  onUpdate,
  villageBuildings,
}: BarracksPanelV2Props) {
  const { address } = useAccount();
  const [config, setConfig] = useState<BarracksConfigV2 | null>(null);
  const [landState, setLandState] = useState<BarracksLandStateV2 | null>(null);
  const [lastOutgoingReport, setLastOutgoingReport] = useState<BarracksRaidReportV2 | null>(null);
  const [lastIncomingReport, setLastIncomingReport] = useState<BarracksRaidReportV2 | null>(null);
  const [preview, setPreview] = useState<BarracksRaidPreviewV2 | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [, setCountdownTick] = useState(0);
  const [buildAllowance, setBuildAllowance] = useState(ZERO_BIGINT);
  const [trainingAllowance, setTrainingAllowance] = useState(ZERO_BIGINT);
  const [trainAmount, setTrainAmount] = useState("1");
  const [selectedTrainTroop, setSelectedTrainTroop] = useState<BarracksTroopId>("swordsman");
  const [attackSwordsmen, setAttackSwordsmen] = useState("");
  const [attackPhalanx, setAttackPhalanx] = useState("");
  const [activeTab, setActiveTab] = useState<BarracksTab>("train");
  const [reportView, setReportView] = useState<ReportMode>("outgoing");
  const [eligibleTargets, setEligibleTargets] = useState<Land[]>([]);
  const [selectedTargetLandId, setSelectedTargetLandId] = useState<bigint | null>(null);

  const buildTokenAddress = config?.buildToken;
  const selectedTrainConfig = getTroopConfig(config, selectedTrainTroop);
  const trainingTokenAddress = selectedTrainConfig?.trainingToken;
  const buildTokenSymbol = useTokenSymbol(buildTokenAddress) || "TOKEN";
  const trainingTokenSymbol = useTokenSymbol(trainingTokenAddress) || "TOKEN";
  const { decimals: buildTokenDecimals } = useTokenMetadata(buildTokenAddress);
  const { decimals: trainingTokenDecimals } = useTokenMetadata(trainingTokenAddress);

  const { data: buildTokenBalance } = useBalance({
    address,
    token:
      buildTokenAddress && buildTokenAddress !== ZERO_ADDRESS
        ? (buildTokenAddress as `0x${string}`)
        : undefined,
    query: {
      enabled: !!address && !!buildTokenAddress && buildTokenAddress !== ZERO_ADDRESS,
    },
  });

  const { data: trainingTokenBalance } = useBalance({
    address,
    token:
      trainingTokenAddress && trainingTokenAddress !== ZERO_ADDRESS
        ? (trainingTokenAddress as `0x${string}`)
        : undefined,
    query: {
      enabled: !!address && !!trainingTokenAddress && trainingTokenAddress !== ZERO_ADDRESS,
    },
  });

  const parsedTrainAmount = parsePositiveBigInt(trainAmount);
  const parsedAttackSwordsmen = parseOptionalBigInt(attackSwordsmen);
  const parsedAttackPhalanx = parseOptionalBigInt(attackPhalanx);
  const selectedTarget = useMemo(
    () => eligibleTargets.find((target) => target.tokenId === selectedTargetLandId) ?? null,
    [eligibleTargets, selectedTargetLandId],
  );
  const homeDefenseBonusBps = useMemo(
    () => getHomeDefenseBonusBps(villageBuildings),
    [villageBuildings],
  );
  const queueTroopType = troopIdFromNumeric(landState?.trainingQueueTroopType ?? 0);
  const queueTroopOption = getTroopOption(queueTroopType);
  const trainingQueueActive = (landState?.trainingQueueAmount ?? ZERO_BIGINT) > ZERO_BIGINT;
  const availableSwordsmenToSend =
    (landState?.stationedSwordsmanTroops ?? ZERO_BIGINT) + (landState?.readyToClaimSwordsmanTroops ?? ZERO_BIGINT);
  const availablePhalanxToSend =
    (landState?.stationedPhalanxTroops ?? ZERO_BIGINT) + (landState?.readyToClaimPhalanxTroops ?? ZERO_BIGINT);
  const trainCostTotal =
    selectedTrainConfig && parsedTrainAmount
      ? selectedTrainConfig.trainingCost * parsedTrainAmount
      : ZERO_BIGINT;
  const trainDurationDisplay =
    selectedTrainConfig && parsedTrainAmount
      ? formatDurationFromBigInt(selectedTrainConfig.trainingTimePerTroop * parsedTrainAmount)
      : null;
  const totalRequestedToAttack =
    (parsedAttackSwordsmen ?? ZERO_BIGINT) + (parsedAttackPhalanx ?? ZERO_BIGINT);

  const pause = useCallback((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)), []);
  const hasLiveCountdown = useMemo(
    () =>
      [
        landState?.trainingEndsAt ?? ZERO_BIGINT,
        landState?.attackCooldownEndsAt ?? ZERO_BIGINT,
        landState?.defenseCooldownEndsAt ?? ZERO_BIGINT,
        preview?.attackerCooldownEndsAt ?? ZERO_BIGINT,
        preview?.defenderCooldownEndsAt ?? ZERO_BIGINT,
      ].some((timestamp) => secondsUntil(timestamp) > 0),
    [
      landState?.attackCooldownEndsAt,
      landState?.defenseCooldownEndsAt,
      landState?.trainingEndsAt,
      preview?.attackerCooldownEndsAt,
      preview?.defenderCooldownEndsAt,
    ],
  );

  const applySnapshot = useCallback((snapshot: BarracksSnapshotV2) => {
    setConfig(snapshot.config);
    setLandState(snapshot.landState);
    setLastOutgoingReport(snapshot.lastOutgoingReport);
    setLastIncomingReport(snapshot.lastIncomingReport);
  }, []);

  const readSnapshot = useCallback(async (): Promise<BarracksSnapshotV2> => {
    const [nextConfig, nextLandState, nextOutgoing, nextIncoming] = await Promise.all([
      barracksGetConfigV2(),
      barracksGetLandStateV2(landId),
      barracksGetLastOutgoingReportV2(landId),
      barracksGetLastIncomingReportV2(landId),
    ]);

    return {
      config: nextConfig,
      landState: nextLandState,
      lastOutgoingReport: nextOutgoing,
      lastIncomingReport: nextIncoming,
    };
  }, [landId]);

  const loadState = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) {
        setLoading(true);
      }

      const snapshot = await readSnapshot();
      applySnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.error("Failed to load barracks V2 state:", error);
      return null;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [applySnapshot, readSnapshot]);

  const loadAllowances = useCallback(async () => {
    if (!address || !buildTokenAddress || !trainingTokenAddress) {
      setBuildAllowance(ZERO_BIGINT);
      setTrainingAllowance(ZERO_BIGINT);
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }

    try {
      const [nextBuildAllowance, nextTrainingAllowance] = await Promise.all([
        checkBarracksApproval(address, buildTokenAddress),
        checkBarracksApproval(address, trainingTokenAddress),
      ]);
      setBuildAllowance(nextBuildAllowance);
      setTrainingAllowance(nextTrainingAllowance);
      return { build: nextBuildAllowance, training: nextTrainingAllowance };
    } catch (error) {
      console.error("Failed to load barracks V2 approvals:", error);
      setBuildAllowance(ZERO_BIGINT);
      setTrainingAllowance(ZERO_BIGINT);
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }
  }, [address, buildTokenAddress, trainingTokenAddress]);

  const loadTargets = useCallback(async () => {
    if (!config?.enabled || !landState?.isBuilt) {
      setEligibleTargets([]);
      setSelectedTargetLandId(null);
      setTargetsError(null);
      setTargetsLoading(false);
      return;
    }

    try {
      setTargetsLoading(true);
      setTargetsError(null);

      const targetIds = await barracksGetEligibleAttackableLandIds(landId);
      const targetLands = targetIds.length > 0 ? await getLandsByIds(targetIds) : [];

      setEligibleTargets(targetLands);
      setSelectedTargetLandId((current) =>
        current && targetLands.some((target) => target.tokenId === current)
          ? current
          : (targetLands[0]?.tokenId ?? null),
      );
    } catch (error) {
      console.error("Failed to load barracks V2 targets:", error);
      setEligibleTargets([]);
      setSelectedTargetLandId(null);
      setTargetsError("Unable to load eligible targets right now.");
    } finally {
      setTargetsLoading(false);
    }
  }, [config?.enabled, landId, landState?.isBuilt]);

  useEffect(() => {
    void loadState();
  }, [currentBlock, loadState]);

  useEffect(() => {
    void loadAllowances();
  }, [loadAllowances]);

  useEffect(() => {
    if (activeTab !== "raid") return;
    void loadTargets();
  }, [activeTab, currentBlock, loadTargets]);

  useEffect(() => {
    let cancelled = false;

    async function loadPreview() {
      if (
        !BARRACKS_PREVIEW_ENABLED ||
        activeTab !== "raid" ||
        !config?.enabled ||
        !landState?.isBuilt ||
        !selectedTargetLandId ||
        parsedAttackSwordsmen === null ||
        parsedAttackPhalanx === null ||
        totalRequestedToAttack === ZERO_BIGINT
      ) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      const nextPreview = await barracksPreviewRaidV2(
        landId,
        selectedTargetLandId,
        parsedAttackSwordsmen,
        parsedAttackPhalanx,
      );

      if (cancelled) return;

      if (!nextPreview) {
        setPreview(null);
        setPreviewError("Raid preview unavailable for the selected target.");
      } else {
        setPreview(nextPreview);
        setPreviewError(null);
      }

      setPreviewLoading(false);
    }

    void loadPreview();

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    BARRACKS_PREVIEW_ENABLED,
    config?.enabled,
    currentBlock,
    landId,
    landState?.isBuilt,
    parsedAttackPhalanx,
    parsedAttackSwordsmen,
    selectedTargetLandId,
    totalRequestedToAttack,
  ]);

  useEffect(() => {
    if (!hasLiveCountdown) return;

    const countdownInterval = setInterval(() => {
      setCountdownTick((current) => current + 1);
    }, 1000);

    const refreshInterval = setInterval(() => {
      void loadState(false);
    }, 15000);

    return () => {
      clearInterval(countdownInterval);
      clearInterval(refreshInterval);
    };
  }, [hasLiveCountdown, loadState]);

  const dispatchRefreshEvents = useCallback(() => {
    onUpdate();
    try {
      window.dispatchEvent(new Event("balances:refresh"));
      window.dispatchEvent(new Event("buildings:refresh"));
    } catch { }
  }, [onUpdate]);

  const refreshAfterSuccess = useCallback(async () => {
    for (const waitMs of [0, 500, 1200]) {
      if (waitMs > 0) {
        await pause(waitMs);
      }

      await Promise.all([
        loadState(false),
        loadAllowances(),
        activeTab === "raid" ? loadTargets() : Promise.resolve(),
      ]);
    }

    dispatchRefreshEvents();
  }, [activeTab, dispatchRefreshEvents, loadAllowances, loadState, loadTargets, pause]);

  const refreshAfterRaidSuccess = useCallback(async () => {
    const previousLastAttackAt = landState?.lastAttackAt ?? ZERO_BIGINT;
    const previousAttackCooldownEndsAt = landState?.attackCooldownEndsAt ?? ZERO_BIGINT;
    const previousOutgoingRaidId = lastOutgoingReport?.raidId ?? ZERO_BIGINT;
    const previousAvailableSwordsmen = availableSwordsmenToSend;
    const previousAvailablePhalanx = availablePhalanxToSend;

    for (const waitMs of [0, 500, 1200, 2200, 3500]) {
      if (waitMs > 0) {
        await pause(waitMs);
      }

      const [snapshot] = await Promise.all([
        loadState(false),
        loadAllowances(),
        loadTargets(),
      ]);

      if (!snapshot?.landState) {
        continue;
      }

      const nextAvailableSwordsmen =
        snapshot.landState.stationedSwordsmanTroops + snapshot.landState.readyToClaimSwordsmanTroops;
      const nextAvailablePhalanx =
        snapshot.landState.stationedPhalanxTroops + snapshot.landState.readyToClaimPhalanxTroops;
      const nextOutgoingRaidId = snapshot.lastOutgoingReport?.raidId ?? ZERO_BIGINT;

      if (
        snapshot.landState.lastAttackAt !== previousLastAttackAt ||
        snapshot.landState.attackCooldownEndsAt !== previousAttackCooldownEndsAt ||
        nextOutgoingRaidId !== previousOutgoingRaidId ||
        nextAvailableSwordsmen !== previousAvailableSwordsmen ||
        nextAvailablePhalanx !== previousAvailablePhalanx
      ) {
        break;
      }
    }

    dispatchRefreshEvents();
  }, [
    availablePhalanxToSend,
    availableSwordsmenToSend,
    dispatchRefreshEvents,
    landState?.attackCooldownEndsAt,
    landState?.lastAttackAt,
    lastOutgoingReport?.raidId,
    loadAllowances,
    loadState,
    loadTargets,
    pause,
  ]);

  const refreshAfterApproval = useCallback(
    async (type: "build" | "training") => {
      const requiredAmount = type === "build" ? (config?.buildCost ?? ZERO_BIGINT) : trainCostTotal;

      for (const waitMs of [0, 700, 1400, 2200]) {
        if (waitMs > 0) {
          await pause(waitMs);
        }

        const nextAllowances = await loadAllowances();
        const currentAllowance = type === "build" ? nextAllowances.build : nextAllowances.training;

        if (requiredAmount === ZERO_BIGINT || currentAllowance >= requiredAmount) {
          break;
        }
      }
    },
    [config?.buildCost, loadAllowances, pause, trainCostTotal],
  );

  const needsBuildApproval = !!config && config.buildCost > ZERO_BIGINT && buildAllowance < config.buildCost;
  const needsTrainingApproval =
    !!selectedTrainConfig && trainCostTotal > ZERO_BIGINT && trainingAllowance < trainCostTotal;
  const isBuildBalanceLoaded =
    !address || !buildTokenAddress || buildTokenAddress === ZERO_ADDRESS || !!buildTokenBalance;
  const hasBuildBalance =
    config?.buildCost === ZERO_BIGINT ||
    (buildTokenBalance ? buildTokenBalance.value >= (config?.buildCost ?? ZERO_BIGINT) : false);
  const hasTrainingBalance =
    trainCostTotal === ZERO_BIGINT ||
    (trainingTokenBalance ? trainingTokenBalance.value >= trainCostTotal : false);
  const attackInputsValid = parsedAttackSwordsmen !== null && parsedAttackPhalanx !== null;
  const canAttack =
    !!selectedTargetLandId &&
    attackInputsValid &&
    totalRequestedToAttack > ZERO_BIGINT &&
    (parsedAttackSwordsmen ?? ZERO_BIGINT) <= availableSwordsmenToSend &&
    (parsedAttackPhalanx ?? ZERO_BIGINT) <= availablePhalanxToSend &&
    (!BARRACKS_PREVIEW_ENABLED || (!!preview && preview.statusCode === RAID_STATUS_OK));
  const attackCooldownEndsAt = landState?.attackCooldownEndsAt ?? ZERO_BIGINT;
  const attackCooldownActive = secondsUntil(attackCooldownEndsAt) > 0;
  const emptyRaidTargetMessage = attackCooldownActive
    ? `Cannot attack for ${formatRemaining(attackCooldownEndsAt)}`
    : "You cannot attack right now";

  if (loading && !config && !landState) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config || !landState) {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
        Barracks data is unavailable.
      </div>
    );
  }

  const buildCostDisplay = formatTokenAmount(config.buildCost, buildTokenDecimals);
  const trainingCostDisplay = formatTokenAmount(trainCostTotal, trainingTokenDecimals);
  const selectedTroopOption = getTroopOption(selectedTrainTroop);

  if (!landState.isBuilt) {
    return (
      <div className="space-y-4">
        <div className="text-center py-4 space-y-2">
          <div className="text-muted-foreground text-sm">
            Build a Barracks to train troops and raid nearby lands.
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-border">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Build Cost:</h4>
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Instant Build:</span>
              <span className="font-semibold">
                {buildCostDisplay} {buildTokenSymbol}
              </span>
            </div>
            {address && (
              <div className="flex justify-between items-center text-sm">
                <span className="text-muted-foreground">Your Balance:</span>
                <span className={hasBuildBalance ? "font-medium" : "font-medium text-destructive"}>
                  {buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : "..."}{" "}
                  {buildTokenSymbol}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2">
            {!config.enabled ? (
              <Button className="w-full" variant="secondary" disabled>
                Barracks disabled
              </Button>
            ) : !address ? (
              <Button className="w-full" variant="secondary" disabled>
                Connect wallet to build
              </Button>
            ) : !isBuildBalanceLoaded ? (
              <Button className="w-full" variant="secondary" disabled>
                Checking balance...
              </Button>
            ) : needsBuildApproval ? (
              <ApproveTransaction
                spenderAddress={LAND_CONTRACT_ADDRESS}
                tokenAddress={config.buildToken as `0x${string}`}
                buttonText={`Approve ${buildTokenSymbol} to Build`}
                buttonClassName="w-full"
                onSuccess={async () => {
                  toast.success(`${buildTokenSymbol} approved`);
                  await refreshAfterApproval("build");
                }}
                onError={(error) => toast.error(`Approval failed: ${error.message || error}`)}
              />
            ) : !hasBuildBalance ? (
              <Button className="w-full" variant="secondary" disabled>
                Insufficient balance
              </Button>
            ) : (
              <SponsoredTransaction
                calls={[buildBarracksBuildCall(landId)]}
                buttonText={`Build (${buildCostDisplay} ${buildTokenSymbol})`}
                buttonClassName="w-full"
                disabled={!config.enabled}
                onSuccess={async () => {
                  toast.success("Barracks built");
                  await refreshAfterSuccess();
                }}
                onError={(error) => toast.error(`Build failed: ${error.message || error}`)}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Barracks</div>
          <div className="text-xs text-muted-foreground">
            Train Swordsmen and Phalanx, raid lands, and review the latest reports.
          </div>
        </div>
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${config.enabled ? "text-primary" : "text-muted-foreground"}`}>
          {config.enabled ? `Defense +${formatPercentFromBps(homeDefenseBonusBps)}` : "Disabled"}
        </div>
      </div>

      <ToggleGroup
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BarracksTab)}
        options={[
          { value: "train", label: "Train" },
          { value: "raid", label: "Raid" },
          { value: "history", label: "History" },
        ]}
        className="w-full justify-between"
        getButtonClassName={() => "flex-1 justify-center h-8"}
      />

      {activeTab === "train" && (
        <StandardContainer className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatTile
              label="Swordsman Ready"
              value={<TroopCount type="swordsman" amount={availableSwordsmenToSend} withName />}
              hint={`${landState.stationedSwordsmanTroops.toString()} stationed`}
            />
            <StatTile
              label="Phalanx Ready"
              value={<TroopCount type="phalanx" amount={availablePhalanxToSend} withName />}
              hint={`${landState.stationedPhalanxTroops.toString()} stationed`}
            />
          </div>

          <StatTile
            label="Queue"
            value={
              trainingQueueActive ? (
                <span className="inline-flex items-center gap-2">
                  <TroopCount type={queueTroopType} amount={landState.trainingQueueAmount} withName />
                </span>
              ) : (
                "Queue empty"
              )
            }
            hint={
              trainingQueueActive
                ? `${queueTroopOption.name} ready in ${formatRemaining(landState.trainingEndsAt)}`
                : "One training queue shared across both troop types"
            }
          />

          <ToggleGroup
            value={selectedTrainTroop}
            onValueChange={(value) => setSelectedTrainTroop((value as BarracksTroopId) || "swordsman")}
            options={TROOP_OPTIONS.map((troop) => ({
              value: troop.id,
              label: troop.name,
            }))}
            className="w-full justify-between"
            getButtonClassName={() => "flex-1 justify-center h-8"}
          />

          <div className="relative">
            <Input
              value={trainAmount}
              onChange={(event) => setTrainAmount(event.target.value)}
              placeholder="Troops"
              inputMode="numeric"
              className="h-10 pr-24"
            />
            {trainDurationDisplay ? (
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-muted-foreground">
                {trainDurationDisplay}
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <TroopCount type={selectedTrainTroop} amount="" withName withRole />
            </span>
            <span>Costs {trainingCostDisplay} {trainingTokenSymbol}</span>
          </div>

          {address && (
            <div className="flex justify-between items-center text-sm">
              <span className="text-muted-foreground">Your Balance</span>
              <span className={hasTrainingBalance ? "font-medium" : "font-medium text-destructive"}>
                {trainingTokenBalance
                  ? formatTokenAmount(trainingTokenBalance.value, trainingTokenDecimals)
                  : "..."}{" "}
                {trainingTokenSymbol}
              </span>
            </div>
          )}

          {!parsedTrainAmount ? (
            <DisabledTransaction buttonText="Enter Troop Amount" buttonClassName="w-full" />
          ) : trainingQueueActive ? (
            <DisabledTransaction buttonText="Training Queue Active" buttonClassName="w-full" />
          ) : needsTrainingApproval ? (
            <ApproveTransaction
              spenderAddress={LAND_CONTRACT_ADDRESS}
              tokenAddress={trainingTokenAddress as `0x${string}`}
              buttonText={`Approve ${trainingTokenSymbol}`}
              buttonClassName="w-full"
              onSuccess={async () => {
                toast.success(`${trainingTokenSymbol} approved`);
                await refreshAfterApproval("training");
              }}
              onError={(error) => toast.error(`Approval failed: ${error.message || error}`)}
            />
          ) : !hasTrainingBalance ? (
            <DisabledTransaction
              buttonText={`Insufficient ${trainingTokenSymbol}`}
              buttonClassName="w-full"
            />
          ) : (
            <SponsoredTransaction
              calls={[buildBarracksTrainCallV2(landId, troopNumericType(selectedTrainTroop), parsedTrainAmount)]}
              buttonText={`Train ${parsedTrainAmount.toString()} ${selectedTroopOption.name}`}
              buttonClassName="w-full"
              onSuccess={async () => {
                toast.success("Training started");
                await refreshAfterSuccess();
              }}
              onError={(error) => toast.error(`Training failed: ${error.message || error}`)}
            />
          )}
        </StandardContainer>
      )}

      {activeTab === "raid" && (
        <StandardContainer className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Attack Cooldown"
              value={formatCooldownState(landState.attackCooldownEndsAt)}
              hint="Attack timer"
            />
            <StatTile
              label="Defense Cooldown"
              value={formatCooldownState(landState.defenseCooldownEndsAt)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Select target</span>
              {targetsLoading ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Refreshing
                </span>
              ) : attackCooldownActive ? (
                <span>Cooldown active</span>
              ) : (
                <span>{eligibleTargets.length} available</span>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-12 w-full justify-between gap-3 text-left"
                  disabled={targetsLoading || eligibleTargets.length === 0}
                >
                  {selectedTarget ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{formatLandLabel(selectedTarget)}</div>
                      <div className="text-xs text-muted-foreground">
                        #{selectedTarget.tokenId.toString()} • {formatCoordinates(selectedTarget)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      {targetsLoading ? "Loading targets..." : emptyRaidTargetMessage}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-72 overflow-y-auto">
                {eligibleTargets.map((target) => {
                  const selected = selectedTargetLandId === target.tokenId;
                  return (
                    <DropdownMenuItem
                      key={target.tokenId.toString()}
                      onSelect={() => setSelectedTargetLandId(target.tokenId)}
                      className="min-h-14"
                    >
                      <div className="flex w-full items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{formatLandLabel(target)}</div>
                          <div className="text-xs text-muted-foreground">
                            #{target.tokenId.toString()} • {formatCoordinates(target)}
                          </div>
                        </div>
                        {selected ? <div className="text-xs font-semibold text-primary">Selected</div> : null}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {targetsError ? (
              <div className="text-xs text-destructive">{targetsError}</div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="relative">
                <Input
                  value={attackSwordsmen}
                  onChange={(event) => setAttackSwordsmen(event.target.value)}
                  placeholder="Swordsmen"
                  inputMode="numeric"
                  className="h-10 pr-16"
                />
                <button
                  type="button"
                  onClick={() => setAttackSwordsmen(availableSwordsmenToSend.toString())}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-accent"
                >
                  Max
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <TroopCount type="swordsman" amount={availableSwordsmenToSend} withName />
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="relative">
                <Input
                  value={attackPhalanx}
                  onChange={(event) => setAttackPhalanx(event.target.value)}
                  placeholder="Phalanx"
                  inputMode="numeric"
                  className="h-10 pr-16"
                />
                <button
                  type="button"
                  onClick={() => setAttackPhalanx(availablePhalanxToSend.toString())}
                  className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-accent"
                >
                  Max
                </button>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <TroopCount type="phalanx" amount={availablePhalanxToSend} withName />
                </span>
              </div>
            </div>
          </div>

          {BARRACKS_PREVIEW_ENABLED ? (
            <div className="rounded-md bg-muted/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Preview</div>
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>

              {previewError ? (
                <div className="text-sm text-destructive">{previewError}</div>
              ) : preview ? (
                <>
                  <div className="text-sm text-muted-foreground">{getPreviewMessage(preview)}</div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-muted-foreground">Attack / Defense</div>
                      <div className="font-semibold">
                        {preview.attackerPower.toString()} / {preview.defenderPower.toString()}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Estimated PTS</div>
                      <div className="font-semibold text-primary">
                        {formatBarracksPoints(preview.estimatedPointsLoot)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Estimated TOD</div>
                      <div className="font-semibold text-primary">
                        {formatBarracksLifetime(preview.estimatedLifetimeLoot)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Requested</div>
                      <div className="font-semibold">
                        {preview.swordsmenRequested.toString()} / {preview.phalanxRequested.toString()}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground">
                      Defender power includes up to a 10% home bonus from production building levels.
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <TroopLossSummary
                      label="Attacker Losses"
                      swordsmen={preview.attackerSwordsmenLost}
                      phalanx={preview.attackerPhalanxLost}
                    />
                    <TroopLossSummary
                      label="Defender Losses"
                      swordsmen={preview.defenderSwordsmenLost}
                      phalanx={preview.defenderPhalanxLost}
                    />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Choose an eligible target land and enter troop counts to preview the raid.
                </div>
              )}
            </div>
          ) : null}

          {canAttack && selectedTargetLandId && attackInputsValid ? (
            <SponsoredTransaction
              calls={[
                buildBarracksAttackCallV2(
                  landId,
                  selectedTargetLandId,
                  parsedAttackSwordsmen ?? ZERO_BIGINT,
                  parsedAttackPhalanx ?? ZERO_BIGINT,
                ),
              ]}
              buttonText={`Raid Land #${selectedTargetLandId.toString()}`}
              buttonClassName="w-full"
              onSuccess={async () => {
                toast.success("Raid resolved");
                setAttackSwordsmen("");
                setAttackPhalanx("");
                await refreshAfterRaidSuccess();
              }}
              onError={(error) => toast.error(`Raid failed: ${error.message || error}`)}
            />
          ) : (
            <DisabledTransaction buttonText="Raid Unavailable" buttonClassName="w-full" />
          )}
        </StandardContainer>
      )}

      {activeTab === "history" && (
        <div className="space-y-3">
          <ToggleGroup
            value={reportView}
            onValueChange={(value) => setReportView(value as ReportMode)}
            options={[
              { value: "outgoing", label: "Last Attack" },
              { value: "incoming", label: "Last Defense" },
            ]}
            className="w-full justify-between"
            getButtonClassName={() => "flex-1 justify-center h-8"}
          />

          <ReportCard
            report={reportView === "outgoing" ? lastOutgoingReport : lastIncomingReport}
            mode={reportView}
          />
        </div>
      )}
    </div>
  );
}