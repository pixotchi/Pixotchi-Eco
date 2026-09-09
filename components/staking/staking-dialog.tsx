"use client";
import { ResourceValue } from '@/components/ui/resource-value';

import { parseAmountInput } from "@/lib/amount-input";
import { getEconomicReadState } from "@/lib/economic-read-state";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from "@/components/ui/button";
import { AmountField } from "@/components/ui/amount-field";
import { RefreshIcon } from "@/components/ui/refresh-icon";
import {
  buildApproveStakeCall,
  buildClaimRewardsCall,
  buildStakeCall,
  buildUnstakeCall,
} from "@/lib/contracts";
import GameTransaction from "@/components/transactions/game-transaction";
import Image from "next/image";
import { formatTokenAmount } from "@/lib/utils";
import { formatUnits } from "viem";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';
import { onBalanceRefresh } from '@/lib/app-events';

type StakingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type BalanceApiResponse = {
  success: boolean;
  balance: string;
  error?: string;
};

type StakingApiResponse = {
  success: boolean;
  stake: { staked: string; rewards: string } | null;
  approved: boolean;
  rewardRatio?: { numerator: string; denominator: string } | null;
  timeUnit?: string | null;
  totalStaked?: string | null;
  error?: string;
};

const getPeriodLabel = (seconds: number): string => {
  const day = 86400;
  const hour = 3600;
  const minute = 60;

  if (seconds === day) return "day";
  if (seconds === hour) return "hour";
  if (seconds === minute) return "minute";
  if (seconds === 7 * day) return "7 days";
  if (seconds === 30 * day) return "30 days";
  if (seconds % day === 0) return `${seconds / day} days`;
  if (seconds % hour === 0) return `${seconds / hour} hours`;
  if (seconds % minute === 0) return `${seconds / minute} minutes`;
  if (seconds === 1) return "second";
  return `${seconds} seconds`;
};

const formatRewardDisplay = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 0.0001) return "<0.0001";
  const minimumFractionDigits = value >= 1 ? 2 : 0;
  const maximumFractionDigits = value < 1 ? 4 : 2;
  return value.toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  });
};

// Grouped, capped fraction digits, BigInt-safe — the dialog used to mix an
// ungrouped toFixed(4) here with toLocaleString for "Total staked" in the same
// card stack (and parseFloat loses precision above 2^53).
function formatToken(amount?: bigint): string {
  if (!amount) return "0";
  return formatTokenAmount(amount);
}

const MIN_REFRESH_INTERVAL_MS = 1000;
const MIN_REFRESH_FEEDBACK_MS = 650;
const stakingTileClassName = "surface-inset min-w-0 rounded-[var(--radius-control)] p-3 [overflow-wrap:anywhere]";

export default function StakingDialog({ open, onOpenChange }: StakingDialogProps) {
  const { address } = useAccount();
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [stakeInfo, setStakeInfo] = useState<{ staked: bigint; rewards: bigint } | null>(null);
  const [approved, setApproved] = useState<boolean>(false);
  const [amount, setAmount] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [rewardRatio, setRewardRatio] = useState<{ numerator: bigint; denominator: bigint } | null>(null);
  const [rewardTimeUnit, setRewardTimeUnit] = useState<bigint | null>(null);
  const [totalStaked, setTotalStaked] = useState<bigint | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [snapshotOwner, setSnapshotOwner] = useState<string | null>(null);
  const [snapshotFresh, setSnapshotFresh] = useState(false);
  const [missionTrackingMessage, setMissionTrackingMessage] = useState<string | null>(null);
  const refreshGenerationRef = useRef(0);
  const refreshRequestRef = useRef<{
    address: string;
    controller: AbortController;
    generation: number;
  } | null>(null);
  const lastRefreshTime = useRef<number>(0);
  const hasLoadedSnapshotRef = useRef(false);
  const previousAddressRef = useRef<string | null>(null);
  const missionTrackingGenerationRef = useRef(0);
  const currentAddressRef = useRef(address?.toLowerCase() ?? null);
  const openRef = useRef(open);
  currentAddressRef.current = address?.toLowerCase() ?? null;
  openRef.current = open;

  const refresh = useCallback(async (options: { force?: boolean } = {}) => {
    const requestAddress = address?.toLowerCase();
    if (!requestAddress || !openRef.current) return;

    const activeRequest = refreshRequestRef.current;
    if (activeRequest) {
      if (!options.force && activeRequest.address === requestAddress) {
        return;
      }
      activeRequest.controller.abort();
    }
    
    // Rate limiting: prevent refreshes more frequent than MIN_REFRESH_INTERVAL_MS.
    // Post-transaction refreshes pass force so a confirmed write always replaces
    // the pre-transaction snapshot even when the dialog was refreshed recently.
    const now = Date.now();
    if (!options.force && now - lastRefreshTime.current < MIN_REFRESH_INTERVAL_MS) {
      return;
    }
    lastRefreshTime.current = now;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    const controller = new AbortController();
    refreshRequestRef.current = {
      address: requestAddress,
      controller,
      generation,
    };
    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      refreshGenerationRef.current === generation &&
      currentAddressRef.current === requestAddress &&
      openRef.current;

    setLoading(true);
    setSnapshotFresh(false);
    setRefreshError(null);
    
    try {
      // Use API routes for consistent RPC handling
      const [balanceHttpResponse, stakingHttpResponse] = await Promise.all([
        fetch(`/api/staking/balance?address=${encodeURIComponent(requestAddress)}`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
        fetch(`/api/staking/info?address=${encodeURIComponent(requestAddress)}`, {
          cache: 'no-store',
          signal: controller.signal,
        }),
      ]);

      if (!balanceHttpResponse.ok) {
        throw new Error(`Balance request failed (${balanceHttpResponse.status})`);
      }
      if (!stakingHttpResponse.ok) {
        throw new Error(`Staking request failed (${stakingHttpResponse.status})`);
      }

      const [balanceResponse, stakingResponse] = await Promise.all([
        balanceHttpResponse.json() as Promise<BalanceApiResponse>,
        stakingHttpResponse.json() as Promise<StakingApiResponse>,
      ]);
      
      if (balanceResponse.success !== true) {
        throw new Error(`Balance API error: ${balanceResponse.error}`);
      }
      
      if (stakingResponse.success !== true) {
        throw new Error(`Staking API error: ${stakingResponse.error}`);
      }

      if (!stakingResponse.stake || typeof stakingResponse.approved !== 'boolean') {
        throw new Error('Staking snapshot is incomplete');
      }
      if ([balanceResponse.balance, stakingResponse.stake.staked, stakingResponse.stake.rewards]
        .some(value => typeof value !== 'string' || !/^\d+$/.test(value))) {
        throw new Error('Staking snapshot contains an invalid amount');
      }
      const nextSeedBalance = BigInt(balanceResponse.balance);
      const nextStakeInfo = {
        staked: BigInt(stakingResponse.stake.staked),
        rewards: BigInt(stakingResponse.stake.rewards)
      };

      const ratioPayload = stakingResponse.rewardRatio ?? null;
      let nextRewardRatio: { numerator: bigint; denominator: bigint } | null = null;
      if (ratioPayload?.numerator && ratioPayload?.denominator) {
        try {
          nextRewardRatio = {
            numerator: BigInt(ratioPayload.numerator),
            denominator: BigInt(ratioPayload.denominator),
          };
        } catch {}
      }

      let nextRewardTimeUnit: bigint | null = null;
      if (stakingResponse.timeUnit) {
        try {
          nextRewardTimeUnit = BigInt(stakingResponse.timeUnit);
        } catch {}
      }

      let nextTotalStaked: bigint | null = null;
      if (stakingResponse.totalStaked) {
        try {
          nextTotalStaked = BigInt(stakingResponse.totalStaked);
        } catch {}
      }

      if (!isCurrentRequest()) {
        return;
      }

      // Commit one address-consistent snapshot. A slow response from the
      // previous wallet can no longer paint into the current wallet's dialog.
      setSeedBalance(nextSeedBalance);
      setStakeInfo(nextStakeInfo);
      setApproved(stakingResponse.approved);
      setRewardRatio(nextRewardRatio);
      setRewardTimeUnit(nextRewardTimeUnit);
      setTotalStaked(nextTotalStaked);
      setSnapshotOwner(requestAddress);
      setSnapshotFresh(true);
      hasLoadedSnapshotRef.current = true;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || !isCurrentRequest()) {
        return;
      }
      console.error('❌ Failed to refresh staking data:', error);
      // Keep the last-known values. Zeroing them here used to tell a real
      // holder they had 0 SEED / 0 staked, and flipping `approved` false
      // swapped the footer back to "Approve SEED for Staking" — inviting a
      // redundant on-chain approval over a transient API hiccup.
      setRefreshError(
        hasLoadedSnapshotRef.current
          ? 'Could not refresh staking data. Showing the last known values. Actions are paused until a refresh succeeds.'
          : 'Could not load staking data. Actions are paused until a refresh succeeds.',
      );
    } finally {
      if (refreshRequestRef.current?.generation === generation) {
        refreshRequestRef.current = null;
      }
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [address]);

  useEffect(() => {
    refreshGenerationRef.current += 1;
    refreshRequestRef.current?.controller.abort();
    refreshRequestRef.current = null;

    const normalizedAddress = address?.toLowerCase() ?? null;
    if (previousAddressRef.current !== normalizedAddress) {
      previousAddressRef.current = normalizedAddress;
      missionTrackingGenerationRef.current += 1;
      hasLoadedSnapshotRef.current = false;
      lastRefreshTime.current = 0;
      setSeedBalance(BigInt(0));
      setStakeInfo(null);
      setApproved(false);
      setRewardRatio(null);
      setRewardTimeUnit(null);
      setTotalStaked(null);
      setSnapshotOwner(null);
      setAmount('');
      setRefreshError(null);
      setMissionTrackingMessage(null);
    }

    if (!open || !address) {
      setSnapshotFresh(false);
      setLoading(false);
      setManualRefreshing(false);
      return;
    }

    void refresh({ force: true });

    return () => {
      refreshGenerationRef.current += 1;
      refreshRequestRef.current?.controller.abort();
      refreshRequestRef.current = null;
    };
  }, [address, open, refresh]);

  // Reconcile if another transaction updates balances while this dialog is open.
  useEffect(() => {
    if (!open || !address) {
      return;
    }

    return onBalanceRefresh(() => void refresh());
  }, [address, open, refresh]);

  const handleManualRefresh = useCallback(async () => {
    if (manualRefreshing || loading) return;

    const startedAt = Date.now();
    setManualRefreshing(true);

    try {
      await refresh({ force: true });
    } finally {
      const remainingFeedbackMs = MIN_REFRESH_FEEDBACK_MS - (Date.now() - startedAt);
      if (remainingFeedbackMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingFeedbackMs));
      }
      setManualRefreshing(false);
    }
  }, [loading, manualRefreshing, refresh]);

  const trackMissionProgress = useCallback((payload: Record<string, UntypedValue>) => {
    const generation = missionTrackingGenerationRef.current + 1;
    missionTrackingGenerationRef.current = generation;
    setMissionTrackingMessage(null);

    void postMissionProgress(payload)
      .then((response) => {
        if (missionTrackingGenerationRef.current !== generation) {
          return;
        }
        setMissionTrackingMessage(
          response.status === 202
            ? 'Transaction succeeded. Task progress is queued and will retry automatically.'
            : null,
        );
      })
      .catch((error) => {
        if (missionTrackingGenerationRef.current !== generation) {
          return;
        }
        console.warn('[staking] Failed to sync task progress:', error);
        setMissionTrackingMessage(
          'Transaction succeeded, but task progress could not be synced. Open Farmer\'s Tasks to retry.',
        );
      });
  }, []);

  const maxStake = useMemo(() => {
    return seedBalance;
  }, [seedBalance]);

  const maxUnstake = useMemo(() => {
    return stakeInfo?.staked ?? BigInt(0);
  }, [stakeInfo]);

  const setMaxAmount = (type: "stake" | "unstake") => {
    const value = type === "stake" ? maxStake : maxUnstake;
    if (value <= BigInt(0)) {
      setAmount("");
      return;
    }
    const asStr = formatUnits(value, 18);
    // Trim trailing zeros and optional dot
    const cleaned = asStr.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    setAmount(cleaned);
  };

  const sanitizedAmount = amount.trim();
  const hasCurrentSnapshot = Boolean(address && snapshotOwner === address.toLowerCase());
  const readState = getEconomicReadState({
    hasSnapshot: snapshotOwner !== null && snapshotFresh,
    identityMatches: hasCurrentSnapshot,
    loading,
    error: refreshError,
  });
  const dataReady = open && readState === 'ready';
  const displayToken = (value?: bigint) => hasCurrentSnapshot
    ? `${formatToken(value)}${readState !== 'ready' ? ' (last known)' : ''}`
    : readState === 'error' ? 'Unavailable' : 'Loading…';
  const safeParseUnits = parseAmountInput;
  const parsed = safeParseUnits(sanitizedAmount);
  const amountValidPositive = parsed !== null && parsed > BigInt(0);
  const stakedBal = stakeInfo?.staked ?? BigInt(0);
  const exceedsStake = dataReady && mode === 'stake' && amountValidPositive && parsed! > seedBalance;
  const exceedsUnstake = dataReady && mode === 'unstake' && amountValidPositive && parsed! > stakedBal;
  const disableStakeBtn = !dataReady || mode !== 'stake' || !approved || !amountValidPositive || !!exceedsStake;
  const disableUnstakeBtn = !dataReady || mode !== 'unstake' || !amountValidPositive || !!exceedsUnstake;
  const disableClaimRewardsBtn = !dataReady || !stakeInfo || stakeInfo.rewards <= BigInt(0);
  const helperText = sanitizedAmount !== "" && !amountValidPositive
    ? "Enter a valid amount (max 18 decimals)"
    : (exceedsStake ? "Amount exceeds wallet balance" : (exceedsUnstake ? "Amount exceeds staked balance" : ""));

  const rewardRateInfo = useMemo(() => {
    const zero = BigInt(0);
    if (!rewardRatio || rewardRatio.denominator === zero || !rewardTimeUnit || rewardTimeUnit <= zero) {
      return null;
    }

    const numeratorNumber = Number(rewardRatio.numerator);
    const denominatorNumber = Number(rewardRatio.denominator);
    if (!Number.isFinite(numeratorNumber) || !Number.isFinite(denominatorNumber) || denominatorNumber === 0) {
      return null;
    }

    const ratePerPeriod = numeratorNumber / denominatorNumber;
    if (!Number.isFinite(ratePerPeriod) || ratePerPeriod < 0) {
      return null;
    }

    const periodSeconds = Number(rewardTimeUnit);
    if (!Number.isFinite(periodSeconds) || periodSeconds <= 0) {
      return null;
    }

    const periodLabel = getPeriodLabel(periodSeconds);

    let stakedTokens = 0;
    if (stakeInfo?.staked) {
      const stakedAsNumber = Number(formatUnits(stakeInfo.staked, 18));
      if (Number.isFinite(stakedAsNumber)) {
        stakedTokens = stakedAsNumber;
      }
    }

    const estimated = stakedTokens * ratePerPeriod;

    return {
      ratePerUnit: ratePerPeriod,
      periodLabel,
      estimated,
      totalStaked:
        totalStaked !== null
          ? Number(formatUnits(totalStaked, 18))
          : null,
    };
  }, [rewardRatio, rewardTimeUnit, stakeInfo?.staked, totalStaked]);

  const footerTransactionButtonClassName = "h-auto min-h-11 flex-1 whitespace-normal [overflow-wrap:anywhere] max-[340px]:px-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="form" mobileMode="center" surface="soft" className="w-[min(94vw,28rem)] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={20} height={20} />
            Stake SEED
          </DialogTitle>
          <DialogDescription>
            Earn LEAF by staking your SEED. Approve once, then stake or unstake anytime.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="pr-1">
        {/* Mode switch placed below description with positive spacing */}
        <div className="mb-2 mt-1 flex flex-wrap items-center justify-between gap-2">
          <ToggleGroup
            className="max-w-full flex-wrap"
            ariaLabel="Staking action"
            value={mode}
            onValueChange={(v) => setMode((v as 'stake' | 'unstake') || 'stake')}
            options={[
              { value: 'stake', label: 'Stake' },
              { value: 'unstake', label: 'Unstake' },
            ]}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleManualRefresh}
            disabled={loading || manualRefreshing}
            title="Refresh"
            aria-label="Refresh stake data"
            aria-busy={loading || manualRefreshing || undefined}
          >
            <RefreshIcon refreshing={loading || manualRefreshing} className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-3 pb-2">
          {mode === 'stake' ? (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 text-xs">
              <div className={stakingTileClassName}>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                  SEED Balance
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">{displayToken(seedBalance)}</div>
              </div>
              <div className={stakingTileClassName}>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/icons/leaf.png" alt="LEAF" width={16} height={16} />
                  Unclaimed LEAF
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">{displayToken(stakeInfo?.rewards)}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 text-xs">
              <div className={stakingTileClassName}>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                  Staked SEED
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">{displayToken(stakeInfo?.staked)}</div>
              </div>
              <div className={stakingTileClassName}>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/icons/leaf.png" alt="LEAF" width={16} height={16} />
                  Unclaimed LEAF
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">{displayToken(stakeInfo?.rewards)}</div>
              </div>
            </div>
          )}

          {hasCurrentSnapshot && rewardRateInfo && (
            <div className={`${stakingTileClassName} text-xs`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reward Rate {readState !== 'ready' && '(last known)'}
                </span>
              </div>
              <div className="mt-1.5 space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="min-w-0 text-muted-foreground">Per SEED</span>
                  <ResourceValue resource="leaf" className="ml-auto text-right font-semibold leading-tight">
                    {formatRewardDisplay(rewardRateInfo.ratePerUnit)} LEAF / {rewardRateInfo.periodLabel}
                  </ResourceValue>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="min-w-0 text-muted-foreground">Your rate</span>
                  <ResourceValue resource="leaf" className="ml-auto text-right font-semibold leading-tight">
                    {formatRewardDisplay(rewardRateInfo.estimated)} LEAF / {rewardRateInfo.periodLabel}
                  </ResourceValue>
                </div>
                {typeof rewardRateInfo.totalStaked === 'number' && rewardRateInfo.totalStaked >= 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                    <span className="min-w-0 text-muted-foreground">Total staked</span>
                    <ResourceValue resource="seed" className="ml-auto text-right font-semibold leading-tight">
                      {totalStaked !== null ? formatTokenAmount(totalStaked) : '0'} SEED
                    </ResourceValue>
                  </div>
                )}
              </div>
            </div>
          )}

          {refreshError && (
            <Alert variant="warning">
              <AlertDescription className="space-y-2">
                <p>{refreshError}</p>
                <Button variant="outline" size="touchCompact" className="h-auto whitespace-normal [overflow-wrap:anywhere]" onClick={handleManualRefresh} disabled={loading || manualRefreshing}>
                  Retry staking data
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {missionTrackingMessage && (
            <Alert variant="warning">
              <AlertDescription>{missionTrackingMessage}</AlertDescription>
            </Alert>
          )}

          <AmountField id="staking-amount" label={mode === 'stake' ? 'Amount to stake' : 'Amount to unstake'} unit="SEED"
            value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.0" onMax={() => setMaxAmount(mode)}
            maxDisabled={!dataReady || (mode === 'stake' ? seedBalance : (stakeInfo?.staked ?? BigInt(0))) <= BigInt(0)}
            error={helperText || undefined} balance={displayToken(mode === 'stake' ? seedBalance : stakeInfo?.staked)} />

        </div>
        </DialogBody>

      <DialogFooter className="block">
        <div className="w-full space-y-2">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2">
            <div className={!approved && mode === "stake" ? "col-span-full flex min-w-0 flex-col" : "flex min-w-0 flex-col"}>
          {mode === 'stake' ? (
            !approved ? (
                <div className="flex flex-1 flex-col">
                  <GameTransaction
                    effects={{ domains: ["balances", "rewards"] }}
                    trackStreak={false}
                    intentKey="staking:approve-seed"
                    calls={[buildApproveStakeCall()]}
                    buttonText="Approve SEED for Staking"
                    pendingText="Approving SEED…"
                    buttonClassName={footerTransactionButtonClassName}
                    disabled={!dataReady}
                   onSuccess={() => {
                      setApproved(true);
                      void refresh({ force: true });
                   }}
                 />
              </div>
            ) : (
              <div className="flex flex-1 flex-col">
                 <GameTransaction
                   effects={{ domains: ["balances", "rewards"] }}
                   trackStreak={false}
                   intentKey="staking:stake"
                   calls={amountValidPositive ? [buildStakeCall(parsed)] : []}
                   buttonText="Stake"
                   pendingText="Staking…"
                   disabled={disableStakeBtn}
                   buttonClassName={footerTransactionButtonClassName}
                   onSuccess={(tx: UntypedValue) => {
                      setAmount("");
                      void refresh({ force: true });
                     try {
                       const payload: Record<string, UntypedValue> = { address, taskId: 's1_stake_seed' };
                       const txHash = extractTransactionHash(tx);
                       if (txHash) {
                         payload.proof = { txHash };
                       }
                       trackMissionProgress(payload);
                     } catch {}
                   }}
                 />
              </div>
            )
          ) : (
            <div className="flex flex-1 flex-col">
               <GameTransaction
                 effects={{ domains: ["allowances", "balances"] }}
                 trackStreak={false}
                 intentKey="staking:unstake"
                 calls={amountValidPositive ? [buildUnstakeCall(parsed)] : []}
                 buttonText="Unstake"
                 pendingText="Unstaking…"
                 disabled={disableUnstakeBtn}
                 buttonClassName={footerTransactionButtonClassName}
                 onSuccess={() => {
                    setAmount("");
                    void refresh({ force: true });
                 }}
               />
            </div>
          )}
            </div>

          <div className={!approved && mode === "stake" ? "col-span-full flex min-w-0 flex-col" : "flex min-w-0 flex-col"}>
            <GameTransaction
              effects={{ domains: ["balances", "rewards"] }}
              trackStreak={false}
              intentKey="staking:claim-rewards"
              calls={[buildClaimRewardsCall()]}
              buttonText={dataReady && stakeInfo && stakeInfo.rewards <= BigInt(0) ? "No rewards to claim" : "Claim Rewards"}
              pendingText="Claiming rewards…"
              disabled={disableClaimRewardsBtn}
              buttonClassName={footerTransactionButtonClassName}
              onSuccess={(tx: UntypedValue) => {
                 void refresh({ force: true });
                try {
                  const payload: Record<string, UntypedValue> = { address, taskId: 's1_claim_stake' };
                  const txHash = extractTransactionHash(tx);
                  if (txHash) {
                    payload.proof = { txHash };
                  }
                   trackMissionProgress(payload);
                } catch {}
              }}
            />
          </div>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
  );
}
