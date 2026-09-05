"use client";

import { useBarracksSnapshot } from "@/hooks/useBarracksSnapshot";
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useAccount, useBalance } from "wagmi";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AmountField } from "@/components/ui/amount-field";
import { ResourceState } from "@/components/ui/resource-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { InlineBalanceNotice } from "@/components/ui/premium";
import ApproveTransaction from "@/components/transactions/approve-transaction";
import DisabledTransaction from "@/components/transactions/disabled-transaction";
import GameTransaction from "@/components/transactions/game-transaction";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useTokenSymbol } from "@/hooks/useTokenSymbol";
import {
  LAND_CONTRACT_ADDRESS,
  barracksGetEligibleAttackableLandIds,
  barracksPreviewRaidV2,
  buildBarracksAttackCallV2,
  buildBarracksBuildCall,
  buildBarracksTrainCallV2,
  checkBarracksApproval,
  getLandsByIds,
} from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import { dispatchPostTransactionRefresh } from "@/lib/transaction-refresh";
import type {
  BarracksRaidPreviewV2,
  BarracksTroopId,
  BuildingData,
  Land,
} from "@/lib/types";
import {
  formatTokenAmount,
  getFriendlyErrorMessage,
} from "@/lib/utils";
import { BarracksReportCard, type ReportMode } from './barracks-report';
import { BarracksBattleTable as BattleReportTable } from './barracks-battle-table';
import { TROOP_OPTIONS, getTroopOption, troopIdFromNumeric, troopNumericType, getTroopConfig, parsePositiveBigInt, parseOptionalBigInt, secondsUntil, formatRemaining, formatCooldownState, formatBarracksPoints, formatBarracksLifetime, formatDurationFromBigInt, formatQueueHint, formatPercentFromBps, getHomeDefenseBonusBps, formatLandLabel, formatCoordinates, getPreviewMessage } from '@/lib/barracks-view';
import { toast } from "react-hot-toast";

interface BarracksPanelV2Props {
  landId: bigint;
  currentBlock: bigint;
  onUpdate: () => void;
  villageBuildings: BuildingData[];
}

type BarracksTab = "train" | "raid" | "history";

const RAID_STATUS_OK = 0;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ZERO_BIGINT = BigInt(0);
const BARRACKS_PREVIEW_ENABLED = CLIENT_ENV.BARRACKS_PREVIEW_ENABLED;
const BARRACKS_SECTION_SURFACE_CLASS =
  "space-y-4 rounded-[var(--radius-panel)] bg-muted/25 p-4";
const BARRACKS_BUBBLE_SURFACE_CLASS =
  "min-w-0 rounded-[var(--radius-control)] bg-muted/30 p-3 [overflow-wrap:anywhere]";
const BARRACKS_COMPACT_BUBBLE_SURFACE_CLASS =
  "min-w-0 border-t border-border/60 py-3 [overflow-wrap:anywhere]";

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
    <div className={BARRACKS_BUBBLE_SURFACE_CLASS}>
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
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5 [overflow-wrap:anywhere]">
      <Image src={troop.icon} alt={troop.name} width={16} height={16} className="h-4 w-4 object-contain opacity-90" />
      {hasAmount ? <span>{typeof amount === "bigint" ? amount.toString() : amount}</span> : null}
      {withName ? <span className="text-xs font-medium text-muted-foreground">{troop.name}</span> : null}
      {withRole ? <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{troop.role}</span> : null}
    </span>
  );
}

export default function BarracksPanelV2({
  landId,
  currentBlock,
  onUpdate,
  villageBuildings,
}: BarracksPanelV2Props) {
  const { address } = useAccount();
  const { config, landState, lastOutgoingReport, lastIncomingReport, loading, loadedStateLandId, loadState } = useBarracksSnapshot({ landId, currentBlock });
  const [preview, setPreview] = useState<BarracksRaidPreviewV2 | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
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
  const [loadedAllowanceIdentity, setLoadedAllowanceIdentity] = useState<string | null>(null);
  const trainAmountInputId = useId();
  const trainAmountHelpId = useId();
  const attackSwordsmenInputId = useId();
  const attackPhalanxInputId = useId();
  const normalizedAddress = address?.toLowerCase() ?? "disconnected";
  const currentLandIdRef = useRef(landId);
  const allowanceRequestRef = useRef(0);
  const targetsRequestRef = useRef(0);
  currentLandIdRef.current = landId;

  const buildTokenAddress = config?.buildToken;
  const selectedTrainConfig = getTroopConfig(config, selectedTrainTroop);
  const trainingTokenAddress = selectedTrainConfig?.trainingToken;
  const allowanceIdentity = `${landId.toString()}:${normalizedAddress}:${buildTokenAddress ?? "none"}:${trainingTokenAddress ?? "none"}`;
  const currentAllowanceIdentityRef = useRef(allowanceIdentity);
  currentAllowanceIdentityRef.current = allowanceIdentity;
  const allowancesAreCurrent = loadedAllowanceIdentity === allowanceIdentity;
  const currentBuildAllowance = allowancesAreCurrent ? buildAllowance : ZERO_BIGINT;
  const currentTrainingAllowance = allowancesAreCurrent ? trainingAllowance : ZERO_BIGINT;
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

  const loadAllowances = useCallback(async () => {
    const requestIdentity = allowanceIdentity;
    if (currentAllowanceIdentityRef.current !== requestIdentity) {
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }
    const requestId = ++allowanceRequestRef.current;
    if (!address || !buildTokenAddress || !trainingTokenAddress) {
      setBuildAllowance(ZERO_BIGINT);
      setTrainingAllowance(ZERO_BIGINT);
      setLoadedAllowanceIdentity(requestIdentity);
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }

    try {
      const [nextBuildAllowance, nextTrainingAllowance] = await Promise.all([
        checkBarracksApproval(address, buildTokenAddress),
        checkBarracksApproval(address, trainingTokenAddress),
      ]);
      if (
        requestId !== allowanceRequestRef.current
        || currentAllowanceIdentityRef.current !== requestIdentity
      ) return { build: ZERO_BIGINT, training: ZERO_BIGINT };
      setBuildAllowance(nextBuildAllowance);
      setTrainingAllowance(nextTrainingAllowance);
      setLoadedAllowanceIdentity(requestIdentity);
      return { build: nextBuildAllowance, training: nextTrainingAllowance };
    } catch (error) {
      console.error("Failed to load barracks V2 approvals:", error);
      if (
        requestId !== allowanceRequestRef.current
        || currentAllowanceIdentityRef.current !== requestIdentity
      ) return { build: ZERO_BIGINT, training: ZERO_BIGINT };
      setBuildAllowance(ZERO_BIGINT);
      setTrainingAllowance(ZERO_BIGINT);
      setLoadedAllowanceIdentity(requestIdentity);
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }
  }, [address, allowanceIdentity, buildTokenAddress, trainingTokenAddress]);

  const loadTargets = useCallback(async () => {
    const requestLandId = landId;
    if (currentLandIdRef.current !== requestLandId) return;
    const requestId = ++targetsRequestRef.current;
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
      if (
        requestId !== targetsRequestRef.current
        || currentLandIdRef.current !== requestLandId
      ) return;

      setEligibleTargets(targetLands);
      setSelectedTargetLandId((current) =>
        current && targetLands.some((target) => target.tokenId === current)
          ? current
          : (targetLands[0]?.tokenId ?? null),
      );
    } catch (error) {
      console.error("Failed to load barracks V2 targets:", error);
      if (
        requestId !== targetsRequestRef.current
        || currentLandIdRef.current !== requestLandId
      ) return;
      setEligibleTargets([]);
      setSelectedTargetLandId(null);
      setTargetsError("Unable to load eligible targets right now.");
    } finally {
      if (
        requestId === targetsRequestRef.current
        && currentLandIdRef.current === requestLandId
      ) setTargetsLoading(false);
    }
  }, [config?.enabled, landId, landState?.isBuilt]);

  useEffect(() => {
    targetsRequestRef.current += 1;
    setEligibleTargets([]);
    setSelectedTargetLandId(null);
    setTargetsError(null);
    setTargetsLoading(false);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setAttackSwordsmen("");
    setAttackPhalanx("");

    return () => {
      targetsRequestRef.current += 1;
    };
  }, [landId]);


  useEffect(() => {
    allowanceRequestRef.current += 1;
    setLoadedAllowanceIdentity(null);
    setBuildAllowance(ZERO_BIGINT);
    setTrainingAllowance(ZERO_BIGINT);
    void loadAllowances();
    return () => {
      allowanceRequestRef.current += 1;
    };
  }, [allowanceIdentity, loadAllowances]);

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
    dispatchPostTransactionRefresh(["buildings:refresh"], undefined, {
      address,
      source: "barracks",
    });
  }, [address, onUpdate]);

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

  const needsBuildApproval =
    !!config && config.buildCost > ZERO_BIGINT && currentBuildAllowance < config.buildCost;
  const needsTrainingApproval =
    !!selectedTrainConfig && trainCostTotal > ZERO_BIGINT && currentTrainingAllowance < trainCostTotal;
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

  if (loadedStateLandId !== landId || (loading && !config && !landState)) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!config || !landState) {
    return (
      <ResourceState status="error" title="Barracks data is unavailable" description="Try loading your troops and reports again." onRetry={() => { void loadState(); }} />
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

        <div className="building-subpanel-surface space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] p-4">
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

                  await refreshAfterApproval("build");
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
              />
            ) : !hasBuildBalance ? (
              <>
                <DisabledTransaction buttonText={`Insufficient ${buildTokenSymbol} Balance`} buttonClassName="w-full" />
                <InlineBalanceNotice>
                  Not enough {buildTokenSymbol}. Balance: {buildTokenBalance ? formatTokenAmount(buildTokenBalance.value, buildTokenDecimals) : "..."} • Required: {buildCostDisplay}
                </InlineBalanceNotice>
              </>
            ) : (
              <GameTransaction
                effects={{ domains: ["buildings", "lands", "balances"] }}
                intentKey={`barracks:build:${landId}`}
                calls={[buildBarracksBuildCall(landId)]}
                buttonText={`Build (${buildCostDisplay} ${buildTokenSymbol})`}
                buttonClassName="w-full"
                disabled={!config.enabled}
                onSuccess={async () => {

                  await refreshAfterSuccess();
                }}
                onError={(error) => toast.error(getFriendlyErrorMessage(error))}
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
        ariaLabel="Barracks section"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BarracksTab)}
        options={[
          { value: "train", label: "Train" },
          { value: "raid", label: "Raid" },
          { value: "history", label: "History" },
        ]}
        className="w-full justify-between"
        getButtonClassName={() => "flex-1 justify-center"}
      />

      {activeTab === "train" && (
        <div className={BARRACKS_SECTION_SURFACE_CLASS}>
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
                ? formatQueueHint(queueTroopOption.name, landState.trainingEndsAt)
                : "One training queue shared across both troop types"
            }
          />

          <ToggleGroup
            ariaLabel="Troop to train"
            value={selectedTrainTroop}
            onValueChange={(value) => setSelectedTrainTroop((value as BarracksTroopId) || "swordsman")}
            options={TROOP_OPTIONS.map((troop) => ({
              value: troop.id,
              label: troop.name,
            }))}
            className="w-full justify-between"
            getButtonClassName={() => "flex-1 justify-center"}
          />

            <AmountField
              id={trainAmountInputId}
              label="Number to train"
              unit="troops"
              value={trainAmount}
              onChange={(event) => setTrainAmount(event.target.value)}
              inputMode="numeric"
              aria-describedby={trainAmountHelpId}
              hint={trainDurationDisplay ? `Training time: ${trainDurationDisplay}` : undefined}
              error={trainAmount && !parsedTrainAmount ? 'Enter a positive whole number of troops.' : undefined}
            />

          <div id={trainAmountHelpId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <TroopCount type={selectedTrainTroop} amount="" withName withRole />
            <span className="[overflow-wrap:anywhere]">Costs {trainingCostDisplay} {trainingTokenSymbol}</span>
          </div>

          {address && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm [overflow-wrap:anywhere]">
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

                await refreshAfterApproval("training");
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
            />
          ) : !hasTrainingBalance ? (
            <>
              <DisabledTransaction
                buttonText={`Insufficient ${trainingTokenSymbol} Balance`}
                buttonClassName="w-full"
              />
              <InlineBalanceNotice>
                Not enough {trainingTokenSymbol}. Balance: {trainingTokenBalance ? formatTokenAmount(trainingTokenBalance.value, trainingTokenDecimals) : "..."} • Required: {formatTokenAmount(trainCostTotal, trainingTokenDecimals)}
              </InlineBalanceNotice>
            </>
          ) : (
            <GameTransaction
              effects={{ domains: ["buildings", "lands", "balances"] }}
              intentKey={`barracks:train:${landId}`}
              calls={[buildBarracksTrainCallV2(landId, troopNumericType(selectedTrainTroop), parsedTrainAmount)]}
              buttonText={`Train ${parsedTrainAmount.toString()} ${selectedTroopOption.name}`}
              buttonClassName="w-full"
              onSuccess={async () => {

                await refreshAfterSuccess();
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
            />
          )}
        </div>
      )}

      {activeTab === "raid" && (
        <div className={BARRACKS_SECTION_SURFACE_CLASS}>
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
              <DropdownMenuContent matchTriggerWidth className=" max-h-72 overflow-y-auto">
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
                <AmountField
                  id={attackSwordsmenInputId}
                  label="Swordsmen to send"
                  unit="troops"
                  value={attackSwordsmen}
                  onChange={(event) => setAttackSwordsmen(event.target.value)}
                  inputMode="numeric"
                  balance={availableSwordsmenToSend.toString()}
                  onMax={() => setAttackSwordsmen(availableSwordsmenToSend.toString())}
                  maxLabel="Use all available swordsmen"
                  maxDisabled={availableSwordsmenToSend === BigInt(0)}
                  error={parsedAttackSwordsmen === null ? 'Enter a whole number of troops.' : parsedAttackSwordsmen > availableSwordsmenToSend ? 'Not enough swordsmen available.' : undefined}
                />
                <AmountField
                  id={attackPhalanxInputId}
                  label="Phalanx to send"
                  unit="troops"
                  value={attackPhalanx}
                  onChange={(event) => setAttackPhalanx(event.target.value)}
                  inputMode="numeric"
                  balance={availablePhalanxToSend.toString()}
                  onMax={() => setAttackPhalanx(availablePhalanxToSend.toString())}
                  maxLabel="Use all available phalanx"
                  maxDisabled={availablePhalanxToSend === BigInt(0)}
                  error={parsedAttackPhalanx === null ? 'Enter a whole number of troops.' : parsedAttackPhalanx > availablePhalanxToSend ? 'Not enough phalanx available.' : undefined}
                />
          </div>

          {BARRACKS_PREVIEW_ENABLED ? (
            <div className={`${BARRACKS_BUBBLE_SURFACE_CLASS} space-y-2`}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Preview</div>
                {previewLoading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>

              {previewError ? (
                <div className="text-sm text-destructive">{previewError}</div>
              ) : preview ? (
                <div className="space-y-3 mt-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {preview.statusCode === RAID_STATUS_OK ? "Projected Outcome" : "Raid Unavailable"}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {getPreviewMessage(preview)}
                      </div>
                    </div>
                    {preview.statusCode === RAID_STATUS_OK && (
                      <div className={`text-xs font-semibold ${preview.attackerWon ? "text-[hsl(var(--success-strong))]" : "text-destructive"}`}>
                        {preview.attackerWon ? "Won" : "Lost"}
                      </div>
                    )}
                  </div>

                  <div className="space-y-3">
                    <BattleReportTable
                      label="Attacker"
                      landId={landId}
                      swordsmenSent={preview.swordsmenRequested}
                      phalanxSent={preview.phalanxRequested}
                      swordsmenLost={preview.attackerSwordsmenLost}
                      phalanxLost={preview.attackerPhalanxLost}
                    />
                    <BattleReportTable
                      label="Defender"
                      landId={selectedTargetLandId || undefined}
                      swordsmenSent={preview.defenderSwordsmenBefore}
                      phalanxSent={preview.defenderPhalanxBefore}
                      swordsmenLost={preview.defenderSwordsmenLost}
                      phalanxLost={preview.defenderPhalanxLost}
                    />
                  </div>

                  {preview.statusCode === RAID_STATUS_OK && (
                    <>
                      <div className={BARRACKS_COMPACT_BUBBLE_SURFACE_CLASS}>
                        <span className="font-semibold">Estimated Loot:</span>{" "}
                        <span className="text-primary">{formatBarracksPoints(preview.estimatedPointsLoot)} PTS</span>
                        <span className="text-muted-foreground"> / </span>
                        <span className="text-primary">{formatBarracksLifetime(preview.estimatedLifetimeLoot)} lifetime</span>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span>Power: {preview.attackerPower.toString()} vs {preview.defenderPower.toString()}</span>
                        <span>(Includes 10% home base bonus)</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  Choose an eligible target land and enter troop counts to preview the raid.
                </div>
              )}
            </div>
          ) : null}

          {canAttack && selectedTargetLandId && attackInputsValid ? (
            <GameTransaction
              effects={{ domains: ["buildings", "lands", "balances"] }}
              intentKey={`barracks:raid:${landId}`}
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

                setAttackSwordsmen("");
                setAttackPhalanx("");
                await refreshAfterRaidSuccess();
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
            />
          ) : (
            <DisabledTransaction buttonText="Raid Unavailable" buttonClassName="w-full" />
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="space-y-3">
          <ToggleGroup
            ariaLabel="Battle report"
            value={reportView}
            onValueChange={(value) => setReportView(value as ReportMode)}
            options={[
              { value: "outgoing", label: "Last Attack" },
              { value: "incoming", label: "Last Defense" },
            ]}
            className="w-full justify-between"
            getButtonClassName={() => "flex-1 justify-center"}
          />

          <BarracksReportCard
            previewEnabled={BARRACKS_PREVIEW_ENABLED}
            onRetry={() => { void loadState(false); }}
            report={reportView === "outgoing" ? lastOutgoingReport : lastIncomingReport}
            mode={reportView}
          />
        </div>
      )}
    </div>
  );
}
