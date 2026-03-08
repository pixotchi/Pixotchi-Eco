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
  barracksGetConfig,
  barracksGetEligibleAttackableLandIds,
  barracksGetLandState,
  barracksGetLastIncomingReport,
  barracksGetLastOutgoingReport,
  barracksPreviewRaid,
  buildBarracksAttackCall,
  buildBarracksBuildCall,
  buildBarracksTrainCall,
  checkBarracksApproval,
  getLandsByIds,
} from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import type {
  BarracksConfig,
  BarracksLandState,
  BarracksRaidPreview,
  BarracksRaidReport,
  Land,
} from "@/lib/types";
import {
  formatDuration,
  formatLifetimeProduction,
  formatTokenAmount,
  formatTokenAmountPrecise,
} from "@/lib/utils";
import { toast } from "react-hot-toast";

interface BarracksPanelProps {
  landId: bigint;
  currentBlock: bigint;
  onUpdate: () => void;
}

type BarracksTab = "train" | "raid" | "history";
type ReportMode = "outgoing" | "incoming";
type TroopType = "swordsman";
type BarracksSnapshot = {
  config: BarracksConfig | null;
  landState: BarracksLandState | null;
  lastOutgoingReport: BarracksRaidReport | null;
  lastIncomingReport: BarracksRaidReport | null;
};

const RAID_STATUS_OK = 0;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BIGINT = BigInt(0);
const PLANT_POINTS_DECIMALS = 12;
const BARRACKS_PREVIEW_ENABLED = CLIENT_ENV.BARRACKS_PREVIEW_ENABLED;
const TROOP_OPTIONS = [
  {
    id: "swordsman" as const,
    name: "Swordsman",
    icon: "/icons/swordsman.svg",
  },
];

function getTroopOption(type: TroopType) {
  return TROOP_OPTIONS.find((option) => option.id === type) ?? TROOP_OPTIONS[0];
}

function parsePositiveBigInt(value: string): bigint | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = BigInt(value.trim());
  return parsed > ZERO_BIGINT ? parsed : null;
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

function formatLandLabel(land: Pick<Land, "tokenId" | "name">): string {
  const trimmed = land.name?.trim();
  return trimmed ? trimmed : `Land #${land.tokenId.toString()}`;
}

function formatCoordinates(land: Pick<Land, "coordinateX" | "coordinateY">): string {
  return `${formatSigned(land.coordinateX)}, ${formatSigned(land.coordinateY)}`;
}

function hasReport(report: BarracksRaidReport | null): report is BarracksRaidReport {
  return !!report && report.raidId > ZERO_BIGINT;
}

function getPreviewMessage(preview: BarracksRaidPreview | null): string | null {
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
}: {
  type: TroopType;
  amount: bigint | string;
  withName?: boolean;
}) {
  const troop = getTroopOption(type);
  const hasAmount = typeof amount === "bigint" || amount !== "";
  return (
    <span className="inline-flex items-center gap-1.5">
      <Image src={troop.icon} alt={troop.name} width={16} height={16} className="h-4 w-4 object-contain opacity-90" />
      {hasAmount ? <span>{typeof amount === "bigint" ? amount.toString() : amount}</span> : null}
      {withName ? <span className="text-xs font-medium text-muted-foreground">{troop.name}</span> : null}
    </span>
  );
}

function ReportCard({
  report,
  mode,
}: {
  report: BarracksRaidReport | null;
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
  const attackerLabel = `Land #${report.attackerLandId.toString()}`;
  const defenderLabel = `Land #${report.defenderLandId.toString()}`;

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
          {success ? "Success" : "Failed"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-md border border-border/70 bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Attacker</div>
          <div className="mt-1 text-sm font-semibold">{attackerLabel}</div>
          <div className="mt-3 grid grid-cols-[1fr,auto] gap-x-3 gap-y-2 text-sm">
            <div className="text-muted-foreground">Sent</div>
            <div className="font-semibold">
              <TroopCount type="swordsman" amount={report.troopsSent} />
            </div>
            <div className="text-muted-foreground">Lost</div>
            <div className="font-semibold text-destructive">
              <TroopCount type="swordsman" amount={report.attackerTroopsLost} />
            </div>
          </div>
        </div>
        <div className="rounded-md border border-border/70 bg-muted/40 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Defender</div>
          <div className="mt-1 text-sm font-semibold">{defenderLabel}</div>
          <div className="mt-3 grid grid-cols-[1fr,auto] gap-x-3 gap-y-2 text-sm">
            <div className="text-muted-foreground">Present</div>
            <div className="font-semibold">
              <TroopCount type="swordsman" amount={report.defenderTroopsBefore} />
            </div>
            <div className="text-muted-foreground">Lost</div>
            <div className="font-semibold text-destructive">
              <TroopCount type="swordsman" amount={report.defenderTroopsLost} />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-md bg-primary/10 px-3 py-2 text-sm">
        <span className="font-semibold">Raided:</span>{" "}
        <span className="text-primary">{formatBarracksPoints(report.pointsStolen)} PTS</span>
        <span className="text-muted-foreground"> / </span>
        <span className="text-primary">{formatBarracksLifetime(report.lifetimeStolen)} TOD</span>
      </div>

      {mode === "incoming" ? (
        <div className="text-xs text-muted-foreground">
          Settled {formatBarracksPoints(report.pendingPointsSettled)} pending PTS and{" "}
          {formatBarracksLifetime(report.pendingLifetimeSettled)} pending TOD on{" "}
          {new Date(Number(report.timestamp) * 1000).toLocaleString()}.
        </div>
      ) : null}
    </StandardContainer>
  );
}

export default function BarracksPanel({
  landId,
  currentBlock,
  onUpdate,
}: BarracksPanelProps) {
  const { address } = useAccount();
  const [config, setConfig] = useState<BarracksConfig | null>(null);
  const [landState, setLandState] = useState<BarracksLandState | null>(null);
  const [lastOutgoingReport, setLastOutgoingReport] = useState<BarracksRaidReport | null>(null);
  const [lastIncomingReport, setLastIncomingReport] = useState<BarracksRaidReport | null>(null);
  const [preview, setPreview] = useState<BarracksRaidPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [, setCountdownTick] = useState(0);
  const [buildAllowance, setBuildAllowance] = useState(ZERO_BIGINT);
  const [trainingAllowance, setTrainingAllowance] = useState(ZERO_BIGINT);
  const [trainAmount, setTrainAmount] = useState("1");
  const [attackTroops, setAttackTroops] = useState("");
  const [activeTab, setActiveTab] = useState<BarracksTab>("train");
  const [reportView, setReportView] = useState<ReportMode>("outgoing");
  const [eligibleTargets, setEligibleTargets] = useState<Land[]>([]);
  const [selectedTargetLandId, setSelectedTargetLandId] = useState<bigint | null>(null);

  const buildTokenAddress = config?.buildToken;
  const trainingTokenAddress = config?.trainingToken;
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
  const parsedAttackTroops = parsePositiveBigInt(attackTroops);
  const trainCostTotal =
    config && parsedTrainAmount ? config.trainingCost * parsedTrainAmount : ZERO_BIGINT;
  const availableToSend =
    (landState?.stationedTroops ?? ZERO_BIGINT) + (landState?.readyToClaimTroops ?? ZERO_BIGINT);
  const selectedTarget = useMemo(
    () => eligibleTargets.find((target) => target.tokenId === selectedTargetLandId) ?? null,
    [eligibleTargets, selectedTargetLandId],
  );
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

  const applySnapshot = useCallback((snapshot: BarracksSnapshot) => {
    setConfig(snapshot.config);
    setLandState(snapshot.landState);
    setLastOutgoingReport(snapshot.lastOutgoingReport);
    setLastIncomingReport(snapshot.lastIncomingReport);
  }, []);

  const readSnapshot = useCallback(async (): Promise<BarracksSnapshot> => {
    const [nextConfig, nextLandState, nextOutgoing, nextIncoming] = await Promise.all([
      barracksGetConfig(),
      barracksGetLandState(landId),
      barracksGetLastOutgoingReport(landId),
      barracksGetLastIncomingReport(landId),
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
      console.error("Failed to load barracks state:", error);
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
      console.error("Failed to load barracks approvals:", error);
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
      console.error("Failed to load barracks targets:", error);
      setEligibleTargets([]);
      setSelectedTargetLandId(null);
      setTargetsError("Unable to load eligible targets right now.");
    } finally {
      setTargetsLoading(false);
    }
  }, [config?.enabled, landId, landState?.isBuilt]);

  useEffect(() => {
    void loadState();
  }, [loadState, currentBlock]);

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
        !parsedAttackTroops
      ) {
        setPreview(null);
        setPreviewError(null);
        setPreviewLoading(false);
        return;
      }

      setPreviewLoading(true);
      const nextPreview = await barracksPreviewRaid(landId, selectedTargetLandId, parsedAttackTroops);

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
    parsedAttackTroops,
    selectedTargetLandId,
  ]);

  useEffect(() => {
    if (!hasLiveCountdown) return;

    const interval = setInterval(() => {
      setCountdownTick((current) => current + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [hasLiveCountdown]);

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
    const previousAvailableToSend = availableToSend;

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

      const nextAvailableToSend =
        snapshot.landState.stationedTroops + snapshot.landState.readyToClaimTroops;
      const nextOutgoingRaidId = snapshot.lastOutgoingReport?.raidId ?? ZERO_BIGINT;

      if (
        snapshot.landState.lastAttackAt !== previousLastAttackAt ||
        snapshot.landState.attackCooldownEndsAt !== previousAttackCooldownEndsAt ||
        nextOutgoingRaidId !== previousOutgoingRaidId ||
        nextAvailableToSend !== previousAvailableToSend
      ) {
        break;
      }
    }

    dispatchRefreshEvents();
  }, [
    availableToSend,
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
        const currentAllowance =
          type === "build" ? nextAllowances.build : nextAllowances.training;

        if (requiredAmount === ZERO_BIGINT || currentAllowance >= requiredAmount) {
          break;
        }
      }
    },
    [config?.buildCost, loadAllowances, pause, trainCostTotal],
  );

  const needsBuildApproval = !!config && config.buildCost > ZERO_BIGINT && buildAllowance < config.buildCost;
  const needsTrainingApproval =
    !!config && trainCostTotal > ZERO_BIGINT && trainingAllowance < trainCostTotal;
  const hasBuildBalance =
    config?.buildCost === ZERO_BIGINT ||
    (buildTokenBalance ? buildTokenBalance.value >= (config?.buildCost ?? ZERO_BIGINT) : false);
  const hasTrainingBalance =
    trainCostTotal === ZERO_BIGINT ||
    (trainingTokenBalance ? trainingTokenBalance.value >= trainCostTotal : false);
  const canAttack =
    !!selectedTargetLandId &&
    !!parsedAttackTroops &&
    parsedAttackTroops <= availableToSend &&
    (!BARRACKS_PREVIEW_ENABLED || (!!preview && preview.statusCode === RAID_STATUS_OK));

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

  if (!landState.isBuilt) {
    return (
      <div className="space-y-4 pt-4 border-t border-border">
        <StandardContainer className="space-y-3">
          <div>
            <div className="text-sm font-semibold">Build Barracks</div>
            <div className="text-xs text-muted-foreground">
              Instant construction unlocks troop training and land raids.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <StatTile label="Build Cost" value={`${buildCostDisplay} ${buildTokenSymbol}`} />
            <StatTile
              label="Your Balance"
              value={`${buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : "..."} ${buildTokenSymbol}`}
              hint={hasBuildBalance ? "Ready" : "Insufficient"}
            />
          </div>

          {!config.enabled ? (
            <DisabledTransaction buttonText="Barracks Disabled" buttonClassName="w-full" />
          ) : needsBuildApproval ? (
            <ApproveTransaction
              spenderAddress={LAND_CONTRACT_ADDRESS}
              tokenAddress={config.buildToken as `0x${string}`}
              buttonText={`Approve ${buildTokenSymbol}`}
              buttonClassName="w-full"
              onSuccess={async () => {
                toast.success(`${buildTokenSymbol} approved`);
                await refreshAfterApproval("build");
              }}
              onError={(error) => toast.error(`Approval failed: ${error.message || error}`)}
            />
          ) : !hasBuildBalance ? (
            <DisabledTransaction
              buttonText={`Insufficient ${buildTokenSymbol}`}
              buttonClassName="w-full"
            />
          ) : (
            <SponsoredTransaction
              calls={[buildBarracksBuildCall(landId)]}
              buttonText={`Build Barracks (${buildCostDisplay} ${buildTokenSymbol})`}
              buttonClassName="w-full"
              disabled={!config.enabled}
              onSuccess={async () => {
                toast.success("Barracks built");
                await refreshAfterSuccess();
              }}
              onError={(error) => toast.error(`Build failed: ${error.message || error}`)}
            />
          )}
        </StandardContainer>
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-4 border-t border-border">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Barracks</div>
          <div className="text-xs text-muted-foreground">
            Train troops, raid lands, and review the latest reports.
          </div>
        </div>
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${config.enabled ? "text-primary" : "text-muted-foreground"}`}>
          {config.enabled ? "Operational" : "Disabled"}
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
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Ready / Training"
              value={
                <span className="inline-flex items-center gap-2">
                  <TroopCount type="swordsman" amount={availableToSend} />
                  <span className="text-muted-foreground">/</span>
                  <TroopCount type="swordsman" amount={landState.trainingQueueAmount} />
                </span>
              }
              hint={
                landState.trainingQueueAmount > ZERO_BIGINT
                  ? `Ready in: ${formatRemaining(landState.trainingEndsAt)}`
                  : "Queue empty"
              }
            />
            <StatTile
              label="Training Pace"
              value={formatDuration(Number(config.trainingTimePerTroop))}
              hint="Per troop"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 items-center">
            <Input
              value={trainAmount}
              onChange={(event) => setTrainAmount(event.target.value)}
              placeholder="Troops"
              inputMode="numeric"
              className="h-10"
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <TroopCount type="swordsman" amount="" withName />
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
          ) : landState.trainingQueueAmount > ZERO_BIGINT ? (
            <DisabledTransaction buttonText="Training Queue Active" buttonClassName="w-full" />
          ) : needsTrainingApproval ? (
            <ApproveTransaction
              spenderAddress={LAND_CONTRACT_ADDRESS}
              tokenAddress={config.trainingToken as `0x${string}`}
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
              calls={[buildBarracksTrainCall(landId, parsedTrainAmount)]}
              buttonText={`Train ${parsedTrainAmount.toString()} Swordsman`}
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
                      {targetsLoading ? "Loading targets..." : "No eligible raid targets"}
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
            ) : eligibleTargets.length === 0 && !targetsLoading ? (
              <div className="text-xs text-muted-foreground">
                No raid targets are currently eligible. The list already filters Barracks status, cooldowns, and raidable production.
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="relative">
              <Input
                value={attackTroops}
                onChange={(event) => setAttackTroops(event.target.value)}
                placeholder="Troops to send"
                inputMode="numeric"
                className="h-10 pr-16"
              />
              <button
                type="button"
                onClick={() => setAttackTroops(availableToSend.toString())}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md bg-muted px-2 py-0.5 text-xs hover:bg-accent"
              >
                Max
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Available troops</span>
              <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                <TroopCount type="swordsman" amount={availableToSend} withName />
              </span>
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
                      <div className="text-muted-foreground">Projected losses</div>
                      <div className="font-semibold">
                        {preview.attackerTroopsLost.toString()} / {preview.defenderTroopsLost.toString()}
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
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Choose an eligible target land and enter troop count to preview the raid.
                </div>
              )}
            </div>
          ) : null}

          {canAttack && selectedTargetLandId && parsedAttackTroops ? (
            <SponsoredTransaction
              calls={[buildBarracksAttackCall(landId, selectedTargetLandId, parsedAttackTroops)]}
              buttonText={`Raid Land #${selectedTargetLandId.toString()}`}
              buttonClassName="w-full"
              onSuccess={async () => {
                toast.success("Raid resolved");
                setAttackTroops("");
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
