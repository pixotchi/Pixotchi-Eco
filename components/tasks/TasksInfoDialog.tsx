"use client";

import React, { useEffect, useState } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { StatusChip } from "@/components/ui/premium";
import { useAccount } from "wagmi";
import Image from "next/image";
import { CLIENT_ENV } from "@/lib/env-config";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { onTasksDialogOpen } from "@/lib/app-events";
import type { GmMissionDay } from "@/lib/gamification-types";

export default function TasksInfoDialog() {
  const { address } = useAccount();
  const gamificationDisabledMessage = CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE;
  const gamificationPolicy = getClientGamificationPolicy();
  const [open, setOpen] = useState(false);
  const [missionDay, setMissionDay] = useState<GmMissionDay | null>(null);
  const [missionPts, setMissionPts] = useState<number>(0);
  const [missionTotal, setMissionTotal] = useState<number>(0);
  const [streak, setStreak] = useState<{ current: number; best: number } | null>(null);
  const [serverDisabledMessage, setServerDisabledMessage] = useState<string | null>(null);
  const effectiveDisabled = !gamificationPolicy.enabled || !!serverDisabledMessage;
  const effectiveDisabledMessage =
    serverDisabledMessage ||
    gamificationPolicy.message ||
    gamificationDisabledMessage;
  const taskDotClass = (done?: boolean) =>
    `inline-block h-2 w-2 rounded-full ${done ? 'bg-[hsl(var(--success))]' : 'bg-muted-foreground/40'}`;

  useEffect(() => {
    return onTasksDialogOpen(() => setOpen(true));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (!address || !open || !gamificationPolicy.enabled) return;

        setServerDisabledMessage(null);

        // Fetch streak data
        const sRes = await fetch(`/api/gamification/streak?address=${address}`);
        if (sRes.ok) {
          const s = await sRes.json();
          if (s?.disabled) {
            setServerDisabledMessage(typeof s?.message === 'string' ? s.message : gamificationDisabledMessage);
            return;
          }
          setStreak({ current: s.streak.current, best: s.streak.best });
        }

        // Fetch missions data
        const mRes = await fetch(`/api/gamification/missions?address=${address}`);
        if (mRes.ok) {
          const m = await mRes.json();
          if (m?.disabled) {
            setServerDisabledMessage(typeof m?.message === 'string' ? m.message : gamificationDisabledMessage);
            return;
          }
          setMissionDay(m.day || null);
          setMissionPts(m.day?.pts ?? 0);
          setMissionTotal(typeof m.total === 'number' && Number.isFinite(m.total) ? m.total : 0);
        }
      } catch { }
    })();
  }, [address, open, gamificationPolicy.enabled, gamificationDisabledMessage]);

  useEffect(() => {
    if (gamificationPolicy.visible) return;
    setOpen(false);
  }, [gamificationPolicy.visible]);

  if (!gamificationPolicy.visible) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent mobileMode="sheet" surface="soft" className="max-w-md w-[min(94vw,28rem)] max-h-[calc(100dvh-1rem)]">
        <DialogHeader>
          <DialogTitle>Farmer&apos;s Tasks</DialogTitle>
          <DialogDescription>
            Earn up to 100 Rock per day by completing 4 sections. Daily reset at 00:00 UTC.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4 pr-1">
        {effectiveDisabled ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-sm font-semibold">Temporarily Disabled</p>
            <p className="text-xs text-muted-foreground mt-1">{effectiveDisabledMessage}</p>
          </div>
        ) : (
          <>
            {/* Progress Card - Streak & Rocks */}
            <div className="sticky top-0 z-10 -mx-1 grid grid-cols-2 gap-3 bg-inherit pb-1">
              {/* Streak */}
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Streak</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" className="animate-streak-colors" aria-hidden="true">
                    <rect x="2" y="2" width="20" height="20" rx="3" />
                  </svg>
                </div>
                <p className="text-xl font-bold">{streak?.current ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">Best: {streak?.best ?? 0}</p>
              </div>

              {/* Today&apos;s Rock */}
              <div className="p-3 rounded-lg bg-muted">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">Today</span>
                  <Image src="/icons/Volcanic_Rock.svg" alt="Rock" width={16} height={16} />
                </div>
                <p className="text-xl font-bold">{missionPts} / 100</p>
                <p className="text-[10px] text-muted-foreground">Lifetime: {missionTotal}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusChip tone={missionPts >= 100 ? "success" : "warning"}>{missionPts} / 100 today</StatusChip>
              <StatusChip tone="info">Best streak {streak?.best ?? 0}</StatusChip>
            </div>

            {/* Task Sections */}
            <div className="space-y-3 pb-2 text-sm">
              <div>
                <div className="font-medium">Section 1 - General (30 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.makeSwap)}></span> Make a SEED swap</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.stakeSeed)}></span> Stake SEED</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.claimStake)}></span> Claim stake rewards</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s1?.placeOrder)}></span> Place a SEED/LEAF order</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 2 - Social (20 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.followPlayer)}></span> Follow a player</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.chatMessage)}></span> Send a message in public chat</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s2?.visitProfile)}></span> Visit a profile</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 3 - Land (25 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.applyResources)}></span> Apply resources/production to a plant</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.sendQuest)}></span> Send a farmer on a quest</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.claimProduction)}></span> Claim production from any building</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s3?.playCasinoGame)}></span> Play a casino game (roulette/blackjack)</li>
                </ul>
              </div>
              <div>
                <div className="font-medium">Section 4 - Plant (25 Rocks)</div>
                <ul className="list-disc pl-5 text-muted-foreground text-xs space-y-1 mt-1">
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.buy10)}></span> Buy at least 10 elements</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.buyShield)}></span> Buy a shield/fence</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.collectStar)}></span> Collect a star by killing a plant</li>
                  <li className="flex items-center gap-2"><span className={taskDotClass(missionDay?.s4?.playArcade)}></span> Play an arcade game (Box or Spin)</li>
                </ul>
              </div>
            </div>
          </>
        )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
