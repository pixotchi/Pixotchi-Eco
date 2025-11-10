"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildApproveStakeCall,
  buildClaimRewardsCall,
  buildStakeCall,
  buildUnstakeCall,
} from "@/lib/contracts";
import UniversalTransaction from "@/components/transactions/universal-transaction";
import Image from "next/image";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import { usePaymaster } from "@/lib/paymaster-context";
import { formatUnits, parseUnits } from "viem";
import { RefreshCw } from "lucide-react";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { extractTransactionHash } from '@/lib/transaction-utils';

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

function formatToken(amount?: bigint): string {
  if (!amount) return "0";
  const formatted = formatUnits(amount, 18);
  const num = parseFloat(formatted);
  return num.toFixed(4).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

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

  const refresh = async () => {
    if (!address) return;
    if (refreshingRef.current) {
      return; // drop overlapping calls
    }
    
    // Rate limiting: prevent refreshes more frequent than MIN_REFRESH_INTERVAL
    const now = Date.now();
    if (now - lastRefreshTime.current < MIN_REFRESH_INTERVAL) {
      return;
    }
    lastRefreshTime.current = now;
    refreshingRef.current = true;
    setLoading(true);
    
    try {
      // Use API routes for consistent RPC handling
      const [balanceResponse, stakingResponse] = await Promise.all([
        fetch(`/api/staking/balance?address=${address}`).then(r => r.json() as Promise<BalanceApiResponse>),
        fetch(`/api/staking/info?address=${address}`).then(r => r.json() as Promise<StakingApiResponse>)
      ]);
      
      if (!balanceResponse.success) {
        throw new Error(`Balance API error: ${balanceResponse.error}`);
      }
      
      if (!stakingResponse.success) {
        throw new Error(`Staking API error: ${stakingResponse.error}`);
      }
      
      // Convert string responses back to bigint
      setSeedBalance(BigInt(balanceResponse.balance));
      setStakeInfo(stakingResponse.stake ? {
        staked: BigInt(stakingResponse.stake.staked),
        rewards: BigInt(stakingResponse.stake.rewards)
      } : null);
      setApproved(stakingResponse.approved);

      const ratioPayload = stakingResponse.rewardRatio ?? null;
      if (ratioPayload?.numerator && ratioPayload?.denominator) {
        try {
          setRewardRatio({
            numerator: BigInt(ratioPayload.numerator),
            denominator: BigInt(ratioPayload.denominator),
          });
        } catch {
          setRewardRatio(null);
        }
      } else {
        setRewardRatio(null);
      }

      if (stakingResponse.timeUnit) {
        try {
          setRewardTimeUnit(BigInt(stakingResponse.timeUnit));
        } catch {
          setRewardTimeUnit(null);
        }
      } else {
        setRewardTimeUnit(null);
      }

      if (stakingResponse.totalStaked) {
        try {
          setTotalStaked(BigInt(stakingResponse.totalStaked));
        } catch {
          setTotalStaked(null);
        }
      } else {
        setTotalStaked(null);
      }
    } catch (error) {
      console.error('❌ Failed to refresh staking data:', error);
      // Set safe defaults on error
      setSeedBalance(BigInt(0));
      setStakeInfo(null);
      setApproved(false);
      setRewardRatio(null);
      setRewardTimeUnit(null);
      setTotalStaked(null);
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  };

  useEffect(() => {
    if (open) {
      refresh();
    }
  }, [open, address]);

  // Also refresh when global balances:refresh is emitted after tx success
  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('balances:refresh', handler as EventListener);
    return () => window.removeEventListener('balances:refresh', handler as EventListener);
  }, [address]);

  // Note: Removed balances:refresh listener to prevent double refresh with status bar
  // The staking dialog will only refresh on manual refresh or dialog open
  // Global balance updates are handled by the status bar

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
  const safeParseUnits = (v: string): bigint | null => {
    if (!v) return null;
    if (!/^\d*(?:\.\d{0,18})?$/.test(v)) return null;
    try {
      return parseUnits(v, 18);
    } catch {
      return null;
    }
  };
  const parsed = safeParseUnits(sanitizedAmount);
  const amountValidPositive = parsed !== null && parsed > BigInt(0);
  const stakedBal = stakeInfo?.staked ?? BigInt(0);
  const exceedsStake = mode === 'stake' && amountValidPositive && parsed! > seedBalance;
  const exceedsUnstake = mode === 'unstake' && amountValidPositive && parsed! > stakedBal;
  const disableStakeBtn = mode !== 'stake' || !approved || !amountValidPositive || !!exceedsStake;
  const disableUnstakeBtn = mode !== 'unstake' || !amountValidPositive || !!exceedsUnstake;
  const helperText = sanitizedAmount !== "" && !amountValidPositive
    ? "Enter a valid amount (max 18 decimals)"
    : (exceedsStake ? "Amount exceeds wallet balance" : (exceedsUnstake ? "Amount exceeds staked balance" : ""));

  const rewardRateInfo = useMemo(() => {
    if (!rewardRatio || rewardRatio.denominator === 0n || !rewardTimeUnit || rewardTimeUnit <= 0n) {
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

  const { isSponsored } = usePaymaster();
  const refreshingRef = useRef<boolean>(false);
  const lastRefreshTime = useRef<number>(0);
  const MIN_REFRESH_INTERVAL = 1000; // Minimum 1 second between refreshes

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-[min(92vw,28rem)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={20} height={20} />
            Stake SEED
          </DialogTitle>
          <DialogDescription>
            Earn LEAF by staking your SEED. Approve once, then stake or unstake anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
        {/* Mode switch placed below description with positive spacing */}
        <div className="mt-2 mb-3 flex items-center justify-between">
          <ToggleGroup
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
            onClick={() => refresh()}
            title="Refresh"
            aria-label="Refresh stake data"
            className="h-8 w-8"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>

        <div className="space-y-5 pb-2">
          {mode === 'stake' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                  SEED Balance
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">{loading ? "…" : formatToken(seedBalance)}</div>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/icons/leaf.png" alt="LEAF" width={16} height={16} />
                  Unclaimed LEAF
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">{loading ? "…" : formatToken(stakeInfo?.rewards)}</div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="p-3 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/PixotchiKit/COIN.svg" alt="SEED" width={16} height={16} />
                  Staked SEED
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">{loading ? "…" : formatToken(stakeInfo?.staked)}</div>
              </div>
              <div className="p-3 rounded-lg border border-border bg-card">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Image src="/icons/leaf.png" alt="LEAF" width={16} height={16} />
                  Unclaimed LEAF
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">{loading ? "…" : formatToken(stakeInfo?.rewards)}</div>
              </div>
            </div>
          )}

          {rewardRateInfo && (
            <div className="rounded-lg border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Reward Rate <span className="font-normal text-muted-foreground">(rate varies based on total staked amount)</span>
                </span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Per SEED</span>
                  <span className="font-semibold">
                    {formatRewardDisplay(rewardRateInfo.ratePerUnit)} LEAF / {rewardRateInfo.periodLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Your rewards</span>
                  <span className="font-semibold">
                    {formatRewardDisplay(rewardRateInfo.estimated)} LEAF / {rewardRateInfo.periodLabel}
                  </span>
                </div>
                {typeof rewardRateInfo.totalStaked === 'number' && rewardRateInfo.totalStaked >= 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Total SEED staked</span>
                    <span className="font-semibold">
                      {rewardRateInfo.totalStaked.toLocaleString(undefined, { maximumFractionDigits: 2 })} SEED
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Amount to {mode === 'stake' ? 'Stake' : 'Unstake'}</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  inputMode="decimal"
                  className="pr-10"
                />
                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">SEED</div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMaxAmount(mode)}
                disabled={(mode === 'stake' ? seedBalance : (stakeInfo?.staked ?? BigInt(0))) <= BigInt(0)}
              >
                Max
              </Button>
            </div>
            {helperText && <div className="text-xs text-red-600 dark:text-red-400">{helperText}</div>}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {mode === 'stake' ? (
                <button onClick={() => setMaxAmount("stake")} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-sm px-1">Use wallet balance</button>
              ) : (
                <button onClick={() => setMaxAmount("unstake")} className="hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-sm px-1">Use staked balance</button>
              )}
              <span>{mode === 'stake' ? `Wallet: ${formatToken(seedBalance)} SEED` : `Staked: ${formatToken(stakeInfo?.staked)} SEED`}</span>
            </div>
          </div>

          {mode === 'stake' ? (
            !approved ? (
                <div className="space-y-2">
                <div className="flex justify-end">{isSponsored && <SponsoredBadge show />}</div>
                 <UniversalTransaction
                   calls={[buildApproveStakeCall()]}
                   buttonText="Approve SEED for Staking"
                   onSuccess={() => {
                     setApproved(true);
                     refresh();
                     window.dispatchEvent(new Event('balances:refresh'));
                   }}
                 />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex justify-end">{isSponsored && <SponsoredBadge show />}</div>
                 <UniversalTransaction
                   calls={[buildStakeCall(amount)]}
                   buttonText="Stake"
                   disabled={disableStakeBtn}
                   onSuccess={() => {
                     setAmount("");
                     refresh();
                     window.dispatchEvent(new Event('balances:refresh'));
                   }}
                 />
              </div>
            )
          ) : (
            <div className="space-y-2">
              <div className="flex justify-end">{isSponsored && <SponsoredBadge show />}</div>
               <UniversalTransaction
                 calls={[buildUnstakeCall(amount)]}
                 buttonText="Unstake"
                 disabled={disableUnstakeBtn}
                 onSuccess={() => {
                   setAmount("");
                   refresh();
                   window.dispatchEvent(new Event('balances:refresh'));
                 }}
               />
            </div>
          )}

          <div className="space-y-2">
            <UniversalTransaction
              calls={[buildClaimRewardsCall()]}
              buttonText="Claim Rewards"
              buttonClassName="bg-green-600 hover:bg-green-700 text-white"
              onSuccess={(tx: any) => {
                refresh();
                window.dispatchEvent(new Event('balances:refresh'));
                try {
                  const payload: Record<string, unknown> = { address, taskId: 's3_claim_stake' };
                  const txHash = extractTransactionHash(tx);
                  if (txHash) {
                    payload.proof = { txHash };
                  }
                  fetch('/api/gamification/missions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                  });
                } catch {}
              }}
            />
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
  );
}


