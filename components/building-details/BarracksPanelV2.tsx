"use client";
import { TokenAmount } from '@/components/ui/token-amount';
import { BackgroundRefresh } from '@/components/ui/background-refresh';

import { useBarracksSnapshot } from "@/hooks/useBarracksSnapshot";
import { useBarracksRaidPreview } from '@/hooks/useBarracksRaidPreview';
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
import { PurchaseReadinessNotice } from './purchase-readiness-notice';
import { getBuildingPurchaseReadiness } from '@/lib/building-purchase-readiness';
import { formatTokenCost, formatTokenSymbol } from '@/lib/token-display';
import ApproveTransaction from "@/components/transactions/approve-transaction";
import { useBuildingApproval } from '@/hooks/useBuildingApproval';
import DisabledTransaction from "@/components/transactions/disabled-transaction";
import GameTransaction from "@/components/transactions/game-transaction";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import {
  LAND_CONTRACT_ADDRESS,
  barracksGetEligibleAttackableLandIds,
  barracksGetConfigV2,
  buildBarracksAttackCallV2,
  buildBarracksBuildCall,
  buildBarracksTrainCallV2,
  checkBarracksApproval,
  getLandsByIds,
} from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import { dispatchPostTransactionRefresh } from "@/lib/transaction-refresh";
import type {
  BarracksTroopId,
  BuildingData,
  Land,
} from "@/lib/types";
import {
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
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
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
      {withRole ? <span className="text-xs text-muted-foreground">{troop.role}</span> : null}
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
  const { config, landState, lastOutgoingReport, lastIncomingReport, loading, error: snapshotError, loadedStateLandId, loadState } = useBarracksSnapshot({ landId });
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetsLoadedLandId, setTargetsLoadedLandId] = useState<bigint | null>(null);
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
  const [allowancesError, setAllowancesError] = useState<string | null>(null);
  const trainAmountInputId = useId();
  const trainAmountHelpId = useId();
  const attackSwordsmenInputId = useId();
  const attackPhalanxInputId = useId();
  const normalizedAddress = address?.toLowerCase() ?? "disconnected";
  const approval = useBuildingApproval(`${landId}:${normalizedAddress}`);
  const currentLandIdRef = useRef(landId);
  const allowanceRequestRef = useRef(0);
  const targetsRequestRef = useRef(0);
  const targetsInFlightRef = useRef<bigint | null>(null);
  currentLandIdRef.current = landId;

  const buildTokenAddress = config?.buildToken;
  const selectedTrainConfig = getTroopConfig(config, selectedTrainTroop);
  const trainingTokenAddress = selectedTrainConfig?.trainingToken;
  const allowanceIdentity = `${landId.toString()}:${normalizedAddress}:${buildTokenAddress ?? "none"}:${trainingTokenAddress ?? "none"}`;
  const currentAllowanceIdentityRef = useRef(allowanceIdentity);
  currentAllowanceIdentityRef.current = allowanceIdentity;
  const allowancesAreCurrent = loadedAllowanceIdentity === allowanceIdentity;
  const currentBuildAllowance = allowancesAreCurrent ? buildAllowance : undefined;
  const currentTrainingAllowance = allowancesAreCurrent ? trainingAllowance : undefined;
  const buildTokenMetadata = useTokenMetadata(buildTokenAddress);
  const trainingTokenMetadata = useTokenMetadata(trainingTokenAddress);
  const buildTokenSymbol = formatTokenSymbol(buildTokenMetadata.symbol);
  const trainingTokenSymbol = formatTokenSymbol(trainingTokenMetadata.symbol);
  const formatBuildAmount = (amount: bigint) => buildTokenMetadata.isReady && buildTokenMetadata.decimals !== undefined
    ? formatTokenCost(amount, buildTokenMetadata.decimals) : '—';

  const { data: buildTokenBalance, isError: buildBalanceError, refetch: refreshBuildBalance } = useBalance({
    address,
    token:
      buildTokenAddress && buildTokenAddress !== ZERO_ADDRESS
        ? (buildTokenAddress as `0x${string}`)
        : undefined,
    query: {
      enabled: !!address && !!buildTokenAddress && buildTokenAddress !== ZERO_ADDRESS,
    },
  });

  const { data: trainingTokenBalance, isError: trainingBalanceError, refetch: refreshTrainingBalance } = useBalance({
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
  const { preview, error: previewError, isLoading: previewLoading, requireReady: requirePreviewReady, refresh: refreshPreview } = useBarracksRaidPreview({
    enabled: BARRACKS_PREVIEW_ENABLED && activeTab === 'raid' && !!config?.enabled && !!landState?.isBuilt,
    owner: address, landId, targetLandId: selectedTargetLandId,
    swordsmen: parsedAttackSwordsmen, phalanx: parsedAttackPhalanx, currentBlock,
  });

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
    setAllowancesError(null);
    if (!address || !buildTokenAddress || !trainingTokenAddress) {
      setLoadedAllowanceIdentity(null);
      setAllowancesError('Approval status could not be checked.');
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
      setAllowancesError('Approval status could not be checked.');
      setLoadedAllowanceIdentity(null);
      return { build: ZERO_BIGINT, training: ZERO_BIGINT };
    }
  }, [address, allowanceIdentity, buildTokenAddress, trainingTokenAddress]);

  const loadTargets = useCallback(async () => {
    const requestLandId = landId;
    if (currentLandIdRef.current !== requestLandId) return;
    if (targetsInFlightRef.current === requestLandId) return;
    const requestId = ++targetsRequestRef.current;
    if (!config?.enabled || !landState?.isBuilt) {
      setEligibleTargets([]);
      setSelectedTargetLandId(null);
      setTargetsError(null);
      setTargetsLoading(false);
      return;
    }

    try {
      targetsInFlightRef.current = requestLandId;
      setTargetsLoading(true);
      setTargetsError(null);

      const targetIds = await barracksGetEligibleAttackableLandIds(landId);
      const targetLands = targetIds.length > 0 ? await getLandsByIds(targetIds) : [];
      if (
        requestId !== targetsRequestRef.current
        || currentLandIdRef.current !== requestLandId
      ) return;

      setEligibleTargets(targetLands);
      setTargetsLoadedLandId(requestLandId);
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
      setTargetsError("Unable to load eligible targets right now.");
    } finally {
      if (
        requestId === targetsRequestRef.current
        && currentLandIdRef.current === requestLandId
      ) {
        targetsInFlightRef.current = null;
        setTargetsLoading(false);
      }
    }
  }, [config?.enabled, landId, landState?.isBuilt]);

  useEffect(() => {
    targetsRequestRef.current += 1;
    targetsInFlightRef.current = null;
    setEligibleTargets([]);
    setTargetsLoadedLandId(null);
    setSelectedTargetLandId(null);
    setTargetsError(null);
    setTargetsLoading(false);
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
    const interval = setInterval(() => { void loadTargets(); }, 30_000);
    return () => clearInterval(interval);
  }, [activeTab, loadTargets]);

  useEffect(() => {
    if (activeTab === 'history') void loadState(false, true);
  }, [activeTab, loadState]);

  useEffect(() => {
    if (!hasLiveCountdown) return;

    const countdownInterval = setInterval(() => {
      setCountdownTick((current) => current + 1);
    }, 1000);

    return () => {
      clearInterval(countdownInterval);
    };
  }, [hasLiveCountdown]);

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

  const buildReadiness = getBuildingPurchaseReadiness({ cost: config?.buildCost ?? ZERO_BIGINT,
    balance: buildTokenBalance?.value, balanceError: buildBalanceError,
    allowance: currentBuildAllowance, allowanceError: allowancesError });
  const trainingReadiness = getBuildingPurchaseReadiness({ cost: trainCostTotal,
    balance: trainingTokenBalance?.value, balanceError: trainingBalanceError,
    allowance: currentTrainingAllowance, allowanceError: allowancesError });
  const featureAvailable = !!config?.enabled && !snapshotError;
  const requireFeatureAvailable = async (action: 'build' | 'train' | 'raid') => {
    const scope = allowanceIdentity;
    const fresh = await barracksGetConfigV2();
    if (currentAllowanceIdentityRef.current !== scope) throw new Error('Your land or wallet changed. Review the action again.');
    if (!fresh?.enabled) {
      void loadState(false, false);
      throw new Error('Barracks is currently unavailable. Your troops and reports are still safe to inspect.');
    }
    const freshTraining = getTroopConfig(fresh, selectedTrainTroop);
    if ((action === 'build' && (fresh.buildCost !== config?.buildCost || fresh.buildToken !== config?.buildToken))
      || (action === 'train' && (freshTraining?.trainingCost !== selectedTrainConfig?.trainingCost
        || freshTraining?.trainingToken !== trainingTokenAddress
        || freshTraining?.trainingTimePerTroop !== selectedTrainConfig?.trainingTimePerTroop))) {
      void loadState(false, false);
      throw new Error('Barracks terms changed. Review the updated cost and duration before continuing.');
    }
  };
  const attackInputsValid = parsedAttackSwordsmen !== null && parsedAttackPhalanx !== null;
  const canAttack =
    featureAvailable && !!landState?.isBuilt &&
    !!selectedTargetLandId &&
    attackInputsValid &&
    totalRequestedToAttack > ZERO_BIGINT &&
    (parsedAttackSwordsmen ?? ZERO_BIGINT) <= availableSwordsmenToSend &&
    (parsedAttackPhalanx ?? ZERO_BIGINT) <= availablePhalanxToSend &&
    (!BARRACKS_PREVIEW_ENABLED || (!previewLoading && !!preview && preview.statusCode === RAID_STATUS_OK));
  const attackCooldownEndsAt = landState?.attackCooldownEndsAt ?? ZERO_BIGINT;
  const attackCooldownActive = secondsUntil(attackCooldownEndsAt) > 0;
  const emptyRaidTargetMessage = attackCooldownActive
    ? `Cannot attack for ${formatRemaining(attackCooldownEndsAt)}`
    : "You cannot attack right now";

  if (loadedStateLandId !== landId || (loading && !config && !landState)) {
    return (
      <ResourceState status="loading" title="Loading Barracks…" description="Checking troops and current rules." className="min-h-32" />
    );
  }

  if (!config || !landState) {
    return (
      <ResourceState status="error" title="Barracks data is unavailable" description="Try loading your troops and reports again." onRetry={() => { void loadState(); }} />
    );
  }

  const buildCostDisplay = formatBuildAmount(config.buildCost);
  const selectedTroopOption = getTroopOption(selectedTrainTroop);
  const buildApprovalToken = approval.active?.action === 'build' ? approval.active.token : config.buildToken as `0x${string}`;
  const buildApprovalLabel = approval.active?.action === 'build' ? approval.active.label : `Approve ${buildTokenSymbol} to Build`;
  const buildApproval = <ApproveTransaction disabled={approval.active?.settled} spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={buildApprovalToken}
    buttonText={buildApprovalLabel} buttonClassName="w-full"
    onStatusUpdate={approval.observe('build', buildApprovalToken, buildApprovalLabel)}
    onSuccess={async () => { await refreshAfterApproval('build'); }} />;
  const trainingApprovalToken = approval.active?.action === 'training' ? approval.active.token : trainingTokenAddress as `0x${string}`;
  const trainingApprovalLabel = approval.active?.action === 'training' ? approval.active.label : `Approve ${trainingTokenSymbol}`;
  const trainingApproval = <ApproveTransaction disabled={approval.active?.settled} spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={trainingApprovalToken}
    buttonText={trainingApprovalLabel} buttonClassName="w-full"
    onStatusUpdate={approval.observe('training', trainingApprovalToken, trainingApprovalLabel)}
    onSuccess={async () => { await refreshAfterApproval('training'); }} />;

  if (!landState.isBuilt || approval.active?.action === 'build') {
    return (
      <div className="space-y-4">
        {snapshotError && <ResourceState status="error" title="Barracks status unavailable" description="Retry the status check before building." onRetry={() => { void loadState(); }} />}
        <div className="space-y-2">
          <div className="text-muted-foreground text-sm">
            Build a Barracks to train troops and raid nearby lands.
          </div>
        </div>

        <div className="surface-subpanel space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/95 bg-[image:var(--gradient-surface)] p-4">
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Build cost</h4>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Instant build</span>
              {buildTokenMetadata.isReady && buildTokenSymbol
                ? <TokenAmount amount={config.buildCost} decimals={buildTokenMetadata.decimals} unit={buildTokenSymbol} mode="cost" className="ml-auto text-right font-semibold" />
                : <span className="ml-auto">—</span>}
            </div>
            {address && (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Your balance</span>
                {buildTokenBalance && !buildBalanceError && buildTokenMetadata.isReady && buildTokenSymbol
                  ? <TokenAmount amount={buildTokenBalance.value} decimals={buildTokenMetadata.decimals} unit={buildTokenSymbol} className={`ml-auto text-right font-medium ${buildReadiness === 'insufficient' ? 'text-destructive' : ''}`} />
                  : <span className="ml-auto">—</span>}
              </div>
            )}
          </div>

          <div className="space-y-2">
            {approval.active?.action === 'build' ? buildApproval : !featureAvailable ? (
              <Button className="w-full" variant="secondary" disabled>
                Barracks disabled
              </Button>
            ) : !address ? (
              <Button className="w-full" variant="secondary" disabled>
                Connect wallet to build
              </Button>
            ) : !buildTokenMetadata.isReady ? (
              <ResourceState status={buildTokenMetadata.isError ? 'error' : 'loading'} title={buildTokenMetadata.isError ? 'Build token details unavailable' : 'Checking build token…'} description="The price must be verified before approving or building." onRetry={() => { void buildTokenMetadata.refetch(); }} />
            ) : buildReadiness !== 'ready' && buildReadiness !== 'approval_required' ? (
              <PurchaseReadinessNotice state={buildReadiness} symbol={buildTokenSymbol} cost={config.buildCost}
                balance={buildTokenBalance?.value} decimals={buildTokenMetadata.decimals}
                onRetryBalance={() => { void refreshBuildBalance(); }} onRetryAllowance={() => { void loadAllowances(); }} />
            ) : buildReadiness === 'approval_required' ? (
              buildApproval
            ) : (
              <GameTransaction
                effects={{ domains: ["buildings", "lands", "balances"] }}
                intentKey={`barracks:build:${landId}`}
                calls={[buildBarracksBuildCall(landId)]}
                buttonText={`Build (${buildCostDisplay} ${buildTokenSymbol})`}
                buttonClassName="w-full"
                disabled={!featureAvailable || !buildTokenMetadata.isReady || buildReadiness !== 'ready'}
                onButtonClick={() => requireFeatureAvailable('build')}
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
    <div className="space-y-4">
      {snapshotError ? <ResourceState status="error" title="Barracks status unavailable" description="Showing your last checked troops and reports. Retry before building, training or raiding." onRetry={() => { void loadState(); }} />
        : !config.enabled ? <ResourceState status="empty" title="Barracks is paused" description="Building, training and raids are currently unavailable. You can still inspect troops and reports." /> : null}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          Train Swordsmen and Phalanx, raid lands, and review the latest reports.
        </p>
        {config.enabled && <p className="shrink-0 text-xs font-medium text-primary">
          Defense +{formatPercentFromBps(homeDefenseBonusBps)}
        </p>}
      </div>

      <fieldset disabled={!!approval.active}>
      <ToggleGroup
        ariaLabel="Barracks section"
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as BarracksTab)}
        options={[
          { value: "train", label: "Train" },
          { value: "raid", label: "Raid" },
          { value: "history", label: "Latest reports" },
        ]}
        className="w-full justify-between"
        getButtonClassName={() => "min-w-0 flex-1 justify-center whitespace-normal"}
      />
      </fieldset>

      {activeTab === "train" && (
        <div className={BARRACKS_SECTION_SURFACE_CLASS}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <StatTile
              label="Swordsmen ready"
              value={<TroopCount type="swordsman" amount={availableSwordsmenToSend} withName />}
              hint={`${landState.stationedSwordsmanTroops.toString()} stationed`}
            />
            <StatTile
              label="Phalanx ready"
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

          <fieldset disabled={!!approval.active} className="space-y-4">
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
          </fieldset>

          <div id={trainAmountHelpId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <TroopCount type={selectedTrainTroop} amount="" withName withRole />
            <span>Costs {trainingTokenMetadata.isReady && trainingTokenSymbol
              ? <TokenAmount amount={trainCostTotal} decimals={trainingTokenMetadata.decimals} unit={trainingTokenSymbol} mode="cost" />
              : '—'}</span>
          </div>

          {address && (
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm [overflow-wrap:anywhere]">
              <span className="text-muted-foreground">Your balance</span>
              {trainingTokenBalance && !trainingBalanceError && trainingTokenMetadata.isReady && trainingTokenSymbol
                ? <TokenAmount amount={trainingTokenBalance.value} decimals={trainingTokenMetadata.decimals} unit={trainingTokenSymbol} className={`ml-auto text-right font-medium ${trainingReadiness === 'insufficient' ? 'text-destructive' : ''}`} />
                : <span className="ml-auto">—</span>}
            </div>
          )}

          {approval.active?.action === 'training' ? trainingApproval : !featureAvailable ? (
            <DisabledTransaction buttonText="Training unavailable" buttonClassName="w-full" />
          ) : !address ? (
            <DisabledTransaction buttonText="Connect wallet to train" buttonClassName="w-full" />
          ) : !parsedTrainAmount ? (
            <DisabledTransaction buttonText="Enter Troop Amount" buttonClassName="w-full" />
          ) : trainingQueueActive ? (
            <DisabledTransaction buttonText="Training Queue Active" buttonClassName="w-full" />
          ) : !trainingTokenMetadata.isReady ? (
            <ResourceState status={trainingTokenMetadata.isError ? 'error' : 'loading'} title={trainingTokenMetadata.isError ? 'Training token details unavailable' : 'Checking training token…'} description="The price must be verified before approving or training." onRetry={() => { void trainingTokenMetadata.refetch(); }} />
          ) : trainingReadiness !== 'ready' && trainingReadiness !== 'approval_required' ? (
            <PurchaseReadinessNotice state={trainingReadiness} symbol={trainingTokenSymbol} cost={trainCostTotal}
              balance={trainingTokenBalance?.value} decimals={trainingTokenMetadata.decimals}
              onRetryBalance={() => { void refreshTrainingBalance(); }} onRetryAllowance={() => { void loadAllowances(); }} />
          ) : trainingReadiness === 'approval_required' ? (
            trainingApproval
          ) : (
            <GameTransaction
              effects={{ domains: ["buildings", "lands", "balances"] }}
              intentKey={`barracks:train:${landId}`}
              calls={[buildBarracksTrainCallV2(landId, troopNumericType(selectedTrainTroop), parsedTrainAmount)]}
              buttonText={`Train ${parsedTrainAmount.toString()} ${selectedTroopOption.name}`}
              buttonClassName="w-full"
              disabled={!featureAvailable || !trainingTokenMetadata.isReady || trainingReadiness !== 'ready'}
              onButtonClick={() => requireFeatureAvailable('train')}
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
              label="Attack cooldown"
              value={formatCooldownState(landState.attackCooldownEndsAt)}
              hint="Attack timer"
            />
            <StatTile
              label="Defense cooldown"
              value={formatCooldownState(landState.defenseCooldownEndsAt)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Select target</span>
              <span className="inline-flex items-center gap-1">
                <span>{attackCooldownActive ? 'Cooldown active' : `${eligibleTargets.length} available`}</span>
                <BackgroundRefresh active={targetsLoading} label="Refreshing eligible targets" />
              </span>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="h-12 w-full justify-between gap-3 text-left"
                  disabled={eligibleTargets.length === 0}
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
                      {targetsLoading && targetsLoadedLandId !== landId ? "Loading targets..." : emptyRaidTargetMessage}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent matchTriggerWidth className="[--menu-max-height:18rem] overflow-y-auto">
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
              <ResourceState status="error" title="Target refresh unavailable" description={`${targetsError} Any retained targets will be checked again before a raid.`} onRetry={() => { void loadTargets(); }} />
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
                <ResourceState status="error" title="Raid preview unavailable" description={previewError} onRetry={refreshPreview} />
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
                        {preview.attackerWon ? "Would win" : "Would lose"}
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
                        <span>(Includes the target&apos;s home defense bonus)</span>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">
                  {previewLoading ? 'Updating the preview for your selected target and troops…' : 'Choose an eligible target land and enter troop counts to preview the raid.'}
                </div>
              )}
            </div>
          ) : null}

          <GameTransaction
              effects={{ domains: ["buildings", "lands", "balances"] }}
              intentKey={`barracks:raid:${landId}`}
              calls={selectedTargetLandId && attackInputsValid ? [
                buildBarracksAttackCallV2(
                  landId,
                  selectedTargetLandId,
                  parsedAttackSwordsmen ?? ZERO_BIGINT,
                  parsedAttackPhalanx ?? ZERO_BIGINT,
                ),
              ] : []}
              disabled={!canAttack}
              onButtonClick={async () => {
                if (!canAttack) {
                  throw new Error('Your raid selection changed. Review the target and troops before submitting.');
                }
                await requireFeatureAvailable('raid');
                const freshTargets = await barracksGetEligibleAttackableLandIds(landId);
                if (!selectedTargetLandId || !freshTargets.includes(selectedTargetLandId)) {
                  void loadTargets();
                  throw new Error('This target is no longer available. Choose another land.');
                }
                if (BARRACKS_PREVIEW_ENABLED) requirePreviewReady();
              }}
              buttonText={canAttack && selectedTargetLandId ? `Raid Land #${selectedTargetLandId.toString()}` : previewLoading ? 'Updating raid preview…' : 'Raid Unavailable'}
              buttonClassName="w-full"
              onSuccess={async () => {

                setAttackSwordsmen("");
                setAttackPhalanx("");
                await refreshAfterRaidSuccess();
              }}
              onError={(error) => toast.error(getFriendlyErrorMessage(error))}
            />
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
